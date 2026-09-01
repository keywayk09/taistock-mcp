# Change Note — Research VNext Production Control-Plane Live Receipt Completeness

- Date: `2026-09-01`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — remains Draft/open/unmerged
- Prior cleanup seal: `00f046995004ec65c1209e9664259e6a10fd85ce`
- Frozen Owner ABI: `123` / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production deploy authorized: `false`
- Production mutation: `NONE`

## Why this phase exists

The first connector-compatible one-shot GET-only Production snapshot attempt completed successfully at the workflow level and produced immutable artifact `9808495101` with digest `sha256:f38b86c862b1bce5d2c0d06a94b7d2ebf7ed0c29caa9cfa39102ad35c304e000`.

Artifact review confirmed that the receipt contained active deployment/version, cron, OAuth KV binding evidence, Durable Object bindings, binding fingerprint, rollback target, hard blocker, read-only capture, deploy authorization false, and mutation none.

However, the frozen live-receipt acceptance contract also requires explicit `token_leak = false` evidence. The captured JSON receipt did **not** contain a `token_leak` field. Therefore the prior workflow `SUCCESS` must not be promoted to a complete Production control-plane snapshot PASS.

The prior live attempt remains immutable evidence. It is not rewritten or relabeled.

## TEST BEFORE BUILD

New RED test:

- `tests/research-vnext-production-control-plane-live-receipt-completeness.test.ts`

The test must prove all safe preconditions before its deliberate terminal RED:

1. temporary one-shot bridge remains absent after cleanup;
2. one-shot authorization remains absent after cleanup;
3. cleanup seal has three green checks;
4. Owner ABI remains frozen at 123 / frozen digest;
5. a deterministic mock live client performs exactly three GET requests;
6. Authorization header contains the test sentinel token only at request time;
7. serialized receipt does not contain the token sentinel;
8. Production deploy authorization remains false;
9. Production mutation remains none;
10. marker `PRODUCTION_CONTROL_PLANE_LIVE_RECEIPT_COMPLETENESS_RED_READY=PASS` prints;
11. only then may the test fail because `receipt.token_leak` is not explicitly `false`.

Expected terminal assertion:

`live receipt must explicitly emit token_leak=false`

## Scope

RED phase only. No implementation in this commit.

Allowed future GREEN implementation, only after accepted RED:

- additive deterministic evidence field `token_leak: false` in the internal Production control-plane snapshot receipt;
- no public MCP ABI change;
- no Owner registration change;
- no Family / Market Data / FORMAL Blind change;
- no OAuth KV / Cron / Durable Object lifecycle change;
- no OHLC change;
- no Production deploy / rollback / mutation;
- no temporary one-shot bridge recreation until the corrected GET-only source is separately GREEN and SEALED.

## PR-sync verification child

The initial RED commit `dcf992b6cec19ecf702548226ab31028244e4d75` became PR #206 head successfully, but GitHub created no check-suite/status for that Git Data ref update. Docs-only verification child `a770fbdf0e1aba0198076640f8d84ea253d3a63d` forced the normal PR synchronize event. Test semantics and runtime remained unchanged.

## RED A — failed precondition, immutable, NOT ACCEPTED

The first CI execution of the completeness test did not reach the intended RED marker. It failed earlier because the cleanup Change Note had not yet recorded the already-completed cleanup-seal run IDs.

Evidence:

- Verification child: `a770fbdf0e1aba0198076640f8d84ea253d3a63d`
- Research VNext Incremental Gate Run `33529493454`: `FAILURE`
- Incremental Job `99928698408`: `FAILURE`
- Change Note / protected-surface scope gate: `SUCCESS`
- failure step: `Run all Research VNext tests`
- exact assertion: `The input did not match the regular expression /Research VNext Incremental Gate Run `33528997296`: `SUCCESS`/`
- intended marker `PRODUCTION_CONTROL_PLANE_LIVE_RECEIPT_COMPLETENESS_RED_READY=PASS`: **NOT REACHED**
- Type check Run `33529493382`: `SUCCESS`
- Research VNext Isolation Gate Run `33529493373`: `FAILURE`
- Isolation VNEXT: `FAILURE` on the same early precondition
- Isolation FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE: `SUCCESS`
- Production deploy authorized: `false`
- Production mutation: `NONE`

Root cause: evidence metadata omission only. Cleanup seal itself had already passed; the cleanup note had not yet been amended with those three seal run IDs.

Disposition:

