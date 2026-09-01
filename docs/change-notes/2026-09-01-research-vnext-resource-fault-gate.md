# Change Note — Research VNext Resource / Fault Injection Gate

- Date: 2026-09-01
- Branch: `refactor/research-vnext-foundation-20260901`
- Prerequisite Gateway seal: commit `e7311b8a83c04ede7583c32544cca6e860a62bdf`
- Prerequisite CI: Incremental `33500798008` SUCCESS; Type check `33500798023` SUCCESS; Isolation `33500798022` SUCCESS
- Production mutation: **NONE**
- Production registration change: **NONE**

## Purpose

Add Phase 8 resource-budget enforcement and fault-injection evidence around the unregistered Research VNext gateway and its already-validated deterministic components.

This phase must not introduce a second runtime, provider, research brain, strategy rule, or Production registration. Resource policy is pure validation. Fault injection is test evidence.

## Before baseline

Validated prerequisite head: `e7311b8a83c04ede7583c32544cca6e860a62bdf`.

At this baseline:

- thin/lazy gateway: PASS, `SHADOW_UNREGISTERED`;
- per-call timeout/failure containment: PASS;
- Memory Core / GitHub adapter / Replay: PASS;
- Isolation fan-out: PASS across VNEXT / FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE;
- public MCP ABI: unchanged;
- Production registration: disabled.

## TEST BEFORE BUILD

RED Change Note commit: `345e7ff24ee3a151f1d401d976277be0fea17e53`.
RED test commit: `83dbb79e69fb2cb6fb5a9115a3015558fbcbc370`.

The RED test was committed before `src/v6/research-vnext/resource-policy.ts` existed.

## RED evidence

Research VNext Incremental Gate:

- Run `33501053608`
- Job `99834238126`
- Change Note / protected-surface scope gate: **PASS**
- existing Research VNext Boundary: **PASS**
- existing thin/lazy Gateway: **PASS**
- existing GitHub Memory Adapter: **PASS**
- existing Isolation manifest test: **PASS**
- existing Memory Core: **PASS**
- existing Selective 1m Replay shadow parity: **PASS**
- new Resource / Fault test: **FAIL (EXPECTED RED)**
- exact failure: `ERR_MODULE_NOT_FOUND` for `src/v6/research-vnext/resource-policy.ts`
- incremental type-check / full research regression / Wrangler dry-run: correctly **SKIPPED** after RED

This failed receipt is immutable and must not be relabeled as PASS.

## Frozen Phase 8 contract

Target pure module:

`src/v6/research-vnext/resource-policy.ts`

The policy may only:

- validate deterministic input shape;
- count bounded input bytes/nodes/depth/object keys/array items;
- fail closed before VNext facade lazy-load when a budget is exceeded;
- return deterministic resource statistics for accepted inputs.

It must not:

- access providers or call `fetch`;
- write storage;
- read runtime market state;
- generate thesis / interpretation / hypothesis;
- mutate strategy;
- register MCP tools;
- import Owner / Family / Market Data / FORMAL Blind / legacy research runtime.

Gateway integration may add a non-public `RESOURCE_LIMIT` structured error and injectable resource-policy limits. Existing Phase 7 gateway contract fields and public MCP ABI must remain unchanged.

## Required fault evidence

The GREEN test must cover at least:

1. malformed gateway input;
2. huge input rejected before facade load;
3. excessive array / depth / node budget;
4. Replay throw contained to one call;
5. Memory throw does not poison deterministic facade use;
6. bad Memory schema/input fails closed;
7. missing Replay/OHLC evidence fails closed;
8. repeated calls reuse one lazy facade and remain bounded;
9. cold-start contract inspection does not eager-load the facade;
10. circular/non-serializable resource shape fails closed;
11. existing bundle dry-run remains PASS;
12. Family / Market Data / FORMAL Blind / Owner-Ops remain PASS through the isolation fan-out gate.

## Stall rule

If the same resource-failure class survives two consecutive micro-fixes:

`STALL_DETECTED`

A third speculative patch is forbidden. Stop and perform architecture review instead.

## Explicitly not changed

- `src/v6/research-tools.ts`
- `src/v6/owner-content-handler.ts`
- `src/v6/mcp-runtime-composition.ts`
- `src/index-v6.ts`
- Family / OAuth / Market Data / FORMAL Blind
- OHLC Production Worker `tv-fugle-1d`
- `wrangler.jsonc`
- public MCP tools/count/schemas
- Production deploy topology
- legacy research runtime

## Risk

Resource limits can accidentally become trading semantics if they inspect market meaning. This phase therefore limits policy to structural size/shape only. Any future semantic eligibility rule requires a separate test-first change.

## Tests

RED/GREEN test:

- `tests/research-vnext-resource-fault.test.ts`

Required post-GREEN validation:

- all Research VNext tests;
- type-check;
- full `test:research`;
- Wrangler dry-run;
- full Research VNext Isolation Gate.

## GREEN implementation

Not built yet. Expected RED is formally proven; implementation is now allowed.

## GREEN evidence

Pending.

## Artifact / hash

Pending.

## Rollback

Remove the pure resource policy, its gateway integration, and the Phase 8 test. No Production runtime may depend on these unregistered paths.

## Final disposition

`RED_CONFIRMED_IMPLEMENTATION_ALLOWED`
