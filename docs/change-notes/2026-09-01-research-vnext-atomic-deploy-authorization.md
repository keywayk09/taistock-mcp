# Change Note — Research VNext Atomic Production Deploy Authorization Policy

- Date: `2026-09-01`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — must remain Draft/open/unmerged
- Prerequisite Atomic Deploy Preflight seal: `a5d9fa87dca75af35b977bf1fc9ee11511b8b0fc`
- Seal CI: Incremental `33513456976` SUCCESS; Type check `33513457024` SUCCESS; Isolation `33513456959` SUCCESS
- Frozen Owner ABI: `123` tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Legacy retirement: **BLOCKED_UNTIL_PRODUCTION_SWITCH_STABLE**
- Production deploy: **NONE**
- Production mutation: **NONE**

## Purpose

Freeze the exact safety contract that must be satisfied before any real Research VNext atomic Production deployment workflow may be built or authorized.

This phase is **policy-only**. It must not create an executor, dispatch a Production workflow, contact Production, or invoke Cloudflare.

## Platform rollback contract

Current Cloudflare Workers documentation states:

1. `wrangler rollback <VERSION_ID>` immediately creates a deployment of the selected version at 100% traffic.
2. Connected resources are not changed by rollback.
3. Rollback is not allowed across a Durable Object lifecycle change made through `exports` or legacy `migrations`.
4. Rollback can also be rejected if a target version depends on a binding resource that has since been deleted or changed.
5. Only recent published versions are eligible rollback targets.

Therefore this cutover may treat rollback as eligible only if the pre-deploy active version is captured exactly, the protected `MyMCP` / `FamilyMCP` exports remain lifecycle-identical, no DO lifecycle reconciliation change occurs, and required bound resources still exist. Any uncertainty must fail closed to manual intervention; no blind automatic rollback is allowed.

## Current repository facts

- Atomic deploy dry-run preflight is sealed as `PASS_ATOMIC_DEPLOY_PREFLIGHT_DRY_RUN_ONLY_PRODUCTION_UNCHANGED`.
- The sealed planner preserves `MyMCP` and `FamilyMCP` exports exactly, injects an existing OAuth KV ID, removes triggers from the temporary config, disables auto-provision/auto-create, and records real deploy semantics as immediate 100% traffic.
- `.github/workflows/research-vnext-production-validation.yml` is manual/read-only and already requires `READ_ONLY_PRODUCTION_PROBE` before Production contact.
- Canonical `.github/workflows/deploy-cloudflare-production.yml` is not suitable for the VNext cutover because it may create OAuth KV and explicitly PUT Cron in addition to deploying.
- `research-vnext-version-upload.yml` remains fail-closed because Durable Object `exports` block versions upload / gradual deployment.

## TEST BEFORE BUILD

RED test:

- `tests/research-vnext-atomic-deploy-authorization.test.ts`

Legal RED requirements:

1. prerequisite atomic deploy preflight seal present;
2. Owner ABI remains exactly 123 / frozen digest;
3. Legacy retirement remains blocked;
4. DO lifecycle policy still requires atomic `wrangler deploy` and blocks versions upload;
5. protected exports remain `MyMCP`, `FamilyMCP`;
6. sealed atomic planner remains dry-run-only and Production unauthorized;
7. read-only Production validation remains manual;
8. canonical Production workflow still contains unrelated KV-create / Cron-PUT side effects and is therefore not reused;
9. version-upload path remains platform-blocked;
10. marker `ATOMIC_DEPLOY_AUTHORIZATION_PRECONDITIONS=PASS` prints;
11. only then may the test fail because `src/v6/research-vnext/atomic-deploy-authorization.ts` does not exist.

Any earlier failure is a premise/harness failure and does not authorize implementation.

## GREEN implementation allowed after accepted RED

Add one policy-only module:

- `src/v6/research-vnext/atomic-deploy-authorization.ts`

It must have no imports, network access, subprocesses, Cloudflare calls or executable Wrangler commands.

It must freeze at least:

- phase = `DESIGN_ONLY_EXECUTION_BLOCKED`
- workflow mode = `MANUAL_ONLY_REQUIRED`
- exact confirmation = `EXECUTE_ATOMIC_VNEXT_PRODUCTION`
- exact 40-hex source SHA required
- OAuth KV = existing secret input only
- pre-deploy active deployment/version snapshot required
- Cron pre/post exact match required
- protected exports = `MyMCP`, `FamilyMCP`
- DO lifecycle change = forbidden for this cutover
- deploy semantics = immediate atomic 100%
- rollback exact version ID only
- rollback target = exact pre-deploy active version
- rollback eligible only when no DO lifecycle change occurred and required bindings remain valid
- automatic rollback = false
- uncertainty = fail closed / manual intervention
- post-deploy read-only Production probe required
- Owner ABI = 123 / frozen digest
- Legacy retirement remains blocked until switch stability
- Production deploy authorized = false
- Production mutation = NONE

## Explicitly forbidden

- creating an executable Production deploy workflow in this phase;
- real `wrangler deploy` or `wrangler rollback`;
- Cloudflare API calls;
- Production workflow dispatch;
- Production MCP contact;
- OAuth KV mutation;
- Cron mutation;
- protected export mutation;
- source `wrangler.jsonc` mutation;
- versions upload / gradual deployment;
- automatic rollback;
- Legacy deletion;
- PR #206 merge.

## RED evidence

Pending.

## GREEN evidence

Pending.

## Final disposition

`ATOMIC_DEPLOY_AUTHORIZATION_POLICY_RED_PENDING`
