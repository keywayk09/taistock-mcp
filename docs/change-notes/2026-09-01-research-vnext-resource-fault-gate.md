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

## GREEN implementation

Implementation commit: `22d59b403647dd8406c0edcef4fbbb474009f148`.

The implementation was committed atomically as one tree update so no half-integrated resource-policy commit exists.

Added `src/v6/research-vnext/resource-policy.ts`:

- version `research-vnext-resource-policy/v1.0.0`;
- pure JSON-like structural resource measurement;
- default limits for bytes, array items, object keys, depth, and total nodes;
- deterministic accepted-input stats: `bytes`, `nodes`, `max_depth`;
- fail-closed `RESOURCE_LIMIT` for budget excess;
- fail-closed `INVALID_RESOURCE_SHAPE` for circular or non-serializable/non-plain shapes;
- no clock, provider, persistence, strategy, or reasoning dependency.

Updated only the unregistered `research-gateway.ts` integration:

- accepts optional internal `resourcePolicy` overrides;
- runs the resource guard before facade lazy-load and before capability dispatch;
- exposes internal structured `RESOURCE_LIMIT` error;
- keeps the exact Phase 7 gateway contract fields/version unchanged;
- keeps lazy cached loading, timeout, and per-call failure containment unchanged.

## Required fault evidence

The GREEN test covers:

1. malformed gateway input;
2. huge array rejected before facade load;
3. oversized text rejected before facade load;
4. excessive depth budget;
5. Replay throw contained to one call;
6. Memory failure does not poison deterministic facade compute;
7. invalid ACCEPTED Memory governance actor fails `HUMAN_APPROVAL_REQUIRED`;
8. missing Replay/OHLC evidence fails closed;
9. 50 repeated calls reuse one lazy facade;
10. cold-start contract inspection does not eager-load the facade;
11. circular/non-serializable structural shape fails closed;
12. bundle dry-run remains PASS;
13. Family / Market Data / FORMAL Blind / Owner-Ops remain PASS through isolation fan-out.

## GREEN evidence

Research VNext Incremental Gate:

- Run `33501254655`
- Job `99834873375`
- Change Note / protected-surface scope gate: **PASS**
- all Research VNext tests including Resource / Fault gate: **PASS**
- Type-check: **PASS**
- Full existing `test:research`: **PASS**
- Wrangler deploy dry-run: **PASS**
- immutable-style receipt generation/upload: **PASS**

Independent repository CI:

- Run `33501254802`
- Job `99834874121`
- Type-check: **PASS**
- Full existing `test:research`: **PASS**
- Wrangler deploy dry-run: **PASS**

Research VNext Isolation Gate:

- Run `33501254673`
- `domain-BUNDLE` job `99834873651`: **PASS**
- `domain-OWNER_OPS` job `99834873857`: **PASS**
- `domain-FAMILY` job `99834873985`: **PASS**
- `domain-VNEXT` job `99834874001`: **PASS**
- `domain-MARKET_DATA` job `99834874014`: **PASS**
- `domain-FORMAL_BLIND` job `99834874843`: **PASS**
- `isolation-evidence` job `99835034621`: **PASS**
- fail-closed final assertion: **PASS**

## Artifact / hash

- Incremental evidence artifact ID `9797797781`
  - digest `sha256:9e55ffad2f340551c561977f7a14774d97b7e52890809472d251d8f552623c63`
  - expires `2026-10-01`
- Isolation evidence artifact ID `9797792730`
  - digest `sha256:45cd492a24d5ef9a0f002fc98dcc91be520deb9916352d59ea4536fc8b639d20`
  - expires `2026-10-01`
- Isolation bundle artifact ID `9797787045`
  - digest `sha256:36858597d1094200324e9dc8e6c4a4fb2fbdebdf2e3d64fb37902cd75be2a7a1`
  - expires `2026-10-01`

## Stall rule

No repeated resource-failure micro-fix occurred in this phase. `STALL_DETECTED` was not triggered.

If the same resource-failure class survives two consecutive micro-fixes in later work:

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
- Production deployment or registration

## Risk

Resource limits can accidentally become trading semantics if they inspect market meaning. This implementation stays structural only and has no market-rule branches. Any future semantic eligibility rule requires a separate test-first change.

## Tests

- `tests/research-vnext-resource-fault.test.ts`: **PASS**
- all Research VNext tests: **PASS**
- type-check: **PASS**
- full `test:research`: **PASS**
- Wrangler dry-run: **PASS**
- independent isolation fan-out: **PASS**

## Evidence log

| Stage | Evidence | Result |
|---|---|---|
| Gateway prerequisite seal | Commit `e7311b8a83c04ede7583c32544cca6e860a62bdf` | PASS |
| Resource/Fault Change Note RED | Commit `345e7ff24ee3a151f1d401d976277be0fea17e53` | scope frozen |
| Resource/Fault RED test | Commit `83dbb79e69fb2cb6fb5a9115a3015558fbcbc370` | test first |
| Resource/Fault RED | Run `33501053608`, job `99834238126` | EXPECTED FAIL — missing resource policy |
| Resource policy + gateway integration | Commit `22d59b403647dd8406c0edcef4fbbb474009f148` | atomic, unregistered |
| Incremental GREEN | Run `33501254655`, job `99834873375` | PASS |
| Independent repo CI | Run `33501254802`, job `99834874121` | PASS |
| Isolation GREEN | Run `33501254673` | PASS — all six domains + evidence |
| Immutable-style evidence | Artifacts `9797797781`, `9797792730`, `9797787045` | PASS |

## Rollback

Remove the pure resource policy and revert its unregistered gateway integration plus the Phase 8 test. No Production runtime depends on these paths.

## Final disposition

`PASS_RESOURCE_FAULT_GATE_SHADOW_UNREGISTERED`
