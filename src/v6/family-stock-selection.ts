import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  concurrencyMap,
  fail,
  finmind,
  fugle,
  normalizeDailyBars,
  normalizeQuote,
  num,
  ok,
  rec,
  round,
  taipeiDate,
  technicalSummary,
  type DailyBar,
} from "./common";

export const FAMILY_STOCK_SELECTION_VERSION = "family-stock-selection/v1.1.0";

type FamilyMode = "stable" | "balanced" | "aggressive";
type SnapshotSource = "FUGLE" | "FUGLE_WITH_FINMIND_FALLBACK" | "FINMIND_FALLBACK" | "UNAVAILABLE";

type CandidateInput = {
  symbol: string;
  name: string;
  market: string;
  sector: string;
  close: number;
  change_percent: number;
  trade_value: number;
  technical_score: number;
  return_20d_percent: number | null;
  return_60d_percent: number | null;
  annualized_volatility_60d_percent: number | null;
  max_drawdown_percent: number | null;
  atr14: number | null;
  distance_to_sma20_atr: number | null;
  distance_to_prior_20d_high_percent: number | null;
  revenue_yoy_percent: number | null;
};

const MODE_CONFIG: Record<FamilyMode, {
  minTradeValue: number;
  maxDailyGainForResearch: number;
  maxReturn20ForResearch: number;
  maxExtensionAtrForResearch: number;
  snapshotShortlist: number;
  technicalShortlist: number;
  weights: { technical: number; growth: number; liquidity: number; risk: number; location: number };
}> = {
  stable: {
    minTradeValue: 50_000_000,
    maxDailyGainForResearch: 5.0,
    maxReturn20ForResearch: 18,
    maxExtensionAtrForResearch: 2.0,
    snapshotShortlist: 36,
    technicalShortlist: 14,
    weights: { technical: 0.35, growth: 0.20, liquidity: 0.15, risk: 0.20, location: 0.10 },
  },
  balanced: {
    minTradeValue: 20_000_000,
    maxDailyGainForResearch: 7.0,
    maxReturn20ForResearch: 25,
    maxExtensionAtrForResearch: 2.5,
    snapshotShortlist: 44,
    technicalShortlist: 16,
    weights: { technical: 0.45, growth: 0.20, liquidity: 0.15, risk: 0.10, location: 0.10 },
  },
  aggressive: {
    minTradeValue: 10_000_000,
    maxDailyGainForResearch: 9.0,
    maxReturn20ForResearch: 35,
    maxExtensionAtrForResearch: 3.0,
    snapshotShortlist: 52,
    technicalShortlist: 18,
    weights: { technical: 0.55, growth: 0.15, liquidity: 0.10, risk: 0.05, location: 0.15 },
  },
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function latestRevenueGrowth(rows: any[]): number | null {
  const normalized = rows
    .map((row) => ({
      revenue: num(row.revenue),
      year: num(row.revenue_year),
      month: num(row.revenue_month),
    }))
    .filter((row) => row.revenue > 0 && row.year > 0 && row.month > 0)
    .sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month));
  const latest = normalized.at(-1);
  if (!latest) return null;
  const lastYear = normalized.find((row) => row.year === latest.year - 1 && row.month === latest.month);
  if (!lastYear?.revenue) return null;
  return round((latest.revenue / lastYear.revenue - 1) * 100, 2);
}

function dailyContext(bars: DailyBar[]) {
  const tech = technicalSummary(bars);
  const latest = bars.at(-1);
  const prior20 = bars.slice(-21, -1);
  const prior20High = prior20.length ? Math.max(...prior20.map((bar) => bar.high)) : null;
  const atr = num((tech as any).atr14);
  const sma20 = num((tech as any).sma20);
  const distanceToSma20Atr = latest && atr > 0 ? round((latest.close - sma20) / atr, 3) : null;
  const distanceToPrior20High = latest && prior20High
    ? round((latest.close / prior20High - 1) * 100, 2)
    : null;
  return {
    technical: tech,
    distance_to_sma20_atr: distanceToSma20Atr,
    distance_to_prior_20d_high_percent: distanceToPrior20High,
  };
}

