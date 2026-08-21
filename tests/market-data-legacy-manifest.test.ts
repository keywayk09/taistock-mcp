import assert from "node:assert/strict";
import { promoteLegacyCompleteManifest } from "../src/v6/market-data-legacy-manifest.ts";

const layers = Array.from({ length: 8 }, (_, index) => ({
  kind: `kind-${index}`,
  market: index % 2 ? "otc" : "listed",
  status: "READY",
  snapshot_path: `snapshot-${index}.json`,
}));

const legacy = {
  schema_version: "diamond-market-data-manifest/v2",
  storage: "GITHUB_ONLY",
  trade_date: "2026-08-19",
  layers,
  updated_at: "2026-08-20T05:24:48.064Z",
};

const promoted = promoteLegacyCompleteManifest(legacy, "2026-08-21T12:35:00.000Z");
assert.ok(promoted);
assert.equal(promoted!.day_status, "COMPLETE");
assert.equal(promoted!.terminal, true);
assert.equal(promoted!.ready_layers, 8);
assert.deepEqual(promoted!.missing_layers, []);
assert.equal(promoted!.index_state.status, "PENDING");
assert.deepEqual(promoted!.index_state.completed_prefixes, []);

assert.equal(promoteLegacyCompleteManifest({ ...legacy, layers: layers.slice(0, 7) }, "2026-08-21T12:35:00.000Z"), null);
assert.equal(promoteLegacyCompleteManifest({ ...legacy, terminal: true, day_status: "COMPLETE" }, "2026-08-21T12:35:00.000Z"), null);

console.log("market-data legacy complete manifest promotion tests passed");
