export const RESEARCH_VNEXT_MEMORY_IMPLEMENTATION_VERSION = "research-vnext-memory-core/v1.0.0" as const;
export const GPT_JUDGMENT_SCHEMA_VERSION = "diamond-gpt-judgment/v1" as const;
export const GPT_JUDGMENT_REVIEW_SCHEMA_VERSION = "diamond-gpt-judgment-review/v1" as const;
export const GPT_TRADING_KNOWLEDGE_SCHEMA_VERSION = "diamond-trading-knowledge/v1" as const;

export type JudgmentMarket = "TW_STOCK" | "TXF";
export type JudgmentDirection = "BULLISH" | "BEARISH" | "NEUTRAL";
export type JudgmentTimeframe = "1m" | "5m" | "15m" | "30m" | "60m" | "1d";
export type KnowledgeStatus = "OBSERVATION" | "HYPOTHESIS" | "VALIDATED" | "REJECTED" | "ACCEPTED";

export type JudgmentReason = {
  code: string;
  family?: string | null;
  weight?: number | null;
  note?: string | null;
};

export type TrendlineAnchor = {
  ts_ms: number;
  price: number;
  anchor_type:
    | "SWING_LOW"
    | "SWING_HIGH"
    | "PIVOT_LOW"
    | "PIVOT_HIGH"
    | "GAP_EDGE"
    | "BREAKOUT_LEVEL"
    | "HIGH_VOLUME_REVERSAL"
    | "MANUAL_GPT_ANCHOR";
  strength?: number | null;
  volume_ratio?: number | null;
  atr_context?: number | null;
};

export type TrendlineRecord = {
  trendline_id: string;
  type: "SUPPORT_TRENDLINE" | "RESISTANCE_TRENDLINE" | "CHANNEL_SUPPORT" | "CHANNEL_RESISTANCE";
  status: "ACTIVE" | "BROKEN" | "RECLAIMED" | "INVALIDATED";
  quality: "LOW" | "MEDIUM" | "HIGH";
  anchors: TrendlineAnchor[];
  slope_price_per_bar?: number | null;
  slope_normalized?: number | null;
  touch_count?: number | null;
  false_break_count?: number | null;
  distance_atr?: number | null;
  distance_pct?: number | null;
  current_price?: number | null;
  projected_price?: number | null;
  expected_behavior?: string | null;
  metadata?: Record<string, unknown>;
};

export type PatternRecord = {
  pattern_id: string;
  pattern_type: string;
  status: "FORMING" | "CONFIRMED" | "FAILED" | "COMPLETED";
  confidence: number;
  detected_at_ts_ms: number;
  upper_boundary?: number | null;
  lower_boundary?: number | null;
  compression_atr?: number | null;
  volume_behavior?: "EXPANDING" | "CONTRACTING" | "NEUTRAL" | "UNKNOWN" | null;
  metadata?: Record<string, unknown>;
};

export type RecordJudgmentInput = {
  judgment_id: string;
  judgment_version: string;
  market: JudgmentMarket;
  symbol: string;
  timeframe: JudgmentTimeframe;
  trade_date: string;
  judgment_ts_ms: number;
  knowledge_cutoff_ts_ms: number;
  data_watermark_ts_ms: number;
  direction: JudgmentDirection;
  confidence: number;
  thesis: string;
  risk_reward_score?: number | null;
  reasons?: JudgmentReason[];
  structures?: string[];
  patterns?: PatternRecord[];
  trendlines?: TrendlineRecord[];
  support_levels?: number[];
  resistance_levels?: number[];
  payload?: Record<string, unknown>;
};

export type DatasetReviewRef = {
  dataset_id: string;
  dataset_version: string;
  dataset_hash: string;
  market: "tw-stock" | "txf";
  symbol: string;
  timeframe: "1m" | "5m" | "1d";
  frozen_view: boolean;
  complete_view: boolean;
  truncated: boolean;
  formal_research_eligible: boolean;
  review_eligible?: boolean;
};

