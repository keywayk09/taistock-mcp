# Change Note — Research VNext Phase 10B Handler Cutover

- Date: `2026-09-01`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` (must remain Draft)
- Prerequisite Phase 10A seal: `bec94f19d7d8632926b6d53161762a2840a47007`
- Phase 10A implementation: `5a65d4e20afdc0eb7da9600a0488e6b73875800e`
- Phase 10A CI: Incremental `33503555975` SUCCESS; Type check `33503555994` SUCCESS; Isolation `33503556025` SUCCESS
- Phase 9 frozen ABI: `123` Owner tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production deploy: **NONE**

## Purpose

Wire the already-GREEN Phase 10A compatibility bridge into the existing Legacy research registration graph without changing public tool names, schemas, count, Owner ingress, or unrelated research handlers.

Only deterministic lanes with completed strict parity evidence may migrate. Legacy remains fallback and all unproven handlers remain Legacy.

## Allowed protected surface

Exactly one previously protected runtime file may change in Phase 10B:

- `src/v6/research-tools.ts`

It may only route the existing Selective Replay and Review Orchestrator registrars through the VNext compatibility registration server.

Still forbidden:

- `src/v6/owner-content-handler.ts`
- `src/index-v6.ts`
- `src/v6/mcp-runtime-composition.ts`
- Family
- OAuth
- Market Data
- FORMAL Blind
- `wrangler.jsonc`
- deploy workflows/topology

The Incremental Gate exception must match this exact file and Phase 10B evidence; every other protected surface remains fail-closed.

## Migrated public lanes

### `resolve_ambiguous_backtest_with_1m`

- VNext `replay.resolve` primary.
- Successful VNext compute uses the existing MCP response shape.
- Bounded VNext/gateway failure falls back exactly once to the original Legacy handler and preserves Legacy domain-error payloads.

### `finalize_daily_review_run` — deterministic summary only

- Existing handler still owns ledger reads, backtest execution, TXF review, persistence and compatibility interpretation fields.
- Stock/TXF metric summaries may use VNext `review.summary` only when the resulting value remains strict semantic parity with Legacy.
- VNext failure or unexpected parity drift keeps the Legacy summary unchanged.
- No interpretation/hypothesis generation is moved into VNext.

### `prepare_swing_selection_run` — deterministic rank output

- Existing handler still owns Signal Ledger access and snapshot orchestration.
- VNext `swing.rank` may replace the selected list only when strict semantic parity with Legacy is preserved.
- VNext failure or unexpected drift keeps Legacy selected output.
- `finalize_swing_review_run` remains Legacy because its local `swingSummary()` public shape has not been strict-parity frozen.

## Explicitly not migrated

- GPT Judgment Memory public tools
- `finalize_swing_review_run` summary
- backend-generated interpretation/hypothesis fields
- strategy promotion/rule mutation
- any new MCP tool

## TEST BEFORE BUILD

Two independent RED layers were required before implementation:

1. `tests/research-vnext-handler-cutover.test.ts`
   - shared registration graph initially not wired;
   - only Selective Replay and Review Orchestrator may use compat server;
   - unrelated registrars remain original server;
   - Owner direct VNext registration forbidden;
   - Phase 9 ABI count/digest frozen.

2. `tests/research-vnext-compat-registration.test.ts`
   - registration wrapper export initially absent;
   - after GREEN verifies target wrapping, non-target pass-through, public config/schema identity, Replay fallback, Review metric mapping, Swing score mapping, and preservation of unproven Legacy handlers.

## RED evidence

### RED A — shared registration wiring absent

- Commit: `e9c54dbad6be155a1273c70994fde774e561d4ba`
- Incremental Run `33503942954`
- Job `99843449610`
- Change Note / protected-surface gate: **PASS**
- Foundation / Phase 10A / Gateway / Memory Adapter before target test: **PASS**
- Handler cutover test: **FAIL (EXPECTED RED)**
- Exact assertion: `research-tools must import only the approved VNext compat-cutover surface`
- Actual state: all registrars still used Legacy/original `server`
- downstream type-check / full `test:research` / Wrangler dry-run: **SKIPPED**
- Production mutation: **NONE**
- Disposition: `PHASE10B_RED_A_ACCEPTED`

### RED B — runtime registration wrapper absent

- Commit: `8df8bfede2450e7d0637c7b38b424c580c73bcc8`
- Incremental Run `33504314943`
- Job `99844627926`
- Change Note / protected-surface gate: **PASS**
- Foundation / Phase 10A before target test: **PASS**
- Compat registration test: **FAIL (EXPECTED RED)**
- Exact failure: `compat-cutover.ts does not provide an export named 'createResearchVNextCompatRegistrationServer'`
- downstream type-check / full `test:research` / Wrangler dry-run: **SKIPPED**
- Production mutation: **NONE**
- Disposition: `PHASE10B_RED_B_ACCEPTED_IMPLEMENTATION_ALLOWED`

## GREEN implementation

Atomic implementation commit:

- `95d2005df4e09a24e1453c92f1981ab4197dcac8`

Runtime scope:

- `src/v6/research-vnext/compat-cutover.ts`
- `src/v6/research-tools.ts`

Guard/test scope:

- `tests/research-vnext-boundary.test.ts`
- `tests/research-vnext-handler-cutover.test.ts`
- `.github/workflows/research-vnext-foundation-gate.yml`

Owner / Family / OAuth / Market Data / FORMAL / OHLC / deploy topology: **UNCHANGED**.

### GREEN attempt 1 — preserved failure

Research VNext Incremental Gate:

- Run `33505459791`
- Job `99848320267`
- Phase 10B protected-surface exception: **PASS** (`PHASE10B_HANDLER_CUTOVER_EXCEPTION=PASS`)
- Foundation boundary: **PASS**
- first failing test: `tests/research-vnext-compat-cutover.test.ts`
- exact assertion: `Phase 10A bridge must remain unregistered until its own GREEN`
- failure shape: `true !== false`
- cause: stale Phase 10A source assertion still required `research-tools.ts` to contain no `compat-cutover` reference after the intentionally test-first Phase 10B registration cutover.
- runtime implementation was not implicated by this failure.
- downstream incremental type-check / full `test:research` / Wrangler dry-run: correctly **SKIPPED**
- Production mutation: **NONE**

Disposition: `GREEN_ATTEMPT_1_IMMUTABLE_STALE_TEST_EXPECTATION`. The fix is restricted to updating the Phase 10A test expectation so Owner direct registration remains forbidden while the approved Phase 10B compat registration path is allowed. No runtime source change is authorized by this failure.

## GREEN evidence

Pending after stale-test-only correction.

## Artifact / hash

Pending.

## Rollback

Revert `src/v6/research-tools.ts` to pass the original server directly to Selective Replay and Review Orchestrator. The Phase 10A bridge remains harmless when unreferenced. No Production deployment exists to roll back.

## Final disposition

`GREEN_RETRY_ALLOWED_TEST_ONLY`
