import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Red/green contract for the unified, on-demand first-party source layer.
// This intentionally reads the implementation file so the test fails before
// the registry exists.
const source = readFileSync("src/v6/first-party-intelligence-sources.ts", "utf8");
const owner = readFileSync("src/v6/owner-content-handler.ts", "utf8");

assert.match(source, /FIRST_PARTY_INTELLIGENCE_REGISTRY_V1/);
assert.match(source, /first-party-intelligence\/v1\.0\.0/);
assert.match(source, /ON_DEMAND_ONLY/);
assert.match(source, /monitoring_enabled:\s*false/);
assert.match(source, /persistence_enabled:\s*false/);
assert.match(source, /read_only:\s*true/);

// Trump and technology leaders share one registry but remain separately grouped.
assert.match(source, /political_macro/);
assert.match(source, /technology/);
assert.match(source, /donald_trump/);
assert.match(source, /realDonaldTrump/);
assert.match(source, /truthsocial\.com\/\@realDonaldTrump/);

for (const [id, handle] of [
  ["jensen_huang", "JensenHuang"],
  ["lisa_su", "LisaSu"],
  ["sam_altman", "sama"],
  ["satya_nadella", "satyanadella"],
  ["sundar_pichai", "sundarpichai"],
  ["demis_hassabis", "demishassabis"],
  ["elon_musk", "elonmusk"],
  ["michael_dell", "MichaelDell"],
  ["tim_cook", "tim_cook"],
] as const) {
  assert.ok(source.includes(id), `${id} must be in the registry`);
  assert.ok(source.includes(handle), `${handle} must be an official X source`);
}

// The source layer is metadata/query only: no polling, timers, cron, writes,
// secrets, order execution, or OHLC mutation paths.
for (const forbidden of [
  "setInterval(",
  "setTimeout(",
  "scheduled(",
  "cron",
  "KV.put",
  ".put(",
  "INSERT ",
  "UPDATE ",
  "DELETE ",
  "place_order",
  "submit_order",
  "PIPELINE_WRITE_ENABLED",
]) {
  assert.ok(!source.includes(forbidden), `forbidden active behavior in source registry: ${forbidden}`);
}

assert.match(source, /registerFirstPartyIntelligenceSourceTool/);
assert.match(source, /get_first_party_intelligence_sources/);
assert.match(owner, /registerFirstPartyIntelligenceSourceTool/);

console.log("first-party intelligence source contract locked");