export type RecordJudgmentReviewInput = {
  review_id: string;
  review_version: string;
  judgment_id: string;
  judgment_version: string;
  dataset: DatasetReviewRef;
  outcome_horizon: string;
  outcome_ts_ms: number;
  return_pct?: number | null;
  mfe_pct?: number | null;
  mae_pct?: number | null;
  return_points?: number | null;
  mfe_points?: number | null;
  mae_points?: number | null;
  direction_correct: boolean | null;
  location_quality?: "GOOD" | "FAIR" | "POOR" | "UNKNOWN";
  timing_quality?: "GOOD" | "FAIR" | "POOR" | "UNKNOWN";
  structure_correct?: boolean | null;
  pattern_correct?: boolean | null;
  trendline_correct?: boolean | null;
  risk_reward_correct?: boolean | null;
  attribution?: string[];
  failure_patterns?: string[];
  optimization_hypotheses?: Array<{
    hypothesis: string;
    expected_effect?: string | null;
    risk?: string | null;
  }>;
  interpretation: string;
  payload?: Record<string, unknown>;
};

export type RecordTradingKnowledgeInput = {
  knowledge_id: string;
  knowledge_version: string;
  market_scope: "ALL" | JudgmentMarket;
  topic: string;
  statement: string;
  status: KnowledgeStatus;
  evidence_count: number;
  evidence_refs?: Array<{
    judgment_id: string;
    judgment_version: string;
    review_id?: string | null;
    review_version?: string | null;
  }>;
  actor_type: "GPT_REVIEW" | "SYSTEM" | "HUMAN";
  human_approved?: boolean;
  rationale?: string | null;
  payload?: Record<string, unknown>;
};

export class ResearchVNextMemoryError extends Error {
  readonly code: string;
  readonly detail?: Record<string, unknown>;

  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "ResearchVNextMemoryError";
    this.code = code;
    this.detail = detail;
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) output[key] = stableValue(source[key]);
    return output;
  }
  if (value === undefined) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function requiredText(value: unknown, field: string, max = 5000): string {
  const output = String(value ?? "").trim();
  if (!output) throw new ResearchVNextMemoryError("INVALID_INPUT", `${field} is required`);
  if (output.length > max) throw new ResearchVNextMemoryError("INVALID_INPUT", `${field} exceeds ${max} chars`);
  return output;
}

function dateText(value: unknown, field = "trade_date"): string {
  const output = requiredText(value, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(output) || Number.isNaN(Date.parse(`${output}T00:00:00Z`))) {
    throw new ResearchVNextMemoryError("INVALID_INPUT", `${field} must be YYYY-MM-DD`);
  }
  return output;
}

function explicitRecordedAt(value: unknown): string {
  const output = requiredText(value, "recorded_at", 40);
  const parsed = Date.parse(output);
  if (!Number.isFinite(parsed) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(output)) {
    throw new ResearchVNextMemoryError("INVALID_RECORDED_AT", "recorded_at must be an explicit UTC ISO timestamp");
  }
  return output;
}

function safePositiveInt(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new ResearchVNextMemoryError("INVALID_INPUT", `${field} must be a positive safe integer`);
  }
  return number;
}

function finite(
  value: unknown,
  field: string,
  options: { min?: number; max?: number; nullable?: boolean } = {},
): number | null {
  if ((value === undefined || value === null || value === "") && options.nullable) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new ResearchVNextMemoryError("INVALID_INPUT", `${field} must be finite`);
  if (options.min !== undefined && number < options.min) {
    throw new ResearchVNextMemoryError("INVALID_INPUT", `${field} must be >= ${options.min}`);
  }
  if (options.max !== undefined && number > options.max) {
    throw new ResearchVNextMemoryError("INVALID_INPUT", `${field} must be <= ${options.max}`);
  }
  return number;
}

function normalizeSymbol(market: JudgmentMarket, raw: unknown): string {
  const symbol = String(raw ?? "").trim().toUpperCase();
  if (market === "TXF") {
    if (symbol !== "TXF") {
      throw new ResearchVNextMemoryError("INVALID_INPUT", "TXF judgment symbol must be logical symbol TXF");
    }
    return symbol;
  }
  if (!/^\d{4,6}$/.test(symbol)) {
    throw new ResearchVNextMemoryError("INVALID_INPUT", "TW_STOCK symbol must be 4-6 digits");
  }
  return symbol;
}

