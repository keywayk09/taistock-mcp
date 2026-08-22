import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  concurrencyMap,
  finmind,
  fugle,
  normalizeDailyBars,
  normalizeQuote,
  num,
  rec,
  round,
  taipeiDate,
  technicalSummary,
  type DailyBar,
} from "./common.ts";

export const FAMILY_STOCK_SELECTION_V2_VERSION = "family-stock-selection/v2.0.0";

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
  technicalScanLimit: number;
  revenueScanLimit: number;
  sectorCap: number;
  weights: { technical: number; growth: number; liquidity: number; risk: number; location: number };
}> = {
  stable: {
    minTradeValue: 50_000_000,
    maxDailyGainForResearch: 5,
    maxReturn20ForResearch: 18,
    maxExtensionAtrForResearch: 2,
    technicalScanLimit: 24,
    revenueScanLimit: 8,
    sectorCap: 3,
    weights: { technical: 0.35, growth: 0.20, liquidity: 0.15, risk: 0.20, location: 0.10 },
  },
  balanced: {
    minTradeValue: 20_000_000,
    maxDailyGainForResearch: 7,
    maxReturn20ForResearch: 25,
    maxExtensionAtrForResearch: 2.5,
    technicalScanLimit: 28,
    revenueScanLimit: 10,
    sectorCap: 4,
    weights: { technical: 0.45, growth: 0.20, liquidity: 0.15, risk: 0.10, location: 0.10 },
  },
  aggressive: {
    minTradeValue: 10_000_000,
    maxDailyGainForResearch: 9,
    maxReturn20ForResearch: 35,
    maxExtensionAtrForResearch: 3,
    technicalScanLimit: 30,
    revenueScanLimit: 12,
    sectorCap: 5,
    weights: { technical: 0.55, growth: 0.15, liquidity: 0.10, risk: 0.05, location: 0.15 },
  },
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function latestRevenueGrowth(rows: any[]): number | null {
  const normalized = rows.map((row) => ({
    revenue: num(row.revenue),
    year: num(row.revenue_year),
    month: num(row.revenue_month),
  })).filter((row) => row.revenue > 0 && row.year > 0 && row.month > 0)
    .sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month));
  const latest = normalized.at(-1);
  if (!latest) return null;
  const lastYear = normalized.find((row) => row.year === latest.year - 1 && row.month === latest.month);
  if (!lastYear?.revenue) return null;
  return round((latest.revenue / lastYear.revenue - 1) * 100, 2);
}

function dailyContext(bars: DailyBar[]) {
  const technical = technicalSummary(bars);
  const latest = bars.at(-1);
  const prior20 = bars.slice(-21, -1);
  const prior20High = prior20.length ? Math.max(...prior20.map((bar) => bar.high)) : null;
  const atr = num((technical as any).atr14);
  const sma20 = num((technical as any).sma20);
  return {
    technical,
    distance_to_sma20_atr: latest && atr > 0 ? round((latest.close - sma20) / atr, 3) : null,
    distance_to_prior_20d_high_percent: latest && prior20High ? round((latest.close / prior20High - 1) * 100, 2) : null,
  };
}

export function scoreFamilyCandidateV2(input: CandidateInput, mode: FamilyMode) {
  const cfg = MODE_CONFIG[mode];
  const technical = clamp(input.technical_score);
  const growth = input.revenue_yoy_percent == null ? 50 : clamp(50 + input.revenue_yoy_percent * 1.5);
  const liquidity = input.trade_value > 0 ? clamp(55 + Math.log10(Math.max(1, input.trade_value / cfg.minTradeValue)) * 22) : 0;
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

  const chaseRisk = input.change_percent > cfg.maxDailyGainForResearch ||
    (input.return_20d_percent ?? 0) > cfg.maxReturn20ForResearch ||
    (input.distance_to_sma20_atr ?? 0) > cfg.maxExtensionAtrForResearch;
  const bucket = chaseRisk ? "YELLOW_WAIT" : score >= 72 ? "GREEN_RESEARCH" : score >= 60 ? "YELLOW_WAIT" : "RED_SKIP";

  const reasons: string[] = [];
  const cautions: string[] = [];
  if (technical >= 70) reasons.push("日線趨勢與中期動能偏強");
  if ((input.return_60d_percent ?? 0) > 8) reasons.push(`近60日相對強勢（${input.return_60d_percent}%）`);
  if (input.revenue_yoy_percent != null && input.revenue_yoy_percent >= 10) reasons.push(`最新月營收年增 ${input.revenue_yoy_percent}%`);
  if (d20 != null && d20 >= -5 && d20 <= 2.5) reasons.push("價格位於20日關鍵高點附近，適合等待突破或回踩確認");
  if (input.trade_value >= cfg.minTradeValue * 3) reasons.push("成交值與流動性充足");
  if (input.revenue_yoy_percent == null) cautions.push("營收年增資料不足，不把基本面加分視為已確認");
  if (input.revenue_yoy_percent != null && input.revenue_yoy_percent < 0) cautions.push(`最新月營收年減 ${Math.abs(input.revenue_yoy_percent)}%`);
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
  return !/ETF|ETN|權證|指數|債券|債|期貨|選擇權/i.test(label);
}

