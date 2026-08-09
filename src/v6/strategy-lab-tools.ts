import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  StrategyLabGovernanceError,
  buildStrategyValidationPlan,
  evaluateStrategyCandidateGate,
  getStrategyCandidate,
  listStrategyCandidates,
} from "./strategy-lab-governance";

const out = (value: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  ...(isError ? { isError:true } : {}),
});

function failure(error: unknown) {
  if (error instanceof StrategyLabGovernanceError) {
    return out({ ok:false, status:error.code, error:error.message, detail:error.detail ?? null }, true);
  }
  return out({ ok:false, status:"STRATEGY_LAB_INTERNAL_ERROR", error:error instanceof Error ? error.message : String(error) }, true);
}

export function registerStrategyLabTools(server: McpServer) {
  server.registerTool("list_strategy_lab_candidates", {
    description: "P12 Strategy Lab：列出已鎖定來源版本的 15 個 daily_stock_analysis Strategy Skill 候選。這些是 Research Candidate，不代表已在台股驗證有效。",
    inputSchema: {
      formalization_class: z.enum(["FULLY_QUANTIFIABLE_CANDIDATE","SEMI_QUANTITATIVE_CANDIDATE","RESEARCH_LLM_CANDIDATE"]).optional(),
    },
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  }, async ({ formalization_class }) => out(listStrategyCandidates(formalization_class)));

  server.registerTool("get_strategy_lab_candidate", {
    description: "讀取單一外部 Strategy Candidate 的 immutable source blob、MIT license、formalization class 與研究限制。",
    inputSchema: { strategy_id:z.string().min(1).max(100) },
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  }, async ({ strategy_id }) => {
    try { return out({ok:true,candidate:getStrategyCandidate(strategy_id)}); }
    catch (error) { return failure(error); }
  });

  server.registerTool("build_strategy_validation_plan", {
    description: "依 Strategy Candidate 類型產生固定驗證計畫：source audit -> formalization -> 台股語意校正 -> time-safe data mapping -> P5/P7 backtest -> P11 validation -> P8 memory -> regression -> Candidate human gate。",
    inputSchema: { strategy_id:z.string().min(1).max(100) },
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  }, async ({ strategy_id }) => {
    try { return out(buildStrategyValidationPlan(strategy_id)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("evaluate_strategy_candidate_gate", {
    description: "P12 Candidate Gate：檢查 formalization、台股校正、P2 dataset、backtest、P11 robustness、regime、regression、P8 memory 與 human gate 是否完整。最多只允許 MARK_CANDIDATE，永遠不提供 Production promotion。",
    inputSchema: {
      strategy_id:z.string().min(1).max(100),
      source_version:z.string().min(1).max(100),
      formalization_complete:z.boolean(),
      taiwan_semantic_calibrated:z.boolean(),
      time_safe_data_mapping:z.boolean(),
      dataset_versions:z.array(z.string().regex(/^sha256:[0-9a-f]{64}$/)).max(500),
      backtest_run_ids:z.array(z.string().min(1).max(300)).max(500),
      walk_forward_run_id:z.string().max(300).nullable().optional(),
      bootstrap_run_id:z.string().max(300).nullable().optional(),
      monte_carlo_run_id:z.string().max(300).nullable().optional(),
      regime_tested:z.boolean(),
      regression_passed:z.boolean(),
      experiment_versions:z.array(z.string().regex(/^sha256:[0-9a-f]{64}$/)).max(500),
      human_candidate_approved:z.boolean(),
    },
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  }, async (payload) => {
    try { return out(evaluateStrategyCandidateGate(payload)); }
    catch (error) { return failure(error); }
  });
}