function taipeiCalendarDate(tsMs: number): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(tsMs);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function uniqueStrings(values: unknown[] | undefined, field: string, max = 100): string[] {
  return Array.from(new Set((values ?? []).map((value) => requiredText(value, field, max)))).sort();
}

function cleanLevels(values: number[] | undefined, field: string): number[] {
  const normalized = (values ?? []).map((value) => finite(value, field, { min: 0.00000001 }) as number);
  return Array.from(new Set(normalized)).sort((a, b) => a - b);
}

function normalizeReason(raw: JudgmentReason): JudgmentReason {
  const code = requiredText(raw?.code, "reason.code", 120).toUpperCase();
  const family = raw?.family == null ? null : requiredText(raw.family, "reason.family", 120).toUpperCase();
  const weight = raw?.weight == null ? null : finite(raw.weight, "reason.weight", { min: -10, max: 10 });
  const note = raw?.note == null ? null : String(raw.note).trim().slice(0, 1200);
  return { code, family, weight, note };
}

function normalizeTrendline(raw: TrendlineRecord, cutoff: number): TrendlineRecord {
  const trendlineId = requiredText(raw?.trendline_id, "trendline_id", 240);
  if (!["SUPPORT_TRENDLINE", "RESISTANCE_TRENDLINE", "CHANNEL_SUPPORT", "CHANNEL_RESISTANCE"].includes(String(raw?.type))) {
    throw new ResearchVNextMemoryError("INVALID_INPUT", "invalid trendline.type");
  }
  if (!["ACTIVE", "BROKEN", "RECLAIMED", "INVALIDATED"].includes(String(raw?.status))) {
    throw new ResearchVNextMemoryError("INVALID_INPUT", "invalid trendline.status");
  }
  if (!["LOW", "MEDIUM", "HIGH"].includes(String(raw?.quality))) {
    throw new ResearchVNextMemoryError("INVALID_INPUT", "invalid trendline.quality");
  }

  const anchors = (raw?.anchors ?? [])
    .map((anchor, index) => {
      const tsMs = safePositiveInt(anchor?.ts_ms, `trendline.anchors[${index}].ts_ms`);
      if (tsMs > cutoff) {
        throw new ResearchVNextMemoryError("LOOKAHEAD_BIAS", "trendline anchor is after knowledge cutoff", {
          trendline_id: trendlineId,
          anchor_ts_ms: tsMs,
          knowledge_cutoff_ts_ms: cutoff,
        });
      }
      const price = finite(anchor?.price, `trendline.anchors[${index}].price`, { min: 0.00000001 }) as number;
      if (!["SWING_LOW", "SWING_HIGH", "PIVOT_LOW", "PIVOT_HIGH", "GAP_EDGE", "BREAKOUT_LEVEL", "HIGH_VOLUME_REVERSAL", "MANUAL_GPT_ANCHOR"].includes(String(anchor?.anchor_type))) {
        throw new ResearchVNextMemoryError("INVALID_INPUT", "invalid trendline anchor_type");
      }
      return {
        ts_ms: tsMs,
        price,
        anchor_type: anchor.anchor_type,
        strength: anchor.strength == null ? null : finite(anchor.strength, "anchor.strength", { min: 0, max: 100 }),
        volume_ratio: anchor.volume_ratio == null ? null : finite(anchor.volume_ratio, "anchor.volume_ratio", { min: 0 }),
        atr_context: anchor.atr_context == null ? null : finite(anchor.atr_context, "anchor.atr_context", { min: 0 }),
      } as TrendlineAnchor;
    })
    .sort((a, b) => a.ts_ms - b.ts_ms);

  if (anchors.length < 2 || anchors.length > 12) {
    throw new ResearchVNextMemoryError("INVALID_INPUT", "trendline requires 2..12 anchors");
  }
  for (let index = 1; index < anchors.length; index += 1) {
    if (anchors[index].ts_ms <= anchors[index - 1].ts_ms) {
      throw new ResearchVNextMemoryError("INVALID_INPUT", "trendline anchors must be strictly chronological");
    }
  }

  const nonnegativeInt = (value: unknown, field: string): number | null => {
    if (value == null) return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) {
      throw new ResearchVNextMemoryError("INVALID_INPUT", `${field} must be non-negative integer`);
    }
    return number;
  };

  return {
    trendline_id: trendlineId,
    type: raw.type,
    status: raw.status,
    quality: raw.quality,
    anchors,
    slope_price_per_bar: raw.slope_price_per_bar == null ? null : finite(raw.slope_price_per_bar, "slope_price_per_bar"),
    slope_normalized: raw.slope_normalized == null ? null : finite(raw.slope_normalized, "slope_normalized"),
    touch_count: nonnegativeInt(raw.touch_count, "touch_count"),
    false_break_count: nonnegativeInt(raw.false_break_count, "false_break_count"),
    distance_atr: raw.distance_atr == null ? null : finite(raw.distance_atr, "distance_atr"),
    distance_pct: raw.distance_pct == null ? null : finite(raw.distance_pct, "distance_pct"),
    current_price: raw.current_price == null ? null : finite(raw.current_price, "current_price", { min: 0.00000001 }),
    projected_price: raw.projected_price == null ? null : finite(raw.projected_price, "projected_price", { min: 0.00000001 }),
    expected_behavior: raw.expected_behavior == null ? null : String(raw.expected_behavior).trim().slice(0, 2000),
    metadata: stableValue(raw.metadata ?? {}) as Record<string, unknown>,
  };
}