export function normalizeFinMindMarketSnapshotV2(priceRows: any[], infoRows: any[]) {
  const infoMap = new Map<string, any>();
  for (const row of infoRows) {
    const symbol = String(row.stock_id ?? row.symbol ?? "").trim();
    if (symbol) infoMap.set(symbol, row);
  }
  return priceRows.flatMap((latest) => {
    const symbol = String(latest.stock_id ?? latest.symbol ?? "").trim();
    const info = infoMap.get(symbol) ?? {};
    const name = String(info.stock_name ?? latest.stock_name ?? "");
    if (!isLikelyCommonStock(symbol, name, info)) return [];
    const close = num(latest.close);
    if (close <= 0) return [];
    const spread = num(latest.spread);
    const previousClose = spread !== 0 ? close - spread : 0;
    const marketRaw = String(info.type ?? info.market ?? latest.type ?? "").toUpperCase();
    return [{
      symbol,
      name,
      market: marketRaw.includes("OTC") || marketRaw.includes("TPEX") ? "OTC" : "TSE",
      sector: String(info.industry_category ?? ""),
      open: num(latest.open),
      high: num(latest.max ?? latest.high),
      low: num(latest.min ?? latest.low),
      close,
      previous_close: previousClose,
      change: spread,
      change_percent: previousClose > 0 ? round((close / previousClose - 1) * 100, 2) : 0,
      trade_volume: num(latest.Trading_Volume ?? latest.volume),
      trade_value: num(latest.Trading_money ?? latest.Trading_Value ?? latest.trade_value),
      intraday_position: null,
      last_updated: latest.date ?? null,
      snapshot_provider: "FINMIND_FALLBACK",
    }];
  });
}

async function loadFugleSnapshot(env: Env) {
  const markets = ["TSE", "OTC"] as const;
  const settled = await Promise.allSettled(markets.map(async (market) => {
    const body = await fugle(env, `/snapshot/quotes/${market}`, { type: "COMMONSTOCK" });
    const rows = extractFugleSnapshotRows(body);
    const normalized = rows.map((row) => ({
      market,
      ...normalizeQuote(row, String(rec(row).symbol ?? "")),
      sector: "",
      snapshot_provider: "FUGLE",
    })).filter((row) => /^\d{4}$/.test(row.symbol) && row.close > 0);
    return { market, data: normalized };
  }));
  const data: any[] = [], errors: string[] = [], marketsStatus: any[] = [];
  settled.forEach((result, index) => {
    const market = markets[index];
    if (result.status === "fulfilled") {
      data.push(...result.value.data);
      marketsStatus.push({ market, status: result.value.data.length ? "OK" : "EMPTY", count: result.value.data.length });
      if (!result.value.data.length) errors.push(`Fugle ${market} snapshot 0 rows`);
    } else {
      const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push(`Fugle ${market}:${error}`);
      marketsStatus.push({ market, status: "ERROR", count: 0, error });
    }
  });
  return { data, errors, marketsStatus, requests: 2 };
}

