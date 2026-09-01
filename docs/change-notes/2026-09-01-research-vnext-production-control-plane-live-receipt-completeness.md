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

No completeness-test semantics are relaxed. The next verification must still prove exactly three mock GETs, token sentinel absent from serialized receipt, deploy authorization false, mutation none, print the RED-ready marker, and then fail only on missing explicit `token_leak: false`.

## Formal RED synchronize child

Correction commit `ca6321b294e96da0c09e24614e279110a6dbbc24` updated evidence only and produced no check-suite after the Git Data ref update. This docs-only child exists only to create a normal PR synchronize event. Test semantics and runtime remain unchanged.

## Current disposition

`PRODUCTION_CONTROL_PLANE_LIVE_RECEIPT_COMPLETENESS_FORMAL_RED_PENDING`
