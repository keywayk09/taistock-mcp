import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ResearchValidationError,
  runBootstrapValidation,
  runMonteCarloValidation,
  runResearchValidationSuite,
  runWalkForwardValidation,
} from "./research-validation";

const tradeSchema = z.object({
  case_id: z.string().min(1).max(240),
  trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  net_return_pct: z.number().finite().gt(-100),
});

const candidateSchema = z.object({
  candidate_id: z.string().min(1).max(240),
  parameter_version: z.string().min(1).max(160),
  strategy_version: z.string().min(1).max(160).optional(),
  trades: z.array(tradeSchema).min(1).max(20000),
});

const walkForwardConfig = z.object({
  train_size: z.number().int().min(5).max(100000),
  test_size: z.number().int().min(1).max(100000),
  step_size: z.number().int().min(1).max(100000).optional(),
  selection_metric: z.enum(["expectancy_pct", "profit_factor"]).optional().default("expectancy_pct"),
});

const stochasticConfig = z.object({
  iterations: z.number().int().min(100).max(5000).optional().default(1000),
  seed: z.string().max(500).optional(),
});

const result = (value: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

function failure(error: unknown) {
  if (error instanceof ResearchValidationError) {
    return result({ ok:false, status:error.code, error:error.message, detail:error.detail ?? null }, true);
  }
  return result({ ok:false, status:"RESEARCH_VALIDATION_INTERNAL_ERROR", error:error instanceof Error ? error.message : String(error) }, true);
}

export function registerResearchValidationTools(server: McpServer) {
  server.registerTool("run_walk_forward_validation", {
    description: [
      "P11 Walk-Forward 驗證。輸入多組已由相同 case set 回測出的 Candidate/Parameter 結果，",
      "每一 Fold 只使用 Train Window 選 Candidate，再只在後續 Test Window 評估，禁止未來資料回流。",
      "輸出 OOS metrics、每 Fold 選擇與 selection stability。此工具不做 Production 策略升級。",
    ].join(" "),
    inputSchema: {
      candidates: z.array(candidateSchema).min(1).max(100),
      train_size: walkForwardConfig.shape.train_size,
      test_size: walkForwardConfig.shape.test_size,
      step_size: walkForwardConfig.shape.step_size,
      selection_metric: walkForwardConfig.shape.selection_metric,
    },
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async (payload) => {
    try { return result(await runWalkForwardValidation(payload)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("run_bootstrap_validation", {
    description: "P11 Bootstrap：對固定交易結果做 seeded bootstrap resampling，輸出 expectancy/PF/compound return 分布與正期望/PF>1 機率。Seed 明確或由 immutable input 派生，結果可重現。",
    inputSchema: {
      trades: z.array(tradeSchema).min(1).max(20000),
      iterations: stochasticConfig.shape.iterations,
      seed: stochasticConfig.shape.seed,
    },
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async (payload) => {
    try { return result(await runBootstrapValidation(payload)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("run_monte_carlo_validation", {
    description: "P11 Monte Carlo：以 seeded return-sequence permutation 重排固定交易報酬，評估 Max Drawdown 與最長連敗的順序風險分布；不改變原始交易集合。",
    inputSchema: {
      trades: z.array(tradeSchema).min(1).max(20000),
      iterations: stochasticConfig.shape.iterations,
      seed: stochasticConfig.shape.seed,
    },
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async (payload) => {
    try { return result(await runMonteCarloValidation(payload)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("run_research_validation_suite", {
    description: "P11 Research Validation Suite：對 primary candidate 一次執行 Bootstrap + Monte Carlo，若提供 aligned candidates 則再執行 Walk-Forward。所有結果 deterministic/versioned，建議寫入 P8 Experiment Memory，但不自動升級策略。",
    inputSchema: {
      primary: candidateSchema,
      walk_forward_candidates: z.array(candidateSchema).min(1).max(100).optional(),
      walk_forward: walkForwardConfig.optional(),
      bootstrap: stochasticConfig.optional(),
      monte_carlo: stochasticConfig.optional(),
    },
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async (payload) => {
    try { return result(await runResearchValidationSuite(payload)); }
    catch (error) { return failure(error); }
  });
}
