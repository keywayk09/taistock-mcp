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

A legal RED requires:

1. blocked-skeleton final PASS disposition present;
2. Owner ABI exactly `123` / frozen digest;
3. the blocked workflow still emits its hard blocker;
4. `production_deploy_authorized=false` and `production_mutation=NONE` remain present;
5. blocked workflow still has no Cloudflare credentials or Production commands;
6. marker `ATOMIC_EXECUTION_MECHANICS_RED_READY=PASS` prints;
7. only then may the test fail because `src/v6/research-vnext/atomic-execution-mechanics.ts` does not exist.

Any earlier failure is a premise/harness failure and does not authorize implementation.

## GREEN implementation allowed after accepted RED

Add only:

- `src/v6/research-vnext/atomic-execution-mechanics.ts`

It must be pure/deterministic and have no imports or side effects.

Required APIs:

- `RESEARCH_VNEXT_ATOMIC_EXECUTION_MECHANICS_VERSION`
- `buildAtomicProductionExecutionMechanics(input)`
- `assessAtomicRollbackEligibility(input)`

The planner may only return operation intents / receipts. It must not contain executable Production commands.

## Explicitly forbidden

- modifying the hard-blocked workflow in this phase;
- wiring Cloudflare credentials;
- network access;
- subprocesses;
- Wrangler/curl commands;
- Production MCP contact;
- real deploy or rollback;
- OAuth KV mutation;
- Cron mutation;
- automatic rollback;
- Legacy deletion;
- PR #206 merge.

## RED evidence

Pending.

## GREEN evidence

Pending.

## Final disposition

`ATOMIC_EXECUTION_MECHANICS_RED_PENDING`
