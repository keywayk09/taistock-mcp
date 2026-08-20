import { GitHubDataStoreError, listIndexedRecords, putIndexedImmutableRecord, readCollectionIndex, readIndexedRecord } from "./github-data-store.ts";

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


function wrapStoreError(error:unknown):never{if(error instanceof GitHubDataStoreError)throw new JudgmentMemoryError(error.code,error.message,error.detail);throw error;}
export async function ensureJudgmentMemorySchema(_env:Env){ /* GitHub-only JSON persistence; no DB schema. */ }

export async function recordMarketJudgment(env:Env,raw:RecordJudgmentInput){
  const judgment_id=requiredText(raw.judgment_id,"judgment_id",240),judgment_version=requiredText(raw.judgment_version,"judgment_version",160),market=String(raw.market??"") as JudgmentMarket;
  if(!["TW_STOCK","TXF"].includes(market))throw new JudgmentMemoryError("INVALID_INPUT","market must be TW_STOCK or TXF");
  const symbol=normalizeSymbol(market,raw.symbol),timeframe=String(raw.timeframe??"") as JudgmentTimeframe;
  if(!["1m","5m","15m","30m","60m","1d"].includes(timeframe))throw new JudgmentMemoryError("INVALID_INPUT","invalid timeframe");
  const trade_date=dateText(raw.trade_date),judgment_ts_ms=safePositiveInt(raw.judgment_ts_ms,"judgment_ts_ms"),knowledge_cutoff_ts_ms=safePositiveInt(raw.knowledge_cutoff_ts_ms,"knowledge_cutoff_ts_ms"),data_watermark_ts_ms=safePositiveInt(raw.data_watermark_ts_ms,"data_watermark_ts_ms");
  if(data_watermark_ts_ms>knowledge_cutoff_ts_ms||knowledge_cutoff_ts_ms>judgment_ts_ms)throw new JudgmentMemoryError("LOOKAHEAD_BIAS","required ordering is data_watermark <= knowledge_cutoff <= judgment timestamp");
  if(market==="TW_STOCK"&&taipeiCalendarDate(judgment_ts_ms)!==trade_date)throw new JudgmentMemoryError("TRADE_DATE_MISMATCH","TW_STOCK trade_date must match judgment timestamp in Asia/Taipei");
  const direction=String(raw.direction??"") as JudgmentDirection;if(!["BULLISH","BEARISH","NEUTRAL"].includes(direction))throw new JudgmentMemoryError("INVALID_INPUT","invalid direction");
  const confidence=finite(raw.confidence,"confidence",{min:0,max:100}) as number,thesis=requiredText(raw.thesis,"thesis",8000),risk_reward_score=raw.risk_reward_score==null?null:finite(raw.risk_reward_score,"risk_reward_score",{min:0,max:100}),structures=uniqueStrings(raw.structures,"structure",120),support_levels=cleanLevels(raw.support_levels,"support_level"),resistance_levels=cleanLevels(raw.resistance_levels,"resistance_level");
  const reasonsMap=new Map<string,JudgmentReason>();for(const r of raw.reasons??[]){const n=normalizeReason(r);reasonsMap.set(n.code,n);}const reasons=[...reasonsMap.values()].sort((a,b)=>a.code.localeCompare(b.code));
  const trendlineIds=new Set<string>();const trendlines=(raw.trendlines??[]).map(x=>normalizeTrendline(x,knowledge_cutoff_ts_ms)).map(x=>{if(trendlineIds.has(x.trendline_id))throw new JudgmentMemoryError("INVALID_INPUT","duplicate trendline_id");trendlineIds.add(x.trendline_id);return x;});
  const patternIds=new Set<string>();const patterns=(raw.patterns??[]).map(x=>normalizePattern(x,knowledge_cutoff_ts_ms)).map(x=>{if(patternIds.has(x.pattern_id))throw new JudgmentMemoryError("INVALID_INPUT","duplicate pattern_id");patternIds.add(x.pattern_id);return x;});
  const payload=stableValue(raw.payload??{}) as Record<string,unknown>,canonical={schema_version:GPT_JUDGMENT_SCHEMA_VERSION,judgment_id,judgment_version,market,symbol,timeframe,trade_date,judgment_ts_ms,knowledge_cutoff_ts_ms,data_watermark_ts_ms,direction,confidence,thesis,risk_reward_score,reasons,structures,patterns,trendlines,support_levels,resistance_levels,payload},content_hash=await sha256Hex(stableJson(canonical)),recorded_at=new Date().toISOString(),record={...canonical,content_hash,recorded_at,storage:"GITHUB_ONLY"};
  try{const w=await putIndexedImmutableRecord(env,{collection:"research/gpt-judgments",key:`${judgment_id}\u0000${judgment_version}`,record,metadata:{judgment_id,judgment_version,market,symbol,timeframe,trade_date,judgment_ts_ms,direction}});return{ok:true,immutable:true,idempotent:w.idempotent,judgment_id,judgment_version,content_hash,market,symbol,timeframe,reason_count:reasons.length,pattern_count:patterns.length,trendline_count:trendlines.length,recorded_at,storage:"GITHUB_ONLY"};}catch(e){wrapStoreError(e);}
}

