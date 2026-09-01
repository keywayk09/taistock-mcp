# Change Note — Research VNext Atomic Production Execution Workflow Blocked Skeleton

- Date: `2026-09-01`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — must remain Draft/open/unmerged
- Prerequisite Authorization Policy seal: `a8488712466a9f5c1615283a88147367e3a07dfd`
- Prerequisite seal CI: Incremental `33515037359` SUCCESS; Type check `33515037433` SUCCESS; Isolation `33515037338` SUCCESS
- Frozen Owner ABI: `123` tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Legacy retirement: **BLOCKED_UNTIL_PRODUCTION_SWITCH_STABLE**
- Production deploy: **NONE**
- Production mutation: **NONE**

## Purpose

Create a test-first, permanently blocked GitHub Actions workflow skeleton for a future Research VNext atomic Production cutover.

This phase does **not** create a deploy executor. The skeleton is only a machine-readable authorization envelope so later phases have a single manually dispatched surface whose required inputs and safety policy are already frozen.

## Safety design

The skeleton:

1. is `workflow_dispatch` only;
2. exposes `confirmation` and `expected_sha` inputs;
3. freezes required confirmation `EXECUTE_ATOMIC_VNEXT_PRODUCTION` and exact-40-hex SHA policy;
4. runs checkout only, then immediately emits `ATOMIC_PRODUCTION_EXECUTION_BLOCKED_PENDING_EXPLICIT_AUTHORIZATION` and exits `78`;
5. exposes policy constants for future pre-deploy active-version snapshot, exact Cron pre/post match, conditional/manual rollback eligibility, read-only postdeploy probe and frozen Owner ABI;
6. contains no Cloudflare secrets, Wrangler commands, curl/fetch, Production endpoint, setup-node, dependency install, deployment, rollback or Production probe command;
7. records `production_deploy_authorized=false` and `production_mutation=NONE`.

A later separately RED-proven phase may add execution mechanics. This phase is not that authorization.

## TEST BEFORE BUILD

RED test:

- `tests/research-vnext-atomic-production-execution-skeleton.test.ts`
- RED commit: `86f517a7650568da12875339135c2231cb297119`

Legal RED required all policy/ABI premises to pass before the missing-workflow failure.

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

## GREEN implementation

Implementation commit:

- `e5a3469ad8ac6fef9ed4ec7c175403c81d77ef65`

Added:

- `.github/workflows/research-vnext-atomic-production-execution.yml`

The workflow remains a **blocked skeleton**, not an executor.

Static contract proven:

- `workflow_dispatch` only;
- `permissions: contents: read`;
- inputs `confirmation` and `expected_sha`;
- execution state `BLOCKED_SKELETON`;
- required confirmation `EXECUTE_ATOMIC_VNEXT_PRODUCTION`;
- expected SHA policy `EXACT_40_HEX_REQUIRED`;
- predeploy rollback target policy `PREDEPLOY_ACTIVE_VERSION_REQUIRED`;
- Cron contract `EXACT_PRE_POST_MATCH_REQUIRED`;
- rollback eligibility `NO_DO_LIFECYCLE_CHANGE_AND_BINDINGS_STILL_VALID`;
- uncertainty `FAIL_CLOSED_MANUAL_INTERVENTION`;
- postdeploy probe policy `READ_ONLY_PRODUCTION_PROBE_REQUIRED`;
- Owner ABI `123:00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`;
- checkout is the only action before the hard blocker;
- one step named `Fail closed pending explicit Production authorization` emits the blocker/status and exits `78`;
- Cloudflare credential wiring: **NONE**;
- setup-node / npm install: **NONE**;
- Wrangler/curl/fetch: **NONE**;
- Production endpoint: **NONE**;
- Production probe command: **NONE**;
- deploy operation: **NONE**;
- rollback operation: **NONE**.

## GREEN evidence — PASS

Research VNext Incremental Gate:

- Run `33515659244`: **SUCCESS**
- all Research VNext tests: **PASS**
- blocked-skeleton contract: **PASS**
- type-check: **PASS**
- full `test:research`: **PASS**
- canonical Wrangler dry-run: **PASS**
- atomic temporary-config Wrangler dry-run: **PASS**
- gate receipt/upload: **PASS**
- frozen Owner ABI: **PASS** — `123` tools / frozen digest
- Production deploy authorized: `false`
- Production mutation: **NONE**

Incremental evidence artifact:

- artifact ID: `9803490976`
- digest: `sha256:48bee036f9484a915dbf92e9635f50c3513a3b32f4de8bfccbe13ef2dc7d0ffc`

Independent Type check:

- Run `33515659167`: **SUCCESS**
- type-check: **PASS**
- full `test:research`: **PASS**
- canonical Wrangler dry-run: **PASS**

Isolation Gate:

- Run `33515659136`: **SUCCESS**
- VNEXT: **PASS**
- FAMILY: **PASS**
- MARKET_DATA: **PASS**
- FORMAL_BLIND: **PASS**
- OWNER_OPS: **PASS**
- BUNDLE: **PASS**
- isolation finalizer: **PASS**

Isolation artifacts:

- evidence artifact ID: `9803480825`
- evidence digest: `sha256:4b44f5b90006c06517f05ffe4b2bf1dd835bce5968c2162f5ef27c406c1404ef`
- bundle artifact ID: `9803472616`
- bundle digest: `sha256:22e077ee468fd02d1f181509ab0fd97fac7c136f1f47b290c36e51ff44f4992d`

Additional workflows on implementation commit:

- P7 `33515659323`: **SUCCESS**
- P8 `33515659204`: **SUCCESS**
- P9 `33515659142`: **SUCCESS**
- P11 `33515659129`: **SUCCESS**
- P12 `33515659144`: **SUCCESS**
- P13 `33515659247`: **SUCCESS**
- P13b `33515659067`: **SUCCESS**
- P14 `33515659192`: **SUCCESS**
- P15 `33515659119`: **SUCCESS**
- P16 `33515659198`: **SUCCESS**

## Production facts throughout this phase

- real Production deploy: **NONE**
- real Production rollback: **NONE**
- Cloudflare API writes: **NONE**
- Cloudflare credentials wired into new skeleton: **NONE**
- Production workflow dispatch: **NONE**
- Production MCP contact: **NONE**
- OAuth KV mutation: **NONE**
- Cron mutation: **NONE**
- traffic shift: **NONE**
- public ABI drift: **NONE**
- Legacy retirement: **BLOCKED**
- PR #206 merge: **NONE**

## Explicitly forbidden after this seal

- treating the existence of the skeleton as Production authorization;
- removing or bypassing the hard blocker without a new accepted RED/GREEN phase;
- adding Cloudflare credentials or real deploy/rollback commands without the next execution-mechanics gate;
- automatic rollback;
- OAuth KV / Cron mutation;
- versions upload / gradual deployment while Durable Object `exports` remain;
- protected export mutation;
- Legacy deletion before switch stability;
- PR #206 merge before later cutover acceptance.

## Next phase

The next safe phase is **Production Execution Mechanics RED**, which may only define and test the future snapshot/deploy/probe/rollback command graph behind the existing hard blocker. The hard blocker must remain active and Production must remain unauthorized throughout that design phase.

No real dispatch or Production mutation is authorized by this seal.

## Final disposition

`PASS_ATOMIC_PRODUCTION_EXECUTION_SKELETON_BLOCKED_NO_CREDENTIALS_NO_COMMANDS_PRODUCTION_UNCHANGED`
