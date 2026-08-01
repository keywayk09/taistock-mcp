import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  dateSchema,
  fail,
  finmind,
  num,
  ok,
  rec,
  round,
  stockSchema,
  taipeiDate,
  type Obj,
} from "../v6/common";

const ACTIVE_ETF_DATASETS = {
  info: "TaiwanStockActiveETFInfo",
  holdings: "TaiwanStockActiveETFHolding",
  changes: "TaiwanStockActiveETFHoldingChange",
} as const;

const assetTypeSchema = z.enum(["all", "stock", "bond", "futures", "option", "cash", "etf", "repo", "other"]);

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function holding(row: unknown) {
  const value = rec(row);
  return {
    date: String(value.date ?? ""),
    etf_id: String(value.stock_id ?? ""),
    component_id: String(value.component_stock_id ?? ""),
    component_name: String(value.component_stock_name ?? ""),
    asset_type: String(value.asset_type ?? "other"),
    shares: num(value.shares),
    weight_percent: num(value.weight),
    market_value: num(value.market_value),
    currency: String(value.currency ?? ""),
  };
}

function holdingChange(row: unknown) {
  const value = rec(row);
  const buy = num(value.buy), sell = num(value.sell);
  return {
    date: String(value.date ?? ""),
    etf_id: String(value.stock_id ?? ""),
    component_id: String(value.component_stock_id ?? ""),
    component_name: String(value.component_stock_name ?? ""),
    buy_shares: buy,
    sell_shares: sell,
    net_change_shares: buy - sell,
  };
}

function dateList(rows: ReturnType<typeof holding>[]) {
  return [...new Set(rows.map((row) => row.date))].filter(Boolean).sort();
}

function filterAsset(rows: ReturnType<typeof holding>[], assetType: string) {
  return assetType === "all" ? rows : rows.filter((row) => row.asset_type === assetType);
}

function snapshotMap(rows: ReturnType<typeof holding>[], date: string, assetType: string) {
  return new Map(filterAsset(rows.filter((row) => row.date === date), assetType)
    .map((row) => [row.component_id, row] as const));
}

function compareSnapshots(
  rows: ReturnType<typeof holding>[],
  changes: ReturnType<typeof holdingChange>[],
  currentDate: string,
  previousDate: string | null,
  assetType: string,
) {
  const current = snapshotMap(rows, currentDate, assetType);
  const previous = previousDate ? snapshotMap(rows, previousDate, assetType) : new Map<string, ReturnType<typeof holding>>();
  const direct = new Map(changes.filter((row) => row.date === currentDate).map((row) => [row.component_id, row] as const));
  const keys = [...new Set([...current.keys(), ...previous.keys(), ...direct.keys()])];
  const output = keys.map((componentId) => {
    const now = current.get(componentId) ?? null;
    const before = previous.get(componentId) ?? null;
    const change = direct.get(componentId) ?? null;
    const shareDelta = (now?.shares ?? 0) - (before?.shares ?? 0);
    const weightDelta = now && before ? round(now.weight_percent - before.weight_percent, 4) : null;
    const status = !before && now ? "added"
      : before && !now ? "removed"
      : shareDelta > 0 ? "increased"
      : shareDelta < 0 ? "decreased"
      : "unchanged";
    return {
      component_id: componentId,
      component_name: now?.component_name ?? before?.component_name ?? change?.component_name ?? "",
      asset_type: now?.asset_type ?? before?.asset_type ?? "unknown",
      status,
      previous_shares: before?.shares ?? 0,
      current_shares: now?.shares ?? 0,
      share_delta: shareDelta,
      previous_weight_percent: before?.weight_percent ?? 0,
      current_weight_percent: now?.weight_percent ?? 0,
      weight_change_percentage_points: weightDelta,
      reported_buy_shares: change?.buy_shares ?? 0,
      reported_sell_shares: change?.sell_shares ?? 0,
      currency: now?.currency ?? before?.currency ?? "",
    };
  });
  return output.filter((row) => row.status !== "unchanged");
}

