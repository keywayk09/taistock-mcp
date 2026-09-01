# Change Note — Research VNext Phase 10A Compat Cutover

- Date: 2026-09-01
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` (must remain Draft)
- Prerequisite Phase 9 seal: `94cc5025940a4afdeee7838de9df40b675fbecd8`
- Prerequisite CI: Incremental `33503006769` SUCCESS; Type check `33503006784` SUCCESS; Isolation `33503006798` SUCCESS
- Production deployment: **NONE**
- Owner registration change: **NONE**
- `research-tools.ts` change: **NONE in 10A**

## Purpose

Start the controlled Research VNext cutover without changing public MCP ABI or replacing the whole Legacy research surface.

Phase 10A introduces a thin lazy compatibility bridge. Only deterministic lanes that already have strict Legacy/VNext parity are eligible to use VNext as primary and Legacy as fallback.

## Eligible lanes

1. `review.summary`
   - Legacy authority under migration: `summarizeReviewRows`
   - VNext: `summarizeReviewMetrics`
   - Evidence: Phase 2 strict deep equality across frozen cases.

2. `swing.rank`
   - Legacy authority under migration: `selectSwingCandidates`
   - VNext: `rankSwingCandidateEvidence`
   - Evidence: Phase 3 strict deep equality.

3. `replay.resolve`
   - Legacy authority under migration: `resolveAmbiguousBacktestWith1m`
   - VNext: `resolveAmbiguousBacktestEvidenceWith1m`
   - Evidence: Phase 4 success strict deep equality plus error-code parity.

## Explicitly not eligible in 10A

- `finalize_swing_review_run` outcome summary: its public tool currently uses a separate local `swingSummary()` shape, not the Phase 3 frozen `summarizeSwingResults()` helper.
- GPT Judgment Memory public tools: VNext Memory Core/Adapter governance is validated, but public Legacy/VNext output parity has not yet been frozen.
- any backend interpretation/hypothesis generation semantic change.
- strategy promotion or rule mutation.

These stay Legacy until their own test-first parity work exists.

## Cutover semantics

The compatibility bridge:

- lazy-loads `research-gateway.ts` only on invocation;
- uses VNext as primary for the eligible deterministic capability;
- uses the supplied Legacy implementation as fallback whenever VNext returns a bounded failure or the gateway loader fails;
- never synthesizes observations, interpretation, thesis, hypothesis, or trading decisions;
- never accesses market providers directly;
- never writes OHLC;
- never registers a new MCP tool;
- preserves the Phase 9 public ABI snapshot exactly;
- keeps Owner and `research-tools.ts` untouched during 10A.

Fallback is availability protection, not a semantic escape hatch: successful VNext outputs are already required to be strict-parity with Legacy for the migrated lanes.

## TEST BEFORE BUILD

RED target:

- `tests/research-vnext-compat-cutover.test.ts`

Expected RED:

- all previously completed VNext tests pass first;
- new test fails precisely because `src/v6/research-vnext/compat-cutover.ts` does not exist;
- downstream type-check/full research regression/Wrangler dry-run are blocked;
- Production remains untouched.

## GREEN implementation

Implementation commit: `5a65d4e20afdc0eb7da9600a0488e6b73875800e`.

Added only:

- `src/v6/research-vnext/compat-cutover.ts`

API:

- `createResearchVNextCompatCutover()`
- `reviewSummary(rows, legacyFallback)`
- `swingRank(signals, limit, legacyFallback)`
- `replayResolve(input, legacyFallback)`

The bridge caches a lazy gateway promise, returns successful VNext deterministic values directly, and invokes exactly one Legacy fallback on bounded VNext/gateway failure.

It remains unregistered in 10A. Integration into existing public handlers is Phase 10B and requires a new RED before any handler source is modified.

## Explicitly not changed

- `src/v6/owner-content-handler.ts`
- `src/v6/research-tools.ts`
- `src/index-v6.ts`
- `src/v6/selective-1m-replay-tool.ts`
- `src/v6/review-orchestrator-tools.ts`
- Family
- OAuth
- Market Data
- FORMAL Blind
- OHLC Production `tv-fugle-1d`
- public MCP names/schemas/count
- Production deploy topology.

## Risk

Primary risk is accidentally treating an unproven Legacy behavior as parity-covered. The eligible-lane allowlist is closed; adding another lane requires its own RED/parity evidence.

## RED evidence

RED test commit: `0fce50e89d93302000c9aab6895dc252ea5b37f4`.

Research VNext Incremental Gate:

- Run `33503434762`
- Job `99841823896`
- Change Note / protected-surface scope gate: **PASS**
- existing Research VNext Foundation test before the new test: **PASS**
- new compat-cutover test: **FAIL (EXPECTED RED)**
- exact failure: `ERR_MODULE_NOT_FOUND` for `src/v6/research-vnext/compat-cutover.ts`
- downstream incremental type-check / full `test:research` / Wrangler dry-run: correctly **SKIPPED**
- Production mutation: **NONE**

Disposition: `PHASE10A_RED_ACCEPTED_IMPLEMENTATION_ALLOWED`.

## GREEN evidence

Research VNext Incremental Gate:

- Run `33503555975`: **SUCCESS**
- all Research VNext tests: **PASS**
- compat cutover VNext-primary cases: **3 PASS**
- compat cutover Legacy fallback cases: **4 PASS**
- lazy cached gateway loading: **PASS**
- type-check: **PASS**
- full `test:research`: **PASS**
- Wrangler dry-run: **PASS**
- evidence upload: **PASS**

Independent Type check:

- Run `33503555994`: **SUCCESS**

Research VNext Isolation Gate:

- Run `33503556025`: **SUCCESS**
- `VNEXT`: PASS
- `FAMILY`: PASS
- `MARKET_DATA`: PASS
- `FORMAL_BLIND`: PASS
- `OWNER_OPS`: PASS
- `BUNDLE`: PASS

## Artifact / hash

- Artifact ID: `9798690610`
- Name: `research-vnext-evidence-33503555975`
- Digest: `sha256:3dece1b9a45afa09f23e8e20abd8863223a8f5a6bf9948080c157952cd4813dd`

## Rollback

Remove `compat-cutover.ts` and its test. No shared registration surface depends on it yet.

## Final disposition

`PASS_PHASE10A_COMPAT_BRIDGE_UNREGISTERED`
