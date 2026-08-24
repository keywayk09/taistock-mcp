import { sha256Hex, stableJson } from "./github-data-store.ts";
import { ensureSelectionEvidence } from "./selection-evidence.ts";
import {
  getSelectionRun,
  recordSelectionRun,
  type SelectionCandidate,
  type SelectionEvidenceRecord,
  type SelectionRunRecord,
  type SelectionType,
} from "./selection-journal.ts";
import { runStableSwingScreen } from "./stable-swing-screen.ts";

export const INTRADAY_REVIEW_SELECTOR_VERSION = "diamond-intraday-review-selector/v1.0.0";
export const NEXT_DAY_INTRADAY_SELECTOR_VERSION = "diamond-next-day-intraday-selector/v1.0.0";
export const SWING_JOURNAL_SELECTOR_VERSION = "diamond-swing-journal-selector/v1.0.0";

const INTRADAY_REVIEW_LIMIT = 30;
const NEXT_DAY_INTRADAY_LIMIT = 30;
const SWING_LIMIT = 12;

type Feature = Record<string, any>;

function num(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nullable(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 2) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function rankScore(rank: unknown, strongThrough: number, zeroAfter: number) {
  const r = Number(rank);
  if (!Number.isFinite(r) || r <= 0 || r > zeroAfter) return 0;
  if (r <= strongThrough) return clamp(100 - (r - 1) * (35 / Math.max(1, strongThrough - 1)));
  return clamp(65 * (1 - (r - strongThrough) / Math.max(1, zeroAfter - strongThrough)));
}

function signedStrength(value: unknown, soft = 0.01, hard = 0.08) {
  const x = num(value);
  const magnitude = clamp(((Math.abs(x) - soft) / Math.max(0.000001, hard - soft)) * 100);
  return x === 0 ? 0 : Math.sign(x) * magnitude;
}

function closePosition(row: Feature) {
  const high = nullable(row.high);
  const low = nullable(row.low);
  const close = nullable(row.close);
  if (high === null || low === null || close === null || high <= low) return 50;
  return clamp(((close - low) / (high - low)) * 100);
}

function evidenceRef(evidence: SelectionEvidenceRecord) {
  return {
    evidence_id: evidence.evidence_id,
    evidence_version: evidence.schema_version,
    source_trade_date: evidence.source_trade_date,
    slot: evidence.slot,
    content_hash: evidence.content_hash,
  };
}

async function ruleHash(value: unknown) {
  return await sha256Hex(stableJson(value));
}

async function selectionId(type: SelectionType, sourceTradeDate: string, targetSessionDate: string, selectorVersion: string, evidenceHash: string) {
  const digest = await sha256Hex([type, sourceTradeDate, targetSessionDate, selectorVersion, evidenceHash].join("|"));
  return `selection:${type.toLowerCase()}:${sourceTradeDate}:${digest.slice(0, 16)}`;
}

function baseHeat(row: Feature) {
  const value = rankScore(row.trade_value_rank, 20, 180);
  const volume = rankScore(row.trade_volume_rank, 20, 180);
  const turnover = rankScore(row.turnover_rank, 20, 180);
  const amplitude = rankScore(row.amplitude_rank, 15, 120);
  const movement = rankScore(row.abs_change_rank, 15, 120);
  return {
    score: round(value * 0.30 + volume * 0.22 + turnover * 0.25 + amplitude * 0.13 + movement * 0.10),
    components: { trade_value: value, trade_volume: volume, turnover, amplitude, movement },
  };
}

function heatReasonCodes(row: Feature) {
  const out: string[] = [];
  if (num(row.trade_value_rank, 9999) <= 50) out.push("VALUE_TOP_50");
  if (num(row.trade_volume_rank, 9999) <= 50) out.push("VOLUME_TOP_50");
  if (num(row.turnover_rank, 9999) <= 50) out.push("TURNOVER_TOP_50");
  if (num(row.amplitude_rank, 9999) <= 50) out.push("AMPLITUDE_TOP_50");
  if (num(row.abs_change_rank, 9999) <= 50) out.push("ABS_MOVE_TOP_50");
  return out;
}

function institutionalSignals(row: Feature) {
  const foreign = signedStrength(row.foreign_net_to_volume, 0.005, 0.06);
  const trust = signedStrength(row.trust_net_to_volume, 0.003, 0.04);
  const dealer = signedStrength(row.dealer_net_to_volume, 0.003, 0.04);
  const directional = clamp(50 + foreign * 0.28 + trust * 0.15 + dealer * 0.07);
  const activity = clamp(Math.abs(foreign) * 0.50 + Math.abs(trust) * 0.30 + Math.abs(dealer) * 0.20);
  return { foreign, trust, dealer, directional, activity };
}

function chipReasonCodes(row: Feature) {
  const out: string[] = [];
  const foreign = num(row.foreign_net_to_volume);
  const trust = num(row.trust_net_to_volume);
  const dealer = num(row.dealer_net_to_volume);
  const margin = num(row.margin_change_to_volume);
  const short = num(row.short_change_to_volume);
  const sbl = num(row.sbl_short_sale_to_volume);
  if (foreign >= 0.01) out.push("FOREIGN_BUY");
  if (foreign <= -0.01) out.push("FOREIGN_SELL");
  if (trust >= 0.005) out.push("TRUST_BUY");
  if (trust <= -0.005) out.push("TRUST_SELL");
  if (dealer >= 0.005) out.push("DEALER_BUY");
  if (dealer <= -0.005) out.push("DEALER_SELL");
  if (margin <= -0.01) out.push("MARGIN_DECREASE");
  if (margin >= 0.02) out.push("MARGIN_SURGE");
  if (short >= 0.005) out.push("SHORT_BUILD");
  if (short <= -0.005) out.push("SHORT_COVER");
  if (sbl >= 0.02) out.push("SBL_SHORT_HIGH");
  return out;
}

function reviewEvent(row: Feature) {
  const change = num(row.change_percent);
  const position = closePosition(row);
  const amplitude = num(row.amplitude_percent);
  if (change >= 3 && position >= 75) return { event_type: "BREAKOUT_EVENT", side: "LONG" as const };
  if (change <= -3 && position <= 25) return { event_type: "BREAKDOWN_EVENT", side: "SHORT" as const };
  if (amplitude >= 6 && position >= 65 && change > 0) return { event_type: "REVERSAL_UP_EVENT", side: "LONG" as const };
  if (amplitude >= 6 && position <= 35 && change < 0) return { event_type: "REVERSAL_DOWN_EVENT", side: "SHORT" as const };
  return { event_type: "HIGH_ACTIVITY_EVENT", side: "BOTH" as const };
}

function buildIntradayReviewCandidates(evidence: SelectionEvidenceRecord) {
  const ranked = evidence.universe_features.map((row: Feature) => {
    const heat = baseHeat(row);
    const inst = institutionalSignals(row);
    const event = reviewEvent(row);
    const score = round(heat.score * 0.82 + inst.activity * 0.18, 1);
    const reasons = [...heatReasonCodes(row), ...chipReasonCodes(row)];
    return {
      row,
      score,
      components: {
        heat_score: heat.score,
        institutional_activity_score: round(inst.activity),
        trade_value_score: heat.components.trade_value,
        volume_score: heat.components.trade_volume,
        turnover_score: heat.components.turnover,
        amplitude_score: heat.components.amplitude,
      },
      reasons,
      ...event,
    };
  }).filter((item) => item.reasons.some((code) => /^(VALUE|VOLUME|TURNOVER|AMPLITUDE|ABS_MOVE)_/.test(code)))
    .sort((a, b) => b.score - a.score || String(a.row.symbol).localeCompare(String(b.row.symbol)));

  const candidates: SelectionCandidate[] = ranked.slice(0, INTRADAY_REVIEW_LIMIT).map((item, index) => ({
    rank: index + 1,
    symbol: String(item.row.symbol),
    name: String(item.row.name ?? ""),
    market: item.row.market === "TPEx" ? "TPEx" : "TWSE",
    side: item.side,
    tier: index < 10 ? "REVIEW_A" : index < 20 ? "REVIEW_B" : "REVIEW_C",
    event_type: item.event_type,
    score: item.score,
    score_components: item.components,
    reason_codes: item.reasons.slice(0, 10),
    caution_codes: num(item.row.margin_change_to_volume) >= 0.03 ? ["MARGIN_SURGE"] : [],
    features: {
      close: item.row.close,
      change_percent: item.row.change_percent,
      amplitude_percent: item.row.amplitude_percent,
      trade_value: item.row.trade_value,
      trade_volume: item.row.trade_volume,
      turnover_percent: item.row.turnover_percent,
      trade_value_rank: item.row.trade_value_rank,
      trade_volume_rank: item.row.trade_volume_rank,
      turnover_rank: item.row.turnover_rank,
      amplitude_rank: item.row.amplitude_rank,
      foreign_net_to_volume: item.row.foreign_net_to_volume,
      trust_net_to_volume: item.row.trust_net_to_volume,
      dealer_net_to_volume: item.row.dealer_net_to_volume,
      close_position_percent: round(closePosition(item.row), 2),
      volume_ratio_5d: null,
      volume_ratio_status: "PENDING_BOUNDED_HISTORY_ENRICHMENT",
    },
  }));
  const control = ranked.slice(INTRADAY_REVIEW_LIMIT, INTRADAY_REVIEW_LIMIT + 20).map((item, index) => ({
    boundary_rank: INTRADAY_REVIEW_LIMIT + index + 1,
    symbol: item.row.symbol,
    score: item.score,
    trade_value_rank: item.row.trade_value_rank,
    trade_volume_rank: item.row.trade_volume_rank,
    turnover_rank: item.row.turnover_rank,
  }));
  return { candidates, control };
}

function directionalChipScore(row: Feature) {
  const inst = institutionalSignals(row);
  const margin = signedStrength(row.margin_change_to_volume, 0.005, 0.06);
  const short = signedStrength(row.short_change_to_volume, 0.003, 0.04);
  const lending = signedStrength(row.securities_lending_change_to_volume, 0.005, 0.08);
  const sbl = clamp(Math.abs(signedStrength(row.sbl_short_sale_to_volume, 0.005, 0.08)));
  const longScore = clamp(inst.directional + (-margin) * 0.16 + short * 0.08 + lending * -0.04);
  const shortScore = clamp(100 - inst.directional + margin * 0.12 + short * 0.14 + lending * 0.06 + sbl * 0.06);
  return { longScore, shortScore, institutional: inst.directional, margin, short, lending, sbl };
}

function buildNextDayIntradayCandidates(evidence: SelectionEvidenceRecord) {
  const ranked = evidence.universe_features.map((row: Feature) => {
    const heat = baseHeat(row);
    const chips = directionalChipScore(row);
    const position = closePosition(row);
    const change = num(row.change_percent);
    const longPrice = clamp(45 + Math.max(-20, Math.min(35, change * 6)) + (position - 50) * 0.35);
    const shortPrice = clamp(45 + Math.max(-20, Math.min(35, -change * 6)) + (50 - position) * 0.35);
    const longScore = heat.score * 0.48 + chips.longScore * 0.34 + longPrice * 0.18;
    const shortScore = heat.score * 0.48 + chips.shortScore * 0.34 + shortPrice * 0.18;
    const side = longScore >= shortScore ? "LONG" as const : "SHORT" as const;
    const score = round(Math.max(longScore, shortScore), 1);
    const reasons = [...heatReasonCodes(row), ...chipReasonCodes(row)];
    let eventType = side === "LONG" ? "LONG_CONTINUATION_WATCH" : "SHORT_CONTINUATION_WATCH";
    if (side === "LONG" && (num(row.short_change_to_volume) > 0.005 || num(row.sbl_short_sale_to_volume) > 0.02)) eventType = "SQUEEZE_WATCH";
    if (side === "SHORT" && num(row.margin_change_to_volume) > 0.02 && num(row.foreign_net_to_volume) < -0.01) eventType = "DISTRIBUTION_WATCH";
    return { row, heat, chips, side, score, longScore, shortScore, longPrice, shortPrice, reasons, eventType };
  }).filter((item) => item.heat.score >= 30)
    .sort((a, b) => b.score - a.score || b.heat.score - a.heat.score || String(a.row.symbol).localeCompare(String(b.row.symbol)));

  const candidates: SelectionCandidate[] = ranked.slice(0, NEXT_DAY_INTRADAY_LIMIT).map((item, index) => ({
    rank: index + 1,
    symbol: String(item.row.symbol),
    name: String(item.row.name ?? ""),
    market: item.row.market === "TPEx" ? "TPEx" : "TWSE",
    side: item.side,
    tier: index < 10 ? "A_CORE" : index < 20 ? "B_CONDITIONAL" : "C_EVENT",
    event_type: item.eventType,
    score: item.score,
    score_components: {
      heat_score: item.heat.score,
      long_chip_score: round(item.chips.longScore),
      short_chip_score: round(item.chips.shortScore),
      long_price_score: round(item.longPrice),
      short_price_score: round(item.shortPrice),
      long_total_score: round(item.longScore, 1),
      short_total_score: round(item.shortScore, 1),
    },
    reason_codes: item.reasons.slice(0, 12),
    caution_codes: [
      ...(num(item.row.margin_change_to_volume) >= 0.03 ? ["MARGIN_SURGE"] : []),
      ...(num(item.row.turnover_percent) >= 20 ? ["EXTREME_TURNOVER"] : []),
    ],
    features: {
      close: item.row.close,
      change_percent: item.row.change_percent,
      amplitude_percent: item.row.amplitude_percent,
      trade_value: item.row.trade_value,
      trade_volume: item.row.trade_volume,
      turnover_percent: item.row.turnover_percent,
      trade_value_rank: item.row.trade_value_rank,
      trade_volume_rank: item.row.trade_volume_rank,
      turnover_rank: item.row.turnover_rank,
      foreign_net_to_volume: item.row.foreign_net_to_volume,
      trust_net_to_volume: item.row.trust_net_to_volume,
      dealer_net_to_volume: item.row.dealer_net_to_volume,
      margin_change_to_volume: item.row.margin_change_to_volume,
      short_change_to_volume: item.row.short_change_to_volume,
      securities_lending_change_to_volume: item.row.securities_lending_change_to_volume,
      sbl_short_sale_to_volume: item.row.sbl_short_sale_to_volume,
      close_position_percent: round(closePosition(item.row), 2),
      volume_ratio_5d: null,
      volume_ratio_status: "PENDING_BOUNDED_HISTORY_ENRICHMENT",
    },
  }));
  const control = ranked.slice(NEXT_DAY_INTRADAY_LIMIT, NEXT_DAY_INTRADAY_LIMIT + 20).map((item, index) => ({
    boundary_rank: NEXT_DAY_INTRADAY_LIMIT + index + 1,
    symbol: item.row.symbol,
    score: item.score,
    heat_score: item.heat.score,
    long_score: round(item.longScore, 1),
    short_score: round(item.shortScore, 1),
  }));
  return { candidates, control };
}

function swingChipScore(row: Feature) {
  const inst = institutionalSignals(row);
  const margin = signedStrength(row.margin_change_to_volume, 0.005, 0.06);
  const score = clamp(inst.directional + (-margin) * 0.15);
  return { score, institutional: inst.directional, margin };
}

async function buildSwingCandidates(env: Env, evidence: SelectionEvidenceRecord) {
  const strictFeatures = new Map(evidence.universe_features.map((row: Feature) => [String(row.symbol), row]));
  const screen = await runStableSwingScreen(env, { mode: "balanced", top_n: 20 });
  if (screen.status !== "OK" && screen.status !== "NO_QUALIFIED_CANDIDATES") {
    return { status: "PENDING" as const, code: `SWING_SCREEN_${screen.status}`, detail: screen };
  }
  const sourceRows = Array.isArray(screen.candidates) ? screen.candidates : [];
  const ranked = sourceRows.flatMap((candidate: any) => {
    const feature = strictFeatures.get(String(candidate.symbol));
    if (!feature || !/^[1-9]\d{3}$/.test(String(candidate.symbol))) return [];
    if (String(candidate.price_date ?? "") !== evidence.source_trade_date) return [];
    const chips = swingChipScore(feature);
    const technical = num(candidate.family_score);
    const final = round(technical * 0.78 + chips.score * 0.22, 1);
    return [{ candidate, feature, chips, final }];
  }).sort((a, b) => b.final - a.final || String(a.candidate.symbol).localeCompare(String(b.candidate.symbol)));

  const candidates: SelectionCandidate[] = ranked.slice(0, SWING_LIMIT).map((item, index) => ({
    rank: index + 1,
    symbol: String(item.candidate.symbol),
    name: String(item.candidate.name ?? item.feature.name ?? ""),
    market: item.feature.market === "TPEx" ? "TPEx" : "TWSE",
    side: "LONG",
    tier: item.final >= 75 ? "SWING_A" : item.final >= 65 ? "SWING_B" : "SWING_WAIT",
    event_type: "SWING_CONTINUATION",
    score: item.final,
    score_components: {
      stable_swing_score: num(item.candidate.family_score),
      technical_score: num(item.candidate.technical_score),
      institutional_credit_score: round(item.chips.score),
    },
    reason_codes: [
      ...(Array.isArray(item.candidate.reasons) ? item.candidate.reasons.map((_: unknown, i: number) => `STABLE_SWING_REASON_${i + 1}`) : []),
      ...chipReasonCodes(item.feature),
    ].slice(0, 12),
    caution_codes: [
      ...(Array.isArray(item.candidate.cautions) ? item.candidate.cautions.map((_: unknown, i: number) => `STABLE_SWING_CAUTION_${i + 1}`) : []),
      ...(num(item.feature.margin_change_to_volume) >= 0.03 ? ["MARGIN_SURGE"] : []),
    ],
    features: {
      price_date: item.candidate.price_date,
      close: item.candidate.close,
      return_20d_percent: item.candidate.return_20d_percent,
      return_60d_percent: item.candidate.return_60d_percent,
      atr14: item.candidate.atr14,
      sma20: item.candidate.sma20,
      sma60: item.candidate.sma60,
      distance_to_sma20_atr: item.candidate.distance_to_sma20_atr,
      distance_to_prior_20d_high_percent: item.candidate.distance_to_prior_20d_high_percent,
      trade_value: item.feature.trade_value,
      turnover_percent: item.feature.turnover_percent,
      foreign_net_to_volume: item.feature.foreign_net_to_volume,
      trust_net_to_volume: item.feature.trust_net_to_volume,
      margin_change_to_volume: item.feature.margin_change_to_volume,
    },
  }));
  return { status: "READY" as const, candidates, control: ranked.slice(SWING_LIMIT, SWING_LIMIT + 10).map((item, index) => ({ boundary_rank: SWING_LIMIT + index + 1, symbol: item.candidate.symbol, score: item.final })) };
}

async function persistRun(env: Env, input: {
  selection_type: SelectionType;
  selector_version: string;
  source_trade_date: string;
  target_session_date: string;
  evidence: SelectionEvidenceRecord;
  candidates: SelectionCandidate[];
  control: Array<Record<string, unknown>>;
  rules: Record<string, unknown>;
}) {
  const existing = await getSelectionRun(env, {
    selection_type: input.selection_type,
    source_trade_date: input.source_trade_date,
    target_session_date: input.target_session_date,
    selector_version: input.selector_version,
  });
  if (existing) return existing;
  const generated = new Date();
  const rulesHash = await ruleHash(input.rules);
  const id = await selectionId(input.selection_type, input.source_trade_date, input.target_session_date, input.selector_version, input.evidence.content_hash);
  return await recordSelectionRun(env, {
    selection_id: id,
    selection_type: input.selection_type,
    selector_version: input.selector_version,
    rule_hash: rulesHash,
    source_trade_date: input.source_trade_date,
    target_session_date: input.target_session_date,
    generated_at: generated.toISOString(),
    generated_at_ms: generated.getTime(),
    knowledge_cutoff_ts_ms: generated.getTime(),
    data_watermark_ts_ms: Math.min(generated.getTime(), input.evidence.data_watermark_ts_ms),
    evidence_ref: evidenceRef(input.evidence),
    universe_count: input.evidence.universe_features.length,
    candidate_count: input.candidates.length,
    candidates: input.candidates,
    control_sample: input.control,
  });
}

export async function runIntradayReviewSelection(env: Env, input: { source_trade_date: string; now?: Date }) {
  const existing = await getSelectionRun(env, {
    selection_type: "INTRADAY_REVIEW",
    source_trade_date: input.source_trade_date,
    target_session_date: input.source_trade_date,
    selector_version: INTRADAY_REVIEW_SELECTOR_VERSION,
  });
  if (existing) return { status: "FINAL" as const, run: existing, idempotent: true };
  const evidenceResult = await ensureSelectionEvidence(env, { source_trade_date: input.source_trade_date, slot: "EOD_1830", now: input.now });
  if (evidenceResult.status !== "READY") return evidenceResult;
  const selected = buildIntradayReviewCandidates(evidenceResult.evidence);
  const run = await persistRun(env, {
    selection_type: "INTRADAY_REVIEW",
    selector_version: INTRADAY_REVIEW_SELECTOR_VERSION,
    source_trade_date: input.source_trade_date,
    target_session_date: input.source_trade_date,
    evidence: evidenceResult.evidence,
    candidates: selected.candidates,
    control: selected.control,
    rules: {
      version: INTRADAY_REVIEW_SELECTOR_VERSION,
      purpose: "POST_CLOSE_INTRADAY_EVENT_REVIEW_NOT_DIRECTIONAL_PREDICTION",
      limit: INTRADAY_REVIEW_LIMIT,
      weights: { heat: 0.82, institutional_activity: 0.18 },
      heat: ["trade_value_rank", "trade_volume_rank", "turnover_rank", "amplitude_rank", "abs_change_rank"],
      strict_stock_universe: "MOPSFIN_COMPANY_MASTER_1XXX_9XXX",
    },
  });
  return { status: "FINAL" as const, run, idempotent: false };
}

export async function runNightSelections(env: Env, input: { source_trade_date: string; target_session_date: string; now?: Date }) {
  const evidenceResult = await ensureSelectionEvidence(env, { source_trade_date: input.source_trade_date, slot: "FULL_2230", now: input.now });
  if (evidenceResult.status !== "READY") return evidenceResult;
  const evidence = evidenceResult.evidence;

  const nextExisting = await getSelectionRun(env, {
    selection_type: "NEXT_DAY_INTRADAY",
    source_trade_date: input.source_trade_date,
    target_session_date: input.target_session_date,
    selector_version: NEXT_DAY_INTRADAY_SELECTOR_VERSION,
  });
  let nextDayRun: SelectionRunRecord;
  if (nextExisting) nextDayRun = nextExisting;
  else {
    const selected = buildNextDayIntradayCandidates(evidence);
    nextDayRun = await persistRun(env, {
      selection_type: "NEXT_DAY_INTRADAY",
      selector_version: NEXT_DAY_INTRADAY_SELECTOR_VERSION,
      source_trade_date: input.source_trade_date,
      target_session_date: input.target_session_date,
      evidence,
      candidates: selected.candidates,
      control: selected.control,
      rules: {
        version: NEXT_DAY_INTRADAY_SELECTOR_VERSION,
        purpose: "NEXT_SESSION_INTRADAY_WATCHLIST",
        limit: NEXT_DAY_INTRADAY_LIMIT,
        weights: { heat: 0.48, chips: 0.34, close_structure: 0.18 },
        inputs: ["value", "volume", "turnover", "amplitude", "foreign", "trust", "dealer", "margin", "short", "securities_lending", "sbl_short_sale"],
        volume_ratio_5d: "RESERVED_NULL_UNTIL_BOUNDED_HISTORY_ENRICHMENT",
        strict_stock_universe: "MOPSFIN_COMPANY_MASTER_1XXX_9XXX",
      },
    });
  }

  const swingExisting = await getSelectionRun(env, {
    selection_type: "SWING",
    source_trade_date: input.source_trade_date,
    target_session_date: input.target_session_date,
    selector_version: SWING_JOURNAL_SELECTOR_VERSION,
  });
  if (swingExisting) return { status: "FINAL" as const, next_day_intraday: nextDayRun, swing: swingExisting, evidence_ref: evidenceRef(evidence) };
  const swingSelected = await buildSwingCandidates(env, evidence);
  if (swingSelected.status !== "READY") {
    return { status: "PARTIAL" as const, next_day_intraday: nextDayRun, swing: null, swing_error: swingSelected, evidence_ref: evidenceRef(evidence) };
  }
  const swingRun = await persistRun(env, {
    selection_type: "SWING",
    selector_version: SWING_JOURNAL_SELECTOR_VERSION,
    source_trade_date: input.source_trade_date,
    target_session_date: input.target_session_date,
    evidence,
    candidates: swingSelected.candidates,
    control: swingSelected.control,
    rules: {
      version: SWING_JOURNAL_SELECTOR_VERSION,
      purpose: "MULTI_DAY_SWING_RESEARCH_SELECTION",
      limit: SWING_LIMIT,
      weights: { stable_swing_technical: 0.78, institutional_credit: 0.22 },
      stable_screen_mode: "balanced",
      strict_stock_universe: "MOPSFIN_COMPANY_MASTER_1XXX_9XXX",
    },
  });
  return { status: "FINAL" as const, next_day_intraday: nextDayRun, swing: swingRun, evidence_ref: evidenceRef(evidence) };
}