export function scoreFamilyCandidate(input: CandidateInput, mode: FamilyMode) {
  const cfg = MODE_CONFIG[mode];
  const technical = clamp(input.technical_score);
  const growth = input.revenue_yoy_percent == null
    ? 50
    : clamp(50 + input.revenue_yoy_percent * 1.5);
  const liquidity = input.trade_value > 0
    ? clamp(55 + Math.log10(Math.max(1, input.trade_value / cfg.minTradeValue)) * 22)
    : 0;
  const volatility = Math.max(0, input.annualized_volatility_60d_percent ?? 60);
  const drawdown = Math.abs(Math.min(0, input.max_drawdown_percent ?? -30));
  const risk = mode === "stable"
    ? clamp(100 - volatility * 0.75 - drawdown * 0.65)
    : mode === "balanced"
      ? clamp(100 - volatility * 0.50 - drawdown * 0.45)
      : clamp(100 - volatility * 0.30 - drawdown * 0.25);

  const d20 = input.distance_to_prior_20d_high_percent;
  const extension = input.distance_to_sma20_atr;
  let location = 60;
  if (d20 != null && d20 >= -5 && d20 <= 2.5) location += 20;
  else if (d20 != null && d20 < -12) location -= 15;
  else if (d20 != null && d20 > 5) location -= 20;
  if (extension != null && extension >= 0 && extension <= 1.8) location += 10;
  if (extension != null && extension > cfg.maxExtensionAtrForResearch) location -= 25;
  location = clamp(location);

  const score = round(
    technical * cfg.weights.technical +
    growth * cfg.weights.growth +
    liquidity * cfg.weights.liquidity +
    risk * cfg.weights.risk +
    location * cfg.weights.location,
    1,
  );

  const chaseRisk =
    input.change_percent > cfg.maxDailyGainForResearch ||
    (input.return_20d_percent ?? 0) > cfg.maxReturn20ForResearch ||
    (input.distance_to_sma20_atr ?? 0) > cfg.maxExtensionAtrForResearch;

  const bucket = chaseRisk
    ? "YELLOW_WAIT"
    : score >= 72
      ? "GREEN_RESEARCH"
      : score >= 60
        ? "YELLOW_WAIT"
        : "RED_SKIP";

  const reasons: string[] = [];
  const cautions: string[] = [];
  if (technical >= 70) reasons.push("日線趨勢與中期動能偏強");
  if ((input.return_60d_percent ?? 0) > 8) reasons.push(`近60日相對強勢（${input.return_60d_percent}%）`);
  if (input.revenue_yoy_percent != null && input.revenue_yoy_percent >= 10) reasons.push(`最新月營收年增 ${input.revenue_yoy_percent}%`);
  if (d20 != null && d20 >= -5 && d20 <= 2.5) reasons.push("價格位於20日關鍵高點附近，適合等待突破或回踩確認");
  if (input.trade_value >= cfg.minTradeValue * 3) reasons.push("成交值與流動性充足");

  if (input.revenue_yoy_percent == null) cautions.push("營收年增資料不足，不把基本面加分視為已確認");
  else if (input.revenue_yoy_percent < 0) cautions.push(`最新月營收年減 ${Math.abs(input.revenue_yoy_percent)}%`);
  if (input.change_percent > cfg.maxDailyGainForResearch) cautions.push("當日漲幅偏大，家用模式避免追價");
  if ((input.return_20d_percent ?? 0) > cfg.maxReturn20ForResearch) cautions.push("近20日已明顯上漲，等待整理或回測較合理");
  if ((input.distance_to_sma20_atr ?? 0) > cfg.maxExtensionAtrForResearch) cautions.push("價格離20日均線過遠，短線乖離風險偏高");
  if (volatility > 65) cautions.push("近60日波動偏高");

  return { score, bucket, reasons: reasons.slice(0, 4), cautions: cautions.slice(0, 4) };
}

