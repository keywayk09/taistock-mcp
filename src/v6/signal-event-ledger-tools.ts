import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getEventLedger,
  getSignalLedger,
  LedgerError,
  listEventLedger,
  listSignalLedger,
  recordLedgerEvent,
  recordSignalLedger,
} from "./signal-event-ledger";

const jsonObject = z.record(z.string(), z.unknown());

function ok(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function failure(error: unknown) {
  const payload = error instanceof LedgerError
    ? { ok: false, status: error.code, error: error.message, detail: error.detail ?? null }
    : { ok: false, status: "LEDGER_INTERNAL_ERROR", error: error instanceof Error ? error.message : String(error) };
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }], isError: true };
}

export function registerSignalEventLedgerTools(server: McpServer, env: Env) {
  server.registerTool("record_research_event", {
    description: "以 append-only / immutable 方式記錄研究事件。相同 event_id+version 只允許完全相同內容重試；available_ts_ms 不得早於 event_ts_ms。這是 Event Ledger，不寫入 OHLC。",
    inputSchema: {
      event_id: z.string().min(1).max(240),
      event_version: z.string().min(1).max(160),
      symbol: z.string().regex(/^\d{4,6}$/).nullable().optional(),
      event_type: z.string().min(1).max(120),
      event_ts_ms: z.number().int().positive(),
      available_ts_ms: z.number().int().positive(),
      source: z.string().min(1).max(160),
      title: z.string().max(1000).nullable().optional(),
      payload: jsonObject.optional(),
    },
  }, async (input) => {
    try { return ok(await recordLedgerEvent(env, input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("record_signal_ledger", {
    description: "記錄不可變 Signal Ledger。強制 data_watermark <= knowledge_cutoff <= signal time；引用 Event 必須在 cutoff 前已可取得，否則 LOOKAHEAD_BIAS。可綁 P2 dataset_id/version/hash。相同 signal_id+version 不允許內容靜默變更。",
    inputSchema: {
      signal_id: z.string().min(1).max(240),
      signal_version: z.string().min(1).max(160),
      symbol: z.string().regex(/^\d{4,6}$/),
      trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      timeframe: z.string().min(1).max(32),
      side: z.enum(["LONG", "SHORT", "NEUTRAL"]),
      strategy: z.string().min(1).max(200),
      stage: z.string().min(1).max(120),
      signal_ts_ms: z.number().int().positive(),
      knowledge_cutoff_ts_ms: z.number().int().positive(),
      data_watermark_ts_ms: z.number().int().positive(),
      price: z.number().positive().nullable().optional(),
      atr: z.number().positive().nullable().optional(),
      source: z.string().min(1).max(160),
      dataset_id: z.string().max(500).nullable().optional(),
      dataset_version: z.string().max(80).nullable().optional(),
      dataset_hash: z.string().max(64).nullable().optional(),
      event_refs: z.array(z.object({ event_id: z.string().min(1).max(240), event_version: z.string().min(1).max(160) })).max(100).optional(),
      reason_codes: z.array(z.string().min(1).max(120)).max(200).optional(),
      payload: jsonObject.optional(),
    },
  }, async (input) => {
    try { return ok(await recordSignalLedger(env, input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("get_signal_ledger", {
    description: "依 signal_id（可指定 version）讀取不可變 Signal Ledger。",
    inputSchema: {
      signal_id: z.string().min(1).max(240),
      signal_version: z.string().min(1).max(160).optional(),
    },
  }, async ({ signal_id, signal_version }) => {
    try { return ok({ ok: true, signal: await getSignalLedger(env, signal_id, signal_version) }); }
    catch (error) { return failure(error); }
  });

  server.registerTool("list_signal_ledger", {
    description: "依日期、股票、策略或 stage 查詢 Signal Ledger，供後續 P5 5m 大樣本回測讀取；只讀，不修改歷史 Signal。",
    inputSchema: {
      trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      symbol: z.string().regex(/^\d{4,6}$/).optional(),
      strategy: z.string().min(1).max(200).optional(),
      stage: z.string().min(1).max(120).optional(),
      limit: z.number().int().min(1).max(500).optional().default(100),
    },
  }, async (filters) => {
    try { const signals = await listSignalLedger(env, filters); return ok({ ok: true, count: signals.length, signals }); }
    catch (error) { return failure(error); }
  });

  server.registerTool("get_research_event", {
    description: "依 event_id（可指定 version）讀取不可變 Event Ledger。",
    inputSchema: {
      event_id: z.string().min(1).max(240),
      event_version: z.string().min(1).max(160).optional(),
    },
  }, async ({ event_id, event_version }) => {
    try { return ok({ ok: true, event: await getEventLedger(env, event_id, event_version) }); }
    catch (error) { return failure(error); }
  });

  server.registerTool("list_research_events", {
    description: "依股票、事件種類與資訊可得時間查詢 Event Ledger。available_before_ts_ms 可用於 Knowledge Cutoff 查詢。",
    inputSchema: {
      symbol: z.string().regex(/^\d{4,6}$/).optional(),
      event_type: z.string().min(1).max(120).optional(),
      available_before_ts_ms: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(500).optional().default(100),
    },
  }, async (filters) => {
    try { const events = await listEventLedger(env, filters); return ok({ ok: true, count: events.length, events }); }
    catch (error) { return failure(error); }
  });
}
