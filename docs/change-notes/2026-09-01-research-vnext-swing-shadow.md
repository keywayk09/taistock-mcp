# Change Note — Research VNext Swing Evidence Shadow

- Date: 2026-09-01
- Branch: `refactor/research-vnext-foundation-20260901`
- Prerequisite review-metrics commit: `65123ddc9cb00c071209b8c6a4a672acd0537a3f`
- Prerequisite verification: Run `33496155753` — SUCCESS
- Production mutation: **NONE**
- Production registration change: **NONE**

## Purpose

Migrate the deterministic parts of the swing path without creating a backend trading brain. GPT remains the swing researcher and final reasoning/selection owner.

VNext may only provide mechanical evidence helpers:

- score extraction from existing signal payload fields;
- deterministic candidate evidence ranking/deduplication;
- deterministic D1/D3/D5-style outcome summaries.

These outputs are evidence for GPT, not autonomous trade decisions.

## Test-before-build proof

RED commit: `429544872c834868cc17e4e23c76f1458a52f52e`.

Research VNext Incremental Gate Run `33496517952`, job `99819864671`:

- Change Note / protected-surface scope gate: **PASS**
- Research VNext foundation boundary test: **PASS**
- Review metrics strict shadow-parity test: **PASS**
- New swing evidence shadow test: **FAIL (EXPECTED RED)**
- Failure: `ERR_MODULE_NOT_FOUND` for `src/v6/research-vnext/compute/swing-evidence.ts`
- Type-check / full existing research regression / Wrangler dry-run: correctly **SKIPPED** after RED

This failed receipt is preserved and must never be rewritten as a pass.

## Frozen shadow contract

Strict shadow comparisons cover:

- score priority: `swing_score` → `diamond_score` → `confidence_score` → probability fallback;
- symbol deduplication and tie-breaking by newer signal timestamp;
- invalid symbol and invalid side filtering;
- current legacy minimum-one behavior for a zero limit;
- MFE/MAE and horizon outcome summary parity;
- deterministic horizon ordering.

Required verdict is `STRICT_DEEP_EQUAL`. Approximate parity is not accepted.

The VNext source must not delegate to `review-orchestrator.ts` and must not own GPT interpretation/hypothesis logic.

## GREEN implementation

Added only `src/v6/research-vnext/compute/swing-evidence.ts`.

Responsibilities:

- `scoreSwingEvidence()` — mechanical score extraction using current frozen legacy precedence;
- `rankSwingCandidateEvidence()` — deterministic filtering, deduplication, tie-break, sorting and bounded ranking;
- `summarizeSwingOutcomeEvidence()` — deterministic MFE/MAE and horizon-return summaries.

Hard boundaries:

- no network or market-provider access;
- no OHLC writes or persistence;
- no observations, hypotheses or narrative interpretation;
- no autonomous strategy promotion;
- no import/delegation to legacy review orchestrator;
- no Production tool registration.

### Intentional migration rule

This architecture migration preserves current legacy deterministic semantics exactly, including zero-limit minimum-one behavior and current score precedence. Any semantic change must be a separate test-first change with its own Change Note and evidence.

## Explicitly not changed

- legacy `src/v6/review-orchestrator.ts`
- `src/v6/review-orchestrator-tools.ts`
- `src/v6/research-tools.ts`
- `src/v6/owner-content-handler.ts`
- `src/index-v6.ts`
- public MCP tool ABI
- Family / OAuth / Market Data / FORMAL Blind / OHLC / Crypto
- `wrangler.jsonc`
- Production deployment topology

## Evidence log

| Stage | Evidence | Result |
|---|---|---|
| Review-metrics prerequisite | Run `33496155753` | PASS |
| Swing RED shadow test | Run `33496517952`, job `99819864671` | EXPECTED FAIL — missing VNext swing module |
| Swing evidence implementation | GREEN validation pending | pending |
| Full regression | GREEN validation pending | pending |

## Rollback

Remove `src/v6/research-vnext/compute/swing-evidence.ts` and the swing shadow-test additions. No Production runtime depends on VNext.

## Final disposition

`IN_PROGRESS_GREEN_VALIDATION`