function normalizePattern(raw: PatternRecord, cutoff: number): PatternRecord {
  const patternId = requiredText(raw?.pattern_id, "pattern_id", 240);
  const patternType = requiredText(raw?.pattern_type, "pattern_type", 160).toUpperCase();
  if (!["FORMING", "CONFIRMED", "FAILED", "COMPLETED"].includes(String(raw?.status))) {
    throw new ResearchVNextMemoryError("INVALID_INPUT", "invalid pattern.status");
  }
  const confidence = finite(raw?.confidence, "pattern.confidence", { min: 0, max: 100 }) as number;
  const detectedAt = safePositiveInt(raw?.detected_at_ts_ms, "pattern.detected_at_ts_ms");
  if (detectedAt > cutoff) {
    throw new ResearchVNextMemoryError("LOOKAHEAD_BIAS", "pattern detection is after knowledge cutoff", {
      pattern_id: patternId,
      detected_at_ts_ms: detectedAt,
      knowledge_cutoff_ts_ms: cutoff,
    });
  }
  const positivePrice = (value: unknown, field: string) =>
    value == null ? null : finite(value, field, { min: 0.00000001 });
  const volumeBehavior = raw.volume_behavior == null ? null : String(raw.volume_behavior).toUpperCase();
  if (volumeBehavior && !["EXPANDING", "CONTRACTING", "NEUTRAL", "UNKNOWN"].includes(volumeBehavior)) {
    throw new ResearchVNextMemoryError("INVALID_INPUT", "invalid pattern.volume_behavior");
  }
  return {
    pattern_id: patternId,
    pattern_type: patternType,
    status: raw.status,
    confidence,
    detected_at_ts_ms: detectedAt,
    upper_boundary: positivePrice(raw.upper_boundary, "pattern.upper_boundary"),
    lower_boundary: positivePrice(raw.lower_boundary, "pattern.lower_boundary"),
    compression_atr: raw.compression_atr == null ? null : finite(raw.compression_atr, "pattern.compression_atr", { min: 0 }),
    volume_behavior: volumeBehavior as PatternRecord["volume_behavior"],
    metadata: stableValue(raw.metadata ?? {}) as Record<string, unknown>,
  };
}

function quality(value: unknown, field: string): "GOOD" | "FAIR" | "POOR" | "UNKNOWN" {
  const output = String(value ?? "UNKNOWN").toUpperCase();
  if (!["GOOD", "FAIR", "POOR", "UNKNOWN"].includes(output)) {
    throw new ResearchVNextMemoryError("INVALID_INPUT", `${field} invalid`);
  }
  return output as "GOOD" | "FAIR" | "POOR" | "UNKNOWN";
}

