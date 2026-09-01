# Change Note — Research VNext Review Metrics Shadow

- Date: 2026-09-01
- Branch: `refactor/research-vnext-foundation-20260901`
- Parent foundation commit: `3d710c8cbfd655bd5241e07daadc0c16627cd664`
- Foundation verification: Run `33495611664` — SUCCESS
- Production mutation: **NONE**
- Production registration change: **NONE**

## Purpose

Begin the first real Research VNext capability migration with a deterministic-only slice: review metrics. GPT remains responsible for interpretation, hypotheses, counter-evidence and research decisions.

The VNext slice is allowed to compute only factual metrics such as counts, win/loss/flat totals, win rate, expectancy, profit factor, MFE/MAE summaries, 5m ambiguity rates and 1m replay-required counts.

## Test-before-build plan

The shadow test is committed and executed **before** `src/v6/research-vnext/compute/review-metrics.ts` exists.

The frozen test compares the same inputs through:

- legacy `summarizeReviewRows()`;
- future VNext `summarizeReviewMetrics()`.

Required shadow verdict: `STRICT_DEEP_EQUAL` for every frozen case. Approximate parity is not accepted.

Frozen cases cover:

1. empty input;
2. mixed TW-stock and TXF units;
3. wins-only profit-factor behavior;
4. losses-only profit-factor behavior;
5. explicit-null legacy semantics;
6. deterministic breakdown ordering.

The test also requires the VNext implementation to be independent: it must not import/delegate to `review-orchestrator.ts`, and it must not absorb `buildReviewInterpretation()` or emit observations/hypotheses.

## CI harness change

The existing Research VNext workflow is generalized from a one-time Foundation Gate to an Incremental Gate that automatically executes every `tests/research-vnext-*.test.ts` file before type-check, existing full research regression and Wrangler dry-run.

This is an engineering-test harness change only. It does not deploy or register VNext.

## Explicitly not changed

- `src/v6/review-orchestrator.ts` legacy behavior
- `src/v6/review-orchestrator-tools.ts`
- `src/v6/research-tools.ts`
- `src/v6/owner-content-handler.ts`
- `src/index-v6.ts`
- public MCP tool ABI
- Family / OAuth
- Market Data
- FORMAL Blind
- OHLC ingest/read/write contract
- Crypto
- `wrangler.jsonc`
- Production deployment workflow

## Evidence log

| Stage | Evidence | Result |
|---|---|---|
| Foundation prerequisite | Run `33495611664` | PASS |
| Review metrics RED shadow test | pending | pending |
| Review metrics implementation | not created yet | pending |
| Full regression | pending | pending |

## Rollback

Remove the shadow test / incremental harness change. No Production registration points to VNext, so this phase has no Production runtime dependency.

## Final disposition

`IN_PROGRESS_TEST_FIRST`
