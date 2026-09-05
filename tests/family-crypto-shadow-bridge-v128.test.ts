// Family MCP -> Crypto Engine V1.3.0 Shadow bridge acceptance.
//
// This test intentionally exercises the exact shared crypto handlers registered
// by FamilyMCP while injecting a Shadow-only CRYPTO_ENGINE_BASE_URL. It never
// changes OAuth, Production routing, strategy parameters, or any write surface.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  registerSharedCryptoMarketTools,
  SHARED_CRYPTO_TOOL_NAMES,
} from "../src/v6/shared-crypto-market-tools.ts";

const previewBase = String(process.env.CRYPTO_ENGINE_SHADOW_URL || "").replace(/\/+$/, "");
assert.ok(previewBase.startsWith("https://"), "CRYPTO_ENGINE_SHADOW_URL must point to an HTTPS Shadow Preview");

// FamilyMCP registers the shared crypto handlers directly. Capture those exact
// handlers without opening a local unauthenticated MCP endpoint or weakening the
// Family OAuth boundary.
const registered = new Map<string, { config: any; handler: (...args: any[]) => Promise<any> }>();
const fakeServer = {
  registerTool(name: string, config: any, handler: (...args: any[]) => Promise<any>) {
    registered.set(name, { config, handler });
  },
};

const env = { CRYPTO_ENGINE_BASE_URL: previewBase } as any;
registerSharedCryptoMarketTools(fakeServer as any, env);

assert.deepEqual([...registered.keys()], [...SHARED_CRYPTO_TOOL_NAMES]);
assert.deepEqual([...SHARED_CRYPTO_TOOL_NAMES], [
  "get_crypto_engine_status",
  "get_crypto_candidates",
  "get_crypto_deep_probe",
]);

// Static registration checks prove these exact shared handlers are exposed by
// FamilyMCP; no duplicate Family crypto implementation is allowed.
const familySource = fs.readFileSync(path.resolve("src/v6/family-mcp.ts"), "utf8");
assert.match(familySource, /\.\.\.SHARED_CRYPTO_TOOL_NAMES/);
assert.match(familySource, /registerSharedCryptoMarketTools\(this\.server, this\.env\)/);
assert.match(familySource, /TV_CRYPTO_ENGINE_KUCOIN_MEXC_PRICE_KUCOIN_GATE_OI_READ_ONLY/);
assert.doesNotMatch(familySource, /TV_CRYPTO_ENGINE_BYBIT_GATE_5M_LOCAL15M_OI_READ_ONLY/);

function unwrapToolResult(result: any) {
  assert.ok(result && Array.isArray(result.content) && result.content.length > 0, result);
  const text = result.content.find((item: any) => item?.type === "text")?.text;
  assert.equal(typeof text, "string", result);
  return JSON.parse(text);
}

async function invoke(name: string, input: any = {}) {
  const tool = registered.get(name);
  assert.ok(tool, `missing registered tool: ${name}`);
  return unwrapToolResult(await tool.handler(input));
}

function assertReadOnlyEnvelope(value: any, endpoint: string) {
  assert.equal(value?.ok, true, value);
  assert.equal(value?.http_status, 200, value);
  assert.equal(value?.source, "tv-crypto-engine", value);
  assert.equal(value?.read_only, true, value);
  assert.equal(value?.endpoint, endpoint, value);
  assert.ok(value?.payload && typeof value.payload === "object", value);
}

function assertNoLegacyBybit(value: any) {
  const serialized = JSON.stringify(value).toLowerCase();
  for (const forbidden of [
    "api.bybit.com",
    "api.bytick.com",
    "bybit_kline_5m",
    "bybit_oi_5m",
    "bybit_1h",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `legacy source leaked: ${forbidden}`);
  }
}

// 1) Family status bridge must resolve the injected V1.3.0 Shadow, not the
// default Production URL.
const status = await invoke("get_crypto_engine_status");
assertReadOnlyEnvelope(status, "/health");
assert.equal(status.payload.version, "1.3.0-shadow", status);
assert.equal(status.payload.production_promotion, false, status);
assert.equal(status.payload.source_reliability_repair?.gate_candlestick_in_data_path, false, status);
assertNoLegacyBybit(status);

