import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), "utf8");
const exists = (relative: string) => fs.existsSync(path.join(repoRoot, relative));

const SEALED_SOURCE_SHA = "bc77effcee66c773fc529df864b1acd33641107f";
const BRANCH = "refactor/research-vnext-foundation-20260901";
const OLD_BRIDGE = ".github/workflows/research-vnext-production-control-plane-one-shot.yml";
const OLD_AUTH = "runtime/research-vnext-production-control-plane-one-shot-authorization.json";
const RECAPTURE_BRIDGE = ".github/workflows/research-vnext-production-control-plane-one-shot-recapture.yml";
const RECAPTURE_AUTH = "runtime/research-vnext-production-control-plane-one-shot-recapture-authorization.json";
const RECAPTURE_NOTE = "docs/change-notes/2026-09-01-research-vnext-production-control-plane-live-recapture.md";

const fixture = JSON.parse(read("tests/fixtures/research-vnext-public-abi-snapshot.json"));
assert.equal(fixture.owner_tool_count, 123);
assert.equal(
  fixture.owner_abi_sha256,
  "00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d",
);

assert.equal(exists(OLD_BRIDGE), false, "first temporary bridge must remain cleaned");
assert.equal(exists(OLD_AUTH), false, "first one-shot authorization must remain cleaned");

const completeness = read("src/v6/research-vnext/production-control-plane-snapshot.ts");
assert.match(completeness, /token_leak:\s*false/);

const canonical = read(".github/workflows/research-vnext-production-control-plane-live-snapshot.yml");
assert.match(canonical, /workflow_dispatch:/);
assert.doesNotMatch(canonical, /^\s*(push|pull_request|schedule):/m);
assert.match(canonical, /READ_ONLY_PRODUCTION_CONTROL_PLANE_SNAPSHOT/);
assert.doesNotMatch(canonical, /-X\s+(POST|PUT|PATCH|DELETE)/i);
assert.doesNotMatch(canonical, /wrangler\s+(deploy|rollback)/i);

const liveScript = read("scripts/research-vnext-production-control-plane-live-snapshot.mjs");
assert.match(liveScript, /method:\s*"GET"/);
assert.doesNotMatch(liveScript, /method:\s*"(POST|PUT|PATCH|DELETE)"/i);
assert.doesNotMatch(liveScript, /wrangler\s+(deploy|rollback)/i);

const note = read(RECAPTURE_NOTE);
assert.match(note, new RegExp(SEALED_SOURCE_SHA));
assert.match(note, /Research VNext Incremental Gate Run `33530324815`: `SUCCESS`/);
assert.match(note, /Type check Run `33530324826`: `SUCCESS`/);
assert.match(note, /Research VNext Isolation Gate Run `33530324829`: `SUCCESS`/);
assert.match(note, /Production deploy authorized: `false`/);
assert.match(note, /Production mutation: `NONE`/);

const recaptureBridgePresent = exists(RECAPTURE_BRIDGE);
const recaptureAuthPresent = exists(RECAPTURE_AUTH);