export async function getMarketJudgment(env:Env,judgmentId:string,judgmentVersion?:string){const id=requiredText(judgmentId,"judgment_id",240);if(judgmentVersion)return await readIndexedRecord<any>(env,"research/gpt-judgments",`${id}\u0000${requiredText(judgmentVersion,"judgment_version",160)}`);const index=await readCollectionIndex(env,"research/gpt-judgments");const hit=index.records.filter(x=>x.judgment_id===id).sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at))[0];return hit?await readIndexedRecord<any>(env,"research/gpt-judgments",hit.key):null;}

export async function listMarketJudgments(env:Env,filters:{market?:JudgmentMarket;symbol?:string;trade_date?:string;timeframe?:JudgmentTimeframe;limit?:number}={}){if(filters.market&&!['TW_STOCK','TXF'].includes(filters.market))throw new JudgmentMemoryError("INVALID_INPUT","invalid market");const market=filters.market,symbol=filters.symbol?normalizeSymbol(market??(/^\d{4,6}$/.test(filters.symbol)?"TW_STOCK":"TXF"),filters.symbol):undefined,tradeDate=filters.trade_date?dateText(filters.trade_date):undefined,timeframe=filters.timeframe,limit=Math.max(1,Math.min(500,Math.floor(Number(filters.limit??100))));const judgments=await listIndexedRecords<any>(env,"research/gpt-judgments",e=>(!market||e.market===market)&&(!symbol||e.symbol===symbol)&&(!tradeDate||e.trade_date===tradeDate)&&(!timeframe||e.timeframe===timeframe),limit);judgments.sort((a,b)=>Number(b.judgment_ts_ms)-Number(a.judgment_ts_ms));return{ok:true,count:judgments.length,judgments,storage:"GITHUB_ONLY"};}

function validateDatasetForReview(dataset:DatasetReviewRef,judgment:Record<string,unknown>){if(!dataset||!dataset.frozen_view||!dataset.complete_view||dataset.truncated)throw new JudgmentMemoryError("DATASET_NOT_FROZEN_COMPLETE","review requires frozen, complete, non-truncated OHLC dataset");if(!/^sha256:[0-9a-f]{64}$/.test(String(dataset.dataset_version))||!/^[0-9a-f]{64}$/.test(String(dataset.dataset_hash))||dataset.dataset_version!==`sha256:${dataset.dataset_hash}`)throw new JudgmentMemoryError("INVALID_DATASET_HASH","dataset version/hash pair is invalid");const market=String(judgment.market);if((market==="TW_STOCK"&&dataset.market!=="tw-stock")||(market==="TXF"&&dataset.market!=="txf"))throw new JudgmentMemoryError("DATASET_MARKET_MISMATCH","dataset market differs from judgment market");if(String(dataset.symbol).toUpperCase()!==String(judgment.symbol).toUpperCase())throw new JudgmentMemoryError("DATASET_SYMBOL_MISMATCH","dataset symbol differs from judgment symbol");if(market==="TW_STOCK"&&!dataset.formal_research_eligible)throw new JudgmentMemoryError("DATASET_NOT_ELIGIBLE","TW_STOCK judgment review requires formal research eligible OHLC dataset");if(market==="TXF"&&dataset.review_eligible!==true&&dataset.formal_research_eligible!==true)throw new JudgmentMemoryError("DATASET_NOT_ELIGIBLE","TXF judgment review requires review_eligible or formal_research_eligible dataset");}

