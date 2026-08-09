import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DIAMOND_RESEARCH_LAB,
  DIAMOND_STRATEGY_LAB,
  DIAMOND_TOOL_REGISTRY,
  EXTERNAL_PROJECT_REGISTRY,
  getDiamondArchitectureStatus,
} from "../src/v6/diamond-capability-registry.ts";

const expectedStrategies = [
  "bottom_volume",
  "box_oscillation",
  "bull_trend",
  "chan_theory",
  "dragon_head",
  "emotion_cycle",
  "event_driven",
  "expectation_repricing",
  "growth_quality",
  "hot_theme",
  "ma_golden_cross",
  "one_yang_three_yin",
  "shrink_pullback",
  "volume_breakout",
  "wave_theory",
].sort();

{
  const actual = DIAMOND_STRATEGY_LAB.map((item) => item.id).sort();
  assert.deepEqual(actual, expectedStrategies, "Strategy Lab must contain exactly the verified 15 external strategy files");
  assert.equal(DIAMOND_STRATEGY_LAB.length, 15);
  assert.ok(DIAMOND_STRATEGY_LAB.every((item) => item.status === "CANDIDATE_EXTERNAL"));
  assert.ok(DIAMOND_STRATEGY_LAB.every((item) => item.validated_on_taiwan_market === false));
  assert.ok(DIAMOND_STRATEGY_LAB.every((item) => item.production_enabled === false));
  assert.ok(DIAMOND_STRATEGY_LAB.every((item) => item.required_pipeline.includes("HUMAN_APPROVAL_GATE")));
}

{
  const overseas = DIAMOND_TOOL_REGISTRY.filter((item) => item.category === "MARKET_DATA" && item.id !== "tw_ohlc");
  assert.equal(overseas.length, 9);
  assert.ok(overseas.every((item) => item.status === "CANDIDATE_EXTERNAL"));
  assert.ok(overseas.every((item) => item.gateway === "OHLC_MCP"));
  assert.ok(overseas.every((item) => item.direct_provider_access === false));
  assert.ok(overseas.every((item) => item.production_write === false));
  assert.equal(DIAMOND_TOOL_REGISTRY.find((item) => item.id === "tw_ohlc")?.status, "ACTIVE_INTERNAL");
}

{
  const active = new Map(DIAMOND_RESEARCH_LAB.filter((item) => item.status === "ACTIVE_INTERNAL").map((item) => [item.id, item]));
  for (const id of ["deterministic_5m_backtest","batch_5m_backtest","selective_1m_replay","swing_outcome_path","experiment_memory_review"]) {
    assert.ok(active.has(id), `Research Lab must expose active ${id}`);
  }
  for (const id of ["walk_forward","monte_carlo","bootstrap","benchmark","run_card","shadow_account","alpha_research"]) {
    const item = DIAMOND_RESEARCH_LAB.find((entry) => entry.id === id);
    assert.equal(item?.status, "CANDIDATE_EXTERNAL", `${id} must not be advertised as implemented`);
    assert.equal(item?.production_strategy_promotion, false);
  }
}

{
  const projects = Object.fromEntries(EXTERNAL_PROJECT_REGISTRY.map((item) => [item.project, item]));
  assert.deepEqual(projects["ZhuLinsen/daily_stock_analysis"].destination_planes, ["TOOL_REGISTRY", "STRATEGY_LAB"]);
  assert.deepEqual(projects["HKUDS/Vibe-Trading"].destination_planes, ["TOOL_REGISTRY", "RESEARCH_VALIDATION_LAB"]);
  assert.equal(projects["mattpocock/skills"].code_import_policy, "AI_TOOLBOX_ONLY");
  assert.equal(projects["PrimeIntellect-ai/prime-agent"].status, "SANDBOX_ONLY");
}

{
  const architecture = getDiamondArchitectureStatus();
  assert.equal(architecture.hard_boundaries.ohlc_gateway, "OHLC_MCP_ONLY");
  assert.equal(architecture.hard_boundaries.research_ohlc_access, "READ_ONLY");
  assert.equal(architecture.hard_boundaries.strategy_auto_promotion, false);
  assert.equal(architecture.counts.strategy_candidates, 15);
}

{
  const source = await readFile(new URL("../src/v6/diamond-capability-registry.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(/, "registry must never fetch external providers directly");
  assert.doesNotMatch(source, /GITHUB_TOKEN|FUGLE_API_KEY|API_KEY\s*=/, "registry must not own provider secrets");
  assert.match(source, /OHLC_MCP_ONLY/);
  assert.match(source, /NO_DIRECT_BULK_IMPORT/);
}

console.log("Diamond Tool Registry, Research Lab, Strategy Lab, and external-integration boundaries passed.");
