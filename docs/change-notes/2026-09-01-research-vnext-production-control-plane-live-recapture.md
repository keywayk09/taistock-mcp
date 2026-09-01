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
- Research VNext Isolation Gate Run `33530782208`: expected fail-closed with VNEXT failing on the same missing recapture bridge
- Isolation FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE: `SUCCESS`
- Isolation VNEXT: `FAILURE`

Disposition:

`PRODUCTION_CONTROL_PLANE_LIVE_RECAPTURE_BRIDGE_RED_ACCEPTED_GREEN_IMPLEMENTATION_ALLOWED`

The RED failure remains immutable and is not rewritten as PASS.

## GREEN implementation bounds

The new temporary recapture workflow is now permitted, with all of these hard bounds:

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

No recapture authorization file is created in this GREEN implementation. Therefore bridge GREEN/seal cannot contact Production.

## Current disposition

`PRODUCTION_CONTROL_PLANE_LIVE_RECAPTURE_BRIDGE_GREEN_IMPLEMENTED_PENDING_VERIFICATION`