function validateDatasetForReview(dataset: DatasetReviewRef, judgment: Record<string, unknown>) {
  if (!dataset || !dataset.frozen_view || !dataset.complete_view || dataset.truncated) {
    throw new ResearchVNextMemoryError(
      "DATASET_NOT_FROZEN_COMPLETE",
      "review requires frozen, complete, non-truncated OHLC dataset",
    );
  }
  if (
    !/^sha256:[0-9a-f]{64}$/.test(String(dataset.dataset_version)) ||
    !/^[0-9a-f]{64}$/.test(String(dataset.dataset_hash)) ||
    dataset.dataset_version !== `sha256:${dataset.dataset_hash}`
  ) {
    throw new ResearchVNextMemoryError("INVALID_DATASET_HASH", "dataset version/hash pair is invalid");
  }
  const market = String(judgment.market);
  if ((market === "TW_STOCK" && dataset.market !== "tw-stock") || (market === "TXF" && dataset.market !== "txf")) {
    throw new ResearchVNextMemoryError("DATASET_MARKET_MISMATCH", "dataset market differs from judgment market");
  }
  if (String(dataset.symbol).toUpperCase() !== String(judgment.symbol).toUpperCase()) {
    throw new ResearchVNextMemoryError("DATASET_SYMBOL_MISMATCH", "dataset symbol differs from judgment symbol");
  }
  if (market === "TW_STOCK" && !dataset.formal_research_eligible) {
    throw new ResearchVNextMemoryError(
      "DATASET_NOT_ELIGIBLE",
      "TW_STOCK judgment review requires formal research eligible OHLC dataset",
    );
  }
  if (market === "TXF" && dataset.review_eligible !== true && dataset.formal_research_eligible !== true) {
    throw new ResearchVNextMemoryError(
      "DATASET_NOT_ELIGIBLE",
      "TXF judgment review requires review_eligible or formal_research_eligible dataset",
    );
  }
}

