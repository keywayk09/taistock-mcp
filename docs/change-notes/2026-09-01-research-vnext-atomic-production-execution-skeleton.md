# Change Note — Research VNext Atomic Production Execution Workflow Blocked Skeleton

- Date: `2026-09-01`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — must remain Draft/open/unmerged
- Prerequisite Authorization Policy seal: `a8488712466a9f5c1615283a88147367e3a07dfd`
- Seal CI: Incremental `33515037359` SUCCESS; Type check `33515037433` SUCCESS; Isolation `33515037338` SUCCESS
- Frozen Owner ABI: `123` tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Legacy retirement: **BLOCKED_UNTIL_PRODUCTION_SWITCH_STABLE**
- Production deploy: **NONE**
- Production mutation: **NONE**

## Purpose

Create a test-first, permanently blocked GitHub Actions workflow skeleton for a future Research VNext atomic Production cutover.

This phase does **not** create a deploy executor. The skeleton is only a machine-readable authorization envelope so later phases have a single manually dispatched surface whose required inputs and safety policy are already frozen.

## Safety design

The skeleton must:

1. be `workflow_dispatch` only;
2. expose `confirmation` and `expected_sha` inputs;
3. freeze the required confirmation string `EXECUTE_ATOMIC_VNEXT_PRODUCTION` and the exact-40-hex SHA requirement;
4. run checkout only, then immediately emit `ATOMIC_PRODUCTION_EXECUTION_BLOCKED_PENDING_EXPLICIT_AUTHORIZATION` and exit `78`;
5. expose policy constants for the future pre-deploy active-version snapshot, exact Cron pre/post match, conditional/manual rollback eligibility, read-only postdeploy probe and frozen Owner ABI;
6. contain no Cloudflare secrets, Wrangler commands, curl/fetch, Production endpoint, setup-node, dependency install, deployment, rollback or Production probe command;
7. record `production_deploy_authorized=false` and `production_mutation=NONE`.

A later separately RED-proven phase may add execution mechanics. This phase is not that authorization.

## TEST BEFORE BUILD

RED test:

- `tests/research-vnext-atomic-production-execution-skeleton.test.ts`
- RED commit: `86f517a7650568da12875339135c2231cb297119`

Legal RED requires all of these to pass before the missing-workflow failure:

- Authorization Policy seal exists with final disposition `PASS_ATOMIC_DEPLOY_AUTHORIZATION_POLICY_EXECUTION_BLOCKED_PRODUCTION_UNCHANGED`;
- Owner ABI remains exactly `123` / frozen digest;
- Legacy retirement remains blocked;
- authorization policy remains `DESIGN_ONLY_EXECUTION_BLOCKED` / `MANUAL_ONLY_REQUIRED`;
- exact confirmation / SHA / existing-KV / protected-export / rollback contracts remain frozen;
- automatic rollback remains `false`;
- `production_deploy_authorized=false`;
- Production mutation remains NONE;
- marker `ATOMIC_PRODUCTION_EXECUTION_SKELETON_RED_READY=PASS` prints;
- only then may the test fail because `.github/workflows/research-vnext-atomic-production-execution.yml` does not exist.

## RED evidence — ACCEPTED

Research VNext Incremental Gate:

- Run `33515386896`
- Job `99880997460`
- Change Note / protected-surface scope gate: **PASS**
- Phase 10B bounded exception: `PHASE10B_HANDLER_CUTOVER_EXCEPTION=PASS`
- authorization-policy test immediately before the new skeleton test: **PASS**
- atomic-deploy-preflight test immediately before the new skeleton test: **PASS**
- exact marker: `ATOMIC_PRODUCTION_EXECUTION_SKELETON_RED_READY=PASS`
- Owner tool count: `123`
- Owner ABI digest: `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- authorization phase: `DESIGN_ONLY_EXECUTION_BLOCKED`
- workflow mode: `MANUAL_ONLY_REQUIRED`
- automatic rollback: `false`
- Production deploy authorized: `false`
- Production mutation: **NONE**
- terminal result: **EXPECTED RED**
- exact terminal error: `ENOENT` for `.github/workflows/research-vnext-atomic-production-execution.yml`
- downstream incremental type-check / full `test:research` / canonical dry-run / atomic-config dry-run: correctly **SKIPPED**

Independent validation on the RED commit:

- Type check Run `33515386890`: **SUCCESS**, including type-check, full `test:research`, and canonical Wrangler dry-run
- Isolation Run `33515386874`: FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE **PASS**; VNEXT failed only on the same expected missing workflow; isolation finalizer failed closed

Disposition: `ATOMIC_PRODUCTION_EXECUTION_SKELETON_RED_ACCEPTED_GREEN_IMPLEMENTATION_ALLOWED`.

The RED failure remains immutable and is not rewritten as PASS.

## GREEN implementation allowed

Add only:

- `.github/workflows/research-vnext-atomic-production-execution.yml`

The GREEN workflow remains a **blocked skeleton**, not an executor.

Required static contract:

- `workflow_dispatch` only;
- `permissions: contents: read`;
- input names `confirmation` and `expected_sha`;
- policy constants:
  - execution state `BLOCKED_SKELETON`;
  - required confirmation `EXECUTE_ATOMIC_VNEXT_PRODUCTION`;
  - expected SHA `EXACT_40_HEX_REQUIRED`;
  - pre-deploy rollback target `PREDEPLOY_ACTIVE_VERSION_REQUIRED`;
  - Cron contract `EXACT_PRE_POST_MATCH_REQUIRED`;
  - rollback eligibility `NO_DO_LIFECYCLE_CHANGE_AND_BINDINGS_STILL_VALID`;
  - uncertainty `FAIL_CLOSED_MANUAL_INTERVENTION`;
  - postdeploy probe `READ_ONLY_PRODUCTION_PROBE_REQUIRED`;
  - Owner ABI `123:00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`;
- checkout may run;
- immediately afterward one step named `Fail closed pending explicit Production authorization` emits the blocker and immutable status lines, then exits `78`;
- no Cloudflare credential wiring;
- no setup-node / npm install;
- no Wrangler/curl/fetch;
- no workers.dev or api.cloudflare.com endpoint;
- no Production probe script;
- no deploy/rollback operation.

## Explicitly forbidden

- real Production deploy;
- real Production rollback;
- Cloudflare API calls;
- Production MCP contact;
- Cloudflare credential wiring in the skeleton;
- OAuth KV mutation;
- Cron mutation;
- automatic rollback;
- protected export mutation;
- source `wrangler.jsonc` mutation;
- versions upload / gradual deployment;
- Legacy deletion;
- PR #206 merge.

## GREEN evidence

Pending.

## Final disposition

`ATOMIC_PRODUCTION_EXECUTION_SKELETON_GREEN_IMPLEMENTATION_ALLOWED`
