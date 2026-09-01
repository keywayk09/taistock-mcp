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

## Test-before-build proof

RED commit: `92491635900371513e01b3ea25708e781aa77de8`.

Research VNext Incremental Gate Run `33495962952`, job `99818105320`:

- Change Note / protected-surface scope gate: **PASS**
- Existing Research VNext foundation boundary test: **PASS**
- New review metrics shadow test: **FAIL (EXPECTED RED)**
- Failure: `ERR_MODULE_NOT_FOUND` for `src/v6/research-vnext/compute/review-metrics.ts`
- Type-check / full existing research regression / Wrangler dry-run: correctly **SKIPPED** after RED

The failed receipt is preserved. It is not rewritten or relabeled as a pass.

## Frozen shadow contract

The same inputs are evaluated through:

- legacy `summarizeReviewRows()`;
- VNext `summarizeReviewMetrics()`.

Required shadow verdict: `STRICT_DEEP_EQUAL` for every frozen case. Approximate parity is not accepted.

Frozen cases cover:

1. empty input;
2. mixed TW-stock and TXF units;
3. wins-only profit-factor behavior;
4. losses-only profit-factor behavior;
5. explicit-null legacy semantics;
6. deterministic breakdown ordering.

The test also requires the VNext implementation to be independent: it must not import/delegate to `review-orchestrator.ts`, and it must not absorb `buildReviewInterpretation()` or emit observations/hypotheses.

## GREEN implementation

Added `src/v6/research-vnext/compute/review-metrics.ts` only.

Responsibilities:

- deterministic normalization of TW-stock percentage units versus TXF point units;
- count / evaluated count / wins / losses / flats;
- win rate / expectancy / profit factor;
- MFE / MAE descriptive statistics;
- 5m ambiguity and 1m replay-required counts;
- deterministic market/strategy/side breakdown sorting.

Hard boundaries:

- no network/provider access;
- no persistence or OHLC writes;
- no hypotheses, observations or strategy decisions;
- no import/delegation to legacy review implementation;
- no Production registration.

### Intentional migration rule

This architecture migration preserves current legacy numeric semantics exactly, including explicit-null behavior, because changing semantics while changing architecture would make failures ambiguous. Any future semantic correction must be a separate test-first change with its own Change Note and evidence.

## CI harness change

The Research VNext workflow was generalized from the one-time Foundation Gate to an Incremental Gate that automatically executes every `tests/research-vnext-*.test.ts` file before type-check, existing full research regression and Wrangler dry-run.

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
| Review metrics RED shadow test | Run `33495962952`, job `99818105320` | EXPECTED FAIL — missing VNext metrics module |
| Review metrics implementation | GREEN validation pending | pending |
| Full regression | GREEN validation pending | pending |

## Rollback

Remove `src/v6/research-vnext/compute/review-metrics.ts` and the shadow-test/harness additions. No Production registration points to VNext, so rollback has no Production runtime dependency.

## Final disposition

`IN_PROGRESS_GREEN_VALIDATION`
