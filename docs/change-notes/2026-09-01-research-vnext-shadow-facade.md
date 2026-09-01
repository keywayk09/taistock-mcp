# Change Note — Research VNext Shadow Facade

- Date: 2026-09-01
- Branch: `refactor/research-vnext-foundation-20260901`
- Prerequisite GitHub Memory Adapter: Run `33498838356` — SUCCESS
- Production mutation: **NONE**
- Production registration change: **NONE**

## Purpose

Create one small, unregistered VNext composition surface for deterministic review evidence, swing evidence, selective 1m replay, and GPT research memory. This facade is the future boundary for a lazy adapter or dedicated internal Worker, without exposing legacy implementation topology.

## Test-before-build

RED test is added before `src/v6/research-vnext/shadow-facade.ts` exists. Expected first failure is `ERR_MODULE_NOT_FOUND`. Preserve the failed receipt.

## Frozen facade contract

- reasoning owner: GPT;
- backend roles: DATA / COMPUTE / REPLAY / EVIDENCE / MEMORY;
- direct provider access: FORBIDDEN;
- OHLC write: FORBIDDEN;
- automatic strategy promotion: FORBIDDEN;
- Production registration: DISABLED;
- Review delegates only to VNext review metrics;
- Swing delegates only to VNext swing evidence;
- Replay delegates only to VNext selective replay;
- Memory delegates only to VNext GitHub memory adapter;
- no imports from legacy review orchestrator, selective replay, or GPT judgment memory;
- no Owner/research-tools/registerTool imports.

## Explicitly not changed

- `src/v6/research-tools.ts`
- `src/v6/owner-content-handler.ts`
- `src/v6/mcp-runtime-composition.ts`
- `src/index-v6.ts`
- public MCP ABI/tool count
- Family / Market Data / FORMAL / OHLC / Crypto
- Production deployment topology

## Evidence log

| Stage | Evidence | Result |
|---|---|---|
| Adapter prerequisite | Run `33498838356` | PASS |
| Facade RED | pending | pending |
| Facade GREEN | not built yet | pending |

## Final disposition

`RED_PENDING`
