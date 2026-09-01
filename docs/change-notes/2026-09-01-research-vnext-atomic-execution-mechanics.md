# Change Note — Research VNext Atomic Production Execution Mechanics

- Date: `2026-09-01`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — must remain Draft/open/unmerged
- Prerequisite blocked-skeleton seal: `e2807a86d75d84ec0469be58ea2fa7ff95e43403`
- Seal CI: Incremental `33515875728` SUCCESS; Type check `33515875530` SUCCESS; Isolation `33515875603` SUCCESS
- Frozen Owner ABI: `123` tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production deploy authorization: **FALSE**
- Production deploy: **NONE**
- Production mutation: **NONE**

## Purpose

Define the future atomic Production cutover mechanics as a pure deterministic planner while the manual execution workflow remains permanently hard-blocked.

This phase must not add Cloudflare credentials, network access, subprocesses, executable Wrangler commands, Production endpoints, or any deploy/rollback capability.

## Mechanics to freeze

A valid future cutover plan must require:

- exact confirmation `EXECUTE_ATOMIC_VNEXT_PRODUCTION`;
- exact 40-hex expected SHA matching the actual source SHA;
- existing OAuth KV ID exactly 32 hex characters;
- exact pre-deploy active Worker version ID;
- exact pre-deploy Cron snapshot `*/5 * * * *`;
- protected exports exactly `MyMCP`, `FamilyMCP` in canonical order;
- a 64-hex binding fingerprint supplied by a future read-only snapshot phase;
- the hard blocker still active;
- `productionAuthorizationIssued=false` throughout this design phase.

The deterministic operation graph must freeze the future ordering without executing it:

1. local exact SHA / confirmation verification;
2. future read-only active deployment/version snapshot;
3. future read-only Cron pre-snapshot;
4. local atomic config build;
5. local exports/binding fingerprint verification;
6. future atomic deploy mutation — blocked;
7. future read-only Production probe;
8. future read-only Cron post-snapshot;
9. local ABI/Cron comparison;
10. local manual rollback eligibility assessment;
11. future exact-version manual rollback mutation — conditional and blocked.

## Rollback contract

Rollback remains manual only. Eligibility requires all of:

- exact pre-deploy target version available;
- no Durable Object lifecycle change;
- required bindings still valid;
- Cron pre/post snapshot unchanged.

Any failure must return `FAIL_CLOSED_MANUAL_INTERVENTION`. Automatic rollback remains forbidden.

## TEST BEFORE BUILD

RED test:

- `tests/research-vnext-atomic-execution-mechanics.test.ts`
- RED commit: `1c5ac73ec669b0f5d52d8b7b7c2cd74d4dc6d585`

A legal RED requires:

1. blocked-skeleton final PASS disposition present;
2. Owner ABI exactly `123` / frozen digest;
3. the blocked workflow still emits its hard blocker;
4. `production_deploy_authorized=false` and `production_mutation=NONE` remain present;
5. blocked workflow still has no Cloudflare credentials or Production commands;
6. marker `ATOMIC_EXECUTION_MECHANICS_RED_READY=PASS` prints;
7. only then may the test fail because `src/v6/research-vnext/atomic-execution-mechanics.ts` does not exist.

## RED evidence — ACCEPTED

Research VNext Incremental Gate:

- Run `33516205188`
- Job `99883740352`
- Change Note / protected-surface scope gate: **PASS**
- Phase 10B bounded exception: `PHASE10B_HANDLER_CUTOVER_EXCEPTION=PASS`
- authorization-policy test immediately before mechanics: **PASS**
- atomic-deploy-preflight test immediately before mechanics: **PASS**
- exact marker: `ATOMIC_EXECUTION_MECHANICS_RED_READY=PASS`
- Owner tool count: `123`
- Owner ABI digest: `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- blocked skeleton: `SEALED`
- Cloudflare credentials wired: `false`
- Production commands present: `false`
- Production deploy authorized: `false`
- Production mutation: **NONE**
- terminal result: **EXPECTED RED**
- exact terminal error: `ERR_MODULE_NOT_FOUND` for `src/v6/research-vnext/atomic-execution-mechanics.ts`
- downstream incremental type-check / full `test:research` / canonical dry-run / atomic-config dry-run: correctly **SKIPPED**

Independent validation on the RED commit:

- Type check Run `33516204985`: **SUCCESS**, including type-check, full `test:research`, and canonical Wrangler dry-run
- Isolation Run `33516204947`: FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE **PASS**; VNEXT failed only on the same expected missing mechanics module; isolation finalizer failed closed

Disposition: `ATOMIC_EXECUTION_MECHANICS_RED_ACCEPTED_GREEN_IMPLEMENTATION_ALLOWED`.

The RED failure remains immutable and is not rewritten as PASS.

## GREEN implementation

Implementation commit:

- `aac1b11a18af5914b89ea1c63924d190a95839c8`

Added only:

- `src/v6/research-vnext/atomic-execution-mechanics.ts`

The implementation is pure/deterministic, has no imports, network access, subprocesses, Cloudflare calls, Production endpoints, Wrangler/curl commands, or mutation capability.

Implemented APIs:

- `RESEARCH_VNEXT_ATOMIC_EXECUTION_MECHANICS_VERSION`
- `buildAtomicProductionExecutionMechanics(input)`
- `assessAtomicRollbackEligibility(input)`

The planner validates exact confirmation, SHA, OAuth KV ID, pre-deploy version, Cron snapshot, protected exports, binding fingerprint, hard-blocker state and design-phase authorization state, then returns a frozen operation graph. Rollback assessment remains manual-only and fails closed on any lifecycle/binding/version/Cron uncertainty.

The hard-blocked manual workflow was **not modified**.

## GREEN evidence — PASS

Research VNext Incremental Gate:

- Run `33517140540`: **SUCCESS**
- all Research VNext tests: **PASS**
- incremental type check: **PASS**
- full `test:research`: **PASS**
- canonical Wrangler dry-run: **PASS**
- atomic deploy config dry-run: **PASS**
- evidence artifact ID: `9804092088`
- evidence artifact digest: `sha256:df2ea76b5784cddab60f127fd7710b09fca848a22746e2b46504026b098c55bf`

Independent Type check:

- Run `33517140498`: **SUCCESS**
- type-check: **PASS**
- full `test:research`: **PASS**
- canonical Wrangler dry-run: **PASS**

Isolation Gate:

- Run `33517140477`: **SUCCESS**
- VNEXT: **PASS**
- FAMILY: **PASS**
- MARKET_DATA: **PASS**
- FORMAL_BLIND: **PASS**
- OWNER_OPS: **PASS**
- BUNDLE: **PASS**
- isolation evidence artifact ID: `9804087187`
- isolation evidence digest: `sha256:99e68bf60b1a5fc02f030723ec5872faa1e020b155ea2286d2481a9bed9475c8`
- isolation bundle artifact ID: `9804078748`
- isolation bundle digest: `sha256:c3c154bedd75b11d1efffec65fc47a2cbdeb6d94b340390059f7dd77f0d5d341`

Frozen public ABI remains:

- Owner tool count: `123`
- Owner ABI digest: `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`

Production status remains:

- deploy authorization: **FALSE**
- deploy: **NONE**
- rollback: **NONE**
- mutation: **NONE**
- Legacy retirement: **BLOCKED**
- PR #206: **Draft/open/unmerged**

## Explicitly forbidden

- modifying or removing the hard blocker as part of this phase;
- wiring Cloudflare credentials;
- network access;
- subprocesses;
- Wrangler/curl Production commands;
- Production MCP contact;
- real deploy or rollback;
- OAuth KV mutation;
- Cron mutation;
- automatic rollback;
- Legacy deletion;
- PR #206 merge.

## Final disposition

`PASS_ATOMIC_EXECUTION_MECHANICS_BEHIND_HARD_BLOCKER_PRODUCTION_UNCHANGED`