export async function recordJudgmentReview(env:Env,raw:RecordJudgmentReviewInput){const review_id=requiredText(raw.review_id,"review_id",240),review_version=requiredText(raw.review_version,"review_version",160),judgment_id=requiredText(raw.judgment_id,"judgment_id",240),judgment_version=requiredText(raw.judgment_version,"judgment_version",160),judgment=await readIndexedRecord<any>(env,"research/gpt-judgments",`${judgment_id}\u0000${judgment_version}`);if(!judgment)throw new JudgmentMemoryError("JUDGMENT_NOT_FOUND","original judgment not found");validateDatasetForReview(raw.dataset,judgment);const outcome_ts_ms=safePositiveInt(raw.outcome_ts_ms,"outcome_ts_ms");if(outcome_ts_ms<=Number(judgment.judgment_ts_ms))throw new JudgmentMemoryError("INVALID_OUTCOME_TIME","outcome must be after original judgment");const outcome_horizon=requiredText(raw.outcome_horizon,"outcome_horizon",120),metric=(v:unknown,f:string)=>v==null?null:finite(v,f),return_pct=metric(raw.return_pct,"return_pct"),mfe_pct=metric(raw.mfe_pct,"mfe_pct"),mae_pct=metric(raw.mae_pct,"mae_pct"),return_points=metric(raw.return_points,"return_points"),mfe_points=metric(raw.mfe_points,"mfe_points"),mae_points=metric(raw.mae_points,"mae_points");if(String(judgment.market)==="TW_STOCK"&&[return_pct,mfe_pct,mae_pct].every(x=>x===null))throw new JudgmentMemoryError("MISSING_OUTCOME_METRICS","TW_STOCK review requires pct outcome metrics");if(String(judgment.market)==="TXF"&&[return_points,mfe_points,mae_points].every(x=>x===null))throw new JudgmentMemoryError("MISSING_OUTCOME_METRICS","TXF review requires point outcome metrics");const quality=(v:unknown,f:string)=>{const x=String(v??"UNKNOWN").toUpperCase();if(!["GOOD","FAIR","POOR","UNKNOWN"].includes(x))throw new JudgmentMemoryError("INVALID_INPUT",`${f} invalid`);return x;},attribution=uniqueStrings(raw.attribution,"attribution",160),failure_patterns=uniqueStrings(raw.failure_patterns,"failure_pattern",160),optimization_hypotheses=(raw.optimization_hypotheses??[]).slice(0,10).map(h=>({hypothesis:requiredText(h?.hypothesis,"hypothesis",2000),expected_effect:h?.expected_effect==null?null:String(h.expected_effect).trim().slice(0,1000),risk:h?.risk==null?null:String(h.risk).trim().slice(0,1000)})),interpretation=requiredText(raw.interpretation,"interpretation",8000),payload=stableValue(raw.payload??{}) as Record<string,unknown>;
  const canonical={schema_version:GPT_JUDGMENT_REVIEW_SCHEMA_VERSION,review_id,review_version,judgment_id,judgment_version,dataset:raw.dataset,outcome_horizon,outcome_ts_ms,return_pct,mfe_pct,mae_pct,return_points,mfe_points,mae_points,direction_correct:raw.direction_correct,location_quality:quality(raw.location_quality,"location_quality"),timing_quality:quality(raw.timing_quality,"timing_quality"),structure_correct:raw.structure_correct??null,pattern_correct:raw.pattern_correct??null,trendline_correct:raw.trendline_correct??null,risk_reward_correct:raw.risk_reward_correct??null,attribution,failure_patterns,optimization_hypotheses,interpretation,payload,market:judgment.market,symbol:judgment.symbol},content_hash=await sha256Hex(stableJson(canonical)),recorded_at=new Date().toISOString(),record={...canonical,content_hash,recorded_at,storage:"GITHUB_ONLY"};try{const w=await putIndexedImmutableRecord(env,{collection:"research/gpt-judgment-reviews",key:`${review_id}\u0000${review_version}`,record,metadata:{review_id,review_version,judgment_id,judgment_version,market:judgment.market,symbol:judgment.symbol,outcome_ts_ms}});return{ok:true,immutable:true,idempotent:w.idempotent,review_id,review_version,content_hash,judgment_id,judgment_version,recorded_at,storage:"GITHUB_ONLY",learning_policy:"REVIEW_DOES_NOT_MUTATE_STRATEGY"};}catch(e){wrapStoreError(e);}
}

