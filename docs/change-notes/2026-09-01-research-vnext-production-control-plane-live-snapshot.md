# Change Note — Research VNext Production Control-Plane Live Snapshot Harness

- Date: `2026-09-01`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — must remain Draft/open/unmerged
- Prerequisite Snapshot Core seal: `3bac7024cd82215fc705a1b943d79771b273437f`
- Snapshot Core seal CI: Incremental `33521334862` SUCCESS; Type check `33521334875` SUCCESS; Isolation `33521334946` SUCCESS
- Same-tree verification CI: Incremental `33521557294` SUCCESS; Type check `33521557144` SUCCESS; Isolation `33521557312` SUCCESS
- Snapshot Core final disposition: `PASS_PRODUCTION_CONTROL_PLANE_SNAPSHOT_CORE_READ_ONLY_PRODUCTION_UNCHANGED`
- Frozen Owner ABI: `123` tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production deploy authorization: **FALSE**
- Production deploy: **NONE**
- Production mutation: **NONE**

## Purpose

Prepare and test a manual-only Cloudflare Production control-plane snapshot harness that is technically incapable of mutating Production.

This phase may add a GET-only client and a `workflow_dispatch` workflow, but the workflow must **not be dispatched in this phase**. The Production execution hard blocker remains active.

## Read-only surfaces

The harness is restricted to exactly three Worker control-plane GETs for `taistock-mcp`:

1. `/accounts/{account_id}/workers/scripts/taistock-mcp/deployments`
2. `/accounts/{account_id}/workers/scripts/taistock-mcp/schedules`
3. `/accounts/{account_id}/workers/scripts/taistock-mcp/settings`

The settings response supplies the existing `OAUTH_KV` namespace ID and Durable Object binding metadata, so no KV create/list mutation path is required.

## Harness contract

The client must:

- make exactly three GET requests;
- use Bearer auth supplied at runtime only;
- select the current deployment result and require exactly one version at `100%`;
- require Cron exactly `*/5 * * * *`;
- read `OAUTH_KV` namespace ID from settings;
- require `MCP_OBJECT` → `MyMCP` and `FAMILY_MCP_OBJECT` → `FamilyMCP`;
- compute a deterministic SHA-256 fingerprint over normalized non-secret Worker binding metadata;
- call the sealed Snapshot Core validator;
- never include the API token or plain-text binding values in the receipt;
- fail closed on non-2xx responses, `success:false`, missing/ambiguous data, or Snapshot Core validation failure.

The workflow must:

- be `workflow_dispatch` only;
- require confirmation exactly `READ_ONLY_PRODUCTION_CONTROL_PLANE_SNAPSHOT`;
- require an exact lowercase 40-hex expected SHA and checkout that exact SHA;
- use `permissions: contents: read`;
- expose Cloudflare credentials only as step environment secrets;
- execute only the GET-only snapshot client;
- upload the resulting JSON receipt as an artifact;
- contain no deployment/rollback/version mutation command or Production MCP endpoint call.

## TEST BEFORE BUILD

RED test:

- `tests/research-vnext-production-control-plane-live-snapshot.test.ts`
- RED commit: `a89fdf1b4e33f9b81fb94bf0cd3d5a3ffe0d4107`

A legal RED requires:

1. Snapshot Core final PASS disposition present;
2. Owner ABI exactly `123` / frozen digest;
3. Production execution hard blocker still active;
4. deploy authorization false / mutation none;
5. marker `PRODUCTION_CONTROL_PLANE_LIVE_SNAPSHOT_RED_READY=PASS` prints;
6. only then may the test fail because `scripts/research-vnext-production-control-plane-live-snapshot.mjs` does not exist.

## RED evidence — ACCEPTED

Research VNext Incremental Gate:

- Run `33521942833`
- Job `99903129043`
- Change Note / protected-surface scope gate: **PASS**
- all prior VNext tests before the current test: **PASS**
- exact marker: `PRODUCTION_CONTROL_PLANE_LIVE_SNAPSHOT_RED_READY=PASS`
- Owner tool count: `123`
- Owner ABI digest: `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Snapshot Core: `SEALED`
- blocked execution workflow: `SEALED`
- capture mode: `GET_ONLY_MANUAL_NOT_EXECUTED`
- Production deploy authorized: `false`
- Production mutation: **NONE**
- terminal result: **EXPECTED RED**
- exact terminal error: `ERR_MODULE_NOT_FOUND` for `scripts/research-vnext-production-control-plane-live-snapshot.mjs`
- downstream incremental type-check / full `test:research` / canonical dry-run / atomic-config dry-run: correctly **SKIPPED**

Independent validation on the RED commit:

- Type check Run `33521942933`: **SUCCESS**, including type-check, full `test:research`, and canonical Wrangler dry-run
- Isolation Run `33521942878`: FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE **PASS**; VNEXT failed only on the same expected missing GET-only client; isolation finalizer failed closed

Disposition: `PRODUCTION_CONTROL_PLANE_LIVE_SNAPSHOT_RED_ACCEPTED_GREEN_IMPLEMENTATION_ALLOWED`.

The RED failure remains immutable and is not rewritten as PASS.

## GREEN implementation

Implementation commit:

- `a6d15c12a8a7ddc65b518785aed05f8a7f72f937`

Atomically added:

- `scripts/research-vnext-production-control-plane-live-snapshot.mjs`
- `.github/workflows/research-vnext-production-control-plane-live-snapshot.yml`

The client remains GET-only and token-safe. The workflow remains manual-only and was **not dispatched** during GREEN validation.

## GREEN evidence — PASS

Research VNext Incremental Gate:

- Run `33522583347`: **SUCCESS**
- Job `99905271739`: **SUCCESS**
- Change Note / protected-surface scope gate: **PASS**
- all Research VNext tests: **PASS**
- live snapshot harness test: **PASS**
- `mock_get_calls=3`
- deployment shape: **PASS**
- schedules shape: **PASS**
- settings/bindings shape: **PASS**
- token leak: `false`
- workflow mode: `MANUAL_GET_ONLY`
- live dispatch executed: `false`
- Production mutation: **NONE**
- frozen Owner tool count: `123`
- frozen Owner ABI digest: `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- full existing `test:research`: **PASS**
- canonical Wrangler dry-run: **PASS**
- atomic deploy-config dry-run: **PASS**
- deploy authorization remained: `false`
- hard blocker remained active

Independent validation:

- Type check Run `33522583305`: **SUCCESS**
- Isolation Run `33522583349`: **SUCCESS** across VNEXT / FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE

Immutable-style gate evidence:

- Artifact ID: `9806336577`
- Artifact name: `research-vnext-evidence-33522583347`
- Artifact digest: `sha256:63539f27495883a4b0c721c196be2df742a4deac69a3d79d8f312c9a488a4a8e`

## Explicitly forbidden

- dispatching the live snapshot workflow before this seal itself passes all gates;
- POST / PUT / PATCH / DELETE Cloudflare calls;
- Production deploy, rollback, or version mutation;
- Production MCP `/my-mcp`, `/health`, or workers.dev contact;
- modifying/removing the atomic Production execution hard blocker;
- OAuth KV mutation;
- Cron mutation;
- Legacy deletion;
- PR #206 merge.

## Final disposition

`PASS_PRODUCTION_CONTROL_PLANE_LIVE_SNAPSHOT_HARNESS_GET_ONLY_UNDISPATCHED_PRODUCTION_UNCHANGED`

Next phase may execute the sealed manual GET-only Production control-plane snapshot only after this docs-only seal commit itself passes Incremental + Type check + Isolation. That next phase remains read-only and does not authorize deploy, rollback, Legacy retirement, or PR merge.
