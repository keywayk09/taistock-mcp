# Change Note — Research VNext Production Control-Plane Live Snapshot Harness

- Date: `2026-09-01`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — must remain Draft/open/unmerged
- Prerequisite Snapshot Core seal: `3bac7024cd82215fc705a1b943d79771b273437f`
- Snapshot Core seal CI: Incremental `33521334862` SUCCESS; Type check `33521334875` SUCCESS; Isolation `33521334946` SUCCESS
- Snapshot Core final disposition: `PASS_PRODUCTION_CONTROL_PLANE_SNAPSHOT_CORE_READ_ONLY_PRODUCTION_UNCHANGED`
- Frozen Owner ABI: `123` tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production deploy authorization: **FALSE**
- Production deploy: **NONE**
- Production mutation: **NONE**

## Purpose

Prepare and test a manual-only Cloudflare Production control-plane snapshot harness that is technically incapable of mutating Production.

This phase may add a GET-only client and a `workflow_dispatch` workflow, but the workflow must **not be dispatched in this phase**. The Production execution hard blocker remains active.

## Current Cloudflare read-only surfaces

The harness is restricted to these three Worker control-plane GETs for `taistock-mcp`:

1. `GET /accounts/{account_id}/workers/scripts/taistock-mcp/deployments`
2. `GET /accounts/{account_id}/workers/scripts/taistock-mcp/schedules`
3. `GET /accounts/{account_id}/workers/scripts/taistock-mcp/settings`

Expected Cloudflare response facts:

- deployments: `result.deployments[]`, each with UUID `id` and `versions[]` of `{version_id, percentage}`;
- schedules: `result.schedules[]` with `cron`;
- settings: `result.bindings[]`, including KV `{name,type,namespace_id}` and Durable Object `{name,type,class_name}` bindings.

No KV list/create API is needed because `OAUTH_KV` namespace ID is available from Worker settings.

## Harness contract

The future client must:

- make exactly three GET requests;
- use Bearer auth supplied at runtime only;
- select the current deployment and require exactly one active version at `100%`;
- require Cron exactly `*/5 * * * *`;
- read `OAUTH_KV` namespace ID from settings;
- require `MCP_OBJECT` → `MyMCP` and `FAMILY_MCP_OBJECT` → `FamilyMCP`;
- compute a deterministic SHA-256 fingerprint over normalized Worker bindings;
- call the sealed Snapshot Core validator;
- never include the API token in the receipt;
- fail closed on non-2xx responses, `success:false`, missing/ambiguous data, or snapshot-core validation failure.

The future workflow must:

- be `workflow_dispatch` only;
- require confirmation exactly `READ_ONLY_PRODUCTION_CONTROL_PLANE_SNAPSHOT`;
- require an exact 40-hex expected SHA and checkout that exact SHA;
- use `permissions: contents: read`;
- expose Cloudflare credentials only as step environment secrets;
- execute only the GET-only snapshot client;
- upload the resulting JSON receipt as an artifact;
- contain no Wrangler, curl, deploy workflow calls, Production MCP endpoint calls, or mutation verbs.

## TEST BEFORE BUILD

RED test:

- `tests/research-vnext-production-control-plane-live-snapshot.test.ts`

A legal RED requires:

1. Snapshot Core final PASS disposition present;
2. Owner ABI exactly `123` / frozen digest;
3. Production execution hard blocker still active;
4. deploy authorization false / mutation none;
5. marker `PRODUCTION_CONTROL_PLANE_LIVE_SNAPSHOT_RED_READY=PASS` prints;
6. only then may the test fail because `scripts/research-vnext-production-control-plane-live-snapshot.mjs` does not exist.

After accepted RED, GREEN may atomically add:

- `scripts/research-vnext-production-control-plane-live-snapshot.mjs`
- `.github/workflows/research-vnext-production-control-plane-live-snapshot.yml`

The GREEN test uses injected mock `fetch` responses matching current Cloudflare API shapes and must prove all requests are GET-only and token-safe before the workflow exists on the branch.

## Explicitly forbidden

- dispatching the live snapshot workflow in this phase;
- POST / PUT / PATCH / DELETE Cloudflare calls;
- `wrangler deploy`, rollback, versions upload/deploy;
- curl-based control-plane mutations;
- Production MCP `/my-mcp`, `/health`, or workers.dev contact;
- modifying/removing the atomic Production execution hard blocker;
- real deploy or rollback;
- OAuth KV mutation;
- Cron mutation;
- Legacy deletion;
- PR #206 merge.

## RED evidence

Pending.

## GREEN evidence

Pending.

## Final disposition

`PRODUCTION_CONTROL_PLANE_LIVE_SNAPSHOT_RED_PENDING`