export async function prepareMarketJudgmentMemoryRecord(raw: RecordJudgmentInput, recordedAtInput: string) {
  const judgmentId = requiredText(raw.judgment_id, "judgment_id", 240);
  const judgmentVersion = requiredText(raw.judgment_version, "judgment_version", 160);
  const market = String(raw.market ?? "") as JudgmentMarket;
  if (!["TW_STOCK", "TXF"].includes(market)) {
    throw new ResearchVNextMemoryError("INVALID_INPUT", "market must be TW_STOCK or TXF");
  }
  const symbol = normalizeSymbol(market, raw.symbol);
  const timeframe = String(raw.timeframe ?? "") as JudgmentTimeframe;
  if (!["1m", "5m", "15m", "30m", "60m", "1d"].includes(timeframe)) {
    throw new ResearchVNextMemoryError("INVALID_INPUT", "invalid timeframe");
  }
  const tradeDate = dateText(raw.trade_date);
  const judgmentTs = safePositiveInt(raw.judgment_ts_ms, "judgment_ts_ms");
  const knowledgeCutoffTs = safePositiveInt(raw.knowledge_cutoff_ts_ms, "knowledge_cutoff_ts_ms");
  const dataWatermarkTs = safePositiveInt(raw.data_watermark_ts_ms, "data_watermark_ts_ms");
  if (dataWatermarkTs > knowledgeCutoffTs || knowledgeCutoffTs > judgmentTs) {
    throw new ResearchVNextMemoryError(
      "LOOKAHEAD_BIAS",
      "required ordering is data_watermark <= knowledge_cutoff <= judgment timestamp",
    );
  }
  if (market === "TW_STOCK" && taipeiCalendarDate(judgmentTs) !== tradeDate) {
    throw new ResearchVNextMemoryError(
      "TRADE_DATE_MISMATCH",
      "TW_STOCK trade_date must match judgment timestamp in Asia/Taipei",
    );
  }
  const direction = String(raw.direction ?? "") as JudgmentDirection;
  if (!["BULLISH", "BEARISH", "NEUTRAL"].includes(direction)) {
    throw new ResearchVNextMemoryError("INVALID_INPUT", "invalid direction");
  }
  const confidence = finite(raw.confidence, "confidence", { min: 0, max: 100 }) as number;
  const thesis = requiredText(raw.thesis, "thesis", 8000);
  const riskRewardScore = raw.risk_reward_score == null
    ? null
    : finite(raw.risk_reward_score, "risk_reward_score", { min: 0, max: 100 });
  const structures = uniqueStrings(raw.structures, "structure", 120);
  const supportLevels = cleanLevels(raw.support_levels, "support_level");
  const resistanceLevels = cleanLevels(raw.resistance_levels, "resistance_level");

  const reasonMap = new Map<string, JudgmentReason>();
  for (const reason of raw.reasons ?? []) {
    const normalized = normalizeReason(reason);
    reasonMap.set(normalized.code, normalized);
  }
  const reasons = [...reasonMap.values()].sort((a, b) => a.code.localeCompare(b.code));

  const trendlineIds = new Set<string>();
  const trendlines = (raw.trendlines ?? []).map((value) => normalizeTrendline(value, knowledgeCutoffTs)).map((value) => {
    if (trendlineIds.has(value.trendline_id)) {
      throw new ResearchVNextMemoryError("INVALID_INPUT", "duplicate trendline_id");
    }
    trendlineIds.add(value.trendline_id);
    return value;
  });

  const patternIds = new Set<string>();
  const patterns = (raw.patterns ?? []).map((value) => normalizePattern(value, knowledgeCutoffTs)).map((value) => {
    if (patternIds.has(value.pattern_id)) {
      throw new ResearchVNextMemoryError("INVALID_INPUT", "duplicate pattern_id");
    }
    patternIds.add(value.pattern_id);
    return value;
  });

  const payload = stableValue(raw.payload ?? {}) as Record<string, unknown>;
  const canonical = {
    schema_version: GPT_JUDGMENT_SCHEMA_VERSION,
    judgment_id: judgmentId,
    judgment_version: judgmentVersion,
    market,
    symbol,
    timeframe,
    trade_date: tradeDate,
    judgment_ts_ms: judgmentTs,
    knowledge_cutoff_ts_ms: knowledgeCutoffTs,
    data_watermark_ts_ms: dataWatermarkTs,
    direction,
    confidence,
    thesis,
    risk_reward_score: riskRewardScore,
    reasons,
    structures,
    patterns,
    trendlines,
    support_levels: supportLevels,
    resistance_levels: resistanceLevels,
    payload,
  };
  const contentHash = await sha256Hex(stableJson(canonical));
  const recordedAt = explicitRecordedAt(recordedAtInput);
  const record = { ...canonical, content_hash: contentHash, recorded_at: recordedAt, storage: "GITHUB_ONLY" as const };

  return {
    canonical,
    content_hash: contentHash,
    record,
    collection: "research/gpt-judgments" as const,
    key: `${judgmentId}\u0000${judgmentVersion}`,
    metadata: {
      judgment_id: judgmentId,
      judgment_version: judgmentVersion,
      market,
      symbol,
      timeframe,
      trade_date: tradeDate,
      judgment_ts_ms: judgmentTs,
      direction,
    },
  };
}

