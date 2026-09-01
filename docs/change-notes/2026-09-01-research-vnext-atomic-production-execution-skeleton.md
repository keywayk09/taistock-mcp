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

This phase must **not** create a deploy executor. The skeleton is only a machine-readable authorization envelope so later phases have a single manually dispatched surface whose required inputs and safety policy are already frozen.

## Safety design

The future skeleton must:

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

Any earlier failure is a premise/harness failure and does not authorize implementation.

## GREEN implementation allowed after accepted RED

Add only:

- `.github/workflows/research-vnext-atomic-production-execution.yml`

The GREEN workflow must remain a **blocked skeleton**, not an executor.

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
- immediately afterward one step named `Fail closed pending explicit Production authorization` must emit `ATOMIC_PRODUCTION_EXECUTION_BLOCKED_PENDING_EXPLICIT_AUTHORIZATION`, `production_deploy_authorized=false`, `production_mutation=NONE`, then exit `78`;
- no Cloudflare credential wiring;
- no setup-node / npm install;
- no Wrangler/curl/fetch;
- no workers.dev or api.cloudflare.com endpoint;
- no Production probe script;
- no deploy/rollback operation.

## Explicitly forbidden

- real `wrangler deploy`;
- real `wrangler rollback`;
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

## RED evidence

Pending.

## GREEN evidence

Pending.

## Final disposition

`ATOMIC_PRODUCTION_EXECUTION_SKELETON_RED_PENDING`