async function loadFinMindOneDayFallback(env: Env) {
  let priceRows: any[] = [];
  let chosenDate: string | null = null;
  let attempts = 0;
  let lastError: string | null = null;
  for (let daysAgo = 1; daysAgo <= 5; daysAgo++) {
    attempts++;
    const date = taipeiDate(daysAgo);
    try {
      const rows = await finmind(env, "TaiwanStockPrice", { start_date: date, end_date: date });
      if (rows.length) {
        priceRows = rows;
        chosenDate = date;
        break;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (/402|403|permission|upper limit/i.test(lastError)) break;
    }
  }
  let infoRows: any[] = [];
  try { infoRows = await finmind(env, "TaiwanStockInfo", {}); }
  catch (error) { lastError = `${lastError ? `${lastError};` : ""}${error instanceof Error ? error.message : String(error)}`; }
  return {
    data: normalizeFinMindMarketSnapshotV2(priceRows, infoRows),
    infoRows,
    chosenDate,
    attempts,
    requests: attempts + 1,
    error: priceRows.length ? null : lastError ?? "FinMind fallback no trading-day snapshot in last 5 calendar days",
  };
}

async function loadCommonStockSnapshotV2(env: Env) {
  const primary = await loadFugleSnapshot(env);
  const primaryHealthy = primary.data.length >= 100 && primary.marketsStatus.every((row) => row.status === "OK");
  let fallback = { data: [] as any[], infoRows: [] as any[], chosenDate: null as string | null, attempts: 0, requests: 0, error: null as string | null };
  if (!primaryHealthy) fallback = await loadFinMindOneDayFallback(env);

  let infoRows = fallback.infoRows;
  let infoRequest = 0;
  if (!infoRows.length) {
    try { infoRows = await finmind(env, "TaiwanStockInfo", {}); infoRequest = 1; }
    catch { infoRows = []; infoRequest = 1; }
  }
  const infoMap = new Map(infoRows.map((row) => [String(row.stock_id ?? ""), row]));
  const merged = new Map<string, any>();
  for (const row of fallback.data) merged.set(row.symbol, row);
  for (const row of primary.data) {
    const info = infoMap.get(row.symbol) ?? {};
    const name = row.name || String(info.stock_name ?? "");
    if (!isLikelyCommonStock(row.symbol, name, info)) continue;
    merged.set(row.symbol, { ...row, name, sector: String(info.industry_category ?? row.sector ?? "") });
  }
  const data = [...merged.values()];
  let source: SnapshotSource = "UNAVAILABLE";
  if (primary.data.length && fallback.data.length) source = "FUGLE_WITH_FINMIND_FALLBACK";
  else if (primary.data.length) source = "FUGLE";
  else if (fallback.data.length) source = "FINMIND_FALLBACK";
  return {
    data,
    infoRows,
    source,
    fallback_used: !primaryHealthy,
    requests_used: primary.requests + fallback.requests + infoRequest,
    errors: [...primary.errors, ...(fallback.error ? [`FinMind fallback:${fallback.error}`] : [])],
    provider_status: {
      fugle: { configured: Boolean(env.FUGLE_API_KEY), count: primary.data.length, markets: primary.marketsStatus },
      finmind_fallback: { attempted: !primaryHealthy, configured: Boolean(env.FINMIND_TOKEN), count: fallback.data.length, date: fallback.chosenDate, attempts: fallback.attempts, error: fallback.error },
    },
  };
}

export function snapshotPreScoreV2(row: any, minTradeValue: number) {
  const liquidity = row.trade_value > 0 ? clamp(50 + Math.log10(Math.max(1, row.trade_value / minTradeValue)) * 20) : 0;
  const gain = num(row.change_percent);
  let move = 55;
  if (gain >= 0.5 && gain <= 4.5) move += 20;
  else if (gain > 7.5) move -= 25;
  else if (gain < -5) move -= 20;
  const intraday = row.intraday_position == null ? 50 : clamp(num(row.intraday_position));
  return round(liquidity * 0.60 + move * 0.25 + intraday * 0.15, 2);
}

function diversifiedShortlist(rows: any[], limit: number, sectorCap: number, minTradeValue: number) {
  const sorted = rows.map((row) => ({ ...row, snapshot_pre_score: snapshotPreScoreV2(row, minTradeValue) }))
    .sort((a, b) => b.snapshot_pre_score - a.snapshot_pre_score || b.trade_value - a.trade_value);
  const counts = new Map<string, number>();
  const out: any[] = [];
  for (const row of sorted) {
    const sector = String(row.sector ?? "").trim();
    if (sector) {
      const count = counts.get(sector) ?? 0;
      if (count >= sectorCap) continue;
      counts.set(sector, count + 1);
    }
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

function unavailablePayload(status: string, mode: FamilyMode, snapshot: Awaited<ReturnType<typeof loadCommonStockSnapshotV2>>, extra: Record<string, unknown> = {}) {
  return {
    version: FAMILY_STOCK_SELECTION_V2_VERSION,
    status,
    research_only: true,
    family_mode: mode,
    horizon: "1-8 weeks",
    candidates: [],
    data_quality: "INSUFFICIENT",
    ranking_scope: "NO_VERIFIABLE_ENGINE_RANKING",
    message: "本輪沒有形成可驗證的引擎候選；可以用Web找研究線索，但不得把Web候選包裝成全市場引擎排名。",
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

export async function runFamilySwingScreenV2(env: Env, input: { mode?: FamilyMode; top_n?: number }) {
  const familyMode = input.mode ?? "balanced";
  const topN = Math.max(1, Math.min(10, Math.floor(input.top_n ?? 5)));
  const cfg = MODE_CONFIG[familyMode];
  const snapshot = await loadCommonStockSnapshotV2(env);
  if (!snapshot.data.length) return unavailablePayload("DATA_UNAVAILABLE", familyMode, snapshot);

  const liquidUniverse = snapshot.data
    .filter((row) => row.trade_value >= cfg.minTradeValue)
    .filter((row) => row.change_percent > -9.5 && row.change_percent < 9.8);
  if (!liquidUniverse.length) return unavailablePayload("NO_LIQUID_CANDIDATES", familyMode, snapshot, { min_trade_value: cfg.minTradeValue });

  // Keep the whole snapshot as the fast universe, then bound expensive per-symbol calls.
  // Reserve external-call budget for technical history and revenue deepening.
  const softSubrequestBudget = 45;
  const reservedRevenue = cfg.revenueScanLimit;
  const availableTechnical = Math.max(12, softSubrequestBudget - snapshot.requests_used - reservedRevenue - 2);
  const technicalLimit = Math.min(cfg.technicalScanLimit, availableTechnical, liquidUniverse.length);
  const technicalPool = diversifiedShortlist(liquidUniverse, technicalLimit, cfg.sectorCap, cfg.minTradeValue);

  const technicalSettled = await concurrencyMap(technicalPool, 4, async (quote: any) => {
    const bars = normalizeDailyBars(await finmind(env, "TaiwanStockPrice", {
      data_id: quote.symbol,
      start_date: taipeiDate(340),
      end_date: taipeiDate(),
    }));
    if (bars.length < 80) throw new Error(`${quote.symbol} daily bars < 80`);
    return { ...quote, bars, ...dailyContext(bars) };
  });
  const technicalRows = technicalSettled.flatMap((result) => result.status === "fulfilled" ? [result.value] : [])
    .sort((a: any, b: any) => num(b.technical?.score) - num(a.technical?.score));
  if (!technicalRows.length) return unavailablePayload("TECHNICAL_DATA_UNAVAILABLE", familyMode, snapshot, {
    fast_universe_count: snapshot.data.length,
    liquid_universe_count: liquidUniverse.length,
    technical_pool_count: technicalPool.length,
    technical_errors: technicalSettled.flatMap((result, index) => result.status === "rejected" ? [{ symbol: technicalPool[index]?.symbol, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }] : []),
  });

  const deepPool = technicalRows.slice(0, Math.min(cfg.revenueScanLimit, technicalRows.length));
  const deepSettled = await concurrencyMap(deepPool, 4, async (row: any) => {
    const revenue = await finmind(env, "TaiwanStockMonthRevenue", {
      data_id: row.symbol,
      start_date: taipeiDate(500),
      end_date: taipeiDate(),
    });
    return { ...row, revenue_yoy_percent: latestRevenueGrowth(revenue) };
  });

  const infoMap = new Map(snapshot.infoRows.map((row) => [String(row.stock_id ?? ""), row]));
  const ranked = deepSettled.flatMap((result, index) => {
    const base: any = result.status === "fulfilled"
      ? result.value
      : { ...deepPool[index], revenue_yoy_percent: null, partial_error: result.reason instanceof Error ? result.reason.message : String(result.reason) };
    if (!base?.symbol) return [];
    const info = infoMap.get(base.symbol) ?? {};
    const tech = base.technical ?? {};
    const candidate: CandidateInput = {
      symbol: base.symbol,
      name: base.name || String(info.stock_name ?? ""),
      market: base.market,
      sector: base.sector || String(info.industry_category ?? ""),
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
    const judged = scoreFamilyCandidateV2(candidate, familyMode);
    return [{ ...candidate, family_score: judged.score, family_bucket: judged.bucket, reasons: judged.reasons, cautions: judged.cautions }];
  }).sort((a, b) => b.family_score - a.family_score);

  const green = ranked.filter((row) => row.family_bucket === "GREEN_RESEARCH");
  const yellow = ranked.filter((row) => row.family_bucket === "YELLOW_WAIT");
  const red = ranked.filter((row) => row.family_bucket === "RED_SKIP");
  const candidates = [...green, ...yellow].slice(0, topN).map((row, index) => ({ rank: index + 1, ...row }));

  return {
    version: FAMILY_STOCK_SELECTION_V2_VERSION,
    status: candidates.length ? "OK" : "NO_QUALIFIED_CANDIDATES",
    research_only: true,
    family_mode: familyMode,
    horizon: "1-8 weeks",
    as_of: new Date().toISOString(),
    data_quality: candidates.length ? "USABLE_PRELIMINARY_ENGINE_SCREEN" : "NO_QUALIFIED_RESULTS",
    ranking_scope: {
      stage_1: "FULL_AVAILABLE_TSE_OTC_SNAPSHOT_FAST_PREFILTER",
      stage_2: "BOUNDED_DIVERSIFIED_DAILY_TECHNICAL_SCAN",
      stage_3: "TOP_TECHNICAL_MONTHLY_REVENUE_DEEPENING",
      final_research_rank: false,
      explanation: "所有可用普通股先進快速預篩；昂貴的逐檔歷史資料採受控深度掃描。此排名是候選初選，不冒充每檔都做完11點。",
    },
    universe: {
      snapshot_source: snapshot.source,
      snapshot_count: snapshot.data.length,
      liquid_universe_count: liquidUniverse.length,
      technical_pool_count: technicalPool.length,
      technical_success_count: technicalRows.length,
      revenue_deep_count: deepPool.length,
      ranked_count: ranked.length,
    },
    request_budget: {
      soft_external_subrequest_budget: softSubrequestBudget,
      snapshot_requests_estimate: snapshot.requests_used,
      technical_requests: technicalPool.length,
      revenue_requests: deepPool.length,
      note: "避免單次Worker為了假裝全市場深算而爆掉；最終Top候選用下一個11點工具逐檔驗證。",
    },
    diagnostics: {
      fallback_used: snapshot.fallback_used,
      provider_status: snapshot.provider_status,
      snapshot_errors: snapshot.errors,
    },
    candidates,
    waitlist: yellow.slice(0, Math.min(5, topN)),
    skipped_examples: red.slice(0, 3),
    next_step: {
      required_before_final_family_recommendation: true,
      tool: "compare_family_stocks",
      symbols: candidates.map((row) => row.symbol),
      purpose: "用同一套11點模板補正式籌碼、財務、估值、同業與Web研究缺口，再做最後研究排序。",
    },
    web_policy: {
      allowed: true,
      use_for: ["題材", "產業趨勢", "公司法說", "客戶訂單", "產能", "供應鏈", "催化劑", "機構EPS與目標價"],
      must_label: "WEB_RESEARCH_CANDIDATE_OR_EVIDENCE",
      forbidden_claim: "不得把Web找到的股票說成這次全市場引擎排名結果。",
    },
    hard_rules: [
      "好公司不等於現在就是好買點",
      "不提供自動下單或保證報酬",
      "資料不足時明示，不捏造即時價格、籌碼、支撐壓力或目標價",
      "正式籌碼在下一階段必須使用Published generation",
      "正式OHLC仍由OHLC MCP負責",
      "引擎篩選失敗時可以用Web找研究候選，但必須標示Web候選，不能偽稱引擎Top 5",
    ],
    partial_errors: [
      ...snapshot.errors,
      ...technicalSettled.flatMap((result, index) => result.status === "rejected" ? [{ symbol: technicalPool[index]?.symbol, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }] : []),
      ...deepSettled.flatMap((result, index) => result.status === "rejected" ? [{ symbol: deepPool[index]?.symbol, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }] : []),
    ],
  };
}

export function registerFamilyStockSelectionToolsV2(server: McpServer, env: Env) {
  server.registerTool("screen_family_swing_candidates", {
    description: "家人版波段選股V2。先掃全部可用上市櫃普通股snapshot，再以受控API預算做分散化日線深掃與月營收深化；輸出的是1~8週『引擎初選候選』，最後推薦前必須再呼叫compare_family_stocks補完整11點。Web可補題材與情報，但不得冒充引擎排名。",
    inputSchema: {
      mode: z.enum(["stable", "balanced", "aggressive"]).optional().default("balanced"),
      top_n: z.number().int().min(1).max(10).optional().default(5),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ mode, top_n }) => ({
    content: [{ type: "text" as const, text: JSON.stringify(await runFamilySwingScreenV2(env, { mode, top_n }), null, 2) }],
  }));
}
