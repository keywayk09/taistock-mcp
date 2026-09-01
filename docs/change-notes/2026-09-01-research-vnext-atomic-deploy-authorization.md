# Change Note — Research VNext Atomic Production Deploy Authorization Policy

- Date: `2026-09-01`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — must remain Draft/open/unmerged
- Prerequisite Atomic Deploy Preflight seal: `a5d9fa87dca75af35b977bf1fc9ee11511b8b0fc`
- Prerequisite seal CI: Incremental `33513456976` SUCCESS; Type check `33513457024` SUCCESS; Isolation `33513456959` SUCCESS
- Frozen Owner ABI: `123` tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Legacy retirement: **BLOCKED_UNTIL_PRODUCTION_SWITCH_STABLE**
- Production deploy: **NONE**
- Production mutation: **NONE**

## Purpose

Freeze the exact safety contract that must be satisfied before any real Research VNext atomic Production deployment workflow may be built or authorized.

This phase is **policy-only**. It does not create an executor, dispatch a Production workflow, contact Production, or invoke Cloudflare.

## Platform rollback contract

Current Cloudflare Workers documentation establishes the rollback constraints used by this policy:

1. rollback to an eligible version immediately creates a 100%-traffic deployment of that version;
2. connected resources are not changed by rollback;
3. rollback is not allowed across a Durable Object lifecycle change made through declarative `exports` or legacy `migrations`;
4. rollback can be rejected when the target version depends on a bound resource that no longer exists or is no longer compatible;
5. rollback eligibility is limited to recent published versions.

Therefore this cutover treats rollback as eligible only when the exact pre-deploy active version is captured, protected `MyMCP` / `FamilyMCP` exports remain lifecycle-identical, no Durable Object lifecycle change occurs, and required bindings remain valid. Any uncertainty fails closed to manual intervention. Blind automatic rollback is forbidden.

## Current repository facts

- Atomic deploy dry-run preflight is sealed as `PASS_ATOMIC_DEPLOY_PREFLIGHT_DRY_RUN_ONLY_PRODUCTION_UNCHANGED`.
- The sealed planner preserves `MyMCP` and `FamilyMCP` exports exactly, injects an already-existing OAuth KV ID, removes triggers from the temporary config, disables auto-provision / auto-create, and records real deploy semantics as immediate 100% traffic.
- `.github/workflows/research-vnext-production-validation.yml` remains manual/read-only and requires `READ_ONLY_PRODUCTION_PROBE` before Production contact.
- Canonical `.github/workflows/deploy-cloudflare-production.yml` is not reused for VNext cutover because it may create OAuth KV and explicitly PUT Cron in addition to deployment.
- `.github/workflows/research-vnext-version-upload.yml` remains fail-closed because Durable Object `exports` block versions upload / gradual deployment for this Worker.

## TEST BEFORE BUILD

RED test:

- `tests/research-vnext-atomic-deploy-authorization.test.ts`
- RED commit: `317b74e546384f0d8af56e3f239d43e9a2b3a1b7`

Legal RED requirements:

1. prerequisite atomic deploy preflight seal present;
2. Owner ABI remains exactly `123` / frozen digest;
3. Legacy retirement remains blocked;
4. DO lifecycle policy still requires atomic deployment and blocks versions upload;
5. protected exports remain `MyMCP`, `FamilyMCP`;
6. sealed atomic planner remains dry-run-only and Production unauthorized;
7. read-only Production validation remains manual;
8. canonical Production workflow still contains unrelated KV-create / Cron-PUT side effects and is therefore not reused;
9. version-upload path remains platform-blocked;
10. marker `ATOMIC_DEPLOY_AUTHORIZATION_PRECONDITIONS=PASS` prints;
11. only then may the test fail because `src/v6/research-vnext/atomic-deploy-authorization.ts` does not exist.

## RED evidence — ACCEPTED

Research VNext Incremental Gate:

