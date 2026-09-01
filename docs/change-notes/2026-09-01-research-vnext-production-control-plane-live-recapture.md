# Change Note — Research VNext Production Control-Plane Live Recapture

- Date: `2026-09-01`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — remains Draft/open/unmerged
- Corrected sealed source: `bc77effcee66c773fc529df864b1acd33641107f`
- Frozen Owner ABI: `123` / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production deploy authorized: `false`
- Production mutation: `NONE`

## Why a second independent recapture is required

The first connector-compatible GET-only Production control-plane snapshot was executed exactly once and preserved as immutable evidence. Its workflow run succeeded, but artifact review found that its JSON receipt omitted the frozen acceptance field `token_leak: false`. That first receipt remains immutable and is not rewritten as PASS. Its temporary bridge and authorization were removed and the cleanup lifecycle was sealed.

A separate TEST BEFORE BUILD phase repaired only the internal receipt contract so it emits explicit `token_leak: false` while continuing to prove the Cloudflare token is used only in request Authorization headers and is absent from serialized receipt output.

Corrected receipt completeness seal:

- seal commit: `bc77effcee66c773fc529df864b1acd33641107f`
- Research VNext Incremental Gate Run `33530324815`: `SUCCESS`
- Type check Run `33530324826`: `SUCCESS`
- Research VNext Isolation Gate Run `33530324829`: `SUCCESS`
- public Owner ABI remains `123` / frozen digest
- Production deploy authorized: `false`
- Production mutation: `NONE`

The canonical live snapshot workflow remains manual `workflow_dispatch` only and is unchanged.

## Distinct temporary bridge

The first temporary bridge is historical evidence and is not recreated or modified. This phase uses distinct paths:

- workflow: `.github/workflows/research-vnext-production-control-plane-one-shot-recapture.yml`
- authorization: `runtime/research-vnext-production-control-plane-one-shot-recapture-authorization.json`
- pinned corrected source: `bc77effcee66c773fc529df864b1acd33641107f`

The recapture authorization must remain absent until the new bridge is GREEN and SEALED.

## TEST BEFORE BUILD — formal bridge RED

RED test:

- `tests/research-vnext-production-control-plane-live-recapture-bridge.test.ts`

Initial RED commit:

- `02fc98cd9e851065e74102e57d38be007c7b401c`

The Git Data ref update became PR #206 head but produced no check-suite, so docs-only verification child `9edd7acc0f2b445f88bb4b000d172565cca7a026` forced a normal PR synchronize event without changing RED semantics or runtime.

Formal RED evidence:

- Research VNext Incremental Gate Run `33530782294`: `FAILURE`
- Incremental Job `99933095511`: `FAILURE`
- Change Note / protected-surface scope gate: `SUCCESS`
- marker before terminal RED: `PRODUCTION_CONTROL_PLANE_LIVE_RECAPTURE_BRIDGE_RED_READY=PASS`
- first temporary bridge: `CLEANED`
- corrected sealed source: `bc77effcee66c773fc529df864b1acd33641107f`
- corrected receipt contract: `TOKEN_LEAK_FALSE_PRESENT`
- canonical manual harness: `WORKFLOW_DISPATCH_ONLY_UNCHANGED`
- Owner tool count: `123`
- Owner ABI digest: `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production deploy authorized: `false`
- Production mutation: `NONE`
- exact terminal assertion: `temporary one-shot recapture GET-only bridge must exist only after accepted RED`

Independent RED validation:

- Type check Run `33530782077`: `SUCCESS`
- Research VNext Isolation Gate Run `33530782208`: fail-closed on VNEXT only
- Isolation FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE: `SUCCESS`
- Isolation VNEXT: `FAILURE`

Disposition:

`PRODUCTION_CONTROL_PLANE_LIVE_RECAPTURE_BRIDGE_RED_ACCEPTED_GREEN_IMPLEMENTATION_ALLOWED`

The RED failure remains immutable and is not rewritten as PASS.

## GREEN bridge implementation

Implementation commit:

- `ec648c126897951f067e93be48ee4af2af8fd02b`

The implementation adds only the distinct temporary recapture workflow and updates this Change Note. No recapture authorization file exists, so this implementation cannot contact Production.

The workflow contract is bounded to:

- exact branch + exact recapture authorization path trigger;
- triggering commit must change exactly one authorization file;
- authorization schema `RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_ONE_SHOT_RECAPTURE_AUTH_V1`;
- mode `READ_ONLY_PRODUCTION_CONTROL_PLANE_SNAPSHOT`;
- corrected source pinned to `bc77effcee66c773fc529df864b1acd33641107f`;
- workflow permissions `contents: read`;
- Cloudflare secrets only in the snapshot step;
- corrected sealed snapshot client only;
- GET-only control-plane access;
- immutable-style artifact receipt;
- no `gh`, no `curl`, no Wrangler deploy/rollback, no POST/PUT/PATCH/DELETE;
- no Production MCP invocation;
- no OHLC write;
- no resource provisioning;
- Production deploy authorization remains false;
- Production mutation remains none.

## GREEN bridge verification — PASS

- Research VNext Incremental Gate Run `33530999040`: `SUCCESS`
- Type check Run `33530999019`: `SUCCESS`
- Research VNext Isolation Gate Run `33530999031`: `SUCCESS`
- Change Note / protected-surface scope gate: `SUCCESS`
- all Research VNext tests: `SUCCESS`
- full existing research regression: `SUCCESS`
- Wrangler dry-run only: `SUCCESS`
- atomic deploy-config dry-run only: `SUCCESS`
- Owner ABI remains `123` / frozen digest
- Production deploy authorized: `false`
- Production mutation: `NONE`

Immutable-style GREEN evidence:

- Artifact ID: `9809735087`
- Artifact name: `research-vnext-evidence-33530999040`
- Artifact digest: `sha256:415c4d5374116428f4fde5c8a7dc8015bbf6209398727e56a9354963d259df45`

Disposition:

`PASS_PRODUCTION_CONTROL_PLANE_LIVE_RECAPTURE_BRIDGE_GREEN_UNTRIGGERED`

## Seal requirement

This docs-only seal commit must itself pass:

- Research VNext Incremental Gate;
- Type check;
- Research VNext Isolation Gate.

Only after all three seal checks are `SUCCESS` may exactly one recapture authorization file be created. Until then, Production contact remains none for this recapture phase.

PR #206 remains Draft/open/unmerged. Production deploy remains unauthorized. Production mutation remains `NONE`.

## Bridge seal — PASS

Bridge seal commit: `3be195dc5e2ccffa3ec693abbaf53f4818368e43`

- Research VNext Incremental Gate Run `33531169692`: `SUCCESS`
- Type check Run `33531169619`: `SUCCESS`
- Research VNext Isolation Gate Run `33531169596`: `SUCCESS`
- PR #206 remained Draft/open/unmerged.
- Recapture authorization was still absent throughout bridge GREEN + seal.
- Production contact remained none until the later one-shot authorization commit.
- Production deploy authorized: `false`
- Production mutation: `NONE`

Disposition:

`PASS_PRODUCTION_CONTROL_PLANE_LIVE_RECAPTURE_BRIDGE_SEALED`

## Corrected one-shot live recapture — SUCCESS

Only after bridge seal three-green, exactly one authorization file was created.

Authorization commit: `9e60b241635bcffc706e537455598b3ff2431b9f`

The authorization commit was verified against the bridge seal and changed exactly one file:

- `runtime/research-vnext-production-control-plane-one-shot-recapture-authorization.json`

Frozen authorization inputs:

- schema: `RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_ONE_SHOT_RECAPTURE_AUTH_V1`
- mode: `READ_ONLY_PRODUCTION_CONTROL_PLANE_SNAPSHOT`
- source SHA: `bc77effcee66c773fc529df864b1acd33641107f`
- Production deploy authorized: `false`
- Production mutation: `NONE`

The single push triggered exactly one dedicated corrected recapture workflow run:

- Recapture Run `33531322196`: `SUCCESS`
- event: `push`
- authorization head: `9e60b241635bcffc706e537455598b3ff2431b9f`
- corrected sealed source: `bc77effcee66c773fc529df864b1acd33641107f`
- GET-only snapshot step: `SUCCESS`
- immutable-style receipt upload: `SUCCESS`

Immutable corrected live receipt:

- Artifact ID: `9809833837`
- Artifact name: `research-vnext-production-control-plane-one-shot-recapture-33531322196`
- Artifact digest: `sha256:9f4ddd0bc0f0b877208a6f605bb73e086aa27528885ef4c62c96cb3f1146de6f`
- Receipt status: `READ_ONLY_SNAPSHOT_VALID`
- worker: `taistock-mcp`
- active deployment: `8e4b3922-e96b-4e2b-b365-65e2e9f71968`
- active version: `75f989b9-e798-4d32-a95f-7253b4e703ec`
- active version percentage: `100`
- cron: `*/5 * * * *`
- protected exports: `MyMCP`, `FamilyMCP`
- binding fingerprint: `d1faf34e53a3901c0ca13f4c29ff354194c7a3788bd94aa7a2e37509eaf1a49b`
- rollback target: `75f989b9-e798-4d32-a95f-7253b4e703ec`
- hard blocker: `REQUIRED_ACTIVE`
- read_only_capture: `true`
- token_leak: `false`
- Production deploy authorized: `false`
- Production mutation: `NONE`

This corrected receipt is the accepted live control-plane snapshot evidence. The first historical receipt remains immutable and is not rewritten.

## Immediate temporary recapture cleanup

After immutable live evidence was obtained, cleanup was executed in fail-closed order:

1. Workflow cleanup commit: `0ed451a027e44ed881ce7377c05d5159c3434a00`
   - removed `.github/workflows/research-vnext-production-control-plane-one-shot-recapture.yml`
2. Authorization cleanup commit: `2df63f1da0dc75765cb8ea9639df50f3f36982c6`
   - removed `runtime/research-vnext-production-control-plane-one-shot-recapture-authorization.json`

The workflow was removed before the authorization file, so deleting the authorization could not trigger a second recapture. Both temporary paths are absent at cleanup head.

No deploy, rollback, Production MCP invocation, OHLC write, resource provisioning, or other Production mutation occurred.

## TEST BEFORE BUILD — cleanup lifecycle RED

Cleanup head:

- `2df63f1da0dc75765cb8ea9639df50f3f36982c6`

The existing bridge test intentionally remained on its pre-cleanup lifecycle semantics before the cleanup GREEN correction. This produced the expected fail-closed cleanup RED:

- Research VNext Incremental Gate Run `33531433136`: `FAILURE`
- Incremental Job `99935281924`: `FAILURE`
- Change Note / protected-surface scope gate: `SUCCESS`
- all tests before the recapture bridge test: `SUCCESS`
- recapture preconditions marker: `PRODUCTION_CONTROL_PLANE_LIVE_RECAPTURE_BRIDGE_RED_READY=PASS`
- exact terminal assertion: `temporary one-shot recapture GET-only bridge must exist only after accepted RED`
- Type check Run `33531433218`: `SUCCESS`
- Research VNext Isolation Gate Run `33531433148`: `FAILURE`
- Isolation FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE: `SUCCESS`
- Isolation VNEXT: `FAILURE`

This cleanup RED is accepted because the only VNEXT failure is the old assertion requiring the now-correctly-removed temporary recapture workflow. The failure remains immutable and is not rewritten as PASS.

Disposition:

`PRODUCTION_CONTROL_PLANE_LIVE_RECAPTURE_CLEANUP_RED_ACCEPTED_GREEN_IMPLEMENTATION_ALLOWED`

## Cleanup GREEN contract

The cleanup lifecycle test may now be corrected, without changing runtime or Production surfaces, so it accepts exactly two fail-closed states:

1. bridge-present lifecycle:
   - validates the bounded temporary bridge contract and optional exact authorization contract;
2. bridge-absent post-cleanup lifecycle:
   - authorization must also be absent;
   - corrected live Run `33531322196` and Artifact `9809833837` must be recorded;
   - receipt must explicitly record `token_leak: false`, `read_only_capture: true`, deploy authorization false, and mutation none;
   - workflow cleanup commit and authorization cleanup commit must be recorded;
   - cleanup RED evidence must remain recorded.

No missing or partially cleaned lifecycle is accepted.

Production deploy remains unauthorized. Production mutation remains `NONE`. PR #206 remains Draft/open/unmerged.