function avg(values:number[]){return values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length*1e6)/1e6:null;}
function boolNumber(value:unknown){return value===true?1:value===false?0:value==null?null:Number(value);}
function rate(values:Array<number|null>){const known=values.filter((x):x is number=>x!==null);return known.length?Math.round(known.filter(x=>x===1).length/known.length*1e6)/1e6:null;}
function outcomeValue(row:Record<string,unknown>){return String(row.market)==="TXF"?(row.return_points==null?null:Number(row.return_points)):(row.return_pct==null?null:Number(row.return_pct));}

export async function analyzeJudgmentHistory(env:Env,filters:{market?:JudgmentMarket;symbol?:string;timeframe?:JudgmentTimeframe;from?:string;to?:string;limit?:number}={}){const market=filters.market,symbol=filters.symbol?normalizeSymbol(market??(/^\d{4,6}$/.test(filters.symbol)?"TW_STOCK":"TXF"),filters.symbol):undefined,from=filters.from?dateText(filters.from,"from"):undefined,to=filters.to?dateText(filters.to,"to"):undefined,limit=Math.max(1,Math.min(5000,Math.floor(Number(filters.limit??1000))));const judgments=await listIndexedRecords<any>(env,"research/gpt-judgments",e=>(!market||e.market===market)&&(!symbol||e.symbol===symbol)&&(!filters.timeframe||e.timeframe===filters.timeframe)&&(!from||String(e.trade_date)>=from)&&(!to||String(e.trade_date)<=to),limit);const idSet=new Set(judgments.map(j=>`${j.judgment_id}\u0000${j.judgment_version}`)),reviews=await listIndexedRecords<any>(env,"research/gpt-judgment-reviews",e=>idSet.has(`${e.judgment_id}\u0000${e.judgment_version}`),limit),jmap=new Map(judgments.map(j=>[`${j.judgment_id}\u0000${j.judgment_version}`,j]));const rows=reviews.map(r=>({...jmap.get(`${r.judgment_id}\u0000${r.judgment_version}`),...r}));const outcomes=rows.map(outcomeValue).filter((x):x is number=>x!==null&&Number.isFinite(x)),winRate=outcomes.length?Math.round(outcomes.filter(x=>x>0).length/outcomes.length*1e6)/1e6:null;const group=(keyFn:(r:any)=>string)=>Object.values(rows.reduce((acc:Record<string,{key:string;rows:any[]}>,r:any)=>{const key=keyFn(r);(acc[key]??={key,rows:[]}).rows.push(r);return acc;},{})).map(({key,rows:rs})=>{const vals=rs.map(outcomeValue).filter((x):x is number=>x!==null&&Number.isFinite(x));return{key,count:rs.length,win_rate:vals.length?Math.round(vals.filter(x=>x>0).length/vals.length*1e6)/1e6:null,avg_outcome:avg(vals),direction_accuracy:rate(rs.map(x=>boolNumber(x.direction_correct))),trendline_accuracy:rate(rs.map(x=>boolNumber(x.trendline_correct))),pattern_accuracy:rate(rs.map(x=>boolNumber(x.pattern_correct)))};}).sort((a,b)=>a.key.localeCompare(b.key));const reasonGroups=new Map<string,any[]>(),trendGroups=new Map<string,any[]>(),patternGroups=new Map<string,any[]>();for(const row of rows){const judgment=jmap.get(`${row.judgment_id}\u0000${row.judgment_version}`);for(const reason of judgment?.reasons??[]){const list=reasonGroups.get(String(reason.code))??[];list.push(row);reasonGroups.set(String(reason.code),list);}for(const t of judgment?.trendlines??[]){const key=`${t.type}|${t.status}|${t.quality}`,list=trendGroups.get(key)??[];list.push(row);trendGroups.set(key,list);}for(const p of judgment?.patterns??[]){const key=`${p.pattern_type}|${p.status}`,list=patternGroups.get(key)??[];list.push(row);patternGroups.set(key,list);}}
  const stat=(groups:Map<string,any[]>,accuracy:(r:any)=>number|null)=>[...groups.entries()].map(([key,rs])=>{const vals=rs.map(outcomeValue).filter((x):x is number=>x!==null&&Number.isFinite(x));return{key,count:rs.length,win_rate:vals.length?Math.round(vals.filter(x=>x>0).length/vals.length*1e6)/1e6:null,avg_outcome:avg(vals),accuracy:rate(rs.map(accuracy))};}).sort((a,b)=>b.count-a.count||a.key.localeCompare(b.key));const reason_stats=stat(reasonGroups,r=>boolNumber(r.direction_correct)).map(x=>({reason_code:x.key,count:x.count,win_rate:x.win_rate,avg_outcome:x.avg_outcome,direction_accuracy:x.accuracy})),trendline_stats=stat(trendGroups,r=>boolNumber(r.trendline_correct)).map(x=>({key:x.key,count:x.count,win_rate:x.win_rate,avg_outcome:x.avg_outcome,trendline_accuracy:x.accuracy})),pattern_stats=stat(patternGroups,r=>boolNumber(r.pattern_correct)).map(x=>({key:x.key,count:x.count,win_rate:x.win_rate,avg_outcome:x.avg_outcome,pattern_accuracy:x.accuracy}));return{ok:true,memory_version:GPT_JUDGMENT_MEMORY_VERSION,storage:"GITHUB_ONLY",filters,summary:{judgments_with_reviews:rows.length,win_rate:winRate,avg_outcome:avg(outcomes),outcome_unit:filters.market==="TXF"?"points":filters.market==="TW_STOCK"?"pct":"MIXED_DO_NOT_COMPARE_DIRECTLY",direction_accuracy:rate(rows.map(x=>boolNumber(x.direction_correct))),structure_accuracy:rate(rows.map(x=>boolNumber(x.structure_correct))),pattern_accuracy:rate(rows.map(x=>boolNumber(x.pattern_correct))),trendline_accuracy:rate(rows.map(x=>boolNumber(x.trendline_correct))),risk_reward_accuracy:rate(rows.map(x=>boolNumber(x.risk_reward_correct))),avg_confidence:avg(rows.map(x=>Number(x.confidence)).filter(Number.isFinite))},by_direction:group(r=>String(r.direction)),by_market_strategy_unit_warning:"TW_STOCK percentage outcomes and TXF point outcomes are never aggregated into a shared numeric expectancy",reason_stats,trendline_stats,pattern_stats,learning_policy:"STATISTICS_GENERATE_HYPOTHESES_ONLY_NO_AUTO_STRATEGY_CHANGE"};}

