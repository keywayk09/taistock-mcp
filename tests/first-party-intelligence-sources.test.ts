import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FIRST_PARTY_INTELLIGENCE_REGISTRY,
  queryFirstPartyIntelligenceSources,
} from "../src/v6/first-party-intelligence-sources.ts";

const source = readFileSync("src/v6/first-party-intelligence-sources.ts", "utf8");
const owner = readFileSync("src/v6/owner-content-handler.ts", "utf8");

assert.equal(FIRST_PARTY_INTELLIGENCE_REGISTRY.schema, "FIRST_PARTY_INTELLIGENCE_REGISTRY_V1");
assert.equal(FIRST_PARTY_INTELLIGENCE_REGISTRY.registry_version, "first-party-intelligence/v1.0.0");
assert.equal(FIRST_PARTY_INTELLIGENCE_REGISTRY.mode, "ON_DEMAND_ONLY");
assert.equal(FIRST_PARTY_INTELLIGENCE_REGISTRY.monitoring_enabled, false);
assert.equal(FIRST_PARTY_INTELLIGENCE_REGISTRY.persistence_enabled, false);
assert.equal(FIRST_PARTY_INTELLIGENCE_REGISTRY.read_only, true);

// Trump and technology leaders share one registry but remain separately grouped.
const trump = queryFirstPartyIntelligenceSources({ entity_id: "donald_trump" });
assert.equal(trump.count, 1);
assert.equal(trump.entities[0]?.group, "political_macro");
assert.ok(trump.entities[0]?.sources.some((item) => item.url === "https://x.com/realDonaldTrump"));
assert.ok(trump.entities[0]?.sources.some((item) => item.url === "https://truthsocial.com/@realDonaldTrump"));

const p0Tech = queryFirstPartyIntelligenceSources({ group: "technology", priority: "P0" });
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
  const entity = p0Tech.entities.find((item) => item.id === id);
  assert.ok(entity, `${id} must be in the P0 technology registry`);
  assert.ok(entity.sources.some((item) => item.platform === "x" && item.handle === handle), `${handle} must be the pinned X source`);
}

assert.ok(queryFirstPartyIntelligenceSources({ topic: "cpo" }).entities.some((item) => item.id === "jensen_huang"));
assert.equal(queryFirstPartyIntelligenceSources({ group: "political_macro" }).entities.every((item) => item.group === "political_macro"), true);

// Static registry belongs in MCP resources, not a new model-invokable action.
// This keeps the frozen modern Owner tools/list inventory at 123.
assert.match(source, /registerFirstPartyIntelligenceSourceResource/);
assert.match(source, /server\.registerResource\(/);
assert.match(source, /first-party-intelligence:\/\/registry/);
assert.doesNotMatch(source, /registerTool\(/);
assert.doesNotMatch(source, /get_first_party_intelligence_sources/);
assert.match(owner, /registerFirstPartyIntelligenceSourceResource\(this\.server\)/);

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

console.log("first-party intelligence source resource contract locked");
