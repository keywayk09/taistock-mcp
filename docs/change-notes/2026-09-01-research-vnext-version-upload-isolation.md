# Change Note — Research VNext Version Upload Isolation Gate

- Date: `2026-09-01`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — must remain Draft/open/unmerged
- Prerequisite Production Validation Preflight seal: `541eec98372217ceff9245a91b5b3433a840ad2d`
- Preflight seal CI: Incremental `33508377218` SUCCESS; Type check `33508377075` SUCCESS; Isolation `33508377130` SUCCESS
- Frozen Owner ABI: `123` tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Legacy retirement: **BLOCKED_UNTIL_PRODUCTION_SWITCH_STABLE**
- Production deploy: **NONE**
- Production mutation in this phase: **NONE**

## External platform contract reviewed

Current Cloudflare Workers/Wrangler documentation distinguishes Worker Versions from Deployments:

- `wrangler versions upload` creates a Worker version without deploying it to traffic;
- trigger changes are applied separately with `wrangler triggers deploy` when using the versions workflow;
- a Worker version contains code, bindings and compatibility configuration;
- KV bindings require a concrete namespace ID;
- Wrangler exposes automatic provisioning / auto-create controls and both must be forced off for this path;
- this Worker uses Durable Objects, so version Preview URLs cannot be relied upon for validation;
- `versions list --json` is available for machine-readable version evidence.

This phase freezes those constraints into repository tests and prepares a future manually authorized, undeployed version-upload path. It does **not** execute that path.

## Existing deployment blockers

`wrangler.jsonc` currently contains:

- `OAUTH_KV` binding without a namespace `id`;
- a `*/5 * * * *` Cron declaration;
- Durable Object bindings for `MyMCP` and `FamilyMCP`.

The canonical Production workflow resolves/creates OAuth KV and separately PUTs Cron schedules. Reusing it would therefore mutate unrelated control-plane resources.

A bounded version-upload path instead treats the existing OAuth KV namespace ID as a pre-existing immutable input and disables Wrangler automatic resource provisioning.

## Purpose

Prepare and test a manual-only workflow that can, in a later explicitly authorized phase, upload a new `taistock-mcp` Worker **version without deploying it to traffic and without changing triggers or creating resources**.

The path must:

1. require `workflow_dispatch` only;
2. require exact confirmation `UPLOAD_UNDEPLOYED_VNEXT_VERSION`;
3. accept the existing OAuth KV namespace ID only from dedicated secret `RESEARCH_VNEXT_OAUTH_KV_ID`;
4. validate that ID is exactly 32 hex characters;
5. generate a temporary Wrangler config that injects that existing ID;
6. remove the `triggers` block from the temporary upload config;
7. invoke only `wrangler versions upload` for the write step;
8. force `--experimental-provision=false` and `--experimental-auto-create=false`;
9. never invoke `wrangler deploy`, `wrangler versions deploy`, `wrangler triggers deploy`, Cloudflare REST resource creation, or Cron mutation;
10. resolve the uploaded version ID via read-only `wrangler versions list --json` and store a receipt;
11. prove active deployments are identical before/after upload;
12. not contact Production MCP and not shift traffic;
13. leave Legacy fallback intact.

## TEST BEFORE BUILD

RED test:

- `tests/research-vnext-version-upload-isolation.test.ts`
- RED commit: `cf7fa5d54548c77396e6621637c2ec21c37d9891`

A legal RED required all prechecks to pass first:

- Production Validation Preflight remains sealed;
- public ABI fixture remains `123` / frozen digest;
- Legacy retirement remains blocked;
- source Wrangler config still exposes the exact missing-KV-ID + Cron condition this phase is designed to isolate;
- canonical deploy still contains the disallowed OAuth KV/Cron control-plane side effects;
- marker `VERSION_UPLOAD_ISOLATION_RED_READY=PASS` prints;
- only then failure may occur because `scripts/research-vnext-version-upload-plan.mjs` does not exist.

## RED evidence — ACCEPTED

Research VNext Incremental Gate:

- Run `33508779546`
- Job `99859111278`
- Change Note / protected-surface gate: **PASS**
- Phase 10B bounded exception: `PHASE10B_HANDLER_CUTOVER_EXCEPTION=PASS`
- all earlier Research VNext tests before this test: **PASS**
- Production Validation Preflight test: **PASS**
- public ABI snapshot immediately before RED: **PASS** — `123` tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Switch Stability precheck: **PASS**
- exact marker: `VERSION_UPLOAD_ISOLATION_RED_READY=PASS`
- source OAuth KV ID present: `false`
- source Cron present: `true`
- canonical deploy resource side effects: `true`
- Legacy retirement: `BLOCKED_UNTIL_PRODUCTION_SWITCH_STABLE`
- Production mutation: **NONE**
- terminal result: **EXPECTED RED**
- exact error: `ERR_MODULE_NOT_FOUND` for `scripts/research-vnext-version-upload-plan.mjs`
- downstream incremental type-check / full `test:research` / Wrangler dry-run: correctly **SKIPPED**

Disposition: `VERSION_UPLOAD_ISOLATION_RED_ACCEPTED_IMPLEMENTATION_ALLOWED`.

## GREEN implementation

Implementation commit: `14e01d84b86169b26d764a9de5947ec16623ddc6`.

Added only:

### `scripts/research-vnext-version-upload-plan.mjs`

- pure local planner;
- Node built-ins only;
- no network, Cloudflare API or subprocess capability;
- validates worker name and exact source contract;
- requires a pre-existing 32-hex OAuth KV namespace ID;
- injects the ID exactly once into a generated temporary config;
- fails closed if source `OAUTH_KV` already contains an ID;
- removes the complete `triggers` block from the upload config;
- preserves `MyMCP` / `FamilyMCP` Durable Object bindings;
- receipt hashes source/upload config but does not store the KV ID;
- receipt freezes `VERSIONS_UPLOAD_ONLY`, `traffic_shift=NONE`, `trigger_mutation=NONE`, `resource_provisioning=DISABLED`.

### `.github/workflows/research-vnext-version-upload.yml`

