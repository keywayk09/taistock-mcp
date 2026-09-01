# Change Note — Research VNext Durable Object Platform Compatibility Gate

- Date: `2026-09-01`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — must remain Draft/open/unmerged
- Prerequisite Version Upload Isolation seal: `5a4a21aa2f54096eab46b0655b7590758c7c98ee`
- Version Upload Isolation seal CI: Incremental `33509692559` SUCCESS; Type check `33509692104` SUCCESS; Isolation `33509692188` SUCCESS
- Frozen Owner ABI: `123` tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Legacy retirement: **BLOCKED_UNTIL_PRODUCTION_SWITCH_STABLE**
- Production deploy: **NONE**
- Production mutation: **NONE**

## Platform constraint

Current Cloudflare Durable Objects semantics require this repository to treat declarative `exports` as an atomic lifecycle surface:

1. `exports` and legacy `migrations` are mutually exclusive lifecycle declarations.
2. The existing Worker uses declarative `exports`; later lifecycle-aware deploys must preserve that model.
3. `wrangler versions upload` does not apply the lifecycle model and fails when the configuration contains `exports` entries.
4. Gradual deployments are not supported with `exports`.
5. Durable Object lifecycle deployment therefore requires atomic `wrangler deploy` handling.

The repository independently states the same constraint in `wrangler.jsonc`: Durable Object lifecycle uses declarative exports and Production deploys must use `wrangler deploy`.

Protected live exports remain:

- `MyMCP`
- `FamilyMCP`

They were not removed, renamed, hidden or converted to `migrations`.

## Relationship to prior Version Upload Isolation PASS

The prior phase remains historically valid and immutable as a local-isolation proof:

- existing OAuth KV ID can be injected as an input;
- Cron mutation intent can be removed from a temporary config;
- the prepared workflow was manual-only and structurally isolated from traffic promotion/control-plane REST writes;
- it was never dispatched.

That historical result remains `PASS_VERSION_UPLOAD_ISOLATION_PATH_READY_NOT_EXECUTED`.

This phase supersedes only its **execution eligibility**: while Durable Object `exports` remain, the prepared `wrangler versions upload` path is not a Cloudflare-compatible execution path.

## TEST BEFORE BUILD — accepted RED

RED test: `tests/research-vnext-do-platform-compatibility.test.ts`

RED commit: `7a8ca894fa57cdc0cb47922c2e164f28a6a01e4f`

Research VNext Incremental Gate:

