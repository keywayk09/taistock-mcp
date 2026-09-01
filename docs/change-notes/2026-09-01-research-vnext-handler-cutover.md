# Change Note — Research VNext Phase 10B Handler Cutover

- Date: 2026-09-01
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` (must remain Draft)
- Prerequisite Phase 10A seal: `bec94f19d7d8632926b6d53161762a2840a47007`
- Phase 10A implementation: `5a65d4e20afdc0eb7da9600a0488e6b73875800e`
- Phase 10A CI: Incremental `33503555975` SUCCESS; Type check `33503555994` SUCCESS; Isolation `33503556025` SUCCESS
- Phase 9 frozen ABI: `123` Owner tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production deploy: **NONE**

## Purpose

Wire the already-GREEN Phase 10A compatibility bridge into the existing Legacy research registration graph without changing public tool names, schemas, count, Owner ingress, or unrelated research handlers.

This phase is not a whole-system replacement. It activates VNext only for the deterministic lanes with completed strict parity evidence and retains Legacy fallback.

## Allowed protected surface

Exactly one previously protected runtime file may change in Phase 10B:

- `src/v6/research-tools.ts`

It may change only to route the existing Selective Replay and Review Orchestrator registrars through a VNext compatibility registration server.

Still forbidden:

- `src/v6/owner-content-handler.ts`
- `src/index-v6.ts`
- `src/v6/mcp-runtime-composition.ts`
- Family
- OAuth
- Market Data
- FORMAL Blind
- `wrangler.jsonc`
- deploy workflows/topology.

The Incremental Gate must be updated narrowly so `research-tools.ts` is allowed only when the Phase 10B Change Note/test exist and the cutover wiring marker is present. Every other protected surface remains fail-closed.

## Migrated public lanes

### `resolve_ambiguous_backtest_with_1m`

- VNext `replay.resolve` is primary.
- A successful VNext compute result is formatted through the existing MCP response shape.
- Any bounded VNext/gateway failure falls back to the original Legacy handler, preserving Legacy domain-error payloads.

### `finalize_daily_review_run` — deterministic summary only

- Existing handler still owns ledger reads, deterministic backtest execution, TXF review execution, persistence and the existing compatibility interpretation fields.
- After those factual results exist, stock/TXF metric summaries are recomputed through VNext `review.summary` and replace the public summary only when VNext succeeds and remains strict-parity with the Legacy summary.
- If VNext fails or an unexpected parity drift is observed, the Legacy summary remains unchanged.
- No interpretation/hypothesis generation is moved into VNext.

### `prepare_swing_selection_run` — deterministic rank output

- Existing handler still owns Signal Ledger access and snapshot orchestration.
- The emitted selected candidate list is re-ranked/canonicalized through VNext `swing.rank`; VNext output becomes authoritative only when it is strict-parity with the Legacy selected list.
- Legacy selected output is fallback on bounded VNext failure or unexpected parity drift.
- `finalize_swing_review_run` remains Legacy because its current public `swingSummary()` has not been strict-parity frozen.

## Explicitly not migrated

- GPT Judgment Memory public tools.
- `finalize_swing_review_run` summary.
- backend-generated compatibility interpretation/hypothesis fields.
- any strategy promotion/rule mutation.
- any new MCP tool.

## TEST BEFORE BUILD

Two independent RED layers are required before implementation:

1. `tests/research-vnext-handler-cutover.test.ts`
   - proves the shared registration graph is not wired yet;
   - requires only Selective Replay and Review Orchestrator to use a compat server;
   - locks all unrelated registrars to the original server;
   - locks Owner direct VNext registration as forbidden;
   - locks Phase 9 ABI count/digest.

2. `tests/research-vnext-compat-registration.test.ts`
   - requires the registration wrapper export before it exists;
   - then, after GREEN, verifies target handler wrapping, non-target pass-through, config/schema identity, Replay Legacy fallback, Review deterministic metric mapping, Swing deterministic score mapping, and preservation of unproven Legacy handlers.

No implementation file may be changed before both RED layers are observed.

## GREEN target

Expected changes after valid RED:

- extend `src/v6/research-vnext/compat-cutover.ts` with `createResearchVNextCompatRegistrationServer()`;
- modify only `src/v6/research-tools.ts` among protected runtime surfaces;
- update the foundation boundary test from “no VNext anywhere in research-tools” to “only the approved compat-cutover import; Owner direct registration remains forbidden”;
- narrow Phase 10B exception in `.github/workflows/research-vnext-foundation-gate.yml`;
- no public schema/name/count change.

## Gates

GREEN must pass:

- Phase 10B integration test;
- compat registration runtime test;
- all Research VNext tests;
- Phase 9 public ABI snapshot unchanged;
- type-check;
- full `test:research`;
- Wrangler dry-run;
- Isolation Gate;
- protected-surface gate with only the bounded `research-tools.ts` exception.

## Risk

Main risk is accidentally turning a compatibility cutover into a broad protected-surface exemption. The gate exception therefore must match one exact file and one exact phase marker; any Owner/Family/Market/FORMAL/deploy change remains BLOCK.

## RED evidence

### RED A — shared registration wiring absent

RED test commit: `e9c54dbad6be155a1273c70994fde774e561d4ba`.

Research VNext Incremental Gate:

- Run `33503942954`
- Job `99843449610`
- Change Note / protected-surface scope gate: **PASS**
- Foundation test: **PASS**
- Phase 10A compat bridge test: **PASS**
- Gateway test: **PASS**
- GitHub Memory Adapter test: **PASS**
- new Phase 10B handler cutover test: **FAIL (EXPECTED RED)**
- exact assertion: `research-tools must import only the approved VNext compat-cutover surface`
- actual state: `src/v6/research-tools.ts` still routes all registrars through the Legacy/original `server`
- downstream incremental type-check / full `test:research` / Wrangler dry-run: correctly **SKIPPED**
- Production mutation: **NONE**

Disposition: `PHASE10B_RED_A_ACCEPTED`.

### RED B — runtime registration wrapper absent

Runtime RED test commit: `8df8bfede2450e7d0637c7b38b424c580c73bcc8`.

Research VNext Incremental Gate:

- Run `33504314943`
- Job `99844627926`
- Change Note / protected-surface scope gate: **PASS**
- Foundation test: **PASS**
- Phase 10A compat bridge test: **PASS**
- new compat registration test: **FAIL (EXPECTED RED)**
- exact failure: `SyntaxError: ... compat-cutover.ts does not provide an export named 'createResearchVNextCompatRegistrationServer'`
- downstream incremental type-check / full `test:research` / Wrangler dry-run: correctly **SKIPPED**
- Production mutation: **NONE**

Disposition: `PHASE10B_RED_B_ACCEPTED_IMPLEMENTATION_ALLOWED`.

## GREEN evidence

Pending.

## Artifact / hash

Pending.

## Rollback

Revert `research-tools.ts` to pass the original server directly to all registrars. The Phase 10A bridge remains harmless if unreferenced.

## Final disposition

`GREEN_IMPLEMENTATION_ALLOWED`