export async function prepareJudgmentReviewMemoryRecord(
  raw: RecordJudgmentReviewInput,
  judgment: Record<string, unknown>,
  recordedAtInput: string,
) {
  const reviewId = requiredText(raw.review_id, "review_id", 240);
  const reviewVersion = requiredText(raw.review_version, "review_version", 160);
  const judgmentId = requiredText(raw.judgment_id, "judgment_id", 240);
  const judgmentVersion = requiredText(raw.judgment_version, "judgment_version", 160);
  if (!judgment || typeof judgment !== "object") {
    throw new ResearchVNextMemoryError("JUDGMENT_NOT_FOUND", "original judgment not found");
  }
  if (String(judgment.judgment_id) !== judgmentId || String(judgment.judgment_version) !== judgmentVersion) {
    throw new ResearchVNextMemoryError("JUDGMENT_MISMATCH", "provided judgment does not match review reference");
  }
  validateDatasetForReview(raw.dataset, judgment);

  const outcomeTs = safePositiveInt(raw.outcome_ts_ms, "outcome_ts_ms");
  if (outcomeTs <= Number(judgment.judgment_ts_ms)) {
    throw new ResearchVNextMemoryError("INVALID_OUTCOME_TIME", "outcome must be after original judgment");
  }
  const outcomeHorizon = requiredText(raw.outcome_horizon, "outcome_horizon", 120);
  const metric = (value: unknown, field: string) => value == null ? null : finite(value, field);
  const returnPct = metric(raw.return_pct, "return_pct");
  const mfePct = metric(raw.mfe_pct, "mfe_pct");
  const maePct = metric(raw.mae_pct, "mae_pct");
  const returnPoints = metric(raw.return_points, "return_points");
  const mfePoints = metric(raw.mfe_points, "mfe_points");
  const maePoints = metric(raw.mae_points, "mae_points");
  if (String(judgment.market) === "TW_STOCK" && [returnPct, mfePct, maePct].every((value) => value === null)) {
    throw new ResearchVNextMemoryError("MISSING_OUTCOME_METRICS", "TW_STOCK review requires pct outcome metrics");
  }
  if (String(judgment.market) === "TXF" && [returnPoints, mfePoints, maePoints].every((value) => value === null)) {
    throw new ResearchVNextMemoryError("MISSING_OUTCOME_METRICS", "TXF review requires point outcome metrics");
  }

  const attribution = uniqueStrings(raw.attribution, "attribution", 160);
  const failurePatterns = uniqueStrings(raw.failure_patterns, "failure_pattern", 160);
  const optimizationHypotheses = (raw.optimization_hypotheses ?? []).slice(0, 10).map((hypothesis) => ({
    hypothesis: requiredText(hypothesis?.hypothesis, "hypothesis", 2000),
    expected_effect: hypothesis?.expected_effect == null ? null : String(hypothesis.expected_effect).trim().slice(0, 1000),
    risk: hypothesis?.risk == null ? null : String(hypothesis.risk).trim().slice(0, 1000),
  }));
  const interpretation = requiredText(raw.interpretation, "interpretation", 8000);
  const payload = stableValue(raw.payload ?? {}) as Record<string, unknown>;

  const canonical = {
    schema_version: GPT_JUDGMENT_REVIEW_SCHEMA_VERSION,
    review_id: reviewId,
    review_version: reviewVersion,
    judgment_id: judgmentId,
    judgment_version: judgmentVersion,
    dataset: stableValue(raw.dataset) as DatasetReviewRef,
    outcome_horizon: outcomeHorizon,
    outcome_ts_ms: outcomeTs,
    return_pct: returnPct,
    mfe_pct: mfePct,
    mae_pct: maePct,
    return_points: returnPoints,
    mfe_points: mfePoints,
    mae_points: maePoints,
    direction_correct: raw.direction_correct,
    location_quality: quality(raw.location_quality, "location_quality"),
    timing_quality: quality(raw.timing_quality, "timing_quality"),
    structure_correct: raw.structure_correct ?? null,
    pattern_correct: raw.pattern_correct ?? null,
    trendline_correct: raw.trendline_correct ?? null,
    risk_reward_correct: raw.risk_reward_correct ?? null,
    attribution,
    failure_patterns: failurePatterns,
    optimization_hypotheses: optimizationHypotheses,
    interpretation,
    payload,
    market: judgment.market,
    symbol: judgment.symbol,
  };
  const contentHash = await sha256Hex(stableJson(canonical));
  const recordedAt = explicitRecordedAt(recordedAtInput);
  const record = { ...canonical, content_hash: contentHash, recorded_at: recordedAt, storage: "GITHUB_ONLY" as const };

  return {
    canonical,
    content_hash: contentHash,
    record,
    collection: "research/gpt-judgment-reviews" as const,
    key: `${reviewId}\u0000${reviewVersion}`,
    metadata: {
      review_id: reviewId,
      review_version: reviewVersion,
      judgment_id: judgmentId,
      judgment_version: judgmentVersion,
      market: judgment.market,
      symbol: judgment.symbol,
      outcome_ts_ms: outcomeTs,
    },
    learning_policy: "REVIEW_DOES_NOT_MUTATE_STRATEGY" as const,
  };
}