`PRODUCTION_CONTROL_PLANE_LIVE_RECEIPT_COMPLETENESS_RED_A_PRECONDITION_FAILED_NOT_ACCEPTED`

This failure remains immutable and is not relabeled as the formal completeness RED.

## RED correction

The cleanup Change Note is amended with the already-completed cleanup seal evidence:

- Research VNext Incremental Gate Run `33528997296`: `SUCCESS`
- Type check Run `33528997181`: `SUCCESS`
- Research VNext Isolation Gate Run `33528997209`: `SUCCESS`

No completeness-test semantics are relaxed.

## Formal RED — ACCEPTED, IMMUTABLE

Formal verification child:

- `fa943d40ea525f34f07ea6cc4ec10eb9dbccd73a`

Research VNext Incremental Gate:

- Run `33529860387`: `FAILURE`
- Job `99929987720`: `FAILURE`
- Change Note / protected-surface scope gate: `SUCCESS`
- marker before terminal RED: `PRODUCTION_CONTROL_PLANE_LIVE_RECEIPT_COMPLETENESS_RED_READY=PASS`
- mock GET calls: `3`
- serialized token present: `false`
- Owner tool count: `123`
- Owner ABI digest: `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production deploy authorized: `false`
- Production mutation: `NONE`
- exact terminal assertion: `live receipt must explicitly emit token_leak=false`
- actual `receipt.token_leak`: `undefined`
- expected: `false`

Independent validation:

- Type check Run `33529860512`: `SUCCESS`
- Research VNext Isolation Gate Run `33529860439`: `FAILURE`
- Isolation VNEXT: `FAILURE` on the same expected completeness RED
- Isolation FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE: `SUCCESS`

Disposition:

`PRODUCTION_CONTROL_PLANE_LIVE_RECEIPT_COMPLETENESS_RED_ACCEPTED_GREEN_IMPLEMENTATION_ALLOWED`

This formal RED remains immutable and is not rewritten as PASS.

## GREEN implementation

Implementation commit:

- `f1e87cc03232902899c130d8204d3c10b3dac410`

The implementation is intentionally minimal and additive:

- `src/v6/research-vnext/production-control-plane-snapshot.ts` emits `token_leak: false` in the internal read-only snapshot receipt;
- the Cloudflare API token is still never passed into `buildProductionControlPlaneSnapshot`;
- the completeness test continues to prove the sentinel token is present only in request Authorization headers and absent from serialized receipt;
- public MCP ABI remains unchanged;
- no Owner registration, Family, Market Data, FORMAL Blind, OAuth KV, Cron, Durable Object lifecycle, OHLC, workflow trigger, Production deploy, rollback, or mutation behavior changes.

Production deploy remains unauthorized. Production mutation remains `NONE`.

## GREEN verification — PASS

GREEN verification child:

- `5f63e7e1bfdef4165a259a7943c5726250dd2097`

Required verification:

- Research VNext Incremental Gate Run `33530133237`: `SUCCESS`
- Type check Run `33530133333`: `SUCCESS`
- Research VNext Isolation Gate Run `33530133320`: `SUCCESS`
- Change Note / protected-surface scope gate: `SUCCESS`
- all Research VNext tests: `SUCCESS`
- type check: `SUCCESS`
- full existing research regression: `SUCCESS`
- Cloudflare Wrangler dry-run only: `SUCCESS`
- atomic deploy-config dry-run only: `SUCCESS`
- completeness test proves exactly 3 mock GETs, sentinel token absent from serialized receipt, and explicit `token_leak: false`
- Owner tool count remains `123`
- Owner ABI digest remains `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production deploy authorized: `false`
- Production mutation: `NONE`

Immutable-style GREEN evidence:

- Artifact ID: `9809398581`
- Artifact name: `research-vnext-evidence-33530133237`
- Artifact digest: `sha256:1e845bff6ec10ca7468e34ce99928aa31dccf4ee12d5047db6aba0c1011b162a`

Disposition:

`PASS_PRODUCTION_CONTROL_PLANE_LIVE_RECEIPT_COMPLETENESS_GREEN`

## Seal requirement

This docs-only seal commit must itself pass:

- Research VNext Incremental Gate;
- Type check;
- Research VNext Isolation Gate.

Only after all three seal checks are `SUCCESS` may the corrected GET-only source be considered sealed for a new independently authorized read-only Production snapshot attempt. No Production deploy authorization is granted by this seal.

PR #206 remains Draft/open/unmerged. Production deploy remains unauthorized. Production mutation remains `NONE`.
