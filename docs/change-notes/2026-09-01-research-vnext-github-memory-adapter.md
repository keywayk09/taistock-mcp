# Change Note — Research VNext GitHub Memory Adapter

- Date: 2026-09-01
- Branch: `refactor/research-vnext-foundation-20260901`
- Prerequisite Memory Core: Run `33498386438` — SUCCESS
- Production mutation: **NONE**
- Production registration change: **NONE**

## Purpose

Add a thin persistence adapter around the already-validated pure Research VNext Memory Core. The adapter owns only runtime timestamp acquisition and canonical GitHub immutable-store I/O. It must not own market-data providers, research reasoning, strategy promotion, or MCP registration.

## Test-before-build

The RED gate is added before `src/v6/research-vnext/memory/github-memory-adapter.ts` exists.

Expected first failure: `ERR_MODULE_NOT_FOUND` for the adapter module. Preserve that failed receipt.

## Frozen adapter responsibilities

- obtain `recorded_at` from an injectable clock (default runtime UTC clock later);
- call pure Memory Core preparation functions;
- write via canonical `putIndexedImmutableRecord` only;
- read/list via canonical indexed-store functions only;
- preserve immutable conflict and idempotent replay semantics;
- translate canonical store errors without hiding error codes;
- preserve `GITHUB_ONLY`, `REVIEW_DOES_NOT_MUTATE_STRATEGY`, and `production_promotion=FORBIDDEN` markers;
- no direct `fetch`;
- no hypothesis/interpretation generation;
- no Production registration.

## In-memory RED/GREEN test

Uses the existing `__GITHUB_DATA_MEMORY` store mode, so CI validates actual canonical-store semantics without writing the real GitHub data repository.

Frozen cases:

1. first judgment write is immutable and non-idempotent;
2. exact replay is idempotent;
3. exact judgment read/list works;
4. same key with changed content fails `IMMUTABLE_CONFLICT`;
5. review persists only after original judgment lookup and core validation;
6. GPT trading knowledge persists with promotion forbidden;
7. filtered knowledge list works;
8. source boundary: adapter imports Core + canonical store, no direct provider access or GPT reasoning synthesis.

## Explicitly not changed

- pure `memory-core.ts` persistence boundary
- legacy `gpt-judgment-memory.ts`
- `research-tools.ts`
- Owner / Family / Market Data / FORMAL / OHLC
- MCP ABI/tool count
- `wrangler.jsonc`
- Production deployment topology

## Evidence log

| Stage | Evidence | Result |
|---|---|---|
| Memory Core prerequisite | Run `33498386438` | PASS |
| Adapter RED | pending | pending |
| Adapter GREEN | not built yet | pending |

## Final disposition

`RED_PENDING`
