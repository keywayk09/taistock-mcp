export const GPT_JUDGMENT_SCHEMA_VERSION = "diamond-gpt-judgment/v1";
export const GPT_JUDGMENT_REVIEW_SCHEMA_VERSION = "diamond-gpt-judgment-review/v1";
export const GPT_TRADING_KNOWLEDGE_SCHEMA_VERSION = "diamond-trading-knowledge/v1";
export const GPT_JUDGMENT_MEMORY_VERSION = "diamond-gpt-judgment-memory/v1.0.0";

export type JudgmentMarket = "TW_STOCK" | "TXF";
export type JudgmentDirection = "BULLISH" | "BEARISH" | "NEUTRAL";
export type JudgmentTimeframe = "1m" | "5m" | "15m" | "30m" | "60m" | "1d";
export type TrendlineType = "SUPPORT_TRENDLINE" | "RESISTANCE_TRENDLINE" | "CHANNEL_SUPPORT" | "CHANNEL_RESISTANCE";
export type TrendlineStatus = "ACTIVE" | "BROKEN" | "RECLAIMED" | "INVALIDATED";
export type PatternStatus = "FORMING" | "CONFIRMED" | "FAILED" | "COMPLETED";
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
  anchor_type: "SWING_LOW" | "SWING_HIGH" | "PIVOT_LOW" | "PIVOT_HIGH" | "GAP_EDGE" | "BREAKOUT_LEVEL" | "HIGH_VOLUME_REVERSAL" | "MANUAL_GPT_ANCHOR";
  strength?: number | null;
  volume_ratio?: number | null;
  atr_context?: number | null;
};