export async function prepareTradingKnowledgeMemoryRecord(
  raw: RecordTradingKnowledgeInput,
  recordedAtInput: string,
) {
  const knowledgeId = requiredText(raw.knowledge_id, "knowledge_id", 240);
  const knowledgeVersion = requiredText(raw.knowledge_version, "knowledge_version", 160);
  const marketScope = String(raw.market_scope ?? "") as "ALL" | JudgmentMarket;
  if (!["ALL", "TW_STOCK", "TXF"].includes(marketScope)) {
    throw new ResearchVNextMemoryError("INVALID_INPUT", "invalid market_scope");
  }
  const topic = requiredText(raw.topic, "topic", 200).toUpperCase();
  const statement = requiredText(raw.statement, "statement", 8000);
  const status = String(raw.status ?? "") as KnowledgeStatus;
  if (!["OBSERVATION", "HYPOTHESIS", "VALIDATED", "REJECTED", "ACCEPTED"].includes(status)) {
    throw new ResearchVNextMemoryError("INVALID_INPUT", "invalid knowledge status");
  }
  const evidenceCount = Number(raw.evidence_count);
  if (!Number.isInteger(evidenceCount) || evidenceCount < 0) {
    throw new ResearchVNextMemoryError("INVALID_INPUT", "evidence_count must be non-negative integer");
  }
  const actorType = String(raw.actor_type ?? "") as "GPT_REVIEW" | "SYSTEM" | "HUMAN";
  if (!["GPT_REVIEW", "SYSTEM", "HUMAN"].includes(actorType)) {
    throw new ResearchVNextMemoryError("INVALID_INPUT", "invalid actor_type");
  }
  const humanApproved = raw.human_approved === true;
  if (status === "ACCEPTED" && (!humanApproved || actorType !== "HUMAN")) {
    throw new ResearchVNextMemoryError(
      "HUMAN_APPROVAL_REQUIRED",
      "ACCEPTED knowledge requires HUMAN actor and human_approved=true",
    );
  }
  const evidenceRefs = (raw.evidence_refs ?? [])
    .map((reference) => ({
      judgment_id: requiredText(reference.judgment_id, "evidence.judgment_id", 240),
      judgment_version: requiredText(reference.judgment_version, "evidence.judgment_version", 160),
      review_id: reference.review_id == null ? null : requiredText(reference.review_id, "evidence.review_id", 240),
      review_version: reference.review_version == null ? null : requiredText(reference.review_version, "evidence.review_version", 160),
    }))
    .sort((a, b) => `${a.judgment_id}|${a.judgment_version}|${a.review_id}`.localeCompare(`${b.judgment_id}|${b.judgment_version}|${b.review_id}`));
  const rationale = raw.rationale == null ? null : String(raw.rationale).trim().slice(0, 5000);
  const payload = stableValue(raw.payload ?? {}) as Record<string, unknown>;

  const canonical = {
    schema_version: GPT_TRADING_KNOWLEDGE_SCHEMA_VERSION,
    knowledge_id: knowledgeId,
    knowledge_version: knowledgeVersion,
    market_scope: marketScope,
    topic,
    statement,
    status,
    evidence_count: evidenceCount,
    evidence_refs: evidenceRefs,
    actor_type: actorType,
    human_approved: humanApproved,
    rationale,
    payload,
  };
  const contentHash = await sha256Hex(stableJson(canonical));
  const recordedAt = explicitRecordedAt(recordedAtInput);
  const record = { ...canonical, content_hash: contentHash, recorded_at: recordedAt, storage: "GITHUB_ONLY" as const };

  return {
    canonical,
    content_hash: contentHash,
    record,
    collection: "research/gpt-trading-knowledge" as const,
    key: `${knowledgeId}\u0000${knowledgeVersion}`,
    metadata: {
      knowledge_id: knowledgeId,
      knowledge_version: knowledgeVersion,
      market_scope: marketScope,
      topic,
      status,
    },
    production_promotion: "FORBIDDEN" as const,
  };
}