- Run `33514436647`
- Job `99877788552`
- Change Note / protected-surface scope gate: **PASS**
- Phase 10B bounded exception: `PHASE10B_HANDLER_CUTOVER_EXCEPTION=PASS`
- exact marker: `ATOMIC_DEPLOY_AUTHORIZATION_PRECONDITIONS=PASS`
- Owner tool count: `123`
- Owner ABI digest: `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- protected exports: `MyMCP`, `FamilyMCP`
- atomic preflight: `SEALED_DRY_RUN_ONLY`
- canonical Production workflow: `UNSUITABLE_FOR_VNEXT_CUTOVER_DUE_TO_EXTRA_SIDE_EFFECTS`
- versions upload: `BLOCKED_WHILE_DURABLE_OBJECT_EXPORTS_PRESENT`
- Legacy retirement: `BLOCKED_UNTIL_PRODUCTION_SWITCH_STABLE`
- Production mutation: **NONE**
- terminal result: **EXPECTED RED**
- exact terminal error: `ERR_MODULE_NOT_FOUND` for `src/v6/research-vnext/atomic-deploy-authorization.ts`
- downstream incremental type-check / full `test:research` / canonical dry-run / atomic-config dry-run: correctly **SKIPPED**

Independent validation on the RED commit:

- Type check Run `33514436808`: **SUCCESS**, including type-check, full `test:research`, and canonical Wrangler dry-run
- Isolation Run `33514436508`: FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE **PASS**; VNEXT failed only on the same expected missing policy module; isolation finalizer failed closed

Disposition: `ATOMIC_DEPLOY_AUTHORIZATION_POLICY_RED_ACCEPTED_GREEN_IMPLEMENTATION_ALLOWED`.

The RED failure remains immutable and is not rewritten as PASS.

## GREEN implementation

Implementation commit:

- `48b02f731d0617fc7d26ceb0ecb474db0dc6e142`

Added exactly one policy-only module:

- `src/v6/research-vnext/atomic-deploy-authorization.ts`

No executable Production deploy/rollback workflow was added.

The policy freezes:

- `schema = RESEARCH_VNEXT_ATOMIC_DEPLOY_AUTHORIZATION_V1`
- `phase = DESIGN_ONLY_EXECUTION_BLOCKED`
- `workflow_mode = MANUAL_ONLY_REQUIRED`
- required confirmation = `EXECUTE_ATOMIC_VNEXT_PRODUCTION`
- source SHA = exact 40-hex required
- OAuth KV = existing secret input only
- pre-deploy snapshot = active deployment and exact version required
- Cron = exact pre/post snapshot match required
- protected exports = `MyMCP`, `FamilyMCP`
- DO lifecycle change = `FORBIDDEN_FOR_THIS_CUTOVER`
- deploy semantics = `ATOMIC_IMMEDIATE_100_PERCENT`
- rollback mode = exact version ID only
- rollback target = exact pre-deploy active version
- rollback eligibility = only if no DO lifecycle change occurred and required bindings remain valid
- automatic rollback = `false`
- rollback uncertainty = `FAIL_CLOSED_MANUAL_INTERVENTION`
- post-deploy probe = `READ_ONLY_PRODUCTION_PROBE_REQUIRED`
- Owner tool count = `123`
- Owner ABI digest = frozen digest
- Legacy retirement remains `BLOCKED_UNTIL_PRODUCTION_SWITCH_STABLE`
- Production deploy authorized = `false`
- Production mutation = `NONE`

The policy source contains no imports, network access, Cloudflare API access, subprocesses, or executable Wrangler commands.

## GREEN evidence — PASS

Research VNext Incremental Gate:

- Run `33514688088`: **SUCCESS**
- all Research VNext tests: **PASS**
- authorization policy contract: **PASS**
- incremental type-check: **PASS**
- full `test:research`: **PASS**
- canonical Wrangler dry-run: **PASS**
- atomic temporary-config Wrangler dry-run: **PASS**
- evidence receipt/upload: **PASS**
- frozen Owner ABI: **PASS** — `123` tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production deploy authorized: `false`
- Production mutation: **NONE**

Incremental evidence artifact:

- artifact ID: `9803099995`
- digest: `sha256:93071d1cf6ac46190db5d1e79a59fa6dd7ca5d51a0e184f9809d5eb1870f0049`

Independent Type check:

- Run `33514687970`: **SUCCESS**
- type-check: **PASS**
- full `test:research`: **PASS**
- canonical Wrangler dry-run: **PASS**

Isolation Gate:

- Run `33514687876`: **SUCCESS**
- VNEXT: **PASS**
- FAMILY: **PASS**
- MARKET_DATA: **PASS**
- FORMAL_BLIND: **PASS**
- OWNER_OPS: **PASS**
- BUNDLE: **PASS**
- isolation finalizer: **PASS**

Isolation artifacts:

- evidence artifact ID: `9803093791`
- evidence digest: `sha256:dcd8bcc8f5a7f65a8f7aad5e05619c5982066f4effd61df6a9dc340c7a76e2b0`
- bundle artifact ID: `9803089361`
- bundle digest: `sha256:e121453b927673f843ca717935cc4dc6200a22398f535269f8b152f87af82b4e`

Additional workflows on implementation commit:

- P7 Swing Outcome Path `33514688068`: **SUCCESS**
- P8 Experiment Memory `33514687894`: **SUCCESS**
- P9 Diamond Capability Registry `33514688089`: **SUCCESS**
- P11 Research Validation `33514687844`: **SUCCESS**
- P12 Strategy Lab Governance `33514688005`: **SUCCESS**
- P13 Cross-market Supply Chain Graph `33514688073`: **SUCCESS**
- P13b Supply Chain Data Plane `33514688147`: **SUCCESS**
- P14 TXF Dual-market Review `33514688022`: **SUCCESS**
- P15 Review Swing Orchestration `33514687975`: **SUCCESS**
- P16 GPT Judgment Memory `33514688028`: **SUCCESS**

## Production facts throughout this phase

- real Production deploy: **NONE**
- real rollback: **NONE**
- executable VNext Production deploy workflow created: **NO**
- Cloudflare API writes: **NONE**
- Production workflow dispatch: **NONE**
- Production MCP contact: **NONE**
- OAuth KV mutation: **NONE**
- Cron mutation: **NONE**
- protected export mutation: **NONE**
- traffic shift: **NONE**
- public ABI drift: **NONE**
- Legacy retirement: **BLOCKED**
- PR #206 merge: **NONE**

## Explicitly forbidden after this seal

- treating this policy PASS as Production execution authorization;
- any real Production deploy or rollback without a separately tested manual execution gate and a later explicit authorization;
- automatic rollback;
- rollback when DO lifecycle identity or required bindings are uncertain;
- Cloudflare control-plane writes outside the separately authorized execution phase;
- OAuth KV or Cron mutation;
- versions upload / gradual deployment while Durable Object `exports` remain;
- protected export mutation;
- source `wrangler.jsonc` mutation as a shortcut;
- Legacy deletion before Production switch stability;
- PR #206 merge before later cutover acceptance.

## Next phase

The next safe phase is a **manual Production Atomic Deploy Execution Workflow RED / blocked-skeleton design**. It must remain non-executable until its own RED/GREEN gates and a later explicit Production authorization are complete.

That phase must test-first freeze at least:

- `workflow_dispatch` only;
- exact branch SHA and explicit confirmation inputs;
- existing Production OAuth KV ID as immutable secret input only;
- pre-deploy active deployment/version snapshot;
- pre-deploy Cron snapshot;
- sealed atomic planner and root-anchored temporary config;
- exact protected exports and no trigger mutation intent;
- auto-provision / auto-create disabled;
- real deploy semantics explicitly documented as immediate 100% switch;
- exact pre-deploy rollback target capture;
- rollback eligibility only when no DO lifecycle change occurred and bindings remain valid;
- no automatic rollback;
- post-deploy read-only Production probe and exact Owner ABI `123` / frozen digest;
- Cron post-snapshot exact match;
- Legacy retained until Production switch stability;
- fail closed before any mutation unless a separate execution authorization is present.

## Final disposition

`PASS_ATOMIC_DEPLOY_AUTHORIZATION_POLICY_EXECUTION_BLOCKED_PRODUCTION_UNCHANGED`