function statusSummary(rows: ReturnType<typeof compareSnapshots>) {
  const count = (status: string) => rows.filter((row) => row.status === status).length;
  return {
    added: count("added"),
    removed: count("removed"),
    increased: count("increased"),
    decreased: count("decreased"),
  };
}

function sourceNote() {
  return {
    source: "FinMind",
    datasets: ACTIVE_ETF_DATASETS,
    access: "持股明細與持股異動資料需要 FinMind sponsor 會員權限。",
    caution: "申購或贖回會使整體持股股數等比例變化；股數增減不必然代表經理人主動買賣。新增與剔除以相鄰持股快照是否由零變有、由有變零判定。",
  };
}

export function registerEtfTools(server: McpServer, env: Env) {
  server.registerTool("get_active_etf_list", {
    description: "取得台灣上市櫃主動式ETF清單與基本分類。",
    inputSchema: {
      category: z.enum(["all", "domestic", "foreign"]).optional().default("all"),
      market: z.enum(["all", "twse", "tpex"]).optional().default("all"),
    },
  }, async ({ category, market }) => {
    try {
      const rows = (await finmind(env, ACTIVE_ETF_DATASETS.info, {})).map((row) => {
        const value = rec(row);
        return {
          date: String(value.date ?? ""),
          etf_id: String(value.stock_id ?? ""),
          etf_name: String(value.stock_name ?? ""),
          category: String(value.category ?? ""),
          market: String(value.type ?? ""),
        };
      }).filter((row) => (category === "all" || row.category === category) && (market === "all" || row.market === market));
      return ok({ ...sourceNote(), count: rows.length, data: rows });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_active_etf_holdings", {
    description: "查詢單一主動式ETF每日完整持股、權重與資產類別；可只取最新快照。需要FinMind sponsor權限。",
    inputSchema: {
      etf_id: stockSchema,
      start_date: dateSchema.optional(),
      end_date: dateSchema.optional(),
      asset_type: assetTypeSchema.optional().default("stock"),
      latest_only: z.boolean().optional().default(true),
      top_n: z.number().int().min(1).max(1000).optional().default(200),
    },
  }, async ({ etf_id, start_date, end_date, asset_type, latest_only, top_n }) => {
    try {
      const end = end_date ?? taipeiDate();
      const start = start_date ?? shiftDate(end, -45);
      const rows = (await finmind(env, ACTIVE_ETF_DATASETS.holdings, { data_id: etf_id, start_date: start, end_date: end })).map(holding);
      const dates = dateList(rows);
      const latestDate = dates.at(-1) ?? null;
      let selected = filterAsset(rows, asset_type);
      if (latest_only && latestDate) selected = selected.filter((row) => row.date === latestDate);
      selected.sort((a, b) => b.weight_percent - a.weight_percent || Math.abs(b.market_value) - Math.abs(a.market_value));
      return ok({
        ...sourceNote(), etf_id, requested_range: { start_date: start, end_date: end },
        latest_available_date: latestDate, asset_type, total_rows: selected.length,
        data: selected.slice(0, top_n), truncated: selected.length > top_n,
      });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_active_etf_holding_changes", {
    description: "比較主動式ETF相鄰持股快照，辨識新增、剔除、加碼、減碼及權重變化。需要FinMind sponsor權限。",
    inputSchema: {
      etf_id: stockSchema,
      date: dateSchema.optional().default(taipeiDate()),
      lookback_days: z.number().int().min(3).max(60).optional().default(14),
      asset_type: assetTypeSchema.optional().default("stock"),
      include_increased_decreased: z.boolean().optional().default(true),
      top_n: z.number().int().min(1).max(1000).optional().default(300),
    },
  }, async ({ etf_id, date, lookback_days, asset_type, include_increased_decreased, top_n }) => {
    try {
      const start = shiftDate(date, -lookback_days);
      const [holdingRows, changeRows] = await Promise.all([
        finmind(env, ACTIVE_ETF_DATASETS.holdings, { data_id: etf_id, start_date: start, end_date: date }),
        finmind(env, ACTIVE_ETF_DATASETS.changes, { data_id: etf_id, start_date: start, end_date: date }),
      ]);
      const holdings = holdingRows.map(holding);
      const changes = changeRows.map(holdingChange);
      const dates = dateList(holdings);
      const currentDate = dates.at(-1) ?? null;
      const previousDate = dates.at(-2) ?? null;
      if (!currentDate) throw new Error(`${etf_id} 在查詢區間內沒有持股資料`);
      let compared = compareSnapshots(holdings, changes, currentDate, previousDate, asset_type);
      if (!include_increased_decreased) compared = compared.filter((row) => row.status === "added" || row.status === "removed");
      compared.sort((a, b) => {
        const priority: Record<string, number> = { added: 0, removed: 1, increased: 2, decreased: 3 };
        return (priority[a.status] ?? 9) - (priority[b.status] ?? 9)
          || Math.abs(b.weight_change_percentage_points ?? 0) - Math.abs(a.weight_change_percentage_points ?? 0)
          || Math.abs(b.share_delta) - Math.abs(a.share_delta);
      });
      return ok({
        ...sourceNote(), etf_id, requested_date: date, current_date: currentDate, previous_date: previousDate,
        asset_type, summary: statusSummary(compared), total_changes: compared.length,
        data: compared.slice(0, top_n), truncated: compared.length > top_n,
      });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_stock_active_etf_activity", {
    description: "查詢某檔股票在全部主動式ETF中的持股與當日買賣變化，找出哪些ETF新增、剔除、加碼或減碼。需要FinMind sponsor權限。",
    inputSchema: {
      symbol: stockSchema,
      date: dateSchema.optional().default(taipeiDate()),
      lookback_days: z.number().int().min(3).max(60).optional().default(14),
    },
  }, async ({ symbol, date, lookback_days }) => {
    try {
      const start = shiftDate(date, -lookback_days);
      const [holdingRows, changeRows, infoRows] = await Promise.all([
        finmind(env, ACTIVE_ETF_DATASETS.holdings, { start_date: start, end_date: date }),
        finmind(env, ACTIVE_ETF_DATASETS.changes, { start_date: start, end_date: date }),
        finmind(env, ACTIVE_ETF_DATASETS.info, {}),
      ]);
      const holdings = holdingRows.map(holding).filter((row) => row.component_id === symbol);
      const changes = changeRows.map(holdingChange).filter((row) => row.component_id === symbol);
      const info = new Map(infoRows.map((row) => {
        const value = rec(row);
        return [String(value.stock_id ?? ""), { etf_name: String(value.stock_name ?? ""), category: String(value.category ?? ""), market: String(value.type ?? "") }] as const;
      }));
      const etfIds = [...new Set([...holdings.map((row) => row.etf_id), ...changes.map((row) => row.etf_id)])];
      const activity = etfIds.map((etfId) => {
        const etfHoldings = holdings.filter((row) => row.etf_id === etfId);
        const dates = dateList(etfHoldings);
        const currentDate = dates.at(-1) ?? null;
        const previousDate = dates.at(-2) ?? null;
        const current = currentDate ? etfHoldings.find((row) => row.date === currentDate) ?? null : null;
        const previous = previousDate ? etfHoldings.find((row) => row.date === previousDate) ?? null : null;
        const directDate = [...new Set(changes.filter((row) => row.etf_id === etfId).map((row) => row.date))].sort().at(-1) ?? null;
        const direct = directDate ? changes.find((row) => row.etf_id === etfId && row.date === directDate) ?? null : null;
        const shareDelta = (current?.shares ?? 0) - (previous?.shares ?? 0);
        const status = !previous && current ? "added" : previous && !current ? "removed" : shareDelta > 0 ? "increased" : shareDelta < 0 ? "decreased" : "unchanged";
        return {
          etf_id: etfId,
          ...info.get(etfId),
          current_date: currentDate,
          previous_date: previousDate,
          status,
          previous_shares: previous?.shares ?? 0,
          current_shares: current?.shares ?? 0,
          share_delta: shareDelta,
          previous_weight_percent: previous?.weight_percent ?? 0,
          current_weight_percent: current?.weight_percent ?? 0,
          weight_change_percentage_points: current && previous ? round(current.weight_percent - previous.weight_percent, 4) : null,
          reported_buy_shares: direct?.buy_shares ?? 0,
          reported_sell_shares: direct?.sell_shares ?? 0,
        };
      }).filter((row) => row.status !== "unchanged" || row.reported_buy_shares > 0 || row.reported_sell_shares > 0)
        .sort((a, b) => Math.abs(b.share_delta) - Math.abs(a.share_delta));
      return ok({ ...sourceNote(), symbol, requested_date: date, etf_count: activity.length, data: activity });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_active_etf_daily_change_report", {
    description: "彙整全部主動式ETF某日新增、剔除與主要買賣持股，供台股盤後日報使用。需要FinMind sponsor權限。",
    inputSchema: {
      date: dateSchema.optional().default(taipeiDate()),
      lookback_days: z.number().int().min(3).max(30).optional().default(10),
      top_n: z.number().int().min(5).max(200).optional().default(50),
    },
  }, async ({ date, lookback_days, top_n }) => {
    try {
      const start = shiftDate(date, -lookback_days);
      const [holdingRows, changeRows, infoRows] = await Promise.all([
        finmind(env, ACTIVE_ETF_DATASETS.holdings, { start_date: start, end_date: date }),
        finmind(env, ACTIVE_ETF_DATASETS.changes, { start_date: start, end_date: date }),
        finmind(env, ACTIVE_ETF_DATASETS.info, {}),
      ]);
      const holdings = holdingRows.map(holding).filter((row) => row.asset_type === "stock");
      const changes = changeRows.map(holdingChange);
      const info = new Map(infoRows.map((row) => {
        const value = rec(row);
        return [String(value.stock_id ?? ""), String(value.stock_name ?? "")] as const;
      }));
      const etfIds = [...new Set(holdings.map((row) => row.etf_id))];
      const compared = etfIds.flatMap((etfId) => {
        const rows = holdings.filter((row) => row.etf_id === etfId);
        const dates = dateList(rows);
        const currentDate = dates.at(-1);
        const previousDate = dates.at(-2) ?? null;
        if (!currentDate) return [];
        return compareSnapshots(rows, changes.filter((row) => row.etf_id === etfId), currentDate, previousDate, "stock")
          .map((row) => ({ etf_id: etfId, etf_name: info.get(etfId) ?? "", current_date: currentDate, previous_date: previousDate, ...row }));
      });
      const additions = compared.filter((row) => row.status === "added")
        .sort((a, b) => b.current_weight_percent - a.current_weight_percent).slice(0, top_n);
      const removals = compared.filter((row) => row.status === "removed")
        .sort((a, b) => b.previous_weight_percent - a.previous_weight_percent).slice(0, top_n);
      const buys = compared.filter((row) => row.share_delta > 0)
        .sort((a, b) => b.share_delta - a.share_delta).slice(0, top_n);
      const sells = compared.filter((row) => row.share_delta < 0)
        .sort((a, b) => a.share_delta - b.share_delta).slice(0, top_n);
      return ok({
        ...sourceNote(), requested_date: date, etfs_analyzed: etfIds.length,
        summary: statusSummary(compared), additions, removals, largest_share_increases: buys, largest_share_decreases: sells,
      });
    } catch (error) { return fail(error); }
  });
}