- Run `33510088942`
- Job `99863378358`
- Change Note / protected-surface scope gate: **PASS**
- Phase 10B bounded exception: `PHASE10B_HANDLER_CUTOVER_EXCEPTION=PASS`
- all earlier VNext tests before the new test: **PASS**
- exact marker: `DO_PLATFORM_COMPATIBILITY_RED_READY=PASS`
- Owner tool count: `123`
- Owner ABI digest: `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- protected exports: `MyMCP`, `FamilyMCP`
- `wrangler versions upload` present: `true`
- platform blocker before implementation: `false`
- Legacy retirement: `BLOCKED_UNTIL_PRODUCTION_SWITCH_STABLE`
- Production mutation: **NONE**
- terminal result: **EXPECTED RED**
- exact error: `ERR_MODULE_NOT_FOUND` for `src/v6/research-vnext/do-deployment-policy.ts`
- downstream incremental type-check / full `test:research` / Wrangler dry-run: correctly **SKIPPED**

Independent validation on the RED commit:

- Type check Run `33510088974`: **SUCCESS**
- Isolation Run `33510088975`: FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE **PASS**; VNEXT failed only on the same expected missing policy module; finalizer failed closed
- P7 / P8 / P9 / P11 / P12 / P13 / P13b / P14 / P15 / P16: **SUCCESS**

Disposition: `DO_PLATFORM_COMPATIBILITY_RED_ACCEPTED_GREEN_IMPLEMENTATION_ALLOWED`.

The RED failure remains immutable and is not rewritten as PASS.

## GREEN implementation

Implementation commit: `eadd6eae6d7fa159f3b8b9504f6aad408353b14a`

Added policy-only module:

- `src/v6/research-vnext/do-deployment-policy.ts`

Frozen policy:

- `versions_upload = BLOCKED_WHILE_DURABLE_OBJECT_EXPORTS_PRESENT`
- `gradual_deployment = BLOCKED_WHILE_DURABLE_OBJECT_EXPORTS_PRESENT`
- `lifecycle_deploy = WRANGLER_DEPLOY_REQUIRED`
- `remove_exports_automatically = false`
- protected exports = `MyMCP`, `FamilyMCP`
- `zero_traffic_candidate_validation = BLOCKED_PENDING_COMPATIBLE_DEPLOYMENT_DESIGN`
- `production_mutation = NONE`

The policy module has no imports, provider/network access, subprocesses or runtime side effects.

The existing manual workflow `.github/workflows/research-vnext-version-upload.yml` was changed to fail closed immediately after checkout and before setup-node, npm install, planner, Wrangler commands, or credential-dependent Cloudflare operations.

When `exports` are present it emits:

- `DO_EXPORTS_VERSION_UPLOAD_BLOCKED`
- `PLATFORM_REAUTHORIZATION_REQUIRED`
- exits `78`

If `exports` unexpectedly disappear, it still emits `PLATFORM_REAUTHORIZATION_REQUIRED` and exits `78`. Previously prepared upload commands remain after the blocker only for auditability and are unreachable.

## Failed GREEN attempt 1 — immutable harness failure

Implementation commit `eadd6eae6d7fa159f3b8b9504f6aad408353b14a` produced a test-harness-only failure:

- Incremental Run `33511192351`
- Job `99866972574`
- scope gate: **PASS**
- exact failure: stale RED-only assertion still required `DO_EXPORTS_VERSION_UPLOAD_BLOCKED` to be absent
- the implementation correctly added the blocker, so this stale RED premise self-failed before GREEN policy/workflow assertions ran
- downstream incremental type-check / full `test:research` / dry-run: correctly **SKIPPED**

Independent same-commit evidence:

- Type check Run `33511193411`: **SUCCESS**, including full `test:research` and Wrangler dry-run
- Isolation Run `33511192533`: FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE **PASS**; VNEXT failed only on the same stale RED assertion; finalizer failed closed

No implementation defect or Production mutation was identified.

Disposition: `GREEN_ATTEMPT_1_HARNESS_FLIP_FAILURE_IMMUTABLE`.

The failed GREEN attempt remains immutable and is not rewritten as PASS.

## Corrected GREEN — PASS

Test-only harness correction commit:

- `5a06c0e1c4fffdbb7b21bee3d05c28177dad226d`

The correction changed only the accepted RED precondition into a GREEN precheck requiring the platform blocker to be present. The policy module and fail-closed workflow were unchanged.

Research VNext Incremental Gate:

- Run `33511571358`
- Job `99868248201`
- Change Note / protected-surface scope gate: **PASS**
- all Research VNext tests: **PASS**
- `DO_PLATFORM_COMPATIBILITY_GREEN_PRECHECK=PASS`
- DO deployment policy assertions: **PASS**
- fail-closed workflow ordering assertions: **PASS**
- frozen public ABI snapshot: **PASS** — `123` tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- incremental type-check: **PASS**
- full `test:research`: **PASS**
- Wrangler dry-run: **PASS**
- evidence upload: **PASS**
- artifact ID: `9801863507`
- artifact digest: `sha256:4d5bf22c0e1f074faf400ce3c008c43c331d9da14538a5552ab9b5134b38c29e`

Independent Type check:

- Run `33511571023`: **SUCCESS**
- type-check: **PASS**
- full `test:research`: **PASS**
- Wrangler dry-run: **PASS**

Isolation Gate:

- Run `33511570858`: **SUCCESS**
- VNEXT: **PASS**
- FAMILY: **PASS**
- MARKET_DATA: **PASS**
- FORMAL_BLIND: **PASS**
- OWNER_OPS: **PASS**
- BUNDLE: **PASS**
- isolation finalizer: **PASS**
- evidence artifact ID: `9801859281`
- evidence digest: `sha256:29c4c205c88797dc46108828ab73b25f413998eefb52e3e34b03d930d5fb52fc`
- bundle artifact ID: `9801855331`
- bundle digest: `sha256:fbe86be74c2097131667a576006d68e2108f24f4fe06d5985c6cb2240b0fac80`

Additional workflows on the corrected GREEN commit:

- P7 Swing Outcome Path `33511571067`: **SUCCESS**
- P8 Experiment Memory `33511570850`: **SUCCESS**
- P9 Diamond Capability Registry `33511571046`: **SUCCESS**
- P11 Research Validation `33511571254`: **SUCCESS**
- P12 Strategy Lab Governance `33511571086`: **SUCCESS**
- P13 Cross-market Supply Chain Graph `33511570892`: **SUCCESS**
- P13b Supply Chain Data Plane `33511570932`: **SUCCESS**
- P14 TXF Dual-market Review `33511571071`: **SUCCESS**
- P15 Review Swing Orchestration `33511571104`: **SUCCESS**
- P16 GPT Judgment Memory `33511570887`: **SUCCESS**

Production facts throughout RED / implementation / correction / GREEN:

- version-upload workflow dispatch: **NONE**
- Cloudflare Worker version creation: **NONE**
- `wrangler versions upload` execution: **NONE**
- `wrangler deploy` execution: **NONE**
- gradual deployment: **NONE**
- OAuth KV mutation: **NONE**
- Cron mutation: **NONE**
- Production MCP contact: **NONE**
- traffic shift: **NONE**
- public ABI change: **NONE**
- Legacy retirement: **BLOCKED**
- PR #206 merge: **NONE**

## Explicitly forbidden after this seal

- removing/renaming/hiding `MyMCP` or `FamilyMCP` exports;
- converting `exports` to `migrations` as a shortcut;
- dispatching the now-blocked version-upload workflow as a deployment attempt;
- `wrangler versions upload` / gradual deployment while `exports` remain;
- any Production deploy without a separately tested and explicitly authorized atomic deployment phase;
- Legacy deletion before Production switch stability.

## Next phase

Do **not** proceed with zero-traffic version override or gradual deployment.

The next safe design phase is a Cloudflare-supported **atomic `wrangler deploy` validation/cutover strategy** that:

- preserves declarative Durable Object `exports`;
- treats existing OAuth KV as an immutable input;
- prevents unrelated Cron/control-plane mutation;
- proves rollback boundaries and active-version identity;
- validates Owner ABI and live read-only behavior after an eventual authorized atomic deployment;
- receives a separate explicit Production authorization before any mutation.

## Final disposition

`PASS_DO_PLATFORM_COMPATIBILITY_FAIL_CLOSED_PRODUCTION_UNCHANGED`