if (recaptureBridgePresent) {
  const workflow = read(RECAPTURE_BRIDGE);
  assert.match(workflow, /push:/);
  assert.match(workflow, new RegExp(BRANCH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(workflow, new RegExp(RECAPTURE_AUTH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
  assert.match(workflow, new RegExp(SEALED_SOURCE_SHA));
  assert.match(workflow, /READ_ONLY_PRODUCTION_CONTROL_PLANE_SNAPSHOT/);
  assert.match(workflow, /path:\s*sealed/);
  assert.match(workflow, /sealed\/scripts\/research-vnext-production-control-plane-live-snapshot\.mjs/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(
    workflow,
    /CLOUDFLARE_API_TOKEN:\s*\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN\s*\}\}/,
  );
  assert.match(
    workflow,
    /CLOUDFLARE_ACCOUNT_ID:\s*\$\{\{\s*secrets\.CLOUDFLARE_ACCOUNT_ID\s*\}\}/,
  );
  assert.doesNotMatch(
    workflow,
    /curl\b|\bgh\s|wrangler\s+(deploy|rollback)|-X\s+(POST|PUT|PATCH|DELETE)/i,
  );

  if (recaptureAuthPresent) {
    const auth = JSON.parse(read(RECAPTURE_AUTH));
    assert.equal(
      auth.schema,
      "RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_ONE_SHOT_RECAPTURE_AUTH_V1",
    );
    assert.equal(auth.mode, "READ_ONLY_PRODUCTION_CONTROL_PLANE_SNAPSHOT");
    assert.equal(auth.source_sha, SEALED_SOURCE_SHA);
    assert.equal(auth.production_deploy_authorized, false);
    assert.equal(auth.production_mutation, "NONE");
  }

  console.log(JSON.stringify({
    schema: "RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_LIVE_RECAPTURE_BRIDGE_TEST_V2",
    status: "PASS",
    lifecycle: recaptureAuthPresent ? "AUTHORIZED_ONE_SHOT" : "SEALED_UNTRIGGERED",
    trigger_scope: "EXACT_BRANCH_PLUS_RECAPTURE_AUTHORIZATION_PATH",
    source_execution: "PINNED_CORRECTED_SEALED_SHA",
    cloudflare_method_surface: "SEALED_CLIENT_GET_ONLY",
    owner_tool_count: fixture.owner_tool_count,
    owner_abi_sha256: fixture.owner_abi_sha256,
    production_deploy_authorized: false,
    production_mutation: "NONE",
  }, null, 2));
} else {
  // Post-live cleanup is valid only when the one-shot authorization is also gone
  // and the immutable live + cleanup evidence has been recorded in the Change Note.
  assert.equal(
    recaptureAuthPresent,
    false,
    "recapture authorization must be absent after temporary bridge cleanup",
  );

  assert.match(note, /Bridge seal commit: `3be195dc5e2ccffa3ec693abbaf53f4818368e43`/);
  assert.match(note, /Research VNext Incremental Gate Run `33531169692`: `SUCCESS`/);
  assert.match(note, /Type check Run `33531169619`: `SUCCESS`/);
  assert.match(note, /Research VNext Isolation Gate Run `33531169596`: `SUCCESS`/);

  assert.match(note, /Authorization commit: `9e60b241635bcffc706e537455598b3ff2431b9f`/);
  assert.match(note, /Recapture Run `33531322196`: `SUCCESS`/);
  assert.match(note, /Artifact ID: `9809833837`/);
  assert.match(
    note,
    /Artifact digest: `sha256:9f4ddd0bc0f0b877208a6f605bb73e086aa27528885ef4c62c96cb3f1146de6f`/,
  );
  assert.match(note, /Receipt status: `READ_ONLY_SNAPSHOT_VALID`/);
  assert.match(note, /token_leak: `false`/);
  assert.match(note, /read_only_capture: `true`/);
  assert.match(note, /active version: `75f989b9-e798-4d32-a95f-7253b4e703ec`/);
  assert.match(note, /cron: `\*\/5 \* \* \* \*`/);
  assert.match(note, /rollback target: `75f989b9-e798-4d32-a95f-7253b4e703ec`/);

  assert.match(note, /Workflow cleanup commit: `0ed451a027e44ed881ce7377c05d5159c3434a00`/);
  assert.match(note, /Authorization cleanup commit: `2df63f1da0dc75765cb8ea9639df50f3f36982c6`/);
  assert.match(note, /Research VNext Incremental Gate Run `33531433136`: `FAILURE`/);
  assert.match(note, /Type check Run `33531433218`: `SUCCESS`/);
  assert.match(note, /Research VNext Isolation Gate Run `33531433148`: `FAILURE`/);
  assert.match(note, /Isolation FAMILY \/ MARKET_DATA \/ FORMAL_BLIND \/ OWNER_OPS \/ BUNDLE: `SUCCESS`/);
  assert.match(note, /Isolation VNEXT: `FAILURE`/);
  assert.match(
    note,
    /PRODUCTION_CONTROL_PLANE_LIVE_RECAPTURE_CLEANUP_RED_ACCEPTED_GREEN_IMPLEMENTATION_ALLOWED/,
  );

  console.log("PRODUCTION_CONTROL_PLANE_LIVE_RECAPTURE_CLEANUP_LIFECYCLE=PASS");
  console.log(JSON.stringify({
    schema: "RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_LIVE_RECAPTURE_CLEANUP_TEST_V1",
    status: "PASS",
    lifecycle: "LIVE_RECEIPT_CAPTURED_TEMPORARY_BRIDGE_CLEANED",
    corrected_sealed_source_sha: SEALED_SOURCE_SHA,
    live_run: 33531322196,
    token_leak: false,
    temporary_bridge: "ABSENT",
    authorization: "ABSENT",
    owner_tool_count: fixture.owner_tool_count,
    owner_abi_sha256: fixture.owner_abi_sha256,
    production_deploy_authorized: false,
    production_mutation: "NONE",
  }, null, 2));
}
