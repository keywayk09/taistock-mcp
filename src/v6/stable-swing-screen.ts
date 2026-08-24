import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  concurrencyMap,
  fugle,
  normalizeDailyBars,
  num,
  round,
  taipeiDate,
  technicalSummary,
  type DailyBar,
} from "./common";
import {
  loadStableMarketUniverse,
  STABLE_MARKET_SOURCE_CONTRACT,
  type StableSnapshotRow,
} from "./stable-market-tools";

/**
 * Frozen swing-screen consumer of the full-market source contract.
 *
 * Stage 1 always starts from the complete TWSE + TPEx stable universe.
 * Stage 2 uses Fugle per-symbol historical candles only for a bounded shortlist.
 * FinMind, Fugle market-wide snapshot/ranking and direct TPEx OpenAPI quotes are
 * intentionally outside this required path.
 */
export const STABLE_SWING_SCREEN_VERSION = "stable-swing-screen/v1.0.0";

type Mode = "stable" | "balanced" | "aggressive";

type TechnicalRow = StableSnapshotRow & {
  price_date: string;
  technical_score: number;
  return_20d_percent: number | null;
  return_60d_percent: number | null;
  annualized_volatility_60d_percent: number | null;
  max_drawdown_percent: number | null;
  atr14: number | null;
  sma20: number | null;
  sma60: number | null;
  distance_to_sma20_atr: number | null;
  distance_to_prior_20d_high_percent: number | null;
};