export async function recordTradingKnowledge(env:Env,raw:RecordTradingKnowledgeInput){const knowledge_id=requiredText(raw.knowledge_id,"knowledge_id",240),knowledge_version=requiredText(raw.knowledge_version,"knowledge_version",160),market_scope=String(raw.market_scope??"");if(!["ALL","TW_STOCK","TXF"].includes(market_scope))throw new JudgmentMemoryError("INVALID_INPUT","invalid market_scope");const topic=requiredText(raw.topic,"topic",200).toUpperCase(),statement=requiredText(raw.statement,"statement",8000),status=String(raw.status??"") as KnowledgeStatus;if(!["OBSERVATION","HYPOTHESIS","VALIDATED","REJECTED","ACCEPTED"].includes(status))throw new JudgmentMemoryError("INVALID_INPUT","invalid knowledge status");const evidence_count=Number(raw.evidence_count);if(!Number.isInteger(evidence_count)||evidence_count<0)throw new JudgmentMemoryError("INVALID_INPUT","evidence_count must be non-negative integer");const actor_type=String(raw.actor_type??"");if(!["GPT_REVIEW","SYSTEM","HUMAN"].includes(actor_type))throw new JudgmentMemoryError("INVALID_INPUT","invalid actor_type");const human_approved=raw.human_approved===true;if(status==="ACCEPTED"&&(!human_approved||actor_type!=="HUMAN"))throw new JudgmentMemoryError("HUMAN_APPROVAL_REQUIRED","ACCEPTED knowledge requires HUMAN actor and human_approved=true");const evidence_refs=(raw.evidence_refs??[]).map(r=>({judgment_id:requiredText(r.judgment_id,"evidence.judgment_id",240),judgment_version:requiredText(r.judgment_version,"evidence.judgment_version",160),review_id:r.review_id==null?null:requiredText(r.review_id,"evidence.review_id",240),review_version:r.review_version==null?null:requiredText(r.review_version,"evidence.review_version",160)})).sort((a,b)=>`${a.judgment_id}|${a.judgment_version}|${a.review_id}`.localeCompare(`${b.judgment_id}|${b.judgment_version}|${b.review_id}`)),rationale=raw.rationale==null?null:String(raw.rationale).trim().slice(0,5000),payload=stableValue(raw.payload??{}) as Record<string,unknown>,canonical={schema_version:GPT_TRADING_KNOWLEDGE_SCHEMA_VERSION,knowledge_id,knowledge_version,market_scope,topic,statement,status,evidence_count,evidence_refs,actor_type,human_approved,rationale,payload},content_hash=await sha256Hex(stableJson(canonical)),recorded_at=new Date().toISOString(),record={...canonical,content_hash,recorded_at,storage:"GITHUB_ONLY"};try{const w=await putIndexedImmutableRecord(env,{collection:"research/gpt-trading-knowledge",key:`${knowledge_id}\u0000${knowledge_version}`,record,metadata:{knowledge_id,knowledge_version,market_scope,topic,status}});return{ok:true,immutable:true,idempotent:w.idempotent,knowledge_id,knowledge_version,content_hash,status,recorded_at,storage:"GITHUB_ONLY",production_promotion:"FORBIDDEN"};}catch(e){wrapStoreError(e);}}
export async function listTradingKnowledge(env:Env,filters:{market_scope?:"ALL"|JudgmentMarket;topic?:string;status?:KnowledgeStatus;limit?:number}={}){const topic=filters.topic?requiredText(filters.topic,"topic",200).toUpperCase():undefined,limit=Math.max(1,Math.min(500,Math.floor(Number(filters.limit??100)))),knowledge=await listIndexedRecords<any>(env,"research/gpt-trading-knowledge",e=>(!filters.market_scope||e.market_scope===filters.market_scope)&&(!topic||e.topic===topic)&&(!filters.status||e.status===filters.status),limit);return{ok:true,count:knowledge.length,knowledge,storage:"GITHUB_ONLY"};}
