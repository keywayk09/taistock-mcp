# Change Note — Research VNext Shadow Facade

- Date: 2026-09-01
- Branch: `refactor/research-vnext-foundation-20260901`
- Prerequisite GitHub Memory Adapter: Run `33498838356` — SUCCESS
- Production mutation: **NONE**
- Production registration change: **NONE**

## Purpose

Create one small, unregistered VNext composition surface for deterministic review evidence, swing evidence, selective 1m replay, and GPT research memory. This facade is the future boundary for a lazy adapter or dedicated internal Worker, without exposing legacy implementation topology.

## Test-before-build proof

RED commit: `d9c305b2f050b1130e65b7f36011dd1c9964c255`.

- Run `33499093075`
- Job `99827986998`
- Change Note / protected-surface scope gate: **PASS**
- all previously built VNext modules: **PASS**
- Shadow Facade test: **FAIL (EXPECTED RED)**
- exact failure: `ERR_MODULE_NOT_FOUND` for `src/v6/research-vnext/shadow-facade.ts`
- downstream type-check / regression / dry-run: correctly **SKIPPED**

This failed receipt is preserved.

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

## GREEN implementation

Implementation commit: `7abdc510ffdd29b030e2cc5b045bee937ab29cae`.

Added only `src/v6/research-vnext/shadow-facade.ts`.

The facade exposes a frozen contract plus four VNext capability groups:

1. `summarizeReviewEvidence`
2. `rankSwingEvidence` / `summarizeSwingOutcomes`
3. `resolveSelective1mReplay`
4. `memory` adapter

It contains no tool registration and no direct provider access.

## Final GREEN evidence

Validated branch head: `6b25ff4332eb7cb1ec5ebbd37df958c635734743`.

Research VNext Incremental Gate:

- Run `33499196388`
- Job `99828313013`
- protected-surface scope gate: **PASS**
- all VNext tests: **PASS**
- VNext-only delegation assertions: **PASS**
- Type-check: **PASS**
- Full existing `test:research`: **PASS**
- Wrangler dry-run: **PASS**
- receipt/upload: **PASS**

Independent repository CI:

- Run `33499196465`
- Job `99828313102`
- Type-check: **PASS**
- Full existing `test:research`: **PASS**
- Wrangler dry-run: **PASS**

Artifact:

- ID `9796998155`
- name `research-vnext-evidence-33499196388`
- digest `sha256:9f58efd36fe25c3e54fdbf22520f2b509caad6ebb6c9dcc3c50c4e32d6c717c2`
- expires `2026-10-01`

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
| Facade RED | Run `33499093075`, job `99827986998` | EXPECTED FAIL — missing facade |
| Facade implementation | Commit `7abdc510ffdd29b030e2cc5b045bee937ab29cae` | built, unregistered |
| Facade GREEN | Run `33499196388`, job `99828313013` | PASS |
| Independent repo regression | Run `33499196465`, job `99828313102` | PASS |
| Immutable-style evidence | Artifact `9796998155` | PASS |

## Final disposition

`PASS_SHADOW_FACADE_UNREGISTERED`