export type TrendlineRecord = {
  trendline_id: string;
  type: TrendlineType;
  status: TrendlineStatus;
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
  status: PatternStatus;
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
  optimization_hypotheses?: Array<{ hypothesis: string; expected_effect?: string | null; risk?: string | null }>;
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
  evidence_refs?: Array<{ judgment_id: string; judgment_version: string; review_id?: string | null; review_version?: string | null }>;
  actor_type: "GPT_REVIEW" | "SYSTEM" | "HUMAN";
  human_approved?: boolean;
  rationale?: string | null;
  payload?: Record<string, unknown>;
};

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS gpt_judgments (
    judgment_id TEXT NOT NULL,
    judgment_version TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    market TEXT NOT NULL,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    judgment_ts_ms INTEGER NOT NULL,
    knowledge_cutoff_ts_ms INTEGER NOT NULL,
    data_watermark_ts_ms INTEGER NOT NULL,
    direction TEXT NOT NULL,
    confidence REAL NOT NULL,
    thesis TEXT NOT NULL,
    risk_reward_score REAL,
    structures_json TEXT NOT NULL,
    support_levels_json TEXT NOT NULL,
    resistance_levels_json TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (judgment_id, judgment_version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_gpt_judgments_market_date ON gpt_judgments(market, trade_date, judgment_ts_ms)`,
  `CREATE INDEX IF NOT EXISTS idx_gpt_judgments_symbol_date ON gpt_judgments(symbol, trade_date, judgment_ts_ms)`,
  `CREATE TABLE IF NOT EXISTS gpt_judgment_reasons (
    judgment_id TEXT NOT NULL,
    judgment_version TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    family TEXT,
    weight REAL,
    note TEXT,
    PRIMARY KEY (judgment_id, judgment_version, reason_code)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_gpt_judgment_reasons_code ON gpt_judgment_reasons(reason_code)`,
  `CREATE TABLE IF NOT EXISTS gpt_judgment_trendlines (
    trendline_id TEXT NOT NULL,
    judgment_id TEXT NOT NULL,
    judgment_version TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    quality TEXT NOT NULL,
    anchor_count INTEGER NOT NULL,
    anchors_json TEXT NOT NULL,
    slope_price_per_bar REAL,
    slope_normalized REAL,
    touch_count INTEGER,
    false_break_count INTEGER,
    distance_atr REAL,
    distance_pct REAL,
    current_price REAL,
    projected_price REAL,
    expected_behavior TEXT,
    metadata_json TEXT NOT NULL,
    PRIMARY KEY (trendline_id, judgment_id, judgment_version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_gpt_trendlines_type ON gpt_judgment_trendlines(type, status, quality)`,
  `CREATE TABLE IF NOT EXISTS gpt_judgment_patterns (
    pattern_id TEXT NOT NULL,
    judgment_id TEXT NOT NULL,
    judgment_version TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    pattern_type TEXT NOT NULL,
    status TEXT NOT NULL,
    confidence REAL NOT NULL,
    detected_at_ts_ms INTEGER NOT NULL,
    upper_boundary REAL,
    lower_boundary REAL,
    compression_atr REAL,
    volume_behavior TEXT,
    metadata_json TEXT NOT NULL,
    PRIMARY KEY (pattern_id, judgment_id, judgment_version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_gpt_patterns_type ON gpt_judgment_patterns(pattern_type, status)`,
  `CREATE TABLE IF NOT EXISTS gpt_judgment_reviews (
    review_id TEXT NOT NULL,
    review_version TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    judgment_id TEXT NOT NULL,
    judgment_version TEXT NOT NULL,
    market TEXT NOT NULL,
    symbol TEXT NOT NULL,
    outcome_horizon TEXT NOT NULL,
    outcome_ts_ms INTEGER NOT NULL,
    dataset_id TEXT NOT NULL,
    dataset_version TEXT NOT NULL,
    dataset_hash TEXT NOT NULL,
    dataset_timeframe TEXT NOT NULL,
    return_pct REAL,
    mfe_pct REAL,
    mae_pct REAL,
    return_points REAL,
    mfe_points REAL,
    mae_points REAL,
    direction_correct INTEGER,
    location_quality TEXT,
    timing_quality TEXT,
    structure_correct INTEGER,
    pattern_correct INTEGER,
    trendline_correct INTEGER,
    risk_reward_correct INTEGER,
    attribution_json TEXT NOT NULL,
    failure_patterns_json TEXT NOT NULL,
    optimization_hypotheses_json TEXT NOT NULL,
    interpretation TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (review_id, review_version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_gpt_reviews_judgment ON gpt_judgment_reviews(judgment_id, judgment_version)`,
  `CREATE INDEX IF NOT EXISTS idx_gpt_reviews_market_symbol ON gpt_judgment_reviews(market, symbol, outcome_ts_ms)`,
  `CREATE TABLE IF NOT EXISTS gpt_trading_knowledge (
    knowledge_id TEXT NOT NULL,
    knowledge_version TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    market_scope TEXT NOT NULL,
    topic TEXT NOT NULL,
    statement TEXT NOT NULL,
    status TEXT NOT NULL,
    evidence_count INTEGER NOT NULL,
    evidence_refs_json TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    human_approved INTEGER NOT NULL,
    rationale TEXT,
    payload_json TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (knowledge_id, knowledge_version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_gpt_knowledge_topic_status ON gpt_trading_knowledge(topic, status, market_scope)`,
] as const;

export class JudgmentMemoryError extends Error {
  readonly code: string;
  readonly detail?: Record<string, unknown>;
  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "JudgmentMemoryError";
    this.code = code;
    this.detail = detail;
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = stableValue(src[key]);
    return out;
  }
  if (value === undefined) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  return value;
}

function stableJson(value: unknown): string { return JSON.stringify(stableValue(value)); }
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function requiredText(value: unknown, field: string, max = 5000): string {
  const out = String(value ?? "").trim();
  if (!out) throw new JudgmentMemoryError("INVALID_INPUT", `${field} is required`);
  if (out.length > max) throw new JudgmentMemoryError("INVALID_INPUT", `${field} exceeds ${max} chars`);
  return out;
}
function dateText(value: unknown, field = "trade_date"): string {
  const out = requiredText(value, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out) || Number.isNaN(Date.parse(`${out}T00:00:00Z`))) throw new JudgmentMemoryError("INVALID_INPUT", `${field} must be YYYY-MM-DD`);
  return out;
}
function safePositiveInt(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new JudgmentMemoryError("INVALID_INPUT", `${field} must be a positive safe integer`);
  return n;
}
function finite(value: unknown, field: string, opts: { min?: number; max?: number; nullable?: boolean } = {}): number | null {
  if ((value === undefined || value === null || value === "") && opts.nullable) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new JudgmentMemoryError("INVALID_INPUT", `${field} must be finite`);
  if (opts.min !== undefined && n < opts.min) throw new JudgmentMemoryError("INVALID_INPUT", `${field} must be >= ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw new JudgmentMemoryError("INVALID_INPUT", `${field} must be <= ${opts.max}`);
  return n;
}
function optionalBool(value: boolean | null | undefined): number | null { return value === null || value === undefined ? null : value ? 1 : 0; }
function parseJson<T>(value: unknown, fallback: T): T { try { return JSON.parse(String(value ?? "")) as T; } catch { return fallback; } }
function normalizeSymbol(market: JudgmentMarket, raw: unknown): string {
  const symbol = String(raw ?? "").trim().toUpperCase();
  if (market === "TXF") {
    if (symbol !== "TXF") throw new JudgmentMemoryError("INVALID_INPUT", "TXF judgment symbol must be logical symbol TXF");
    return symbol;
  }
  if (!/^\d{4,6}$/.test(symbol)) throw new JudgmentMemoryError("INVALID_INPUT", "TW_STOCK symbol must be 4-6 digits");
  return symbol;
}
function taipeiCalendarDate(tsMs: number) { return new Date(tsMs + 8 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function uniqueStrings(values: unknown[] | undefined, field: string, max = 100): string[] {
  const result = Array.from(new Set((values ?? []).map((x) => requiredText(x, field, max))));
  return result.sort();
}
function cleanLevels(values: number[] | undefined, field: string) {
  const out = (values ?? []).map((x) => finite(x, field, { min: 0.00000001 }) as number);
  return Array.from(new Set(out)).sort((a, b) => a - b);
}
function normalizeReason(raw: JudgmentReason): JudgmentReason {
  const code = requiredText(raw?.code, "reason.code", 120).toUpperCase();
  const family = raw?.family == null ? null : requiredText(raw.family, "reason.family", 120).toUpperCase();
  const weight = raw?.weight == null ? null : finite(raw.weight, "reason.weight", { min: -10, max: 10 });
  const note = raw?.note == null ? null : String(raw.note).trim().slice(0, 1200);
  return { code, family, weight, note };
}
function normalizeTrendline(raw: TrendlineRecord, cutoff: number): TrendlineRecord {
  const id = requiredText(raw?.trendline_id, "trendline_id", 240);
  if (!["SUPPORT_TRENDLINE","RESISTANCE_TRENDLINE","CHANNEL_SUPPORT","CHANNEL_RESISTANCE"].includes(String(raw?.type))) throw new JudgmentMemoryError("INVALID_INPUT", "invalid trendline.type");
  if (!["ACTIVE","BROKEN","RECLAIMED","INVALIDATED"].includes(String(raw?.status))) throw new JudgmentMemoryError("INVALID_INPUT", "invalid trendline.status");
  if (!["LOW","MEDIUM","HIGH"].includes(String(raw?.quality))) throw new JudgmentMemoryError("INVALID_INPUT", "invalid trendline.quality");
  const anchors = (raw?.anchors ?? []).map((a, index) => {
    const ts_ms = safePositiveInt(a?.ts_ms, `trendline.anchors[${index}].ts_ms`);
    if (ts_ms > cutoff) throw new JudgmentMemoryError("LOOKAHEAD_BIAS", "trendline anchor is after knowledge cutoff", { trendline_id: id, anchor_ts_ms: ts_ms, knowledge_cutoff_ts_ms: cutoff });
    const price = finite(a?.price, `trendline.anchors[${index}].price`, { min: 0.00000001 }) as number;
    if (!["SWING_LOW","SWING_HIGH","PIVOT_LOW","PIVOT_HIGH","GAP_EDGE","BREAKOUT_LEVEL","HIGH_VOLUME_REVERSAL","MANUAL_GPT_ANCHOR"].includes(String(a?.anchor_type))) throw new JudgmentMemoryError("INVALID_INPUT", "invalid trendline anchor_type");
    return {
      ts_ms, price, anchor_type: a.anchor_type,
      strength: a.strength == null ? null : finite(a.strength, "anchor.strength", { min: 0, max: 100 }),
      volume_ratio: a.volume_ratio == null ? null : finite(a.volume_ratio, "anchor.volume_ratio", { min: 0 }),
      atr_context: a.atr_context == null ? null : finite(a.atr_context, "anchor.atr_context", { min: 0 }),
    } as TrendlineAnchor;
  }).sort((a, b) => a.ts_ms - b.ts_ms);
  if (anchors.length < 2 || anchors.length > 12) throw new JudgmentMemoryError("INVALID_INPUT", "trendline requires 2..12 anchors");
  for (let i = 1; i < anchors.length; i++) if (anchors[i].ts_ms <= anchors[i - 1].ts_ms) throw new JudgmentMemoryError("INVALID_INPUT", "trendline anchors must be strictly chronological");
  const nonnegativeInt = (v: unknown, field: string) => v == null ? null : (() => { const n = Number(v); if (!Number.isInteger(n) || n < 0) throw new JudgmentMemoryError("INVALID_INPUT", `${field} must be non-negative integer`); return n; })();
  return {
    trendline_id: id, type: raw.type, status: raw.status, quality: raw.quality, anchors,
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
  const pattern_id = requiredText(raw?.pattern_id, "pattern_id", 240);
  const pattern_type = requiredText(raw?.pattern_type, "pattern_type", 160).toUpperCase();
  if (!["FORMING","CONFIRMED","FAILED","COMPLETED"].includes(String(raw?.status))) throw new JudgmentMemoryError("INVALID_INPUT", "invalid pattern.status");
  const confidence = finite(raw?.confidence, "pattern.confidence", { min: 0, max: 100 }) as number;
  const detected_at_ts_ms = safePositiveInt(raw?.detected_at_ts_ms, "pattern.detected_at_ts_ms");
  if (detected_at_ts_ms > cutoff) throw new JudgmentMemoryError("LOOKAHEAD_BIAS", "pattern detection is after knowledge cutoff", { pattern_id, detected_at_ts_ms, knowledge_cutoff_ts_ms: cutoff });
  const price = (v: unknown, f: string) => v == null ? null : finite(v, f, { min: 0.00000001 });
  const volume = raw.volume_behavior == null ? null : String(raw.volume_behavior).toUpperCase();
  if (volume && !["EXPANDING","CONTRACTING","NEUTRAL","UNKNOWN"].includes(volume)) throw new JudgmentMemoryError("INVALID_INPUT", "invalid pattern.volume_behavior");
  return {
    pattern_id, pattern_type, status: raw.status, confidence, detected_at_ts_ms,
    upper_boundary: price(raw.upper_boundary, "pattern.upper_boundary"),
    lower_boundary: price(raw.lower_boundary, "pattern.lower_boundary"),
    compression_atr: raw.compression_atr == null ? null : finite(raw.compression_atr, "pattern.compression_atr", { min: 0 }),
    volume_behavior: volume as PatternRecord["volume_behavior"],
    metadata: stableValue(raw.metadata ?? {}) as Record<string, unknown>,
  };
}

export async function ensureJudgmentMemorySchema(env: Env) {
  if (!env.RESEARCH_DB) throw new JudgmentMemoryError("RESEARCH_DB_UNAVAILABLE", "RESEARCH_DB binding is required");
  await env.RESEARCH_DB.batch(SCHEMA_SQL.map((sql) => env.RESEARCH_DB.prepare(sql)));
}

export async function recordMarketJudgment(env: Env, raw: RecordJudgmentInput) {
  await ensureJudgmentMemorySchema(env);
  const judgment_id = requiredText(raw.judgment_id, "judgment_id", 240);
  const judgment_version = requiredText(raw.judgment_version, "judgment_version", 160);
  const market = String(raw.market ?? "") as JudgmentMarket;
  if (!["TW_STOCK","TXF"].includes(market)) throw new JudgmentMemoryError("INVALID_INPUT", "market must be TW_STOCK or TXF");
  const symbol = normalizeSymbol(market, raw.symbol);
  const timeframe = String(raw.timeframe ?? "") as JudgmentTimeframe;
  if (!["1m","5m","15m","30m","60m","1d"].includes(timeframe)) throw new JudgmentMemoryError("INVALID_INPUT", "invalid timeframe");
  const trade_date = dateText(raw.trade_date);
  const judgment_ts_ms = safePositiveInt(raw.judgment_ts_ms, "judgment_ts_ms");
  const knowledge_cutoff_ts_ms = safePositiveInt(raw.knowledge_cutoff_ts_ms, "knowledge_cutoff_ts_ms");
  const data_watermark_ts_ms = safePositiveInt(raw.data_watermark_ts_ms, "data_watermark_ts_ms");
  if (data_watermark_ts_ms > knowledge_cutoff_ts_ms || knowledge_cutoff_ts_ms > judgment_ts_ms) throw new JudgmentMemoryError("LOOKAHEAD_BIAS", "required ordering is data_watermark <= knowledge_cutoff <= judgment timestamp");
  if (market === "TW_STOCK" && taipeiCalendarDate(judgment_ts_ms) !== trade_date) throw new JudgmentMemoryError("TRADE_DATE_MISMATCH", "TW_STOCK trade_date must match judgment timestamp in Asia/Taipei");
  const direction = String(raw.direction ?? "") as JudgmentDirection;
  if (!["BULLISH","BEARISH","NEUTRAL"].includes(direction)) throw new JudgmentMemoryError("INVALID_INPUT", "invalid direction");
  const confidence = finite(raw.confidence, "confidence", { min: 0, max: 100 }) as number;
  const thesis = requiredText(raw.thesis, "thesis", 8000);
  const risk_reward_score = raw.risk_reward_score == null ? null : finite(raw.risk_reward_score, "risk_reward_score", { min: 0, max: 100 });
  const structures = uniqueStrings(raw.structures, "structure", 120);
  const support_levels = cleanLevels(raw.support_levels, "support_level");
  const resistance_levels = cleanLevels(raw.resistance_levels, "resistance_level");
  const reasonsMap = new Map<string, JudgmentReason>();
  for (const r of raw.reasons ?? []) { const n = normalizeReason(r); reasonsMap.set(n.code, n); }
  const reasons = Array.from(reasonsMap.values()).sort((a, b) => a.code.localeCompare(b.code));
  const trendlineIds = new Set<string>();
  const trendlines = (raw.trendlines ?? []).map((x) => normalizeTrendline(x, knowledge_cutoff_ts_ms)).map((x) => { if (trendlineIds.has(x.trendline_id)) throw new JudgmentMemoryError("INVALID_INPUT", "duplicate trendline_id"); trendlineIds.add(x.trendline_id); return x; });
  const patternIds = new Set<string>();
  const patterns = (raw.patterns ?? []).map((x) => normalizePattern(x, knowledge_cutoff_ts_ms)).map((x) => { if (patternIds.has(x.pattern_id)) throw new JudgmentMemoryError("INVALID_INPUT", "duplicate pattern_id"); patternIds.add(x.pattern_id); return x; });
  const payload = stableValue(raw.payload ?? {}) as Record<string, unknown>;
  const canonical = { schema_version:GPT_JUDGMENT_SCHEMA_VERSION, judgment_id, judgment_version, market, symbol, timeframe, trade_date, judgment_ts_ms, knowledge_cutoff_ts_ms, data_watermark_ts_ms, direction, confidence, thesis, risk_reward_score, reasons, structures, patterns, trendlines, support_levels, resistance_levels, payload };
  const content_hash = await sha256Hex(stableJson(canonical));
  const recorded_at = new Date().toISOString();

  const existing = await env.RESEARCH_DB.prepare(`SELECT content_hash FROM gpt_judgments WHERE judgment_id=? AND judgment_version=?`).bind(judgment_id, judgment_version).first<{content_hash:string}>();
  if (existing) {
    if (String(existing.content_hash) !== content_hash) throw new JudgmentMemoryError("IMMUTABLE_CONFLICT", "judgment_id + judgment_version already exists with different content", { judgment_id, judgment_version });
    return { ok:true, immutable:true, idempotent:true, judgment_id, judgment_version, content_hash };
  }

  const statements = [
    env.RESEARCH_DB.prepare(`INSERT INTO gpt_judgments(judgment_id,judgment_version,schema_version,content_hash,market,symbol,timeframe,trade_date,judgment_ts_ms,knowledge_cutoff_ts_ms,data_watermark_ts_ms,direction,confidence,thesis,risk_reward_score,structures_json,support_levels_json,resistance_levels_json,payload_json,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(judgment_id,judgment_version,GPT_JUDGMENT_SCHEMA_VERSION,content_hash,market,symbol,timeframe,trade_date,judgment_ts_ms,knowledge_cutoff_ts_ms,data_watermark_ts_ms,direction,confidence,thesis,risk_reward_score,stableJson(structures),stableJson(support_levels),stableJson(resistance_levels),stableJson(payload),recorded_at),
    ...reasons.map((r) => env.RESEARCH_DB.prepare(`INSERT INTO gpt_judgment_reasons(judgment_id,judgment_version,reason_code,family,weight,note) VALUES(?,?,?,?,?,?)`).bind(judgment_id,judgment_version,r.code,r.family??null,r.weight??null,r.note??null)),
  ];
  for (const t of trendlines) {
    const tHash = await sha256Hex(stableJson(t));
    statements.push(env.RESEARCH_DB.prepare(`INSERT INTO gpt_judgment_trendlines(trendline_id,judgment_id,judgment_version,content_hash,type,status,quality,anchor_count,anchors_json,slope_price_per_bar,slope_normalized,touch_count,false_break_count,distance_atr,distance_pct,current_price,projected_price,expected_behavior,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(t.trendline_id,judgment_id,judgment_version,tHash,t.type,t.status,t.quality,t.anchors.length,stableJson(t.anchors),t.slope_price_per_bar??null,t.slope_normalized??null,t.touch_count??null,t.false_break_count??null,t.distance_atr??null,t.distance_pct??null,t.current_price??null,t.projected_price??null,t.expected_behavior??null,stableJson(t.metadata??{})));
  }
  for (const p of patterns) {
    const pHash = await sha256Hex(stableJson(p));
    statements.push(env.RESEARCH_DB.prepare(`INSERT INTO gpt_judgment_patterns(pattern_id,judgment_id,judgment_version,content_hash,pattern_type,status,confidence,detected_at_ts_ms,upper_boundary,lower_boundary,compression_atr,volume_behavior,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(p.pattern_id,judgment_id,judgment_version,pHash,p.pattern_type,p.status,p.confidence,p.detected_at_ts_ms,p.upper_boundary??null,p.lower_boundary??null,p.compression_atr??null,p.volume_behavior??null,stableJson(p.metadata??{})));
  }
  await env.RESEARCH_DB.batch(statements);
  return { ok:true, immutable:true, idempotent:false, judgment_id, judgment_version, content_hash, market, symbol, timeframe, reason_count:reasons.length, pattern_count:patterns.length, trendline_count:trendlines.length, recorded_at };
}

async function hydrateJudgment(env: Env, row: Record<string, unknown> | null) {
  if (!row) return null;
  const judgment_id=String(row.judgment_id), judgment_version=String(row.judgment_version);
  const [reasons,trendlines,patterns]=await Promise.all([
    env.RESEARCH_DB.prepare(`SELECT reason_code as code,family,weight,note FROM gpt_judgment_reasons WHERE judgment_id=? AND judgment_version=? ORDER BY reason_code`).bind(judgment_id,judgment_version).all<Record<string,unknown>>(),
    env.RESEARCH_DB.prepare(`SELECT * FROM gpt_judgment_trendlines WHERE judgment_id=? AND judgment_version=? ORDER BY trendline_id`).bind(judgment_id,judgment_version).all<Record<string,unknown>>(),
    env.RESEARCH_DB.prepare(`SELECT * FROM gpt_judgment_patterns WHERE judgment_id=? AND judgment_version=? ORDER BY pattern_id`).bind(judgment_id,judgment_version).all<Record<string,unknown>>(),
  ]);
  return {
    ...row,
    structures:parseJson(row.structures_json,[]), support_levels:parseJson(row.support_levels_json,[]), resistance_levels:parseJson(row.resistance_levels_json,[]), payload:parseJson(row.payload_json,{}),
    reasons:reasons.results,
    trendlines:trendlines.results.map((x)=>({...x,anchors:parseJson(x.anchors_json,[]),metadata:parseJson(x.metadata_json,{})})),
    patterns:patterns.results.map((x)=>({...x,metadata:parseJson(x.metadata_json,{})})),
  };
}

export async function getMarketJudgment(env: Env, judgmentId: string, judgmentVersion?: string) {
  await ensureJudgmentMemorySchema(env);
  const id=requiredText(judgmentId,"judgment_id",240);
  const row=judgmentVersion
    ? await env.RESEARCH_DB.prepare(`SELECT * FROM gpt_judgments WHERE judgment_id=? AND judgment_version=?`).bind(id,requiredText(judgmentVersion,"judgment_version",160)).first<Record<string,unknown>>()
    : await env.RESEARCH_DB.prepare(`SELECT * FROM gpt_judgments WHERE judgment_id=? ORDER BY recorded_at DESC LIMIT 1`).bind(id).first<Record<string,unknown>>();
  return hydrateJudgment(env,row);
}

export async function listMarketJudgments(env: Env, filters: { market?:JudgmentMarket; symbol?:string; trade_date?:string; timeframe?:JudgmentTimeframe; limit?:number } = {}) {
  await ensureJudgmentMemorySchema(env);
  const clauses:string[]=[], args:unknown[]=[];
  if(filters.market){if(!["TW_STOCK","TXF"].includes(filters.market))throw new JudgmentMemoryError("INVALID_INPUT","invalid market");clauses.push("market=?");args.push(filters.market);}
  if(filters.symbol){const market=filters.market??(/^\d{4,6}$/.test(filters.symbol)?"TW_STOCK":"TXF");clauses.push("symbol=?");args.push(normalizeSymbol(market,filters.symbol));}
  if(filters.trade_date){clauses.push("trade_date=?");args.push(dateText(filters.trade_date));}
  if(filters.timeframe){clauses.push("timeframe=?");args.push(filters.timeframe);}
  const limit=Math.max(1,Math.min(500,Math.floor(Number(filters.limit??100))));
  const where=clauses.length?`WHERE ${clauses.join(" AND ")}`:"";
  const result=await env.RESEARCH_DB.prepare(`SELECT * FROM gpt_judgments ${where} ORDER BY judgment_ts_ms DESC LIMIT ?`).bind(...args,limit).all<Record<string,unknown>>();
  return {ok:true,count:result.results.length,judgments:result.results.map((x)=>({ ...x, structures:parseJson(x.structures_json,[]), support_levels:parseJson(x.support_levels_json,[]), resistance_levels:parseJson(x.resistance_levels_json,[]), payload:parseJson(x.payload_json,{}) }))};
}

function validateDatasetForReview(dataset: DatasetReviewRef, judgment: Record<string,unknown>) {
  if (!dataset || !dataset.frozen_view || !dataset.complete_view || dataset.truncated) throw new JudgmentMemoryError("DATASET_NOT_FROZEN_COMPLETE", "review requires frozen, complete, non-truncated OHLC dataset");
  if (!/^sha256:[0-9a-f]{64}$/.test(String(dataset.dataset_version)) || !/^[0-9a-f]{64}$/.test(String(dataset.dataset_hash)) || dataset.dataset_version !== `sha256:${dataset.dataset_hash}`) throw new JudgmentMemoryError("INVALID_DATASET_HASH", "dataset version/hash pair is invalid");
  const market=String(judgment.market);
  if ((market==="TW_STOCK" && dataset.market!=="tw-stock") || (market==="TXF" && dataset.market!=="txf")) throw new JudgmentMemoryError("DATASET_MARKET_MISMATCH", "dataset market differs from judgment market");
  if (String(dataset.symbol).toUpperCase() !== String(judgment.symbol).toUpperCase()) throw new JudgmentMemoryError("DATASET_SYMBOL_MISMATCH", "dataset symbol differs from judgment symbol");
  if (market==="TW_STOCK" && !dataset.formal_research_eligible) throw new JudgmentMemoryError("DATASET_NOT_ELIGIBLE", "TW_STOCK judgment review requires formal research eligible OHLC dataset");
  if (market==="TXF" && dataset.review_eligible!==true && dataset.formal_research_eligible!==true) throw new JudgmentMemoryError("DATASET_NOT_ELIGIBLE", "TXF judgment review requires review_eligible or formal_research_eligible dataset");
}

export async function recordJudgmentReview(env: Env, raw: RecordJudgmentReviewInput) {
  await ensureJudgmentMemorySchema(env);
  const review_id=requiredText(raw.review_id,"review_id",240), review_version=requiredText(raw.review_version,"review_version",160);
  const judgment_id=requiredText(raw.judgment_id,"judgment_id",240), judgment_version=requiredText(raw.judgment_version,"judgment_version",160);
  const judgment=await env.RESEARCH_DB.prepare(`SELECT * FROM gpt_judgments WHERE judgment_id=? AND judgment_version=?`).bind(judgment_id,judgment_version).first<Record<string,unknown>>();
  if(!judgment)throw new JudgmentMemoryError("JUDGMENT_NOT_FOUND","original judgment not found");
  validateDatasetForReview(raw.dataset,judgment);
  const outcome_ts_ms=safePositiveInt(raw.outcome_ts_ms,"outcome_ts_ms");
  if(outcome_ts_ms<=Number(judgment.judgment_ts_ms))throw new JudgmentMemoryError("INVALID_OUTCOME_TIME","outcome must be after original judgment");
  const outcome_horizon=requiredText(raw.outcome_horizon,"outcome_horizon",120);
  const metric=(v:unknown,f:string)=>v==null?null:finite(v,f);
  const return_pct=metric(raw.return_pct,"return_pct"),mfe_pct=metric(raw.mfe_pct,"mfe_pct"),mae_pct=metric(raw.mae_pct,"mae_pct"),return_points=metric(raw.return_points,"return_points"),mfe_points=metric(raw.mfe_points,"mfe_points"),mae_points=metric(raw.mae_points,"mae_points");
  if(String(judgment.market)==="TW_STOCK" && [return_pct,mfe_pct,mae_pct].every((x)=>x===null)) throw new JudgmentMemoryError("MISSING_OUTCOME_METRICS","TW_STOCK review requires pct outcome metrics");
  if(String(judgment.market)==="TXF" && [return_points,mfe_points,mae_points].every((x)=>x===null)) throw new JudgmentMemoryError("MISSING_OUTCOME_METRICS","TXF review requires point outcome metrics");
  const quality=(v:unknown,f:string)=>{const x=String(v??"UNKNOWN").toUpperCase();if(!["GOOD","FAIR","POOR","UNKNOWN"].includes(x))throw new JudgmentMemoryError("INVALID_INPUT",`${f} invalid`);return x;};
  const attribution=uniqueStrings(raw.attribution,"attribution",160), failure_patterns=uniqueStrings(raw.failure_patterns,"failure_pattern",160);
  const hypotheses=(raw.optimization_hypotheses??[]).slice(0,10).map((h)=>({hypothesis:requiredText(h?.hypothesis,"hypothesis",2000),expected_effect:h?.expected_effect==null?null:String(h.expected_effect).trim().slice(0,1000),risk:h?.risk==null?null:String(h.risk).trim().slice(0,1000)}));
  const interpretation=requiredText(raw.interpretation,"interpretation",8000), payload=stableValue(raw.payload??{}) as Record<string,unknown>;
  const canonical={schema_version:GPT_JUDGMENT_REVIEW_SCHEMA_VERSION,review_id,review_version,judgment_id,judgment_version,dataset:raw.dataset,outcome_horizon,outcome_ts_ms,return_pct,mfe_pct,mae_pct,return_points,mfe_points,mae_points,direction_correct:raw.direction_correct,location_quality:quality(raw.location_quality,"location_quality"),timing_quality:quality(raw.timing_quality,"timing_quality"),structure_correct:raw.structure_correct??null,pattern_correct:raw.pattern_correct??null,trendline_correct:raw.trendline_correct??null,risk_reward_correct:raw.risk_reward_correct??null,attribution,failure_patterns,optimization_hypotheses:hypotheses,interpretation,payload};
  const content_hash=await sha256Hex(stableJson(canonical)), recorded_at=new Date().toISOString();
  const existing=await env.RESEARCH_DB.prepare(`SELECT content_hash FROM gpt_judgment_reviews WHERE review_id=? AND review_version=?`).bind(review_id,review_version).first<{content_hash:string}>();
  if(existing){if(String(existing.content_hash)!==content_hash)throw new JudgmentMemoryError("IMMUTABLE_CONFLICT","review_id + review_version already exists with different content");return{ok:true,immutable:true,idempotent:true,review_id,review_version,content_hash};}
  await env.RESEARCH_DB.prepare(`INSERT INTO gpt_judgment_reviews(review_id,review_version,schema_version,content_hash,judgment_id,judgment_version,market,symbol,outcome_horizon,outcome_ts_ms,dataset_id,dataset_version,dataset_hash,dataset_timeframe,return_pct,mfe_pct,mae_pct,return_points,mfe_points,mae_points,direction_correct,location_quality,timing_quality,structure_correct,pattern_correct,trendline_correct,risk_reward_correct,attribution_json,failure_patterns_json,optimization_hypotheses_json,interpretation,payload_json,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(review_id,review_version,GPT_JUDGMENT_REVIEW_SCHEMA_VERSION,content_hash,judgment_id,judgment_version,String(judgment.market),String(judgment.symbol),outcome_horizon,outcome_ts_ms,raw.dataset.dataset_id,raw.dataset.dataset_version,raw.dataset.dataset_hash,raw.dataset.timeframe,return_pct,mfe_pct,mae_pct,return_points,mfe_points,mae_points,optionalBool(raw.direction_correct),quality(raw.location_quality,"location_quality"),quality(raw.timing_quality,"timing_quality"),optionalBool(raw.structure_correct),optionalBool(raw.pattern_correct),optionalBool(raw.trendline_correct),optionalBool(raw.risk_reward_correct),stableJson(attribution),stableJson(failure_patterns),stableJson(hypotheses),interpretation,stableJson(payload),recorded_at).run();
  return{ok:true,immutable:true,idempotent:false,review_id,review_version,content_hash,judgment_id,judgment_version,recorded_at,learning_policy:"REVIEW_DOES_NOT_MUTATE_STRATEGY"};
}

function avg(values:number[]){return values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length*1e6)/1e6:null;}
function rate(values:Array<number|null>){const known=values.filter((x):x is number=>x!==null);return known.length?Math.round(known.filter((x)=>x===1).length/known.length*1e6)/1e6:null;}
function outcomeValue(row:Record<string,unknown>){return String(row.market)==="TXF"?(row.return_points==null?null:Number(row.return_points)):(row.return_pct==null?null:Number(row.return_pct));}

export async function analyzeJudgmentHistory(env:Env,filters:{market?:JudgmentMarket;symbol?:string;timeframe?:JudgmentTimeframe;from?:string;to?:string;limit?:number}={}){
  await ensureJudgmentMemorySchema(env);
  const clauses:string[]=[],args:unknown[]=[];
  if(filters.market){clauses.push("j.market=?");args.push(filters.market);}
  if(filters.symbol){const m=filters.market??(/^\d{4,6}$/.test(filters.symbol)?"TW_STOCK":"TXF");clauses.push("j.symbol=?");args.push(normalizeSymbol(m,filters.symbol));}
  if(filters.timeframe){clauses.push("j.timeframe=?");args.push(filters.timeframe);}
  if(filters.from){clauses.push("j.trade_date>=?");args.push(dateText(filters.from,"from"));}
  if(filters.to){clauses.push("j.trade_date<=?");args.push(dateText(filters.to,"to"));}
  const limit=Math.max(1,Math.min(5000,Math.floor(Number(filters.limit??1000))));
  const where=clauses.length?`WHERE ${clauses.join(" AND ")}`:"";
  const joined=await env.RESEARCH_DB.prepare(`SELECT j.judgment_id,j.judgment_version,j.market,j.symbol,j.timeframe,j.trade_date,j.direction,j.confidence,r.review_id,r.review_version,r.return_pct,r.mfe_pct,r.mae_pct,r.return_points,r.mfe_points,r.mae_points,r.direction_correct,r.location_quality,r.timing_quality,r.structure_correct,r.pattern_correct,r.trendline_correct,r.risk_reward_correct FROM gpt_judgments j JOIN gpt_judgment_reviews r ON r.judgment_id=j.judgment_id AND r.judgment_version=j.judgment_version ${where} ORDER BY j.judgment_ts_ms DESC LIMIT ?`).bind(...args,limit).all<Record<string,unknown>>();
  const rows=joined.results;
  const outcomes=rows.map(outcomeValue).filter((x):x is number=>x!==null&&Number.isFinite(x));
  const winRate=outcomes.length?Math.round(outcomes.filter((x)=>x>0).length/outcomes.length*1e6)/1e6:null;
  const group=(keyFn:(r:Record<string,unknown>)=>string)=>Object.values(rows.reduce((acc:Record<string,{key:string;rows:Record<string,unknown>[]}>,r)=>{const key=keyFn(r);(acc[key]??={key,rows:[]}).rows.push(r);return acc;},{})).map(({key,rows:rs})=>{const vals=rs.map(outcomeValue).filter((x):x is number=>x!==null&&Number.isFinite(x));return{key,count:rs.length,win_rate:vals.length?Math.round(vals.filter((x)=>x>0).length/vals.length*1e6)/1e6:null,avg_outcome:avg(vals),direction_accuracy:rate(rs.map((x)=>x.direction_correct==null?null:Number(x.direction_correct))),trendline_accuracy:rate(rs.map((x)=>x.trendline_correct==null?null:Number(x.trendline_correct))),pattern_accuracy:rate(rs.map((x)=>x.pattern_correct==null?null:Number(x.pattern_correct)))};}).sort((a,b)=>a.key.localeCompare(b.key));
  const ids=rows.map((r)=>`${r.judgment_id}\u0000${r.judgment_version}`);
  const idSet=new Set(ids);
  const reasons=await env.RESEARCH_DB.prepare(`SELECT rr.judgment_id,rr.judgment_version,rr.reason_code FROM gpt_judgment_reasons rr ORDER BY rr.reason_code`).all<Record<string,unknown>>();
  const reasonGroups=new Map<string,Record<string,unknown>[]>();
  const rowMap=new Map(rows.map((r)=>[`${r.judgment_id}\u0000${r.judgment_version}`,r]));
  for(const rr of reasons.results){const id=`${rr.judgment_id}\u0000${rr.judgment_version}`;if(!idSet.has(id))continue;const list=reasonGroups.get(String(rr.reason_code))??[];list.push(rowMap.get(id)!);reasonGroups.set(String(rr.reason_code),list);}
  const reason_stats=Array.from(reasonGroups.entries()).map(([reason_code,rs])=>{const vals=rs.map(outcomeValue).filter((x):x is number=>x!==null&&Number.isFinite(x));return{reason_code,count:rs.length,win_rate:vals.length?Math.round(vals.filter((x)=>x>0).length/vals.length*1e6)/1e6:null,avg_outcome:avg(vals),direction_accuracy:rate(rs.map((x)=>x.direction_correct==null?null:Number(x.direction_correct)))};}).sort((a,b)=>b.count-a.count||a.reason_code.localeCompare(b.reason_code));
  const trendlines=await env.RESEARCH_DB.prepare(`SELECT t.judgment_id,t.judgment_version,t.type,t.status,t.quality FROM gpt_judgment_trendlines t`).all<Record<string,unknown>>();
  const trendStats=new Map<string,Record<string,unknown>[]>();
  for(const t of trendlines.results){const id=`${t.judgment_id}\u0000${t.judgment_version}`;const row=rowMap.get(id);if(!row)continue;const key=`${t.type}|${t.status}|${t.quality}`;const list=trendStats.get(key)??[];list.push(row);trendStats.set(key,list);}
  const trendline_stats=Array.from(trendStats.entries()).map(([key,rs])=>{const vals=rs.map(outcomeValue).filter((x):x is number=>x!==null&&Number.isFinite(x));return{key,count:rs.length,win_rate:vals.length?Math.round(vals.filter((x)=>x>0).length/vals.length*1e6)/1e6:null,avg_outcome:avg(vals),trendline_accuracy:rate(rs.map((x)=>x.trendline_correct==null?null:Number(x.trendline_correct)))};}).sort((a,b)=>b.count-a.count||a.key.localeCompare(b.key));
  const patterns=await env.RESEARCH_DB.prepare(`SELECT p.judgment_id,p.judgment_version,p.pattern_type,p.status FROM gpt_judgment_patterns p`).all<Record<string,unknown>>();
  const patternStats=new Map<string,Record<string,unknown>[]>();
  for(const p of patterns.results){const id=`${p.judgment_id}\u0000${p.judgment_version}`;const row=rowMap.get(id);if(!row)continue;const key=`${p.pattern_type}|${p.status}`;const list=patternStats.get(key)??[];list.push(row);patternStats.set(key,list);}
  const pattern_stats=Array.from(patternStats.entries()).map(([key,rs])=>{const vals=rs.map(outcomeValue).filter((x):x is number=>x!==null&&Number.isFinite(x));return{key,count:rs.length,win_rate:vals.length?Math.round(vals.filter((x)=>x>0).length/vals.length*1e6)/1e6:null,avg_outcome:avg(vals),pattern_accuracy:rate(rs.map((x)=>x.pattern_correct==null?null:Number(x.pattern_correct)))};}).sort((a,b)=>b.count-a.count||a.key.localeCompare(b.key));
  return{ok:true,memory_version:GPT_JUDGMENT_MEMORY_VERSION,filters,summary:{judgments_with_reviews:rows.length,win_rate:winRate,avg_outcome:avg(outcomes),outcome_unit:filters.market==="TXF"?"points":filters.market==="TW_STOCK"?"pct":"MIXED_DO_NOT_COMPARE_DIRECTLY",direction_accuracy:rate(rows.map((x)=>x.direction_correct==null?null:Number(x.direction_correct))),structure_accuracy:rate(rows.map((x)=>x.structure_correct==null?null:Number(x.structure_correct))),pattern_accuracy:rate(rows.map((x)=>x.pattern_correct==null?null:Number(x.pattern_correct))),trendline_accuracy:rate(rows.map((x)=>x.trendline_correct==null?null:Number(x.trendline_correct))),risk_reward_accuracy:rate(rows.map((x)=>x.risk_reward_correct==null?null:Number(x.risk_reward_correct))),avg_confidence:avg(rows.map((x)=>Number(x.confidence)).filter(Number.isFinite))},by_direction:group((r)=>String(r.direction)),by_market_strategy_unit_warning:"TW_STOCK percentage outcomes and TXF point outcomes are never aggregated into a shared numeric expectancy",reason_stats,trendline_stats,pattern_stats,learning_policy:"STATISTICS_GENERATE_HYPOTHESES_ONLY_NO_AUTO_STRATEGY_CHANGE"};
}

export async function recordTradingKnowledge(env:Env,raw:RecordTradingKnowledgeInput){
  await ensureJudgmentMemorySchema(env);
  const knowledge_id=requiredText(raw.knowledge_id,"knowledge_id",240),knowledge_version=requiredText(raw.knowledge_version,"knowledge_version",160);
  const market_scope=String(raw.market_scope??"");if(!["ALL","TW_STOCK","TXF"].includes(market_scope))throw new JudgmentMemoryError("INVALID_INPUT","invalid market_scope");
  const topic=requiredText(raw.topic,"topic",200).toUpperCase(),statement=requiredText(raw.statement,"statement",8000),status=String(raw.status??"") as KnowledgeStatus;
  if(!["OBSERVATION","HYPOTHESIS","VALIDATED","REJECTED","ACCEPTED"].includes(status))throw new JudgmentMemoryError("INVALID_INPUT","invalid knowledge status");
  const evidence_count=Number(raw.evidence_count);if(!Number.isInteger(evidence_count)||evidence_count<0)throw new JudgmentMemoryError("INVALID_INPUT","evidence_count must be non-negative integer");
  const actor_type=String(raw.actor_type??"");if(!["GPT_REVIEW","SYSTEM","HUMAN"].includes(actor_type))throw new JudgmentMemoryError("INVALID_INPUT","invalid actor_type");
  const human_approved=raw.human_approved===true;
  if(status==="ACCEPTED"&&(!human_approved||actor_type!=="HUMAN"))throw new JudgmentMemoryError("HUMAN_APPROVAL_REQUIRED","ACCEPTED knowledge requires HUMAN actor and human_approved=true");
  const evidence_refs=(raw.evidence_refs??[]).map((r)=>({judgment_id:requiredText(r.judgment_id,"evidence.judgment_id",240),judgment_version:requiredText(r.judgment_version,"evidence.judgment_version",160),review_id:r.review_id==null?null:requiredText(r.review_id,"evidence.review_id",240),review_version:r.review_version==null?null:requiredText(r.review_version,"evidence.review_version",160)})).sort((a,b)=>`${a.judgment_id}|${a.judgment_version}|${a.review_id}`.localeCompare(`${b.judgment_id}|${b.judgment_version}|${b.review_id}`));
  const rationale=raw.rationale==null?null:String(raw.rationale).trim().slice(0,5000),payload=stableValue(raw.payload??{}) as Record<string,unknown>;
  const canonical={schema_version:GPT_TRADING_KNOWLEDGE_SCHEMA_VERSION,knowledge_id,knowledge_version,market_scope,topic,statement,status,evidence_count,evidence_refs,actor_type,human_approved,rationale,payload};
  const content_hash=await sha256Hex(stableJson(canonical)),recorded_at=new Date().toISOString();
  const existing=await env.RESEARCH_DB.prepare(`SELECT content_hash FROM gpt_trading_knowledge WHERE knowledge_id=? AND knowledge_version=?`).bind(knowledge_id,knowledge_version).first<{content_hash:string}>();
  if(existing){if(String(existing.content_hash)!==content_hash)throw new JudgmentMemoryError("IMMUTABLE_CONFLICT","knowledge id/version conflict");return{ok:true,immutable:true,idempotent:true,knowledge_id,knowledge_version,content_hash};}
  await env.RESEARCH_DB.prepare(`INSERT INTO gpt_trading_knowledge(knowledge_id,knowledge_version,schema_version,content_hash,market_scope,topic,statement,status,evidence_count,evidence_refs_json,actor_type,human_approved,rationale,payload_json,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(knowledge_id,knowledge_version,GPT_TRADING_KNOWLEDGE_SCHEMA_VERSION,content_hash,market_scope,topic,statement,status,evidence_count,stableJson(evidence_refs),actor_type,human_approved?1:0,rationale,stableJson(payload),recorded_at).run();
  return{ok:true,immutable:true,idempotent:false,knowledge_id,knowledge_version,content_hash,status,recorded_at,production_promotion:"FORBIDDEN"};
}

export async function listTradingKnowledge(env:Env,filters:{market_scope?:"ALL"|JudgmentMarket;topic?:string;status?:KnowledgeStatus;limit?:number}={}){
  await ensureJudgmentMemorySchema(env);
  const clauses:string[]=[],args:unknown[]=[];
  if(filters.market_scope){clauses.push("market_scope=?");args.push(filters.market_scope);}
  if(filters.topic){clauses.push("topic=?");args.push(requiredText(filters.topic,"topic",200).toUpperCase());}
  if(filters.status){clauses.push("status=?");args.push(filters.status);}
  const limit=Math.max(1,Math.min(500,Math.floor(Number(filters.limit??100))));
  const where=clauses.length?`WHERE ${clauses.join(" AND ")}`:"";
  const result=await env.RESEARCH_DB.prepare(`SELECT * FROM gpt_trading_knowledge ${where} ORDER BY recorded_at DESC LIMIT ?`).bind(...args,limit).all<Record<string,unknown>>();
  return{ok:true,count:result.results.length,knowledge:result.results.map((x)=>({...x,evidence_refs:parseJson(x.evidence_refs_json,[]),payload:parseJson(x.payload_json,{})}))};
}