- `workflow_dispatch` only;
- `permissions: contents: read`;
- exact confirmation `UPLOAD_UNDEPLOYED_VNEXT_VERSION`;
- exact branch gate `refactor/research-vnext-foundation-20260901`;
- caller must provide exact checked-out 40-character SHA;
- requires existing `RESEARCH_VNEXT_OAUTH_KV_ID`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_ACCOUNT_ID` only when manually dispatched;
- planner builds the bounded temporary config locally;
- snapshots `wrangler deployments list --json` before the write;
- only write command is `wrangler versions upload`;
- forces `--experimental-provision=false --experimental-auto-create=false`;
- reads `wrangler versions list --json` and deployments again after upload;
- fails closed unless active deployment state is byte/JSON-equivalent before vs after;
- execution receipt declares traffic shift NONE, trigger mutation NONE, Production MCP not contacted;
- uploads only the receipt artifact.

The workflow was **not dispatched** during this phase. No Cloudflare version was created and no Production state changed.

## GREEN attempt 1 — IMMUTABLE HARNESS FAILURE

Implementation commit `14e01d84b86169b26d764a9de5947ec16623ddc6` triggered:

- Incremental Run `33509147313`, Job `99860311032` — **FAILURE**
- independent Type check Run `33509147495` — **SUCCESS**
- Isolation Run `33509147421` — FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE **PASS**, VNEXT **FAIL** from the same assertion; isolation finalizer correctly failed closed.

Before the failure, the Incremental run proved:

- Change Note / protected-surface gate: **PASS**
- Phase 10B bounded exception: **PASS**
- Production Validation Preflight: **PASS**
- public ABI snapshot: **PASS** — `123` tools / frozen digest
- Switch Stability: **PASS**
- Version Upload Isolation premise marker: `VERSION_UPLOAD_ISOLATION_RED_READY=PASS`
- local planner assertions before workflow-negative checks: **PASS**
- Production mutation: **NONE**

Exact failure:

- `assert.doesNotMatch(workflow, /wrangler\s+deploy/i)` incorrectly matched legitimate read-only `wrangler deployments list` because `deploy` is a prefix of `deployments`;
- the workflow contains no actual `wrangler deploy` command;
- this is a test-harness false positive, not workflow semantic failure.

Disposition: `GREEN_ATTEMPT_1_HARNESS_FAILURE_IMMUTABLE_TEST_ONLY_CORRECTION_ALLOWED`.

Failure evidence remains immutable.

## Test-only correction

- evidence note commit: `8aa61d291e82c64995ccfe7bcd200320100e22a6`
- test-only correction commit: `bd14e17a17f9fc8d1498e8b42db362a61f1500ab`

Correction only made the forbidden-command expressions token-boundary aware:

- actual `wrangler deploy` remains forbidden;
- actual `wrangler versions deploy` remains forbidden;
- actual `wrangler triggers deploy` remains forbidden;
- read-only `wrangler deployments list` is no longer falsely rejected.

No planner, workflow, runtime or public ABI behavior changed in the correction.

## Corrected GREEN evidence — PASS

Research VNext Incremental Gate:

- Run `33509476504` — **SUCCESS**
- Job `99861387092` — **SUCCESS**
- Change Note / protected-surface scope: **PASS**
- Phase 10B bounded exception: **PASS**
- all Research VNext tests: **PASS**
- Version Upload Isolation test: **PASS**
- public ABI snapshot: **PASS** — exactly `123` tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Incremental type-check: **PASS**
- full existing `test:research`: **PASS**
- Wrangler deploy dry-run: **PASS**
- immutable-style evidence upload: **PASS**

Independent Type check:

- Run `33509476500` — **SUCCESS**
- `npm run type-check`: **PASS**
- full `npm run test:research`: **PASS**
- Wrangler deploy dry-run: **PASS**

Isolation Gate:

- Run `33509476486` — **SUCCESS**
- VNEXT: **PASS**
- FAMILY: **PASS**
- MARKET_DATA: **PASS**
- FORMAL_BLIND: **PASS**
- OWNER_OPS: **PASS**
- BUNDLE: **PASS**
- isolation evidence finalizer: **PASS**

Additional triggered research regressions also completed **SUCCESS**:

- P7 Swing Outcome Path `33509476591`
- P8 Experiment Memory `33509476495`
- P9 Diamond Capability Registry `33509476634`
- P11 Research Validation `33509476600`
- P12 Strategy Lab Governance `33509476551`
- P13 Cross-market Supply Chain Graph `33509476596`
- P13b Supply Chain Data Plane `33509476510`
- P14 TXF Dual-market Review `33509476557`
- P15 Review Swing Orchestration `33509476493`
- P16 GPT Judgment Memory `33509476672`

Production version-upload workflow dispatched: **NO**.
Cloudflare Worker version created: **NO**.
Production MCP contacted: **NO**.
Production traffic shifted: **NO**.
OAuth KV mutation: **NONE**.
Cron mutation: **NONE**.

## Artifact / hash

Incremental evidence:

- Artifact ID: `9801027048`
- Name: `research-vnext-evidence-33509476504`
- Digest: `sha256:d162488c788950f19ea3ddc760980087565f07d0cfcec3d8098324212f830e6a`
- Expiry: `2026-10-01`

Isolation evidence:

- Artifact ID: `9801027473`
- Name: `research-vnext-isolation-evidence-33509476486`
- Digest: `sha256:2e37783fec3b6cc2e8661f76a08dde72308e118a82f16037432ba9f9ff0f68a4`

Isolation bundle:

- Artifact ID: `9801012697`
- Digest: `sha256:e2fb9ccca166265e0e6364aec0f62b2660c1ac46a1973cd8a57ec59d462c3061`

## Explicitly not authorized by this PASS

- dispatching `.github/workflows/research-vnext-version-upload.yml`;
- creating a Cloudflare Worker version;
- merging PR #206;
- deploying any version to traffic;
- `wrangler deploy`;
- `wrangler versions deploy`;
- `wrangler triggers deploy`;
- OAuth KV creation/update/delete;
- Cron mutation;
- Production MCP invocation;
- Legacy deletion;
- declaring Production switched-path stability from branch evidence alone.

## Next gate after seal

Even after this phase seals, actual `versions upload` remains a Production-account mutation and requires a separately authorized execution phase.

Because this Worker uses Durable Objects and cannot rely on ordinary version Preview URLs, a future Production validation design must first prove a **zero-ordinary-traffic** candidate deployment path: retain the existing version at 100%, place the new version at 0%, then route only explicit validation requests to the candidate version using the supported version-override mechanism, with a tested rollback to the original deployment. That design itself must go through a separate RED/GREEN gate before any Cloudflare mutation.

## Final disposition

`PASS_VERSION_UPLOAD_ISOLATION_PATH_READY_NOT_EXECUTED`
