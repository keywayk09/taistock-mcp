# Change Note — Research VNext Production Control-Plane Live Recapture

- Date: `2026-09-01`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — remains Draft/open/unmerged
- Corrected sealed source: `bc77effcee66c773fc529df864b1acd33641107f`
- Frozen Owner ABI: `123` / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production deploy authorized: `false`
- Production mutation: `NONE`

## Why a second independent recapture is required

The first connector-compatible GET-only Production control-plane snapshot was executed exactly once and preserved as immutable evidence. Its workflow run succeeded, but artifact review found that the JSON receipt omitted the frozen acceptance field `token_leak: false`.

That first receipt remains immutable and is not rewritten as PASS. Its temporary bridge and authorization were removed and the cleanup lifecycle was later sealed.

A separate TEST BEFORE BUILD phase then repaired only the internal receipt contract so it emits explicit `token_leak: false` while continuing to prove the Cloudflare token is used only in request Authorization headers and is absent from serialized receipt output.

Corrected receipt completeness seal:

- seal commit: `bc77effcee66c773fc529df864b1acd33641107f`
- Research VNext Incremental Gate Run `33530324815`: `SUCCESS`
- Type check Run `33530324826`: `SUCCESS`
- Research VNext Isolation Gate Run `33530324829`: `SUCCESS`
- public Owner ABI remains `123` / frozen digest
- Production deploy authorized: `false`
- Production mutation: `NONE`

The canonical live snapshot workflow remains manual `workflow_dispatch` only and is not changed into a push/PR workflow.

## Why this uses a distinct temporary bridge

The first temporary one-shot bridge is historical evidence and has already been cleaned. This phase does not recreate or mutate that historical bridge path.

A second, distinct connector-compatible bridge will be used only after formal RED acceptance and later bridge GREEN + seal:

- workflow: `.github/workflows/research-vnext-production-control-plane-one-shot-recapture.yml`
- authorization: `runtime/research-vnext-production-control-plane-one-shot-recapture-authorization.json`
- pinned corrected source: `bc77effcee66c773fc529df864b1acd33641107f`

The recapture bridge must remain absent during RED. The recapture authorization must remain absent until the new bridge itself is GREEN and SEALED.

## TEST BEFORE BUILD — bridge RED

RED test:

- `tests/research-vnext-production-control-plane-live-recapture-bridge.test.ts`

Before the deliberate terminal RED, the test must prove:

1. first temporary bridge remains absent;
2. first authorization remains absent;
3. recapture authorization remains absent;
4. corrected sealed source contains explicit `token_leak: false`;
5. canonical live snapshot workflow remains `workflow_dispatch` only;
6. sealed live client remains GET-only;
7. completeness seal has all three required SUCCESS runs;
8. Owner ABI remains frozen at 123 / frozen digest;
9. Production deploy authorization remains false;
10. Production mutation remains none;
11. marker `PRODUCTION_CONTROL_PLANE_LIVE_RECAPTURE_BRIDGE_RED_READY=PASS` prints;
12. only then may RED fail because the distinct recapture workflow does not yet exist.

Expected terminal assertion:

`temporary one-shot recapture GET-only bridge must exist only after accepted RED`

## Future GREEN bounds

Only after accepted RED may the new temporary bridge be implemented. Its future contract is bounded to:

- exact branch + exact recapture authorization path trigger;
- triggering commit changes exactly one authorization file;
- corrected source pinned to `bc77effcee66c773fc529df864b1acd33641107f`;
- workflow permissions `contents: read`;
- Cloudflare secrets only in the snapshot step;
- sealed snapshot client only;
- GET-only control-plane access;
- immutable-style artifact receipt;
- no `gh`, no `curl`, no Wrangler deploy/rollback, no POST/PUT/PATCH/DELETE;
- no Production MCP invocation;
- no OHLC write;
- no resource provisioning;
- Production deploy authorization remains false;
- Production mutation remains none.

No recapture authorization exists in this RED phase. No Production contact occurs in RED or bridge GREEN/seal.

## PR-sync verification child

Initial RED commit `02fc98cd9e851065e74102e57d38be007c7b401c` became PR #206 head successfully, but GitHub created no check-suite for the Git Data ref update. This docs-only child exists only to force a normal PR synchronize event. RED test semantics, runtime, workflow state, and Production state remain unchanged.

## Current disposition

`PRODUCTION_CONTROL_PLANE_LIVE_RECAPTURE_BRIDGE_RED_PENDING`