function extractFugleSnapshotRows(body: unknown): any[] {
  const root = rec(body);
  const data = root.data;
  if (Array.isArray(data)) return data;
  const dataRoot = rec(data);
  if (Array.isArray(dataRoot.data)) return dataRoot.data;
  if (Array.isArray(dataRoot.quotes)) return dataRoot.quotes;
  if (Array.isArray(root.quotes)) return root.quotes;
  return [];
}

function isLikelyCommonStock(symbol: string, name: string, info?: any) {
  if (!/^\d{4}$/.test(symbol)) return false;
  const code = Number(symbol);
  if (!Number.isFinite(code) || code < 1100) return false;
  const label = `${name} ${String(info?.stock_name ?? "")} ${String(info?.industry_category ?? "")}`;
  if (/ETF|ETN|權證|指數|債券|債|期貨|選擇權/i.test(label)) return false;
  return true;
}

export function normalizeFinMindMarketSnapshot(priceRows: any[], infoRows: any[]) {
  const infoMap = new Map<string, any>();
  for (const row of infoRows) {
    const symbol = String(row.stock_id ?? row.symbol ?? "").trim();
    if (symbol) infoMap.set(symbol, row);
  }

  const grouped = new Map<string, any[]>();
  for (const row of priceRows) {
    const symbol = String(row.stock_id ?? row.symbol ?? "").trim();
    if (!symbol) continue;
    const bucket = grouped.get(symbol) ?? [];
    bucket.push(row);
    grouped.set(symbol, bucket);
  }

  const result: any[] = [];
  for (const [symbol, rows] of grouped) {
    rows.sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
    const latest = rows.at(-1);
    if (!latest) continue;
    const info = infoMap.get(symbol) ?? {};
    const name = String(info.stock_name ?? latest.stock_name ?? "");
    if (!isLikelyCommonStock(symbol, name, info)) continue;

    const close = num(latest.close);
    if (close <= 0) continue;
    const previousRow = rows.length >= 2 ? rows.at(-2) : undefined;
    const previousCloseFromRow = num(previousRow?.close);
    const spread = num(latest.spread);
    const previousClose = previousCloseFromRow > 0
      ? previousCloseFromRow
      : spread !== 0
        ? close - spread
        : 0;
    const changePercent = previousClose > 0 ? round((close / previousClose - 1) * 100, 2) : 0;
    const marketRaw = String(info.type ?? info.market ?? latest.type ?? "").toUpperCase();
    const market = marketRaw.includes("OTC") || marketRaw.includes("TPEX") ? "OTC" : "TSE";

    result.push({
      symbol,
      name,
      market,
      open: num(latest.open),
      high: num(latest.max ?? latest.high),
      low: num(latest.min ?? latest.low),
      close,
      previous_close: previousClose,
      change: previousClose > 0 ? round(close - previousClose, 4) : spread,
      change_percent: changePercent,
      trade_volume: num(latest.Trading_Volume ?? latest.volume),
      trade_value: num(latest.Trading_money ?? latest.Trading_Value ?? latest.trade_value),
      intraday_position: null,
      last_updated: latest.date ?? null,
      snapshot_provider: "FINMIND_FALLBACK",
    });
  }
  return result;
}

