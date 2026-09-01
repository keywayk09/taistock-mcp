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

The compatibility bridge must:

- lazy-load `research-gateway.ts` only on invocation;
- use VNext as primary for the eligible deterministic capability;
- use the supplied Legacy implementation as fallback whenever VNext returns a bounded failure;
- never synthesize observations, interpretation, thesis, hypothesis, or trading decisions;
- never access market providers directly;
- never write OHLC;
- never register a new MCP tool;
- preserve the Phase 9 public ABI snapshot exactly;
- keep Owner and `research-tools.ts` untouched during 10A.

Fallback is availability protection, not a semantic escape hatch: successful VNext outputs are already required to be strict-parity with Legacy for the migrated lanes.

## TEST BEFORE BUILD

RED target:

- `tests/research-vnext-compat-cutover.test.ts`

Expected RED:

- all previously completed VNext tests pass first;
- new test fails precisely because `src/v6/research-vnext/compat-cutover.ts` does not exist;
- downstream type-check/full research regression/Wrangler dry-run are blocked;
- Production remains untouched.

If RED fails for any other reason, implementation is forbidden until diagnosed.

## GREEN target

Expected new module:

- `src/v6/research-vnext/compat-cutover.ts`

Expected initial API:

- `createResearchVNextCompatCutover()`
- `reviewSummary(rows, legacyFallback)`
- `swingRank(signals, limit, legacyFallback)`
- `replayResolve(input, legacyFallback)`
- contract metadata proving GPT ownership, lazy loading, bounded fallback, and no Production registration mutation.

After the bridge itself is GREEN, integration into existing public handlers is a separate Phase 10B RED→GREEN step.

## Tests after GREEN

- compat cutover unit/fault tests;
- all existing Research VNext tests;
- Phase 9 ABI snapshot;
- type-check;
- full `test:research`;
- Wrangler dry-run;
- full Isolation Gate.

## Explicitly not changed

- `src/v6/owner-content-handler.ts`
- `src/v6/research-tools.ts`
- `src/index-v6.ts`
- Family
- OAuth
- Market Data
- FORMAL Blind
- OHLC Production `tv-fugle-1d`
- public MCP names/schemas/count
- Legacy implementation files in the RED step
- Production deploy topology.

## Risk

Primary risk is accidentally treating an unproven Legacy behavior as parity-covered. The eligible-lane allowlist above is therefore closed; adding another lane requires its own RED/parity evidence.

## RED evidence

Pending.

## GREEN evidence

Pending.

## Artifact / hash

Pending.

## Rollback

Remove the 10A bridge/test. No shared registration surface is modified in this phase.

## Final disposition

`RED_PENDING`
