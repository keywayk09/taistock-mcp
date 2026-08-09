import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  STRATEGY_CANDIDATE_SNAPSHOT,
  StrategyLabGovernanceError,
  buildStrategyValidationPlan,
  evaluateStrategyCandidateGate,
  getStrategyCandidate,
  listStrategyCandidates,
} from "../src/v6/strategy-lab-governance.ts";
import { getDiamondStrategyLabP12 } from "../src/v6/diamond-capability-p12.ts";

const exactSourceSnapshot: Record<string,string> = {
  bottom_volume:"0e032928ac9580c119e7175a43b62d98d1a6a4e1",
  box_oscillation:"eaa8c02db156d2eabf515e8a386d61e86c61b48b",
  bull_trend:"b6900db2268c81657018eaf0dc3513b62e2ef543",
  chan_theory:"362d4692034bbfc4d338552db6c5058f0f18b4a7",
  dragon_head:"4a1b6a84e977576c0c1c80d2d77ab13384035e77",
  emotion_cycle:"668942fbecf04d2ba58b24808245ee2ebe925065",
  event_driven:"1e243e9c0a82f35a43c4cf1ace2bb1ecd67ec4ba",
  expectation_repricing:"a75ee7daada54a9a08d338d6893c01b2f91642ed",
  growth_quality:"9497741567a3daf1f9fc4c56f047f1997fa59199",
  hot_theme:"f036b7ba2e7c133c0199b8ae0f7d6e652ba49241",
  ma_golden_cross:"a9256e50a8897fbf35acd11ac3715b85febc9455",
  one_yang_three_yin:"c561be32659f2fd8cce0c7bc6e8f3c5bf1bd8006",
  shrink_pullback:"d28955fa8f7b5b3bae351e4012a15ca50c2e4e6a",
  volume_breakout:"9b814c15da0bbef7d2e63da591880997d2b8eb09",
  wave_theory:"ab8ca43a111be5ebb21479c1fbc8d2f55506a07b",
};

{
  assert.equal(STRATEGY_CANDIDATE_SNAPSHOT.length,15);
  assert.deepEqual(Object.fromEntries(STRATEGY_CANDIDATE_SNAPSHOT.map((item)=>[item.strategy_id,item.source_blob_sha])),exactSourceSnapshot);
  assert.ok(STRATEGY_CANDIDATE_SNAPSHOT.every((item)=>item.source_repo==="ZhuLinsen/daily_stock_analysis"));
  assert.ok(STRATEGY_CANDIDATE_SNAPSHOT.every((item)=>item.source_license==="MIT"));
  assert.ok(STRATEGY_CANDIDATE_SNAPSHOT.every((item)=>item.source_version===`github-blob:${item.source_blob_sha}`));
  assert.ok(STRATEGY_CANDIDATE_SNAPSHOT.every((item)=>item.permitted_use==="RESEARCH_ONLY"));
  assert.ok(STRATEGY_CANDIDATE_SNAPSHOT.every((item)=>item.production_enabled===false));
  assert.ok(STRATEGY_CANDIDATE_SNAPSHOT.every((item)=>item.formalized===false));
  assert.ok(STRATEGY_CANDIDATE_SNAPSHOT.every((item)=>item.validated_on_taiwan_market===false));
}

{
  assert.equal(listStrategyCandidates("FULLY_QUANTIFIABLE_CANDIDATE").returned,5);
  assert.equal(listStrategyCandidates("SEMI_QUANTITATIVE_CANDIDATE").returned,5);
  assert.equal(listStrategyCandidates("RESEARCH_LLM_CANDIDATE").returned,5);
  assert.equal(getStrategyCandidate("volume_breakout").source_blob_sha,exactSourceSnapshot.volume_breakout);
  assert.throws(()=>getStrategyCandidate("does_not_exist"),(error:unknown)=>error instanceof StrategyLabGovernanceError&&error.code==="STRATEGY_NOT_FOUND");
}

