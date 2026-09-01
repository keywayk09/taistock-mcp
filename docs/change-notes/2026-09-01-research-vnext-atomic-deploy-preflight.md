# Change Note — Research VNext Atomic Deploy Isolation Preflight

- Date: `2026-09-01`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — must remain Draft/open/unmerged
- Prerequisite DO Platform Compatibility seal: `70cf1526fe6f5a14fa471b15864bae8aebb28844`
- Seal CI: Incremental `33511838399` SUCCESS; Type check `33511838477` SUCCESS; Isolation `33511838432` SUCCESS
- Frozen Owner ABI: `123` tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Legacy retirement: **BLOCKED_UNTIL_PRODUCTION_SWITCH_STABLE**
- Production deploy: **NONE**
- Production mutation: **NONE**

## External platform contract frozen for this phase

Current Cloudflare Workers / Wrangler behavior verified for this design:

1. `wrangler deploy` creates a new Worker version and immediately deploys it to 100% of traffic; it is not a zero-traffic candidate mechanism.
2. Durable Object declarative `exports` lifecycle is atomic and requires `wrangler deploy`; `wrangler versions upload` / gradual deployment remain blocked for this Worker.
3. Wrangler configuration is the deployment source of truth.
4. Omitting `triggers.crons` does not disable an existing Cron Trigger; explicitly setting `crons: []` is the disabling operation.
5. Wrangler automatic provisioning / auto-create can be explicitly disabled.

Therefore this phase is limited to a **local atomic-deploy configuration planner plus CI dry-run**. No real deployment command may execute.

## Current repository constraints

`wrangler.jsonc` contains:

- Worker `taistock-mcp`;
- `OAUTH_KV` without an ID;
- `triggers.crons = ["*/5 * * * *"]`;
- declarative live SQLite exports for `MyMCP` and `FamilyMCP`;
- matching Durable Object bindings;
- no legacy `migrations`.

The canonical Production workflow performs unrelated control-plane work around deployment: it may create OAuth KV, performs `wrangler deploy`, and explicitly PUTs the five-minute Cron schedule afterward. It is not reused here.

## Purpose

Prove that a future atomic Production deploy can be represented by a temporary Wrangler config that:

1. preserves protected Durable Object exports exactly;
2. injects an already-existing OAuth KV namespace ID as immutable input;
3. removes the `triggers` block from the temporary deploy config without changing source `wrangler.jsonc`;
4. never emits `crons: []`;
5. disables automatic provisioning / auto-create;
6. passes only `wrangler deploy --dry-run` in CI;
7. records that a real deploy would be an immediate 100% switch and remains unauthorized in this phase.

## TEST BEFORE BUILD — accepted RED

RED test: `tests/research-vnext-atomic-deploy-preflight.test.ts`

RED commit: `b9c3eb2b4a3e6ac851e276cb5955396d30edff2b`

Research VNext Incremental Gate:

- Run `33512232625`
- Job `99870485509`
- Change Note / protected-surface scope gate: **PASS**
- Phase 10B bounded exception: `PHASE10B_HANDLER_CUTOVER_EXCEPTION=PASS`
- exact marker: `ATOMIC_DEPLOY_PREFLIGHT_RED_READY=PASS`
- Owner tool count: `123`
- Owner ABI digest: `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- protected exports: `MyMCP`, `FamilyMCP`
- source OAuth KV ID present: `false`
- source Cron present: `true`
- canonical KV-create side effect: `true`
- canonical Cron-PUT side effect: `true`
- versions upload: `BLOCKED_WHILE_DURABLE_OBJECT_EXPORTS_PRESENT`
- lifecycle deploy: `WRANGLER_DEPLOY_REQUIRED`
- Production mutation: **NONE**
- terminal result: **EXPECTED RED**
- exact terminal error: `ERR_MODULE_NOT_FOUND` for `scripts/research-vnext-atomic-deploy-plan.mjs`
- downstream incremental type-check / full `test:research` / Wrangler dry-run: correctly **SKIPPED**

Independent validation on the RED commit:

- Type check Run `33512232567`: **SUCCESS**, including type-check, full `test:research`, and Wrangler dry-run
- Isolation Run `33512232618`: FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE **PASS**; VNEXT failed only on the same expected missing planner; finalizer failed closed

Disposition: `ATOMIC_DEPLOY_PREFLIGHT_RED_ACCEPTED_GREEN_IMPLEMENTATION_ALLOWED`.

The RED failure remains immutable and is not rewritten as PASS.

## GREEN implementation

Implementation commit: `1418a3b303d9a61b323f30470a6661e6e4b5763d`

Added:

- `scripts/research-vnext-atomic-deploy-plan.mjs` — pure local planner / CLI;
- bounded dry-run step in `.github/workflows/research-vnext-foundation-gate.yml`.

The planner validates worker identity, existing-KV input shape, exact source Cron, protected SQLite DO exports/bindings, and absence of legacy migrations. It injects the test KV ID exactly once, strips triggers, forbids `crons: []`, preserves protected exports exactly, and emits a non-secret dry-run-only receipt.

Source `wrangler.jsonc` remains unchanged.

## Failed GREEN attempt 1 — immutable relative-config-path harness failure

Implementation commit `1418a3b303d9a61b323f30470a6661e6e4b5763d` produced a late CI dry-run failure after all code and regression tests had passed.

Research VNext Incremental Gate:

- Run `33512557029`
- Job `99871565113`
- Change Note / protected-surface scope gate: **PASS**
- all Research VNext tests: **PASS**
- atomic planner/unit assertions: **PASS**
- frozen public ABI: **PASS** — `123` tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- incremental type-check: **PASS**
- full `test:research`: **PASS**
- canonical `wrangler deploy --dry-run`: **PASS**
- atomic planner receipt: **PASS** with `READY_FOR_DRY_RUN_ONLY`, exports preserved, trigger mutation intent NONE, Production deploy unauthorized, Production mutation NONE
- atomic temporary-config `wrangler deploy --dry-run`: **FAIL**
- exact Wrangler version: `4.127.1`
- exact terminal error: `The entry-point file at "src/index-automation-bridge.ts" was not found.`
- evidence receipt/upload steps: correctly **SKIPPED**

Diagnosis:

The planner output was written to `tmp/research-vnext-atomic-deploy/wrangler.atomic.jsonc`. Wrangler resolves the relative `main = src/index-automation-bridge.ts` from the generated config file's directory, so it searched beneath the temporary subdirectory instead of the repository root. The canonical repo-root dry-run succeeded immediately before this step, proving the entry point itself exists and bundles correctly.

This is a **temporary-config anchoring / dry-run harness defect**, not a Durable Object exports, KV, Cron, ABI, runtime, or Production behavior defect.

Planner receipt immediately before the failure:

- source SHA256: `51dacbe95f8fd4e1d9cdea878c48e13e8e182303af06baddfbf9ca6971ca240c`
- generated-config SHA256: `e9ce8ddd20acc2f8b2230bf09b9510e360518ba21110d5c06ff0e6791e505c42`
- Production mutation: **NONE**

Independent same-commit validation:

- Type check Run `33512557173`: **SUCCESS**, including full `test:research` and canonical Wrangler dry-run
- Isolation Run `33512557120`: **SUCCESS** — VNEXT / FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE all PASS; isolation finalizer PASS

No Production workflow was dispatched; no Cloudflare credentials were used by the atomic dry-run; no Production deploy, KV/Cron mutation, Production MCP contact or traffic shift occurred.

Disposition: `GREEN_ATTEMPT_1_RELATIVE_MAIN_PATH_HARNESS_FAILURE_IMMUTABLE`.

The failed attempt remains immutable and is not rewritten as PASS.

## Corrected GREEN — PASS

Harness correction commit:

- `d4cfa25dbb1bff1398c90ae4dc0ed90f6ca6aabf`

The planner semantics were unchanged. Only the Incremental Gate/test/Change Note were corrected so the ephemeral Wrangler config is written at repository root as `wrangler.research-vnext-atomic.jsonc`; an EXIT trap removes it on success or failure. The receipt remains under `tmp/`.

Research VNext Incremental Gate:

- Run `33513066049`: **SUCCESS**
- Job `99873235771`
- Change Note / protected-surface scope gate: **PASS**
- Phase 10B bounded exception: `PHASE10B_HANDLER_CUTOVER_EXCEPTION=PASS`
- all Research VNext tests: **PASS**
- atomic deploy preflight unit contract: **PASS**
- protected exports: `EXACTLY_PRESERVED`
- OAuth KV: `EXISTING_INPUT_ONLY`
- trigger mutation intent: `NONE`
- resource provisioning: `DISABLED`
- temp config anchor: `REPOSITORY_ROOT`
- temp config cleanup: `TRAP_ALWAYS`
- real deploy semantics frozen as `ATOMIC_IMMEDIATE_100_PERCENT`
- Production deploy authorized: `false`
- Production mutation: `NONE`
- frozen public ABI: **PASS** — `123` tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- incremental type-check: **PASS**
- full `test:research`: **PASS**
- canonical Wrangler dry-run: **PASS**
- atomic temporary-config Wrangler dry-run: **PASS**
- exact marker: `ATOMIC_DEPLOY_CONFIG_DRY_RUN=PASS`
- Wrangler version observed: `4.127.1`
- evidence receipt/upload: **PASS**

Atomic dry-run binding output confirmed the temporary config still exposes:

- `MCP_OBJECT (MyMCP)` Durable Object
- `FAMILY_MCP_OBJECT (FamilyMCP)` Durable Object
- `OAUTH_KV` using the fake CI-only 32-hex namespace ID

Atomic planner receipt on corrected GREEN:

- status: `READY_FOR_DRY_RUN_ONLY`
- exports preserved: `true`
- migrations present: `false`
- triggers in deploy config: `false`
- empty Cron array present: `false`
- deployment mode: `ATOMIC_IMMEDIATE_100_PERCENT`
- phase authorization: `DRY_RUN_ONLY`
- Production deploy authorized: `false`
- trigger mutation intent: `NONE`
- resource provisioning: `DISABLED`
- Production mutation: `NONE`
- source SHA256: `51dacbe95f8fd4e1d9cdea878c48e13e8e182303af06baddfbf9ca6971ca240c`
- generated-config SHA256: `e9ce8ddd20acc2f8b2230bf09b9510e360518ba21110d5c06ff0e6791e505c42`

Incremental evidence artifact:

- artifact ID: `9802464886`
- digest: `sha256:9b0d8a85a39424a825ddd14bf0637b1f3fae0badabc71cf32e54ef82b7595cfb`

Independent Type check:

- Run `33513065990`: **SUCCESS**
- type-check: **PASS**
- full `test:research`: **PASS**
- canonical Wrangler dry-run: **PASS**

Isolation Gate:

- Run `33513065991`: **SUCCESS**
- VNEXT: **PASS**
- FAMILY: **PASS**
- MARKET_DATA: **PASS**
- FORMAL_BLIND: **PASS**
- OWNER_OPS: **PASS**
- BUNDLE: **PASS**
- isolation finalizer: **PASS**
- isolation evidence artifact ID: `9802452242`
- isolation evidence digest: `sha256:53ad2ed5c05c649ce55600092853b6b2841fec6f7c2ab200b96029194bc88ad7`
- bundle artifact ID: `9802446743`
- bundle digest: `sha256:be56dc6f3a26310d55b6ad1d092e6f086253ce11cc581cdb409c0bc03289054a`

Additional workflows on corrected GREEN commit:

- P7 Swing Outcome Path `33513065987`: **SUCCESS**
- P8 Experiment Memory `33513066097`: **SUCCESS**
- P9 Diamond Capability Registry `33513065986`: **SUCCESS**
- P11 Research Validation `33513066026`: **SUCCESS**
- P12 Strategy Lab Governance `33513065985`: **SUCCESS**
- P13 Cross-market Supply Chain Graph `33513066007`: **SUCCESS**
- P13b Supply Chain Data Plane `33513066039`: **SUCCESS**
- P14 TXF Dual-market Review `33513066000`: **SUCCESS**
- P15 Review Swing Orchestration `33513066032`: **SUCCESS**
- P16 GPT Judgment Memory `33513066011`: **SUCCESS**

Production facts throughout this phase:

- real `wrangler deploy`: **NONE**
- Cloudflare API writes: **NONE**
- Production workflow dispatch: **NONE**
- OAuth KV mutation: **NONE**
- Cron mutation: **NONE**
- Production MCP contact: **NONE**
- traffic shift: **NONE**
- public ABI drift: **NONE**
- Legacy retirement: **BLOCKED**
- PR #206 merge: **NONE**

## Explicitly forbidden after this seal

- treating this dry-run PASS as Production deployment authorization;
- any real `wrangler deploy` without a separately tested and explicitly authorized execution/rollback gate;
- Production workflow dispatch;
- versions upload / gradual deployment while DO `exports` remain;
- source `wrangler.jsonc` mutation as a shortcut;
- protected export mutation;
- OAuth KV mutation;
- Cron mutation;
- Legacy deletion before Production switch stability;
- PR #206 merge before later cutover acceptance.

## Next phase

The next safe phase is a **Production Atomic Deploy Execution / Rollback Authorization Gate design**, still with no Production mutation. It must test-first freeze:

- exact branch SHA / explicit confirmation / manual-only execution;
- existing Production OAuth KV ID as immutable secret input;
- pre-deploy snapshot of active deployment/version identity;
- temporary config generated by the sealed atomic planner;
- protected DO exports and no trigger mutation intent;
- automatic provisioning disabled;
- real deploy semantics as immediate 100% switch;
- rollback target/identity and fail-closed rollback rules;
- post-deploy live read-only probe and frozen Owner ABI 123/digest;
- proof that existing Cron remains unchanged;
- Legacy fallback retained until Production switch stability.

Actual Production execution must remain separately authorized after that design itself passes.

## Final disposition

`PASS_ATOMIC_DEPLOY_PREFLIGHT_DRY_RUN_ONLY_PRODUCTION_UNCHANGED`
