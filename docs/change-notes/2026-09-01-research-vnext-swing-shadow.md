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

## Test-before-build plan

The RED test is added before `src/v6/research-vnext/compute/swing-evidence.ts` exists.

Strict shadow comparisons cover:

- score priority and probability fallback;
- symbol deduplication and tie-breaking by newer signal timestamp;
- invalid symbol/side filtering;
- current legacy minimum-one behavior for a zero limit;
- MFE/MAE and horizon outcome summary parity;
- deterministic horizon ordering.

Required verdict: `STRICT_DEEP_EQUAL`. The VNext source must not delegate to `review-orchestrator.ts` and must not own GPT interpretation logic.

## Explicitly not changed

- legacy `review-orchestrator.ts`
- review/swing MCP tool registration
- `research-tools.ts`
- `owner-content-handler.ts`
- `index-v6.ts`
- public MCP ABI
- Family / OAuth / Market Data / FORMAL Blind / OHLC / Crypto
- Production deployment topology

## Evidence log

| Stage | Evidence | Result |
|---|---|---|
| Review-metrics prerequisite | Run `33496155753` | PASS |
| Swing RED shadow test | pending | pending |
| Swing evidence implementation | not created yet | pending |
| Full regression | pending | pending |

## Rollback

Remove the unregistered swing shadow test. No Production runtime depends on VNext.

## Final disposition

`IN_PROGRESS_TEST_FIRST`