async function loadFugleCommonStockSnapshot(env: Env) {
  const markets = ["TSE", "OTC"] as const;
  const settled = await Promise.allSettled(markets.map(async (market) => {
    const body = await fugle(env, `/snapshot/quotes/${market}`, { type: "COMMONSTOCK" });
    const rows = extractFugleSnapshotRows(body);
    const normalized = rows
      .map((row) => ({ market, ...normalizeQuote(row, String(rec(row).symbol ?? ""),), snapshot_provider: "FUGLE" }))
      .filter((row) => /^\d{4,6}$/.test(row.symbol) && row.close > 0);
    return { market, data: normalized };
  }));

  const data: any[] = [];
  const errors: string[] = [];
  const market_status: any[] = [];
  settled.forEach((result, index) => {
    const market = markets[index];
    if (result.status === "fulfilled") {
      data.push(...result.value.data);
      market_status.push({ market, status: result.value.data.length ? "OK" : "EMPTY", count: result.value.data.length });
      if (!result.value.data.length) errors.push(`Fugle ${market} snapshot 回傳 0 筆普通股`);
    } else {
      const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push(`Fugle ${market}: ${error}`);
      market_status.push({ market, status: "ERROR", count: 0, error });
    }
  });
  return { data, errors, market_status };
}

async function loadFinMindFallbackSnapshot(env: Env) {
  try {
    const [priceRows, infoRows] = await Promise.all([
      finmind(env, "TaiwanStockPrice", {
        start_date: taipeiDate(10),
        end_date: taipeiDate(),
      }),
      finmind(env, "TaiwanStockInfo", {}),
    ]);
    const data = normalizeFinMindMarketSnapshot(priceRows, infoRows);
    return {
      data,
      error: data.length ? null : "FinMind fallback 回傳資料但無法形成有效普通股 snapshot",
      price_row_count: priceRows.length,
      info_row_count: infoRows.length,
    };
  } catch (error) {
    return {
      data: [] as any[],
      error: error instanceof Error ? error.message : String(error),
      price_row_count: 0,
      info_row_count: 0,
    };
  }
}

async function loadCommonStockSnapshot(env: Env) {
  const primary = await loadFugleCommonStockSnapshot(env);
  const shouldFallback = primary.data.length < 100 || primary.market_status.some((row) => row.status !== "OK");
  let fallback = { data: [] as any[], error: null as string | null, price_row_count: 0, info_row_count: 0 };
  if (shouldFallback) fallback = await loadFinMindFallbackSnapshot(env);

  const merged = new Map<string, any>();
  for (const row of fallback.data) merged.set(row.symbol, row);
  for (const row of primary.data) merged.set(row.symbol, row);
  const data = [...merged.values()];

  let source: SnapshotSource = "UNAVAILABLE";
  if (primary.data.length && fallback.data.length) source = "FUGLE_WITH_FINMIND_FALLBACK";
  else if (primary.data.length) source = "FUGLE";
  else if (fallback.data.length) source = "FINMIND_FALLBACK";

  const errors = [...primary.errors];
  if (shouldFallback && fallback.error) errors.push(`FinMind fallback: ${fallback.error}`);
  return {
    data,
    errors,
    source,
    fallback_used: shouldFallback,
    provider_status: {
      fugle: {
        configured: Boolean(env.FUGLE_API_KEY),
        count: primary.data.length,
        markets: primary.market_status,
      },
      finmind_fallback: {
        attempted: shouldFallback,
        configured: Boolean(env.FINMIND_TOKEN),
        count: fallback.data.length,
        price_row_count: fallback.price_row_count,
        info_row_count: fallback.info_row_count,
        error: fallback.error,
      },
    },
  };
}

function unavailablePayload(
  status: string,
  familyMode: FamilyMode,
  snapshot: Awaited<ReturnType<typeof loadCommonStockSnapshot>>,
  extra: Record<string, unknown> = {},
) {
  return {
    version: FAMILY_STOCK_SELECTION_VERSION,
    status,
    research_only: true,
    family_mode: familyMode,
    horizon: "1-8 weeks",
    candidates: [],
    data_quality: "INSUFFICIENT",
    message: "本輪沒有形成可驗證候選股；這是資料鏈/篩選狀態，不代表市場上沒有好股票。請勿用新聞或猜測硬湊 Top 5。",
    diagnostics: {
      snapshot_source: snapshot.source,
      snapshot_count: snapshot.data.length,
      fallback_used: snapshot.fallback_used,
      provider_status: snapshot.provider_status,
      errors: snapshot.errors,
      ...extra,
    },
  };
}

