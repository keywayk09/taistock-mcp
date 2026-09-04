import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getTwMarketChipSummaryPublished } from "./market-data-published-gateway.ts";
import { getTwBrokerRankedOnDemand, getTwBrokerRankedWindowBundleOnDemand } from "./tw-broker-ranked-on-demand.ts";
import { getTwChipOnDemandSnapshot } from "./tw-chip-on-demand.ts";

export const LEGACY_OWNER_CHIP_OVERRIDE_TOOL_NAMES = Object.freeze([
  "get_broker_chips",
  "get_institutional",
  "get_margin",
  "get_short_pressure",
] as const);

const symbolSchema = z.string().trim().min(1).max(20).regex(/^[0-9A-Za-z._-]+$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const marketSchema = z.enum(["auto", "listed", "otc"]);

const out = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

function taipeiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function calendarDays(startDate: string | undefined, asOf: string, fallback: number) {
  if (!startDate) return Math.max(30, Math.min(180, fallback));
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return Math.max(30, Math.min(180, fallback));
  return Math.max(30, Math.min(180, Math.floor((end - start) / 86_400_000) + 1));
}

function rowsOf(value: unknown) {
  const record = value && typeof value === "object" ? value as Record<string, any> : {};
  return Array.isArray(record.rows) ? record.rows as any[] : [];
}

function mergeCurrentOverHistory(historyRows: any[], currentRows: any[], limit: number) {
  const rows = new Map<string, any>();
  for (const row of [...historyRows, ...currentRows]) {
    const key = `${String(row?.trade_date ?? row?.date ?? "")}:${String(row?.market ?? "")}:${String(row?.symbol ?? "")}`;
    rows.set(key, row);
  }
  return [...rows.values()]
    .sort((a, b) => String(a?.trade_date ?? a?.date ?? "").localeCompare(String(b?.trade_date ?? b?.date ?? "")))
    .slice(-limit);
}

async function currentAndHistory(env: Env, input: {
  symbol: string;
  as_of: string;
  calendar_days: number;
}) {
  const [current, history] = await Promise.all([
    getTwChipOnDemandSnapshot({ symbol: input.symbol, as_of: input.as_of }),
    getTwMarketChipSummaryPublished(env, {
      symbol: input.symbol,
      as_of: input.as_of,
      calendar_days: input.calendar_days,
    }),
  ]);
  return { current, history: history as Record<string, any> };
}

function compactBrokerWindow(result: any, topN: number) {
  const buys = Array.isArray(result?.buys) ? result.buys : [];
  const sells = Array.isArray(result?.sells) ? result.sells : [];
  return {
    window_days: result?.window_days ?? null,
    source_window_label: result?.source_window_label ?? null,
    status: result?.status ?? "UNAVAILABLE",
    source_date: result?.source_date ?? null,
    source_date_verified: result?.source_date_verified === true,
    source_window_verified: result?.source_window_verified === true,
    ranked_output_totals: result?.ranked_output_totals ?? null,
    top_net_buyers: buys.slice(0, topN),
    top_net_sellers: sells.slice(0, topN),
    rank_count: result?.rank_count ?? { buy: buys.length, sell: sells.length },
    error: result && "error" in result ? result.error : null,
  };
}

/**
 * Frozen 79-tool semantic bridge.
 *
 * These public names and input schemas are intentionally preserved because old
 * ChatGPT connections may cache them indefinitely. Only the provider behind the
 * names changes: current chip evidence is exact-date official on-demand;
 * Published/GitHub data is history context only; broker branches are MoneyDJ
 * ranked-only secondary evidence. No current raw/normalized chip data is saved.
 */
export function registerLegacyOwnerChipTools(server: McpServer, env: Env) {
  server.registerTool("get_broker_chips", {
    description: "券商分點 Ranked-only 查詢；目前來源 MoneyDJ 公開次級資料。保留原 symbol/date/top_n 輸入，同一次回傳 1日與 MoneyDJ 伺服器端 5/10/20/60 日區間排名，不以每日Top榜自行加總。缺席分點不代表零交易；exact-date 驗證、唯讀、不保存，且不依賴 FinMind Token。",
    inputSchema: {
      symbol: symbolSchema,
      date: dateSchema,
      top_n: z.number().int().min(1).max(50).optional().default(20),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ symbol, date, top_n }) => {
    const [ranked, bundle] = await Promise.all([
      getTwBrokerRankedOnDemand({ symbol, as_of: date }),
      getTwBrokerRankedWindowBundleOnDemand({ symbol, as_of: date }),
    ]);
    const multiWindow = Object.fromEntries(
      ["5D", "10D", "20D", "60D"].map((key) => [key, compactBrokerWindow(bundle.windows[key], top_n)]),
    );
    return out({
      source: ranked.source,
      provider: "MoneyDJ",
      tier: "PUBLIC_SECONDARY",
      completeness: "RANKED_ONLY",
      symbol,
      date,
      status: ranked.status,
      source_date: ranked.source_date,
      source_date_verified: ranked.source_date_verified,
      top_net_buyers: ranked.buys.slice(0, top_n),
      top_net_sellers: ranked.sells.slice(0, top_n),
      rank_count: "rank_count" in ranked ? ranked.rank_count : { buy: ranked.buys.length, sell: ranked.sells.length },
      missing_branch_means_zero: false,
      previous_day_substitution: false,
      persistence: "NONE",
      interpretation_boundary: "Ranked public-page output only. A branch missing from the ranking must not be interpreted as zero activity or no trading. Broker names are execution channels and must not be treated as investor identity.",
      multi_window: {
        version: bundle.version,
        status: bundle.status,
        requested_windows: bundle.requested_windows,
        server_side_interval_aggregation: bundle.server_side_interval_aggregation,
        daily_rank_summing: bundle.daily_rank_summing,
        missing_window_observation: bundle.missing_window_observation,
        origin_concurrency_limit: bundle.origin_concurrency_limit,
        windows: multiWindow,
        branch_matrix: bundle.branch_matrix.slice(0, top_n),
        horizon_lens: {
          S: ["1D", "5D", "10D"],
          M: ["10D", "20D", "60D"],
          L: ["20D", "60D"],
          optional_deep_L_window_days: 120,
        },
        interpretation_boundary: bundle.interpretation_boundary,
      },
      error: "error" in ranked ? ranked.error : null,
      retrieved_at: ranked.retrieved_at,
    });
  });

  server.registerTool("get_institutional", {
    description: "個股三大法人籌碼。requested end_date 當日優先直接讀 TWSE/TPEx 官方 exact-date on-demand；舊 Published/GitHub 只補歷史背景，禁止前一交易日冒充當日。公開名稱與舊參數保持相容。",
    inputSchema: {
      symbol: symbolSchema,
      start_date: dateSchema.optional(),
      end_date: dateSchema.optional(),
      limit_days: z.number().int().min(1).max(120).optional().default(20),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ symbol, start_date, end_date, limit_days }) => {
    const asOf = end_date ?? taipeiToday();
    const window = calendarDays(start_date, asOf, Math.max(60, limit_days * 3));
    const { current, history } = await currentAndHistory(env, { symbol, as_of: asOf, calendar_days: window });
    const currentLayer = current.layers.institutional;
    const historyLayer = history.layers?.institutional ?? null;
    return out({
      source_priority: ["TWSE/TPEx OFFICIAL EXACT_DATE_ON_DEMAND", "PUBLISHED_GITHUB HISTORY_CONTEXT_ONLY"],
      symbol,
      requested_as_of: asOf,
      status: currentLayer.status,
      data: mergeCurrentOverHistory(rowsOf(historyLayer), currentLayer.rows, limit_days),
      on_demand_current: currentLayer,
      history_context: {
        role: "HISTORY_CONTEXT_ONLY",
        data_as_of: history.data_as_of ?? null,
        status: historyLayer?.status ?? history.status ?? "UNAVAILABLE",
        rows: rowsOf(historyLayer).slice(-limit_days),
      },
      source_health: current.source_health,
      previous_day_substitution: false,
      current_persistence: "NONE",
    });
  });

  server.registerTool("get_margin", {
    description: "個股融資融券。requested end_date 當日直接讀 TWSE MI_MARGN 或 TPEx 官方 exact-date on-demand；舊 Published/GitHub 只補歷史背景，未公布回 PENDING，不拿前一日冒充。公開名稱與舊參數保持相容。",
    inputSchema: {
      symbol: symbolSchema,
      start_date: dateSchema.optional(),
      end_date: dateSchema.optional(),
      limit: z.number().int().min(1).max(250).optional().default(30),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ symbol, start_date, end_date, limit }) => {
    const asOf = end_date ?? taipeiToday();
    const window = calendarDays(start_date, asOf, Math.max(60, Math.min(180, limit * 3)));
    const { current, history } = await currentAndHistory(env, { symbol, as_of: asOf, calendar_days: window });
    const currentLayer = current.layers.margin_short;
    const historyLayer = history.layers?.margin ?? null;
    return out({
      source_priority: ["TWSE/TPEx OFFICIAL EXACT_DATE_ON_DEMAND", "PUBLISHED_GITHUB HISTORY_CONTEXT_ONLY"],
      symbol,
      requested_as_of: asOf,
      status: currentLayer.status,
      data: mergeCurrentOverHistory(rowsOf(historyLayer), currentLayer.rows, limit),
      on_demand_current: currentLayer,
      history_context: {
        role: "HISTORY_CONTEXT_ONLY",
        data_as_of: history.data_as_of ?? null,
        status: historyLayer?.status ?? history.status ?? "UNAVAILABLE",
        rows: rowsOf(historyLayer).slice(-limit),
      },
      source_health: current.source_health,
      previous_day_substitution: false,
      current_persistence: "NONE",
    });
  });

  server.registerTool("get_short_pressure", {
    description: "空方/籌碼壓力相容入口。當期融資融券、借券與借券賣出統一走 TWSE/TPEx official exact-date on-demand；Published/GitHub 僅為歷史背景。未公布 fail-closed，不以 FinMind 或前一日資料冒充當期。",
    inputSchema: {
      symbol: symbolSchema,
      market: marketSchema.optional().default("auto"),
      days: z.number().int().min(5).max(120).optional().default(30),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ symbol, market, days }) => {
    const asOf = taipeiToday();
    const window = Math.max(30, Math.min(180, days * 3));
    const { current, history } = await currentAndHistory(env, { symbol, as_of: asOf, calendar_days: window });
    const marginHistory = rowsOf(history.layers?.margin).slice(-days);
    const lendingHistory = rowsOf(history.layers?.securities_lending).slice(-days);
    const sblHistory = rowsOf(history.layers?.sbl_short_sale).slice(-days);
    return out({
      source_priority: ["TWSE/TPEx OFFICIAL EXACT_DATE_ON_DEMAND", "PUBLISHED_GITHUB HISTORY_CONTEXT_ONLY"],
      symbol,
      market_requested: market,
      requested_as_of: asOf,
      status: current.status,
      official_current: {
        margin_short: current.layers.margin_short,
        securities_lending: current.layers.securities_lending,
        sbl_short_sale: current.layers.sbl_short_sale,
      },
      margin_history: marginHistory,
      securities_lending: mergeCurrentOverHistory(lendingHistory, current.layers.securities_lending.rows, days),
      sbl_short_sale: mergeCurrentOverHistory(sblHistory, current.layers.sbl_short_sale.rows, days),
      history_context: {
        role: "HISTORY_CONTEXT_ONLY",
        data_as_of: history.data_as_of ?? null,
        status: history.status ?? "UNAVAILABLE",
      },
      source_health: current.source_health,
      previous_day_substitution: false,
      current_persistence: "NONE",
      interpretation_boundary: "融資增加不自動等於偏空；借券餘額、借券賣出與融券是不同事件層，須分開解讀。",
    });
  });
}
