# Change Note — Research VNext Production Control-Plane Live Recapture Cleanup Seal

- Date: `2026-09-01`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — must remain Draft/open/unmerged
- Frozen Owner ABI: `123` / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Corrected sealed snapshot source: `bc77effcee66c773fc529df864b1acd33641107f`
- Production deploy authorized: `false`
- Production mutation: `NONE`

## Immutable corrected live evidence

The corrected one-shot GET-only Production control-plane recapture is preserved as immutable evidence:

- Authorization commit: `9e60b241635bcffc706e537455598b3ff2431b9f`
- Recapture Run `33531322196`: `SUCCESS`
- Artifact ID: `9809833837`
- Artifact digest: `sha256:9f4ddd0bc0f0b877208a6f605bb73e086aa27528885ef4c62c96cb3f1146de6f`
- Receipt status: `READ_ONLY_SNAPSHOT_VALID`
- active version: `75f989b9-e798-4d32-a95f-7253b4e703ec`
- cron: `*/5 * * * *`
- rollback target: `75f989b9-e798-4d32-a95f-7253b4e703ec`
- read_only_capture: `true`
- token_leak: `false`
- Production deploy authorized: `false`
- Production mutation: `NONE`

The first historical live receipt that omitted the explicit `token_leak` field remains immutable and is not rewritten.

## Immediate temporary recapture cleanup

Cleanup remained in the required fail-closed order:

1. Workflow cleanup commit: `0ed451a027e44ed881ce7377c05d5159c3434a00`
2. Authorization cleanup commit: `2df63f1da0dc75765cb8ea9639df50f3f36982c6`

At cleanup head both temporary paths are absent:

- `.github/workflows/research-vnext-production-control-plane-one-shot-recapture.yml`
- `runtime/research-vnext-production-control-plane-one-shot-recapture-authorization.json`

Because the workflow was removed first, deleting the authorization could not trigger a second recapture.

## Cleanup lifecycle RED — accepted and immutable

Cleanup head `2df63f1da0dc75765cb8ea9639df50f3f36982c6` produced the expected lifecycle RED before the test contract was corrected:

- Research VNext Incremental Gate Run `33531433136`: `FAILURE`
- Incremental Job `99935281924`: `FAILURE`
- exact terminal assertion: `temporary one-shot recapture GET-only bridge must exist only after accepted RED`
- Type check Run `33531433218`: `SUCCESS`
- Research VNext Isolation Gate Run `33531433148`: `FAILURE`
- Isolation FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE: `SUCCESS`
- Isolation VNEXT: `FAILURE`

Disposition of that immutable RED:

`PRODUCTION_CONTROL_PLANE_LIVE_RECAPTURE_CLEANUP_RED_ACCEPTED_GREEN_IMPLEMENTATION_ALLOWED`

## Cleanup lifecycle GREEN — PASS

Cleanup lifecycle correction commit:

- `00cf5492c2477ed4e4c25dcaf8eee17a01c47d32`

The correction changed only:

- `tests/research-vnext-production-control-plane-live-recapture-bridge.test.ts`
- `docs/change-notes/2026-09-01-research-vnext-production-control-plane-live-recapture.md`

It did not recreate a workflow or authorization, did not change runtime, and did not contact Production.

The corrected test is fail-closed across both legal lifecycle states:

1. bridge-present lifecycle validates the bounded temporary workflow and, when present, exact authorization contract;
2. bridge-absent post-cleanup lifecycle requires authorization absent plus immutable live receipt metadata, cleanup commit metadata, accepted cleanup RED evidence, frozen ABI, deploy authorization false, and mutation none.

GREEN verification:

- Research VNext Incremental Gate Run `33532572536`: `SUCCESS`
- Type check Run `33532572463`: `SUCCESS`
- Research VNext Isolation Gate Run `33532572501`: `SUCCESS`
- all Research VNext tests: `SUCCESS`
- full existing research regression: `SUCCESS`
- protected-surface scope gate: `SUCCESS`
- Wrangler dry-run only: `SUCCESS`
- atomic deploy-config dry-run only: `SUCCESS`
- Owner ABI remains frozen at `123` / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production deploy authorized: `false`
- Production mutation: `NONE`

Immutable-style GREEN gate evidence:

- Artifact ID: `9810331929`
- Artifact name: `research-vnext-evidence-33532572536`
- Artifact digest: `sha256:a74a4830a0e766b2213baa6e22c68c31f168866ff635b83bda23a71859c6d225`

Disposition before this docs-only seal verifies:

`PASS_PRODUCTION_CONTROL_PLANE_LIVE_RECAPTURE_CLEANUP_GREEN`

## Seal condition

This commit is docs-only and is the cleanup seal candidate. It must itself pass all three:

1. Research VNext Incremental Gate
2. Type check
3. Research VNext Isolation Gate

Only after all three are `SUCCESS` may the phase disposition become:

`PASS_PRODUCTION_CONTROL_PLANE_LIVE_RECAPTURE_COMPLETE_AND_TEMPORARY_BRIDGE_CLEANED_SEALED`

No Production deploy, rollback, Legacy retirement, Owner ABI change, public tool change, OAuth KV mutation, Cron mutation, Durable Object lifecycle change, OHLC Production change, or Production mutation is authorized by this seal.
