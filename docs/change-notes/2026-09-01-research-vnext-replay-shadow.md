# Change Note — Research VNext Selective 1m Replay Shadow

- Date: 2026-09-01
- Branch: `refactor/research-vnext-foundation-20260901`
- Prerequisite swing evidence commit: `dee1f45e7e5a24894765ce8e6ef9285fed053acd`
- Prerequisite verification: Run `33496676642` — SUCCESS
- Production mutation: **NONE**
- Production registration change: **NONE**

## Purpose

Migrate the selective 1m replay deterministic core into Research VNext while preserving the existing frozen-data and conservative-resolution semantics exactly. GPT remains the interpretation/reasoning owner; replay only resolves factual intrabar ordering when the evidence permits it.

## Test-before-build plan

The RED shadow test is committed before `src/v6/research-vnext/compute/selective-1m-replay.ts` exists.

Strict success parity covers:

1. target touched first in chronological 1m bars;
2. stop touched first;
3. both touched in the same 1m bar, preserving conservative `STOP_FIRST`.

Strict error-code parity covers:

1. replay inconsistency where neither stop nor target is reproduced;
2. tampered 1m rows that no longer reproduce the frozen dataset hash;
3. replay requested for a 5m result that is not explicitly ambiguous/replay-required.

The VNext implementation must be independent and must not import/delegate to legacy selective replay. It must also remain provider-free, runtime-clock-free and reasoning-free.

## Required invariants

- exact frozen dataset/version/hash verification;
- exact row count and chronological/duplicate/OHLC validation;
- exact symbol/trade-date/bucket boundary checks;
- no future data outside the ambiguous 5m bucket;
- legacy conservative 5m result remains preserved in output;
- deterministic replay identity/hash;
- no fetch/provider access;
- no OHLC writes;
- no GPT hypothesis/interpretation logic;
- no Production registration.

## Explicitly not changed

- legacy `src/v6/selective-1m-replay.ts`
- `src/v6/selective-1m-replay-tool.ts`
- `src/v6/research-tools.ts`
- `src/v6/owner-content-handler.ts`
- `src/index-v6.ts`
- public MCP ABI
- Family / OAuth / Market Data / FORMAL Blind / OHLC / Crypto
- `wrangler.jsonc`
- Production deployment topology

## Evidence log

| Stage | Evidence | Result |
|---|---|---|
| Swing prerequisite | Run `33496676642` | PASS |
| Replay RED shadow test | pending | pending |
| Replay implementation | not created yet | pending |
| Full regression | pending | pending |

## Rollback

Remove the unregistered VNext replay shadow test. No Production runtime depends on VNext.

## Final disposition

`IN_PROGRESS_TEST_FIRST`
