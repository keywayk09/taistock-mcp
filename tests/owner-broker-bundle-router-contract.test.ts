import assert from "node:assert/strict";
import fs from "node:fs";

const ownerSource = fs.readFileSync("src/v6/legacy-owner-chip-tools.ts", "utf8");

assert.match(ownerSource, /registerTool\("get_broker_chips"/);
assert.match(ownerSource, /getTwBrokerProviderBundleOnDemand/);
assert.doesNotMatch(
  ownerSource,
  /getTwBrokerRankedWindowBundleOnDemand/,
  "frozen Owner broker tool must not bypass the whole-provider router",
);
assert.match(ownerSource, /windows:\s*\[1,\s*5,\s*10,\s*20,\s*60\]/);
assert.match(ownerSource, /same_provider_required:\s*true/);
assert.match(ownerSource, /cross_source_backfill_allowed:\s*false/);
assert.match(ownerSource, /cross_provider_window_mixing:\s*false/);
assert.match(ownerSource, /broker_identity_attribution_allowed:\s*false/);
assert.match(ownerSource, /NESTED_WINDOWS_SAME_END_DATE_NOT_TIME_SERIES/);

const brokerBlock = ownerSource.match(
  /registerTool\("get_broker_chips",[\s\S]*?inputSchema:\s*\{([\s\S]*?)\n\s*\},\n\s*annotations:/,
)?.[1];
assert.ok(brokerBlock, "frozen get_broker_chips schema must remain discoverable");
assert.match(brokerBlock, /symbol:\s*symbolSchema/);
assert.match(brokerBlock, /date:\s*dateSchema/);
assert.match(brokerBlock, /top_n:/);
assert.doesNotMatch(brokerBlock, /windows?|provider|period/i, "do not change frozen Owner broker input schema");

console.log("Owner frozen broker tool whole-provider bundle contract passed");