export function registerFamilyStockSelectionTools(server: McpServer, env: Env) {
  server.registerTool("screen_family_swing_candidates", {
    description: "家用版全台股波段選股器。從上市櫃普通股主動找1~8週研究候選，不需要先提供股票代號。採兩階段篩選：全市場流動性快篩，再用日線趨勢/動能/波動/位置與最新月營收年增做深度排序。Fugle 全市場 snapshot 不完整時會嘗試 FinMind 市場資料 fallback，並回傳可讀 diagnostics。輸出GREEN_RESEARCH/YELLOW_WAIT/RED_SKIP，避免把好公司直接等同現在可追價；不提供下單、不自動買賣、不寫入Diamond研究記憶。",
    inputSchema: {
      mode: z.enum(["stable", "balanced", "aggressive"]).optional().default("balanced"),
      top_n: z.number().int().min(1).max(10).optional().default(5),
    },
  }, async ({ mode, top_n }) => {
    try {
      const familyMode = mode as FamilyMode;
      const cfg = MODE_CONFIG[familyMode];
      const snapshot = await loadCommonStockSnapshot(env);
      if (!snapshot.data.length) return ok(unavailablePayload("DATA_UNAVAILABLE", familyMode, snapshot));

      const liquid = snapshot.data
        .filter((row) => row.trade_value >= cfg.minTradeValue)
        .filter((row) => row.change_percent > -9.5 && row.change_percent < 9.8)
        .sort((a, b) => b.trade_value - a.trade_value)
        .slice(0, cfg.snapshotShortlist);
      if (!liquid.length) {
        return ok(unavailablePayload("NO_LIQUID_CANDIDATES", familyMode, snapshot, {
          min_trade_value: cfg.minTradeValue,
        }));
      }

      const technicalSettled = await concurrencyMap(liquid, 5, async (quote: any) => {
        const bars = normalizeDailyBars(await finmind(env, "TaiwanStockPrice", {
          data_id: quote.symbol,
          start_date: taipeiDate(340),
          end_date: taipeiDate(),
        }));
        if (bars.length < 80) throw new Error(`${quote.symbol} 日K樣本不足`);
        const ctx = dailyContext(bars);
        return { ...quote, bars, ...ctx };
      });

      const technicalRows = technicalSettled
        .flatMap((result) => result.status === "fulfilled" ? [result.value] : [])
        .sort((a: any, b: any) => num(b.technical?.score) - num(a.technical?.score))
        .slice(0, cfg.technicalShortlist);
      if (!technicalRows.length) {
        return ok(unavailablePayload("TECHNICAL_DATA_UNAVAILABLE", familyMode, snapshot, {
          liquid_count: liquid.length,
          technical_errors: technicalSettled.flatMap((result, index) => result.status === "rejected"
            ? [{ symbol: liquid[index]?.symbol, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }]
            : []),
        }));
      }

      const [infoResult, deepSettled] = await Promise.all([
        finmind(env, "TaiwanStockInfo", {}).catch(() => []),
        concurrencyMap(technicalRows, 4, async (row: any) => {
          const revenue = await finmind(env, "TaiwanStockMonthRevenue", {
            data_id: row.symbol,
            start_date: taipeiDate(500),
          });
          return { ...row, revenue_yoy_percent: latestRevenueGrowth(revenue) };
        }),
      ]);

      const infoMap = new Map<string, any>();
      for (const row of infoResult as any[]) infoMap.set(String(row.stock_id ?? ""), row);

      const ranked = deepSettled
        .flatMap((result, index) => {
          const base: any = result.status === "fulfilled"
            ? result.value
            : { ...technicalRows[index], revenue_yoy_percent: null, partial_error: result.reason instanceof Error ? result.reason.message : String(result.reason) };
          if (!base?.symbol) return [];
          const info = infoMap.get(base.symbol) ?? {};
          const tech = base.technical ?? {};
          const input: CandidateInput = {
            symbol: base.symbol,
            name: base.name || String(info.stock_name ?? ""),
            market: base.market,
            sector: String(info.industry_category ?? ""),
            close: num(base.close),
            change_percent: num(base.change_percent),
            trade_value: num(base.trade_value),
            technical_score: num(tech.score),
            return_20d_percent: tech.return_20d_percent ?? null,
            return_60d_percent: tech.return_60d_percent ?? null,
            annualized_volatility_60d_percent: tech.annualized_volatility_60d_percent ?? null,
            max_drawdown_percent: tech.max_drawdown_percent ?? null,
            atr14: tech.atr14 ?? null,
            distance_to_sma20_atr: base.distance_to_sma20_atr ?? null,
            distance_to_prior_20d_high_percent: base.distance_to_prior_20d_high_percent ?? null,
            revenue_yoy_percent: base.revenue_yoy_percent ?? null,
          };
          const judged = scoreFamilyCandidate(input, familyMode);
          return [{
            ...input,
            family_score: judged.score,
            family_bucket: judged.bucket,
            reasons: judged.reasons,
            cautions: judged.cautions,
          }];
        })
        .sort((a, b) => b.family_score - a.family_score);

      if (!ranked.length) {
        return ok(unavailablePayload("DEEP_DATA_UNAVAILABLE", familyMode, snapshot, {
          liquid_count: liquid.length,
          technical_scanned_count: technicalRows.length,
        }));
      }

      const green = ranked.filter((row) => row.family_bucket === "GREEN_RESEARCH");
      const yellow = ranked.filter((row) => row.family_bucket === "YELLOW_WAIT");
      const red = ranked.filter((row) => row.family_bucket === "RED_SKIP");
      const candidates = [...green, ...yellow].slice(0, top_n).map((row, index) => ({ rank: index + 1, ...row }));

      return ok({
        version: FAMILY_STOCK_SELECTION_VERSION,
        status: candidates.length ? "OK" : "NO_QUALIFIED_CANDIDATES",
        research_only: true,
        family_mode: familyMode,
        horizon: "1-8 weeks",
        as_of: new Date().toISOString(),
        data_quality: candidates.length ? "USABLE" : "NO_QUALIFIED_RESULTS",
        universe: {
          snapshot_source: snapshot.source,
          snapshot_count: snapshot.data.length,
          liquid_count: liquid.length,
          technical_scanned_count: technicalRows.length,
          deep_scanned_count: ranked.length,
        },
        diagnostics: {
          fallback_used: snapshot.fallback_used,
          provider_status: snapshot.provider_status,
          snapshot_errors: snapshot.errors,
        },
        interpretation: {
          GREEN_RESEARCH: "優先研究：條件相對完整，但仍要等合理位置，不代表直接買進。",
          YELLOW_WAIT: "等待位置：股票可能不差，但有追價、乖離或部分資料風險。",
          RED_SKIP: "本輪略過：目前綜合條件不足。",
        },
        candidates,
        waitlist: yellow.slice(0, Math.min(5, top_n)),
        skipped_examples: red.slice(0, 3),
        hard_rules: [
          "好公司不等於現在就是好買點",
          "不提供自動下單或保證報酬",
          "資料不足時必須明示，不可捏造即時價格、籌碼或目標價",
          "此家用選股結果不寫入Diamond GPT Judgment/Trading Knowledge，避免污染研究記憶",
          "全市場資料鏈失敗時不可用新聞或猜測硬湊 Top 5",
        ],
        partial_errors: [
          ...snapshot.errors,
          ...technicalSettled.flatMap((result, index) => result.status === "rejected" ? [{ symbol: liquid[index]?.symbol, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }] : []),
          ...deepSettled.flatMap((result, index) => result.status === "rejected" ? [{ symbol: technicalRows[index]?.symbol, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }] : []),
        ],
      });
    } catch (error) {
      return fail(error);
    }
  });
}
