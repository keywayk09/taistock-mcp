import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSelectionEvidence, listSelectionRuns } from "./selection-journal.ts";
import { getLiveDecision, listLiveDecisions, recordLiveDecision, LIVE_DECISION_LEDGER_VERSION } from "./live-decision-ledger.ts";
import {
  INTRADAY_REVIEW_SELECTOR_VERSION,
  NEXT_DAY_INTRADAY_SELECTOR_VERSION,
  SWING_JOURNAL_SELECTOR_VERSION,
} from "./selection-engine.ts";
import { SELECTION_SCHEDULE_VERSION } from "./selection-schedule.ts";

export const SELECTION_TOOLS_VERSION = "diamond-selection-tools/v1.0.0";

const out = (value: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

const dateSchema = z.string().regex(/^20\d{2}-\d{2}-\d{2}$/);
const selectionTypeSchema = z.enum(["SWING", "INTRADAY_REVIEW", "NEXT_DAY_INTRADAY"]);
const liveStateSchema = z.enum(["LONG_WATCH", "SHORT_WATCH", "WAIT", "SKIP", "LONG_CONFIRMED", "SHORT_CONFIRMED", "INVALIDATED"]);

export function registerSelectionTools(server: McpServer, env: Env) {
  server.registerTool("get_selection_contract", {
    description: "讀取定案後選標架構：波段標、當沖復盤標、隔日當沖標完全分離；08:30 audit 不回寫；盤中判斷另記 immutable live decision。",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => out({
    ok: true,
    version: SELECTION_TOOLS_VERSION,
    schedule_version: SELECTION_SCHEDULE_VERSION,
    selectors: {
      intraday_review: { version: INTRADAY_REVIEW_SELECTOR_VERSION, target_time: "18:30 Asia/Taipei", journal: "INTRADAY_REVIEW" },
      swing: { version: SWING_JOURNAL_SELECTOR_VERSION, target_time: "22:30 Asia/Taipei", journal: "SWING" },
      next_day_intraday: { version: NEXT_DAY_INTRADAY_SELECTOR_VERSION, target_time: "22:30 Asia/Taipei", journal: "NEXT_DAY_INTRADAY" },
      live_decision: { version: LIVE_DECISION_LEDGER_VERSION, session: "09:00-13:30 Asia/Taipei" },
    },
    hard_rules: [
      "COMMON_RAW_DATA_ONLY_LABELS_NEVER_SHARED",
      "ORIGINAL_SELECTION_IMMUTABLE",
      "AUDIT_DELTA_NEVER_REWRITES_SELECTION",
      "NO_FUTURE_DATA_IN_SELECTION",
      "NO_OLD_DATA_AS_TODAY",
      "STRICT_MOPSFIN_COMPANY_MASTER_EXCLUDES_ETF_ETN",
      "LIVE_DECISION_NEVER_REWRITES_NIGHTLY_SELECTION",
      "MANUAL_ENTRY_ONLY",
    ],
  }));

  server.registerTool("list_selection_runs", {
    description: "列出 immutable 波段/當沖復盤/隔日當沖選標紀錄，用於復盤與回測。",
    inputSchema: {
      selection_type: selectionTypeSchema,
      source_trade_date: dateSchema.optional(),
      target_session_date: dateSchema.optional(),
      limit: z.number().int().min(1).max(100).optional().default(20),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ selection_type, source_trade_date, target_session_date, limit }) => out({
    ok: true,
    selection_type,
    runs: await listSelectionRuns(env, { selection_type, source_trade_date, target_session_date, limit }),
  }));

  server.registerTool("get_selection_evidence", {
    description: "讀取 point-in-time 選標 Evidence；EOD_1830 供當沖復盤，FULL_2230 供波段與隔日當沖。",
    inputSchema: { source_trade_date: dateSchema, slot: z.enum(["EOD_1830", "FULL_2230"]) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ source_trade_date, slot }) => {
    const evidence = await getSelectionEvidence(env, source_trade_date, slot);
    return out({ ok: Boolean(evidence), status: evidence ? "READY" : "UNAVAILABLE", evidence }, !evidence);
  });

  server.registerTool("record_live_decision", {
    description: "將盤中正式判斷事件寫入 immutable Live Decision Ledger。只記判斷，不下單，也不能修改昨晚選標。",
    inputSchema: {
      decision_id: z.string().min(1).max(160),
      decision_version: z.string().min(1).max(120).optional(),
      trade_date: dateSchema,
      symbol: z.string().regex(/^[1-9]\d{3}$/),
      observed_at: z.string().datetime(),
      observed_at_ms: z.number().int().positive(),
      knowledge_cutoff_ts_ms: z.number().int().positive(),
      data_watermark_ts_ms: z.number().int().positive(),
      state: liveStateSchema,
      prior_decision_id: z.string().max(160).nullable().optional(),
      source_selection_ids: z.array(z.string()).max(20).optional(),
      market_context: z.record(z.string(), z.any()).optional(),
      features: z.record(z.string(), z.any()).optional(),
      reason_codes: z.array(z.string().max(80)).max(30).optional(),
      invalidation_conditions: z.array(z.string().max(200)).max(20).optional(),
      note: z.string().max(1000).nullable().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    try {
      return out({ ok: true, decision: await recordLiveDecision(env, input) });
    } catch (error) {
      return out({ ok: false, error: error instanceof Error ? error.message : String(error) }, true);
    }
  });

  server.registerTool("list_live_decisions", {
    description: "讀取盤中正式判斷事件，供事後 MFE/MAE、確認率、失效率與執行品質檢討。",
    inputSchema: { trade_date: dateSchema.optional(), symbol: z.string().regex(/^[1-9]\d{3}$/).optional(), limit: z.number().int().min(1).max(200).optional().default(100) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ trade_date, symbol, limit }) => out({ ok: true, decisions: await listLiveDecisions(env, { trade_date, symbol, limit }) }));

  server.registerTool("get_live_decision", {
    description: "依 decision_id + version 讀取單一 immutable 盤中判斷。",
    inputSchema: { decision_id: z.string().min(1), decision_version: z.string().min(1).optional().default(LIVE_DECISION_LEDGER_VERSION) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ decision_id, decision_version }) => {
    const decision = await getLiveDecision(env, decision_id, decision_version);
    return out({ ok: Boolean(decision), decision }, !decision);
  });
}
