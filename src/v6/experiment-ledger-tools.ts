import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ExperimentLedgerError,
  getExperiment,
  listExperimentDecisions,
  listExperiments,
  recordExperiment,
  recordExperimentDecision,
  reviewHypothesisHistory,
} from "./experiment-ledger";

const textResult = (value: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

const datasetRef = z.object({
  dataset_id: z.string().min(1),
  dataset_version: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  dataset_hash: z.string().regex(/^[0-9a-f]{64}$/),
  symbol: z.string().optional(),
  timeframe: z.string().optional(),
});

const signalRef = z.object({
  signal_id: z.string().min(1),
  signal_version: z.string().min(1),
});

function failure(error: unknown) {
  if (error instanceof ExperimentLedgerError) {
    return textResult({ ok:false, status:error.code, error:error.message, detail:error.detail ?? null }, true);
  }
  return textResult({ ok:false, status:"EXPERIMENT_LEDGER_INTERNAL_ERROR", error:error instanceof Error ? error.message : String(error) }, true);
}

export function registerExperimentLedgerTools(server: McpServer, env: Env) {
  server.registerTool("record_research_experiment", {
    description: "P8 Experiment Memory：以不可變、版本化方式保存研究假設、資料集、參數、結果與失敗原因。只進研究知識庫，不會升級 Production 策略。",
    inputSchema: {
      experiment_id: z.string().min(1).max(240),
      hypothesis: z.string().min(1).max(5000),
      source: z.string().min(1).max(200),
      strategy_id: z.string().max(240).nullable().optional(),
      strategy_version: z.string().max(160).nullable().optional(),
      signal_refs: z.array(signalRef).optional().default([]),
      dataset_refs: z.array(datasetRef).optional().default([]),
      parameters: z.record(z.string(), z.unknown()).optional().default({}),
      result: z.record(z.string(), z.unknown()).optional().default({}),
      metrics: z.object({
        profit_factor: z.number().finite().nullable().optional(),
        win_rate: z.number().min(0).max(1).nullable().optional(),
        expectancy_pct: z.number().finite().nullable().optional(),
        mfe_pct: z.number().finite().nullable().optional(),
        mae_pct: z.number().finite().nullable().optional(),
      }).optional().default({}),
      regime: z.string().max(200).nullable().optional(),
      validation_status: z.enum(["DEVELOPMENT","VALIDATED","REJECTED","CANDIDATE"]),
      rejection_reason: z.string().max(2000).nullable().optional(),
    },
  }, async (payload) => {
    try { return textResult(await recordExperiment(env, payload)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("get_research_experiment", {
    description: "讀取指定 Experiment 的最新版本或指定 immutable version。",
    inputSchema: {
      experiment_id: z.string().min(1).max(240),
      experiment_version: z.string().regex(/^sha256:[0-9a-f]{64}$/).optional(),
    },
  }, async ({ experiment_id, experiment_version }) => {
    try { return textResult(await getExperiment(env, experiment_id, experiment_version)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("list_research_experiments", {
    description: "列出 Experiment Ledger，可依策略或驗證狀態過濾；包含成功與失敗實驗。",
    inputSchema: {
      strategy_id: z.string().max(240).optional(),
      validation_status: z.enum(["DEVELOPMENT","VALIDATED","REJECTED","CANDIDATE"]).optional(),
      limit: z.number().int().min(1).max(200).optional().default(50),
    },
  }, async (filters) => {
    try { return textResult(await listExperiments(env, filters)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("review_hypothesis_history", {
    description: "鑽石引擎 Review Engine 的 deterministic memory gate：用正規化 hypothesis hash 查詢是否已測過，特別標示曾被拒絕的相同假設，避免重複研究。",
    inputSchema: {
      hypothesis: z.string().min(1).max(5000),
      limit: z.number().int().min(1).max(200).optional().default(50),
    },
  }, async ({ hypothesis, limit }) => {
    try { return textResult(await reviewHypothesisHistory(env, hypothesis, limit)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("record_experiment_decision", {
    description: "保存 Experiment 的不可變決策紀錄。只允許 KEEP_RESEARCH / MARK_CANDIDATE / REJECT / NOTE；API 明確禁止 Production promotion，AI_REVIEW 也不能自行升為 Candidate。",
    inputSchema: {
      decision_id: z.string().min(1).max(240),
      experiment_id: z.string().min(1).max(240),
      experiment_version: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      action: z.enum(["KEEP_RESEARCH","MARK_CANDIDATE","REJECT","NOTE"]),
      actor_type: z.enum(["HUMAN","SYSTEM","AI_REVIEW"]),
      rationale: z.string().max(3000).nullable().optional(),
      payload: z.record(z.string(), z.unknown()).optional().default({}),
    },
  }, async (payload) => {
    try { return textResult(await recordExperimentDecision(env, payload)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("list_experiment_decisions", {
    description: "列出指定 immutable Experiment version 的 Decision Ledger。",
    inputSchema: {
      experiment_id: z.string().min(1).max(240),
      experiment_version: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    },
  }, async ({ experiment_id, experiment_version }) => {
    try { return textResult(await listExperimentDecisions(env, experiment_id, experiment_version)); }
    catch (error) { return failure(error); }
  });
}
