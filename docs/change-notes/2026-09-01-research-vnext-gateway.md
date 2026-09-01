# Change Note — Research VNext Thin / Lazy Gateway

- Date: 2026-09-01
- Branch: `refactor/research-vnext-foundation-20260901`
- Prerequisite Isolation Gate seal: commit `160953b822de1f607045bc5905d052b36a50a395`
- Prerequisite CI: Incremental `33500321943` SUCCESS; Type check `33500321954` SUCCESS; Isolation `33500321952` SUCCESS
- Production mutation: **NONE**
- Production registration change: **NONE**

## Purpose

Add the Phase 7 internal Research VNext gateway between future MCP registration and the already-validated unregistered shadow facade. The gateway must be thin, lazy, bounded, fail-closed, and still completely unregistered.

It is not a second research brain. GPT remains the sole reasoning owner. The gateway only provides lazy capability dispatch and failure containment around VNext deterministic infrastructure.

## Before baseline

Validated prerequisite head: `160953b822de1f607045bc5905d052b36a50a395`.

At this baseline:

- Memory Core: PASS
- GitHub Memory Adapter: PASS
- Shadow Facade: PASS and unregistered
- Isolation / ABI / regression fan-out: PASS
- Owner ABI: unchanged
- Production registration: disabled
- public MCP ABI/tool count: unchanged

## TEST BEFORE BUILD

RED Change Note commit: `8e4b95d17c2cdcb00bd2a3cbf74d94612dd50c90`.
RED test commit: `cf8fade56d6a9ed52254208f91b82835c0ce3e55`.

The RED test was committed before `src/v6/research-vnext/research-gateway.ts` existed.

## RED evidence

Research VNext Incremental Gate:

- Run `33500497344`
- Job `99832461609`
- Change Note / protected-surface scope gate: **PASS**
- existing Research VNext boundary test: **PASS**
- new gateway test: **FAIL (EXPECTED RED)**
- exact failure: `ERR_MODULE_NOT_FOUND` for `src/v6/research-vnext/research-gateway.ts`
- type-check / full research regression / Wrangler dry-run inside the incremental gate: correctly **SKIPPED** after RED

The failed receipt is immutable and must not be relabeled as PASS.

## Frozen gateway contract

Target module:

`src/v6/research-vnext/research-gateway.ts`

Required properties:

1. version `research-vnext-gateway/v1.0.0`;
2. runtime mode `SHADOW_UNREGISTERED`;
3. Production registration `DISABLED`;
4. GPT reasoning ownership preserved;
5. no static/eager import of `shadow-facade.ts`;
6. facade is loaded only on first capability invocation and then cached;
7. no imports from Owner, `research-tools.ts`, `index-v6.ts`, Family, Market Data, FORMAL Blind, or legacy research runtime;
8. no `registerTool` / MCP registration;
9. no direct provider `fetch`;
10. each capability failure is contained to that invocation and converted to a bounded structured gateway error;
11. configurable per-call timeout with deterministic `TIMEOUT` error;
12. unknown capability fails closed with `UNKNOWN_CAPABILITY`;
13. gateway does not synthesize thesis, interpretation, hypothesis, trading decision, or strategy promotion.

Initial internal capability names are frozen for the gateway layer only and do not change public MCP ABI:

- `review.summary`
- `swing.rank`
- `swing.outcomes`
- `replay.resolve`

Memory remains reachable through the loaded VNext facade, but no public registration change is permitted in this phase.

## Explicitly not changed

- `src/v6/research-tools.ts`
- `src/v6/owner-content-handler.ts`
- `src/v6/mcp-runtime-composition.ts`
- `src/index-v6.ts`
- Family / OAuth / Market Data / FORMAL Blind
- OHLC Production Worker `tv-fugle-1d`
- `wrangler.jsonc`
- public MCP tool names/count/schemas
- Production deploy topology
- legacy research runtime

## Risk

Primary risks are accidental eager coupling, unbounded error leakage, and introducing hidden registration or reasoning semantics. The RED/GREEN test plus existing isolation gate must fail closed on these classes.

## Tests

RED/GREEN test:

- `tests/research-vnext-gateway.test.ts`

After implementation, required validation remains:

- all Research VNext tests
- type-check
- full `test:research`
- Wrangler dry-run
- Research VNext Isolation Gate across VNEXT / FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE

## GREEN implementation

Not built yet. RED is now formally proven; implementation may proceed.

## GREEN evidence

Pending.

## Artifact / hash

Pending GREEN.

## Rollback

Remove the unregistered gateway and its test. No Production runtime may depend on it during this phase.

## Final disposition

`RED_CONFIRMED_IMPLEMENTATION_ALLOWED`