const MODE: Record<Mode, {
  minTradeValue: number;
  maxDailyGain: number;
  fastPool: number;
  technicalPool: number;
  maxExtensionAtr: number;
}> = {
  stable: { minTradeValue: 50_000_000, maxDailyGain: 5, fastPool: 80, technicalPool: 24, maxExtensionAtr: 2 },
  balanced: { minTradeValue: 20_000_000, maxDailyGain: 7, fastPool: 100, technicalPool: 28, maxExtensionAtr: 2.5 },
  aggressive: { minTradeValue: 10_000_000, maxDailyGain: 9, fastPool: 120, technicalPool: 32, maxExtensionAtr: 3 },
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function intradayPosition(row: StableSnapshotRow) {
  const high = row.high ?? 0;
  const low = row.low ?? 0;
  return high > low ? clamp(((row.close - low) / (high - low)) * 100) : 50;
}

function fastScore(row: StableSnapshotRow, mode: Mode) {
  const cfg = MODE[mode];
  const valueRatio = row.trade_value > 0 ? Math.max(1, row.trade_value / cfg.minTradeValue) : 0;
  const liquidity = valueRatio > 0 ? clamp(50 + Math.log10(valueRatio) * 22) : 0;
  const change = row.change_percent ?? 0;
  let move = 55;
  if (change >= 0.3 && change <= Math.min(4.5, cfg.maxDailyGain)) move += 22;
  else if (change > cfg.maxDailyGain) move -= 30;
  else if (change < -5) move -= 22;
  const position = intradayPosition(row);
  const positionScore = position >= 55 && position <= 92 ? 75 : position > 95 ? 50 : 55;
  const volume = row.trade_volume ?? 0;
  const volumeScore = volume > 0 ? clamp(45 + Math.log10(Math.max(1, volume / 100_000)) * 12) : 20;
  return round(liquidity * 0.45 + move * 0.25 + positionScore * 0.15 + volumeScore * 0.15, 2);
}

function diversify(rows: StableSnapshotRow[], mode: Mode) {
  const cfg = MODE[mode];
  const sorted = rows
    .map((row) => ({ row, score: fastScore(row, mode) }))
    .sort((a, b) => b.score - a.score || b.row.trade_value - a.row.trade_value);
  const sectorCounts = new Map<string, number>();
  const output: Array<{ row: StableSnapshotRow; score: number }> = [];
  const sectorCap = mode === "stable" ? 5 : mode === "balanced" ? 7 : 9;
  for (const item of sorted) {
    const sector = item.row.sector || "未分類";
    const count = sectorCounts.get(sector) ?? 0;
    if (sector !== "未分類" && count >= sectorCap) continue;
    sectorCounts.set(sector, count + 1);
    output.push(item);
    if (output.length >= cfg.fastPool) break;
  }
  return output;
}

async function dailyBars(env: Env, symbol: string) {
  const body = await fugle(env, `/historical/candles/${symbol}`, {
    from: taipeiDate(350),
    to: taipeiDate(),
    timeframe: "D",
    adjusted: "false",
    fields: "open,high,low,close,volume",
    sort: "asc",
  });
  const root = body && typeof body === "object" ? body as Record<string, any> : {};
  const data = Array.isArray(root.data) ? root.data : Array.isArray(root.rows) ? root.rows : [];
  return normalizeDailyBars(data);
}

function technicalContext(row: StableSnapshotRow, bars: DailyBar[]): TechnicalRow {
  if (bars.length < 80) throw new Error(`${row.symbol} daily bars < 80`);
  const tech = technicalSummary(bars) as any;
  const latest = bars.at(-1)!;
  const prior20 = bars.slice(-21, -1);
  const prior20High = prior20.length ? Math.max(...prior20.map((bar) => bar.high)) : null;
  const atr = num(tech.atr14);
  const sma20 = num(tech.sma20);
  return {
    ...row,
    close: latest.close,
    price_date: latest.date,
    technical_score: num(tech.score),
    return_20d_percent: tech.return_20d_percent ?? null,
    return_60d_percent: tech.return_60d_percent ?? null,
    annualized_volatility_60d_percent: tech.annualized_volatility_60d_percent ?? null,
    max_drawdown_percent: tech.max_drawdown_percent ?? null,
    atr14: atr || null,
    sma20: sma20 || null,
    sma60: num(tech.sma60) || null,
    distance_to_sma20_atr: atr > 0 && sma20 > 0 ? round((latest.close - sma20) / atr, 3) : null,
    distance_to_prior_20d_high_percent: prior20High ? round((latest.close / prior20High - 1) * 100, 2) : null,
  };
}

function finalScore(row: TechnicalRow, mode: Mode) {
  const cfg = MODE[mode];
  const technical = clamp(row.technical_score);
  const valueRatio = row.trade_value > 0 ? Math.max(1, row.trade_value / cfg.minTradeValue) : 0;
  const liquidity = valueRatio > 0 ? clamp(55 + Math.log10(valueRatio) * 20) : 0;
  const volatility = Math.max(0, row.annualized_volatility_60d_percent ?? 65);
  const drawdown = Math.abs(Math.min(0, row.max_drawdown_percent ?? -30));
  const risk = mode === "stable"
    ? clamp(100 - volatility * 0.75 - drawdown * 0.65)
    : mode === "balanced"
      ? clamp(100 - volatility * 0.5 - drawdown * 0.45)
      : clamp(100 - volatility * 0.3 - drawdown * 0.25);
  let location = 60;
  const d20 = row.distance_to_prior_20d_high_percent;
  const extension = row.distance_to_sma20_atr;
  if (d20 != null && d20 >= -5 && d20 <= 2.5) location += 20;
  else if (d20 != null && d20 < -12) location -= 15;
  else if (d20 != null && d20 > 5) location -= 20;
  if (extension != null && extension >= 0 && extension <= 1.8) location += 10;
  if (extension != null && extension > cfg.maxExtensionAtr) location -= 25;
  const relativeStrength = clamp(50 + (row.return_20d_percent ?? 0) * 1.3 + (row.return_60d_percent ?? 0) * 0.45);
  const score = mode === "stable"
    ? technical * 0.35 + relativeStrength * 0.18 + liquidity * 0.12 + risk * 0.22 + clamp(location) * 0.13
    : mode === "balanced"
      ? technical * 0.42 + relativeStrength * 0.23 + liquidity * 0.13 + risk * 0.08 + clamp(location) * 0.14
      : technical * 0.48 + relativeStrength * 0.27 + liquidity * 0.10 + risk * 0.04 + clamp(location) * 0.11;
  const chaseRisk = (row.change_percent ?? 0) > cfg.maxDailyGain || (extension ?? 0) > cfg.maxExtensionAtr;
  const bucket = chaseRisk ? "YELLOW_WAIT" : score >= 70 ? "GREEN_RESEARCH" : score >= 58 ? "YELLOW_WAIT" : "RED_SKIP";
  const reasons: string[] = [];
  const cautions: string[] = [];
  if (technical >= 70) reasons.push("日線趨勢偏強");
  if ((row.return_60d_percent ?? 0) > 8) reasons.push(`近60日相對強勢 ${row.return_60d_percent}%`);
  if (d20 != null && d20 >= -5 && d20 <= 2.5) reasons.push("接近20日關鍵高點，適合等突破或回踩確認");
  if (row.trade_value >= cfg.minTradeValue * 3) reasons.push("成交值流動性充足");
  if ((row.change_percent ?? 0) > cfg.maxDailyGain) cautions.push("當日漲幅過大，避免追價");
  if ((extension ?? 0) > cfg.maxExtensionAtr) cautions.push("離20日均線過遠");
  if (volatility > 65) cautions.push("近60日波動偏高");
  return { score: round(score, 1), bucket, reasons: reasons.slice(0, 4), cautions: cautions.slice(0, 4) };
}

export async function runStableSwingScreen(env: Env, input: { mode?: Mode; top_n?: number }) {
  const mode = input.mode ?? "balanced";
  const topN = Math.max(1, Math.min(20, Math.floor(input.top_n ?? 8)));
  const cfg = MODE[mode];
  const universe = await loadStableMarketUniverse();
  if (!universe.usable) {
    return {
      version: STABLE_SWING_SCREEN_VERSION,
      source_contract: STABLE_MARKET_SOURCE_CONTRACT,
      status: "DATA_UNAVAILABLE",
      candidates: [],
      coverage: {
        listed: universe.TWSE.normalized_count,
        otc: universe.TPEx.normalized_count,
      },
      errors: [...universe.TWSE.errors, ...universe.TPEx.errors],
      message: "全市場資料未達完整門檻；不把抓不到資料誤判成今天沒有標的。",
    };
  }

  const liquid = universe.rows
    .filter((row) => row.trade_value >= cfg.minTradeValue)
    .filter((row) => (row.change_percent ?? 0) > -9.5 && (row.change_percent ?? 0) < 9.8);
  const fast = diversify(liquid, mode);
  const technicalPool = fast.slice(0, Math.min(cfg.technicalPool, fast.length));
  const settled = await concurrencyMap(technicalPool, 4, async (item) => {
    const bars = await dailyBars(env, item.row.symbol);
    return { fast_score: item.score, technical: technicalContext(item.row, bars) };
  });
  const success = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const ranked = success.map((item) => {
    const judged = finalScore(item.technical, mode);
    return {
      ...item.technical,
      fast_score: item.fast_score,
      family_score: judged.score,
      family_bucket: judged.bucket,
      reasons: judged.reasons,
      cautions: judged.cautions,
    };
  }).sort((a, b) => b.family_score - a.family_score);
  const candidates = ranked.filter((row) => row.family_bucket !== "RED_SKIP").slice(0, topN).map((row, index) => ({ rank: index + 1, ...row }));

  return {
    version: STABLE_SWING_SCREEN_VERSION,
    source_contract: STABLE_MARKET_SOURCE_CONTRACT,
    status: candidates.length ? "OK" : success.length ? "NO_QUALIFIED_CANDIDATES" : "TECHNICAL_DATA_UNAVAILABLE",
    research_only: true,
    family_mode: mode,
    horizon: "1-8 weeks",
    as_of: new Date().toISOString(),
    source_policy: {
      full_market: "TWSE_OPENAPI_PLUS_MOPSFIN_TWSE_MIS",
      daily_history: "FUGLE_PER_SYMBOL_HISTORICAL",
      finmind_required: false,
      fugle_market_snapshot_required: false,
      direct_tpex_openapi_required: false,
    },
    universe: {
      listed_count: universe.TWSE.normalized_count,
      otc_count: universe.TPEx.normalized_count,
      full_count: universe.rows.length,
      liquid_count: liquid.length,
      fast_prefilter_count: fast.length,
      technical_requested: technicalPool.length,
      technical_succeeded: success.length,
    },
    ranking_scope: {
      stage_1: `全市場先依成交值、當日強弱、日內位置、成交量預篩最多 ${cfg.fastPool} 檔`,
      stage_2: `對前 ${cfg.technicalPool} 檔抓 Fugle 個股歷史日K做相對強弱與風險排序`,
      stage_3: "最終候選仍需個股完整分析確認，不自動下單",
    },
    candidates,
    waitlist: ranked.filter((row) => row.family_bucket === "YELLOW_WAIT").slice(0, 10),
    partial_errors: settled.flatMap((result, index) => result.status === "rejected"
      ? [{ symbol: technicalPool[index]?.row.symbol, error: errorText(result.reason) }]
      : []),
    hard_rules: [
      "全市場資料抓不到時回報 DATA_UNAVAILABLE，不得說今天沒有股票",
      "FinMind token 失效不得拖垮全市場挑標",
      "Fugle 403 的 market ranking/snapshot 不再是必要路徑",
      "TPEx direct OpenAPI redirect 不再是必要路徑",
      "標籤與排序是研究候選，不等於自動建立部位",
    ],
  };
}

export function registerStableSwingScreenTool(server: McpServer, env: Env) {
  server.registerTool("screen_family_swing_candidates", {
    description: "定案版全市場波段初選：TWSE 官方 + TPEx MOPSFIN/TWSE MIS 掃全市場，再用 Fugle 逐檔歷史日K做受控深掃；不依賴 FinMind、Fugle 全市場排行/快照或 TPEx direct OpenAPI。",
    inputSchema: {
      mode: z.enum(["stable", "balanced", "aggressive"]).optional().default("balanced"),
      top_n: z.number().int().min(1).max(20).optional().default(8),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ mode, top_n }) => ({
    content: [{ type: "text" as const, text: JSON.stringify(await runStableSwingScreen(env, { mode, top_n }), null, 2) }],
  }));
}
