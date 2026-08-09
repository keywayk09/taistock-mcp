import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ResearchValidationError,
  runBootstrapValidation,
  runMonteCarloValidation,
  runResearchValidationSuite,
  runWalkForwardValidation,
  summarizeValidationReturns,
} from "../src/v6/research-validation.ts";
import { getDiamondResearchLabP11 } from "../src/v6/diamond-capability-p11.ts";

function trades(values: number[]) {
  return values.map((net_return_pct, index) => ({
    case_id: `c${String(index + 1).padStart(2, "0")}`,
    trade_date: `2026-07-${String(index + 1).padStart(2, "0")}`,
    net_return_pct,
  }));
}

const candidateA = {
  candidate_id: "A",
  parameter_version: "sha256:" + "a".repeat(64),
  trades: trades([1.2,1.1,1.0,0.9,0.8, -0.5,-0.4, -0.3,-0.2, 0.1,0.2,0.3]),
};
const candidateB = {
  candidate_id: "B",
  parameter_version: "sha256:" + "b".repeat(64),
  trades: trades([0.2,0.1,0.3,0.2,0.1, 0.9,1.0, 1.1,1.2, 0.8,0.7,0.6]),
};

{
  const metrics = summarizeValidationReturns([1,-0.5,2,-1]);
  assert.equal(metrics.count,4);
  assert.equal(metrics.wins,2);
  assert.equal(metrics.losses,2);
  assert.equal(metrics.expectancy_pct,0.375);
  assert.ok((metrics.profit_factor ?? 0) > 1);
  assert.ok(metrics.max_drawdown_pct > 0);
}

{
  const input = { candidates:[candidateA,candidateB], train_size:5, test_size:2, step_size:2, selection_metric:"expectancy_pct" as const };
  const a = await runWalkForwardValidation(input);
  const b = await runWalkForwardValidation(input);
  assert.deepEqual(a,b,"Walk-Forward must be deterministic");
  assert.equal(a.no_lookahead,true);
  assert.equal(a.fold_count,3);
  assert.equal(a.folds[0].selected_candidate_id,"A","first train window should select A");
  assert.equal(a.folds[1].selected_candidate_id,"B","second train window legitimately selects B from only its own past train window");
  assert.equal(a.folds[2].selected_candidate_id,"B","later train evidence continues to select B without seeing its future test rows");
  assert.equal(a.production_promotion,"FORBIDDEN");
  for (const fold of a.folds) {
    assert.ok(String(fold.train_end) < String(fold.test_start),"every fold must have strict train-before-test ordering");
  }
}

{
  await assert.rejects(
    runWalkForwardValidation({
      candidates:[candidateA,{...candidateB,trades:candidateB.trades.slice(1)}],
      train_size:5,
      test_size:2,
    }),
    (error:unknown)=>error instanceof ResearchValidationError&&error.code==="CANDIDATE_CASESET_MISMATCH",
  );
}

{
  const input = { trades:candidateB.trades, iterations:300, seed:"fixed-bootstrap-seed" };
  const a = await runBootstrapValidation(input);
  const b = await runBootstrapValidation(input);
  assert.deepEqual(a,b,"Bootstrap must be reproducible with the same seed/input");
  assert.equal(a.iterations,300);
  assert.match(a.seed_hash,/^[0-9a-f]{64}$/);
  assert.ok(a.probability_expectancy_positive >= 0 && a.probability_expectancy_positive <= 1);
  assert.ok(a.expectancy_pct_distribution.p05 <= a.expectancy_pct_distribution.p50);
  assert.ok(a.expectancy_pct_distribution.p50 <= a.expectancy_pct_distribution.p95);
  const changed = await runBootstrapValidation({ ...input, seed:"other-seed" });
  assert.notEqual(changed.validation_run_id,a.validation_run_id,"seed must be part of immutable validation identity");
}

{
  const input = { trades:trades([2,-1,1.5,-0.8,0.7,-0.4,1.1,-0.2]), iterations:300, seed:"fixed-mc-seed" };
  const a = await runMonteCarloValidation(input);
  const b = await runMonteCarloValidation(input);
  assert.deepEqual(a,b,"Monte Carlo must be reproducible with the same seed/input");
  assert.equal(a.method,"RETURN_SEQUENCE_PERMUTATION");
  assert.ok(a.max_drawdown_pct_distribution.p95 >= a.max_drawdown_pct_distribution.p50);
  assert.ok(a.longest_losing_streak_distribution.p95 >= a.longest_losing_streak_distribution.p50);
  assert.ok(a.compounded_return_invariant_tolerance_pct < 1e-8,"permutation must preserve compounded terminal return except tiny floating error");
  assert.equal(a.production_promotion,"FORBIDDEN");
}

{
  const suite = await runResearchValidationSuite({
    primary:candidateB,
    walk_forward_candidates:[candidateA,candidateB],
    walk_forward:{train_size:5,test_size:2,step_size:2},
    bootstrap:{iterations:200,seed:"suite-b"},
    monte_carlo:{iterations:200,seed:"suite-m"},
  });
  assert.equal(suite.deterministic,true);
  assert.ok(suite.walk_forward);
  assert.equal(suite.experiment_memory_recommended,true);
  assert.equal(suite.production_promotion,"FORBIDDEN");
  assert.match(suite.validation_suite_id,/^validation:[0-9a-f]{64}$/);
}

{
  const lab = getDiamondResearchLabP11();
  const active = new Map(lab.capabilities.filter((x)=>x.status==="ACTIVE_INTERNAL").map((x)=>[x.id,x]));
  assert.equal(active.get("walk_forward")?.current_tool,"run_walk_forward_validation");
  assert.equal(active.get("bootstrap")?.current_tool,"run_bootstrap_validation");
  assert.equal(active.get("monte_carlo")?.current_tool,"run_monte_carlo_validation");
  assert.equal(lab.validation_suite_tool,"run_research_validation_suite");
  assert.equal(lab.active_count,8);
  assert.equal(lab.candidate_count,4);
}

{
  const source = await readFile(new URL("../src/v6/research-validation.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/Math\.random\s*\(/,"validation randomness must be seeded/deterministic");
  assert.doesNotMatch(source,/\bfetch\s*\(/,"validation engine must not fetch market data");
  assert.match(source,/production_promotion:\s*"FORBIDDEN"/);
  assert.match(source,/start \+ trainSize \+ testSize <= total/,"Walk-Forward must use explicit chronological train/test windows");
}

console.log("P11 Walk-Forward, Bootstrap, Monte Carlo, suite identity, and Diamond Research Lab activation tests passed.");