// 2) Stable bridge must preserve mandatory MTF and its fail-closed semantics.
// A newly listed contract is allowed to remain visible diagnostically when it
// lacks enough dual-exchange 1D history, but it must be demoted below watch.
const stable = await invoke("get_crypto_candidates", {
  profile: "stable_quality",
  setup: "all",
  per_side: 1,
  light_limit: 12,
});
assertReadOnlyEnvelope(stable, "/market/candidate-scan");
assert.equal(stable.payload.core_pipeline_ok, true, stable);
const tele = stable.payload.market_participation_shadow || {};
assert.equal(tele.mode, "forward_shadow_observation_only", tele);
assert.equal(tele.added_market_requests, 0, tele);
assert.equal(tele.threshold, null, tele);
assert.equal(tele.decision_effect, "none", tele);
assert.equal(tele.source_health?.required_pair_ok, true, tele);
for (const candidate of stable.payload.candidates || []) {
  const mtf = candidate.multi_timeframe || {};
  assert.equal(mtf.mandatory, true, candidate);
  if (mtf.higher_timeframes_available === false) {
    assert.equal(["watch", "strong_watch"].includes(candidate.final_stage), false, candidate);
    assert.equal(mtf.alignment, "unavailable", candidate);
  } else {
    assert.equal(mtf.higher_timeframes_available, true, candidate);
  }
  if (candidate.selected_side === "short") {
    assert.equal(candidate.research_actionability, "observation_only", candidate);
  }
}
assertNoLegacyBybit(stable);

// 3) Volatile bridge keeps KuCoin+Gate light discovery while price confirmation
// uses KuCoin+MEXC and SHORT remains observation-only.
const volatile = await invoke("get_crypto_candidates", {
  profile: "volatile",
  setup: "all",
  per_side: 1,
  light_limit: 30,
});
assertReadOnlyEnvelope(volatile, "/market/candidate-scan");
assert.equal(volatile.payload.profile, "volatile", volatile);
assert.equal(volatile.payload.production_promotion, false, volatile);
assert.equal(volatile.payload.source_repair?.replacement, "kucoin", volatile);
assert.deepEqual(volatile.payload.policy?.required_exchanges, ["kucoin", "gate"], volatile);
assert.equal(volatile.payload.policy?.symmetric_short_actionable, false, volatile);
for (const candidate of volatile.payload.candidates || []) {
  const mtf = candidate.multi_timeframe || {};
  assert.equal(mtf.mandatory, true, candidate);
  if (mtf.higher_timeframes_available === false) {
    assert.equal(candidate.setup, "unclassified", candidate);
    assert.equal(candidate.action_state, "wait_higher_timeframe_context", candidate);
  }
  if (candidate.side === "short") {
    assert.equal(candidate.research_actionability, "observation_only", candidate);
  }
}
assertNoLegacyBybit(volatile);

// 4) Direct Family deep probe must correctly resolve BONK's multiplier contract
// even though the public MCP tool accepts only canonical coin symbols.
const deep = await invoke("get_crypto_deep_probe", { symbols: ["BONK"] });
assertReadOnlyEnvelope(deep, "/market/deep-probe");
assert.equal(deep.payload.ok, true, deep);
const rows = deep.payload.results || [];
assert.equal(rows.length, 1, deep);
const bonk = rows[0];
assert.equal(bonk.base, "BONK", bonk);
assert.equal(bonk.kucoin_symbol, "1000BONKUSDTM", bonk);
assert.equal(bonk.complete, true, bonk);
assert.equal(bonk.requests_passed, 4, bonk);
assert.equal(bonk.requests_total, 4, bonk);
const deepIds = new Set((bonk.request_status || []).map((item: any) => item.id));
assert.deepEqual(deepIds, new Set([
  "kucoin_kline_5m",
  "mexc_kline_5m",
  "kucoin_oi_5m",
  "gate_oi_5m",
]));
const mtf = bonk.multi_timeframe || {};
assert.equal(mtf.mandatory, true, bonk);
assert.equal(mtf.higher_timeframes_available, true, bonk);
assert.equal(mtf.higher_context?.kucoin_symbol, "1000BONKUSDTM", bonk);
assert.equal(mtf.higher_context?.mexc_symbol, "1000BONK_USDT", bonk);
assert.equal(mtf.higher_context?.requests_total, 2, bonk);
const higherIds = new Set((mtf.higher_context?.request_status || []).map((item: any) => item.id));
assert.deepEqual(higherIds, new Set(["kucoin_1h", "mexc_1h"]));
assertNoLegacyBybit(deep);

console.log(JSON.stringify({
  result: "PASS_FAMILY_CRYPTO_V130_SHADOW_BRIDGE",
  family_tools: [...SHARED_CRYPTO_TOOL_NAMES],
  engine_version: status.payload.version,
  stable_candidates: (stable.payload.candidates || []).length,
  stable_market_universe: tele.universe?.eligible_count ?? null,
  volatile_candidates: (volatile.payload.candidates || []).length,
  volatile_bulk_worst_case: volatile.payload.subrequest_budget?.volatile_bulk_worst_case ?? null,
  bonk_kucoin_symbol: bonk.kucoin_symbol,
  bonk_mexc_symbol: mtf.higher_context?.mexc_symbol,
  production_promotion: false,
}, null, 2));
