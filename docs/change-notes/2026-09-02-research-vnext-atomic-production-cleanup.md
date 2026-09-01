# Change Note — Research VNext Atomic Production Cleanup

- Date: `2026-09-02`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — must remain Draft/open/unmerged
- Production deployment run: `33534878858`
- Production deployment version: `0d7a4c8d-0ccf-4d89-9cd4-ab28fab70c5c`
- Production control-plane validation: `PASS`
- Authenticated MCP probe: `BLOCKED_BY_MISSING_GITHUB_SECRET`
- Production rollback: `NONE`
- Legacy retirement: `BLOCKED`

## Temporary-surface cleanup

Immutable deploy evidence was captured before cleanup in artifact `9811214109` with digest `sha256:3ca25cf38fab2e1520e0a5a25688a4c2068aa67c0c670610f0628f7f0b35c8e2`.

Cleanup order was intentionally fail-closed:

1. Workflow cleanup commit: `1845c557bd21d67c5beff4cd04e6d472b1f9a5a9`
2. Authorization cleanup commit: `70073b0da92d33a5b742e85a884ac520ba7fadab`

The workflow was deleted first, so deleting the authorization file could not retrigger the one-shot deployment.

Both temporary paths are now absent:

- `.github/workflows/research-vnext-atomic-production-one-shot.yml`
- `runtime/research-vnext-atomic-production-one-shot-authorization.json`

## Runtime validation blocker classification

The single Worker deploy and exact postdeploy control-plane validation succeeded. The authenticated MCP probe failed because `RESEARCH_VNEXT_PROBE_TOKEN` was empty and both modern and legacy protocol attempts received HTTP 401.

This remains immutable failure evidence and is not rewritten as PASS.

Autonomous decision remains `NO_ROLLBACK` because no runtime defect was demonstrated and all structural/control-plane invariants were preserved.

## TEST BEFORE BUILD — cleanup formal RED accepted

Cleanup lifecycle test:

- `tests/research-vnext-atomic-production-one-shot-cleanup.test.ts`

Formal RED head:

- `60192dd891c050c8691a280051489b277729d40d`

Evidence:

- Research VNext Incremental Gate Run `33535473568`: `FAILURE`
- Incremental Job `99948598794`: `FAILURE`
- scope/protected-surface gate: `SUCCESS`
- marker before terminal RED: `ATOMIC_PRODUCTION_ONE_SHOT_CLEANUP_RED_READY=PASS`
- deployed version: `0d7a4c8d-0ccf-4d89-9cd4-ab28fab70c5c`
- control-plane validation: `PASS`
- authenticated MCP probe: `BLOCKED_BY_MISSING_GITHUB_SECRET`
- rollback: `NONE`
- temporary workflow: `ABSENT`
- temporary authorization: `ABSENT`
- Owner ABI: `123` / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- exact terminal assertion: `credential-blocked cleanup disposition must be recorded only after accepted cleanup RED`

Independent validation:

- Type check Run `33535473461`: `SUCCESS`
- Research VNext Isolation Gate Run `33535473705`: `FAILURE`
- Isolation FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE: `SUCCESS`
- Isolation VNEXT: `FAILURE`

The formal RED remains immutable and is not rewritten as PASS.

## GREEN cleanup lifecycle disposition

The accepted postdeploy state is deliberately narrower than a full authenticated runtime PASS:

`DEPLOYED_CONTROL_PLANE_PASS_AUTHENTICATED_PROBE_CREDENTIAL_BLOCKED_NO_ROLLBACK_TEMPORARY_SURFACES_CLEANED`

Meaning:

- Production Worker deploy: completed;
- postdeploy active version: `0d7a4c8d-0ccf-4d89-9cd4-ab28fab70c5c` at 100%;
- postdeploy control-plane invariants: preserved;
- authenticated MCP tool probe: not completed because the configured GitHub probe secret is absent/empty;
- rollback: not executed;
- temporary workflow: removed;
- temporary authorization: removed;
- no further Production mutation authorized;
- Legacy retirement: blocked until an authenticated read-only runtime probe is available and passes.

This disposition MUST NOT be relabeled as `PASS_ATOMIC_PRODUCTION_ONE_SHOT_DEPLOY_AND_CLEANUP_SEALED` because the authenticated runtime probe has not passed.

## GREEN-A — immutable, not accepted

GREEN-A head:

- `4e74b1d3d02697e88a629233dea4c4206a726a9d`

Evidence:

- Research VNext Incremental Gate Run `33535719817`: `FAILURE`
- Type check Run `33535719677`: `SUCCESS`
- Research VNext Isolation Gate Run `33535719927`: `FAILURE`
- Isolation failure is confined to VNEXT; the unrelated research/domain workflows remained green.

The failure is a test-only wording false positive. The lifecycle test used an unanchored `doesNotMatch` for `PASS_ATOMIC_PRODUCTION_ONE_SHOT_DEPLOY_AND_CLEANUP_SEALED`, while this Change Note intentionally contains that token inside the warning sentence stating that the credential-blocked state MUST NOT be relabeled as a full authenticated PASS.

GREEN-A remains immutable and is not promoted. The correction is limited to making the forbidden full-PASS check line/disposition anchored; no Production workflow, authorization, runtime, Worker deployment, rollback, Cron, OAuth KV, Durable Object lifecycle or Legacy state is changed.
