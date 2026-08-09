import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  GPT_JUDGMENT_MEMORY_VERSION,
  analyzeJudgmentHistory,
  getMarketJudgment,
  listMarketJudgments,
  listTradingKnowledge,
  recordJudgmentReview,
  recordMarketJudgment,
  recordTradingKnowledge,
  type RecordJudgmentInput,
  type RecordJudgmentReviewInput,
  type RecordTradingKnowledgeInput,
} from "./gpt-judgment-memory";

const out = (value: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

const reasonSchema = z.object({
  code: z.string().min(1).max(120),
  family: z.string().max(120).nullable().optional(),
  weight: z.number().min(-10).max(10).nullable().optional(),
  note: z.string().max(1200).nullable().optional(),
});

const anchorSchema = z.object({
  ts_ms: z.number().int().positive(),
  price: z.number().positive(),
  anchor_type: z.enum(["SWING_LOW","SWING_HIGH","PIVOT_LOW","PIVOT_HIGH","GAP_EDGE","BREAKOUT_LEVEL","HIGH_VOLUME_REVERSAL","MANUAL_GPT_ANCHOR"]),
  strength: z.number().min(0).max(100).nullable().optional(),
  volume_ratio: z.number().nonnegative().nullable().optional(),
  atr_context: z.number().nonnegative().nullable().optional(),
});

const trendlineSchema = z.object({
  trendline_id: z.string().min(1).max(240),
  type: z.enum(["SUPPORT_TRENDLINE","RESISTANCE_TRENDLINE","CHANNEL_SUPPORT","CHANNEL_RESISTANCE"]),
  status: z.enum(["ACTIVE","BROKEN","RECLAIMED","INVALIDATED"]),
  quality: z.enum(["LOW","MEDIUM","HIGH"]),
  anchors: z.array(anchorSchema).min(2).max(12),
  slope_price_per_bar: z.number().finite().nullable().optional(),
  slope_normalized: z.number().finite().nullable().optional(),
  touch_count: z.number().int().nonnegative().nullable().optional(),
  false_break_count: z.number().int().nonnegative().nullable().optional(),
  distance_atr: z.number().finite().nullable().optional(),
  distance_pct: z.number().finite().nullable().optional(),
  current_price: z.number().positive().nullable().optional(),
  projected_price: z.number().positive().nullable().optional(),
  expected_behavior: z.string().max(2000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const patternSchema = z.object({
  pattern_id: z.string().min(1).max(240),
  pattern_type: z.string().min(1).max(160),
  status: z.enum(["FORMING","CONFIRMED","FAILED","COMPLETED"]),
  confidence: z.number().min(0).max(100),
  detected_at_ts_ms: z.number().int().positive(),
  upper_boundary: z.number().positive().nullable().optional(),
  lower_boundary: z.number().positive().nullable().optional(),
  compression_atr: z.number().nonnegative().nullable().optional(),
  volume_behavior: z.enum(["EXPANDING","CONTRACTING","NEUTRAL","UNKNOWN"]).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const datasetSchema = z.object({
  dataset_id: z.string().min(1),
  dataset_version: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  dataset_hash: z.string().regex(/^[0-9a-f]{64}$/),
  market: z.enum(["tw-stock","txf"]),
  symbol: z.string().min(1),
  timeframe: z.enum(["1m","5m","1d"]),
  frozen_view: z.literal(true),
  complete_view: z.literal(true),
  truncated: z.literal(false),
  formal_research_eligible: z.boolean(),
  review_eligible: z.boolean().optional(),
});

function failure(error: unknown) {
  const e = error as { code?: string; message?: string; detail?: Record<string, unknown> };
  return out({ ok:false, status:e?.code ?? "GPT_JUDGMENT_MEMORY_ERROR", error:e?.message ?? String(error), detail:e?.detail ?? null }, true);
}

export function registerGptJudgmentMemoryTools(server: McpServer, env: Env) {
  server.registerTool("get_gpt_judgment_memory_contract", {
    description: "P16 GPT 交易認知記憶契約：台股與 TXF 共用 Judgment/Structure/Pattern/Trendline 語言，但保留市場單位與資料資格差異。Trendline anchors、型態、理由與當下判斷全部 immutable，後續 Outcome/Review 只能追加，不能回寫原判斷。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out({
    version: GPT_JUDGMENT_MEMORY_VERSION,
    markets: ["TW_STOCK","TXF"],
    judgment_layers: ["DIRECTION","STRUCTURE","PATTERN","TRENDLINE","SUPPORT_RESISTANCE","REASON_CODES","RISK_REWARD","CONFIDENCE"],
    trendline_goal: "Record GPT-selected anchors/touches/breaks/reclaims now; later learn deterministic anchor/quality rules and build a TradingView trendline indicator.",
    flow: "GPT judgment -> immutable Judgment Memory -> OHLC MCP frozen outcome -> GPT review -> statistics -> hypothesis -> validated/rejected knowledge -> later engine rule candidate",
    no_lookahead: "data_watermark <= knowledge_cutoff <= judgment_ts; every pattern detection and trendline anchor must be <= knowledge_cutoff",
    market_units: { TW_STOCK:"percentage return/MFE/MAE", TXF:"points return/MFE/MAE; never numerically mixed with stock percentage outcomes" },
    knowledge_gate: "GPT/SYSTEM may create OBSERVATION/HYPOTHESIS/VALIDATED/REJECTED; ACCEPTED requires explicit HUMAN approval.",
    production_strategy_change: "FORBIDDEN",
    ohlc_write: "FORBIDDEN",
  }));

  server.registerTool("record_gpt_market_judgment", {
    description: "保存 GPT 在當下對台股或 TXF 的不可變判斷快照。可結構化記錄方向、理由、Structure、Pattern、支撐壓力與 Trendline anchors/品質/Touch/Break 狀態。所有 Anchor/Pattern 時間都必須早於 knowledge cutoff，防止事後看圖重寫理由。",
    inputSchema: {
      judgment_id: z.string().min(1).max(240),
      judgment_version: z.string().min(1).max(160),
      market: z.enum(["TW_STOCK","TXF"]),
      symbol: z.string().min(1).max(16),
      timeframe: z.enum(["1m","5m","15m","30m","60m","1d"]),
      trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      judgment_ts_ms: z.number().int().positive(),
      knowledge_cutoff_ts_ms: z.number().int().positive(),
      data_watermark_ts_ms: z.number().int().positive(),
      direction: z.enum(["BULLISH","BEARISH","NEUTRAL"]),
      confidence: z.number().min(0).max(100),
      thesis: z.string().min(1).max(8000),
      risk_reward_score: z.number().min(0).max(100).nullable().optional(),
      reasons: z.array(reasonSchema).max(50).optional().default([]),
      structures: z.array(z.string().min(1).max(120)).max(30).optional().default([]),
      patterns: z.array(patternSchema).max(20).optional().default([]),
      trendlines: z.array(trendlineSchema).max(20).optional().default([]),
      support_levels: z.array(z.number().positive()).max(30).optional().default([]),
      resistance_levels: z.array(z.number().positive()).max(30).optional().default([]),
      payload: z.record(z.string(), z.unknown()).optional().default({}),
    },
    annotations: { readOnlyHint:false, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async (input) => {
    try { return out(await recordMarketJudgment(env, input as RecordJudgmentInput)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("get_gpt_market_judgment", {
    description: "讀取指定 GPT Judgment 的最新版本或 immutable 指定版本，包含 Reasons、Patterns 與 Trendlines。",
    inputSchema: { judgment_id:z.string().min(1).max(240), judgment_version:z.string().min(1).max(160).optional() },
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async ({ judgment_id, judgment_version }) => {
    try { return out(await getMarketJudgment(env, judgment_id, judgment_version)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("list_gpt_market_judgments", {
    description: "列出 GPT 歷史市場判斷，可依台股/TXF、標的、日期與 timeframe 過濾，供復盤與長期認知分析。",
    inputSchema: {
      market:z.enum(["TW_STOCK","TXF"]).optional(), symbol:z.string().max(16).optional(), trade_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      timeframe:z.enum(["1m","5m","15m","30m","60m","1d"]).optional(), limit:z.number().int().min(1).max(500).optional().default(100),
    },
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async (filters) => {
    try { return out(await listMarketJudgments(env, filters as any)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("record_gpt_judgment_review", {
    description: "行情走完後，用 OHLC MCP frozen dataset 對原 GPT Judgment 做追加式復盤。分開評估 Direction、Location、Timing、Structure、Pattern、Trendline、Risk/Reward，保存 MFE/MAE/Return、錯誤歸因與待驗證優化 Hypothesis；絕不改寫原判斷。",
    inputSchema: {
      review_id:z.string().min(1).max(240), review_version:z.string().min(1).max(160), judgment_id:z.string().min(1).max(240), judgment_version:z.string().min(1).max(160),
      dataset:datasetSchema, outcome_horizon:z.string().min(1).max(120), outcome_ts_ms:z.number().int().positive(),
      return_pct:z.number().finite().nullable().optional(), mfe_pct:z.number().finite().nullable().optional(), mae_pct:z.number().finite().nullable().optional(),
      return_points:z.number().finite().nullable().optional(), mfe_points:z.number().finite().nullable().optional(), mae_points:z.number().finite().nullable().optional(),
      direction_correct:z.boolean().nullable(), location_quality:z.enum(["GOOD","FAIR","POOR","UNKNOWN"]).optional(), timing_quality:z.enum(["GOOD","FAIR","POOR","UNKNOWN"]).optional(),
      structure_correct:z.boolean().nullable().optional(), pattern_correct:z.boolean().nullable().optional(), trendline_correct:z.boolean().nullable().optional(), risk_reward_correct:z.boolean().nullable().optional(),
      attribution:z.array(z.string().min(1).max(160)).max(50).optional().default([]), failure_patterns:z.array(z.string().min(1).max(160)).max(50).optional().default([]),
      optimization_hypotheses:z.array(z.object({ hypothesis:z.string().min(1).max(2000), expected_effect:z.string().max(1000).nullable().optional(), risk:z.string().max(1000).nullable().optional() })).max(10).optional().default([]),
      interpretation:z.string().min(1).max(8000), payload:z.record(z.string(),z.unknown()).optional().default({}),
    },
    annotations: { readOnlyHint:false, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async (input) => {
    try { return out(await recordJudgmentReview(env, input as RecordJudgmentReviewInput)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("analyze_gpt_judgment_history", {
    description: "統計 GPT 長期判斷能力，不只看總勝率：Direction accuracy、Structure/Pattern/Trendline/RR correctness、理由組合、Trendline 類型與型態群組表現。台股%與 TXF points 永不混成同一 expectancy。輸出只形成研究假設，不自動改策略。",
    inputSchema: {
      market:z.enum(["TW_STOCK","TXF"]).optional(), symbol:z.string().max(16).optional(), timeframe:z.enum(["1m","5m","15m","30m","60m","1d"]).optional(),
      from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), limit:z.number().int().min(1).max(5000).optional().default(1000),
    },
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async (filters) => {
    try { return out(await analyzeJudgmentHistory(env, filters as any)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("record_gpt_trading_knowledge", {
    description: "將多次復盤後的認知保存為版本化 Trading Knowledge。可記 OBSERVATION/HYPOTHESIS/VALIDATED/REJECTED；只有 HUMAN + human_approved=true 才能寫 ACCEPTED，避免 GPT 因小樣本把自己的看法升成正式知識。",
    inputSchema: {
      knowledge_id:z.string().min(1).max(240), knowledge_version:z.string().min(1).max(160), market_scope:z.enum(["ALL","TW_STOCK","TXF"]), topic:z.string().min(1).max(200),
      statement:z.string().min(1).max(8000), status:z.enum(["OBSERVATION","HYPOTHESIS","VALIDATED","REJECTED","ACCEPTED"]), evidence_count:z.number().int().nonnegative(),
      evidence_refs:z.array(z.object({judgment_id:z.string().min(1).max(240),judgment_version:z.string().min(1).max(160),review_id:z.string().max(240).nullable().optional(),review_version:z.string().max(160).nullable().optional()})).max(1000).optional().default([]),
      actor_type:z.enum(["GPT_REVIEW","SYSTEM","HUMAN"]), human_approved:z.boolean().optional().default(false), rationale:z.string().max(5000).nullable().optional(), payload:z.record(z.string(),z.unknown()).optional().default({}),
    },
    annotations: { readOnlyHint:false, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async (input) => {
    try { return out(await recordTradingKnowledge(env, input as RecordTradingKnowledgeInput)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("list_gpt_trading_knowledge", {
    description: "讀取 GPT Trading Knowledge，包括已驗證、已否決與人類核准的 Accepted Knowledge，供下一次市場判斷前檢索，避免重複犯已知錯誤。",
    inputSchema: {
      market_scope:z.enum(["ALL","TW_STOCK","TXF"]).optional(), topic:z.string().max(200).optional(), status:z.enum(["OBSERVATION","HYPOTHESIS","VALIDATED","REJECTED","ACCEPTED"]).optional(), limit:z.number().int().min(1).max(500).optional().default(100),
    },
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async (filters) => {
    try { return out(await listTradingKnowledge(env, filters as any)); }
    catch (error) { return failure(error); }
  });
}
