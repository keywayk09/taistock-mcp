import assert from "node:assert/strict";
import { buildReviewInterpretation, selectSwingCandidates, summarizeReviewRows } from "../src/v6/review-orchestrator.ts";

const summary = summarizeReviewRows([
  {market:"tw-stock",signal_id:"a",signal_version:"1",strategy:"S2",side:"SHORT",net_return_pct:1,mfe_pct:2,mae_pct:-0.4,ambiguous_intrabar:false,requires_1m_replay:false},
  {market:"tw-stock",signal_id:"b",signal_version:"1",strategy:"S2",side:"SHORT",net_return_pct:-0.5,mfe_pct:0.3,mae_pct:-1.1,ambiguous_intrabar:true,requires_1m_replay:true},
  {market:"txf",signal_id:"c",signal_version:"1",strategy:"TX1",side:"LONG",net_points:20,mfe_points:35,mae_points:8,ambiguous_intrabar:false,requires_1m_replay:false},
]);
assert.equal(summary.count,3);
assert.equal(summary.evaluated_count,3);
assert.equal(summary.wins,2);
assert.equal(summary.losses,1);
assert.equal(summary.ambiguous_count,1);
assert.equal(summary.breakdown.length,2);
const view=buildReviewInterpretation(summary);
assert.ok(Array.isArray(view.observations));
assert.equal(view.policy,"REVIEW_ONLY_NO_AUTO_STRATEGY_CHANGE");

const selected=selectSwingCandidates([
  {signal_id:"s1",signal_version:"v1",symbol:"2330",trade_date:"2026-08-07",side:"LONG",strategy:"L2",signal_ts_ms:1,payload:{diamond_score:82}},
  {signal_id:"s2",signal_version:"v1",symbol:"2330",trade_date:"2026-08-07",side:"LONG",strategy:"L2",signal_ts_ms:2,payload:{diamond_score:88}},
  {signal_id:"s3",signal_version:"v1",symbol:"2454",trade_date:"2026-08-07",side:"LONG",strategy:"L1",signal_ts_ms:3,payload:{probability:0.91}},
  {signal_id:"s4",signal_version:"v1",symbol:"2317",trade_date:"2026-08-07",side:"NEUTRAL",strategy:"X",signal_ts_ms:4,payload:{diamond_score:99}},
],10);
assert.equal(selected.length,2);
assert.equal(selected[0].symbol,"2454");
assert.equal(selected[0].score,91);
assert.equal(selected[1].symbol,"2330");
assert.equal(selected[1].signal_id,"s2");

console.log("P15 review orchestration core tests passed.");