{
  const plan=buildStrategyValidationPlan("ma_golden_cross");
  assert.equal(plan.research_mode,"DETERMINISTIC_RULE_FORMALIZATION");
  assert.equal(plan.steps.length,9);
  assert.equal(plan.steps[4].stage,"BACKTEST");
  assert.equal(plan.steps[5].stage,"ROBUSTNESS");
  assert.equal(plan.steps[6].stage,"MEMORY");
  assert.equal(plan.steps[8].stage,"CANDIDATE_GATE");
  assert.equal(plan.production_promotion,"FORBIDDEN");
  assert.equal(buildStrategyValidationPlan("event_driven").research_mode,"RESEARCH_CONTEXT_TO_HYPOTHESIS");
}

const candidate=getStrategyCandidate("volume_breakout");
const completeEvidence={
  strategy_id:candidate.strategy_id,
  source_version:candidate.source_version,
  formalization_complete:true,
  taiwan_semantic_calibrated:true,
  time_safe_data_mapping:true,
  dataset_versions:[`sha256:${"a".repeat(64)}`],
  backtest_run_ids:["btbatch:abc"],
  walk_forward_run_id:"wf:abc",
  bootstrap_run_id:"bootstrap:abc",
  monte_carlo_run_id:"mc:abc",
  regime_tested:true,
  regression_passed:true,
  experiment_versions:[`sha256:${"b".repeat(64)}`],
  human_candidate_approved:true,
};

{
  const incomplete=evaluateStrategyCandidateGate({...completeEvidence,human_candidate_approved:false,monte_carlo_run_id:null});
  assert.equal(incomplete.candidate_eligible,false);
  assert.equal(incomplete.gate_status,"VALIDATION_INCOMPLETE");
  assert.deepEqual(incomplete.failed_requirements,["MONTE_CARLO_EVIDENCE","HUMAN_CANDIDATE_GATE"]);
  assert.equal(incomplete.permitted_transition,"KEEP_RESEARCH");
  assert.equal(incomplete.production_promotion,"FORBIDDEN");
}

{
  const passed=evaluateStrategyCandidateGate(completeEvidence);
  assert.equal(passed.candidate_eligible,true);
  assert.equal(passed.gate_status,"CANDIDATE_ELIGIBLE");
  assert.equal(passed.permitted_transition,"MARK_CANDIDATE_ONLY");
  assert.equal(passed.production_promotion,"FORBIDDEN");
}

{
  assert.throws(
    ()=>evaluateStrategyCandidateGate({...completeEvidence,source_version:"github-blob:"+"0".repeat(40)}),
    (error:unknown)=>error instanceof StrategyLabGovernanceError&&error.code==="SOURCE_VERSION_MISMATCH",
  );
}

{
  const lab=getDiamondStrategyLabP12();
  assert.equal(lab.governance_status,"ACTIVE_INTERNAL");
  assert.equal(lab.source_snapshot_locked,true);
  assert.equal(lab.registered_candidate_count,15);
  assert.equal(lab.formalized_count,0);
  assert.equal(lab.validated_count,0);
  assert.equal(lab.production_enabled_count,0);
  assert.equal(lab.governance_tools.length,4);
}

{
  const source=await readFile(new URL("../src/v6/strategy-lab-governance.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/\bfetch\s*\(/,"Strategy Lab governance must not fetch external code at runtime");
  assert.doesNotMatch(source,/APPROVE_PRODUCTION|production_enabled:\s*true/,"P12 must not implement Production promotion");
  assert.match(source,/HUMAN_CANDIDATE_GATE/);
  assert.match(source,/P11_WALK_FORWARD/);
  assert.match(source,/P8_EXPERIMENT_MEMORY/);
}

console.log("P12 15-strategy source snapshot, formalization classes, validation plan, Candidate Gate and no-Production boundary passed.");
