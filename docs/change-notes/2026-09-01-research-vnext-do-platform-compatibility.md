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

## Newly verified external platform constraint

Current Cloudflare Durable Objects documentation states:

1. `exports` and legacy `migrations` are mutually exclusive lifecycle declarations.
2. Once a Worker has been deployed using `exports`, subsequent lifecycle-aware deploys must continue to use `exports` (or neither, which reconciles against an empty declaration and is usually a mistake).
3. `wrangler versions upload` does not apply Durable Object lifecycle changes.
4. If Wrangler configuration contains `exports` entries, `wrangler versions upload` fails fast with an actionable error.
5. Gradual deployments are not supported with `exports`.
6. Durable Object lifecycle changes are atomic and must be applied with `wrangler deploy`.

The repository itself already documents the same lifecycle rule in `wrangler.jsonc`: Durable Object lifecycle uses declarative exports and Production deploys must use `wrangler deploy`.

## Why the prior Version Upload Isolation PASS is not rewritten

The prior phase proved a narrower repository property:

- a local planner can inject an existing OAuth KV ID;
- Cron mutation intent can be removed from a temporary config;
- a manual workflow can be structurally isolated from traffic promotion and control-plane REST writes;
- that workflow was never dispatched.

Those CI results remain valid and immutable.

However, newly verified Cloudflare platform semantics mean the prepared execution path is **not Cloudflare-executable while `wrangler.jsonc` contains Durable Object `exports`**. Therefore this phase supersedes only the prior phase's execution eligibility, not its recorded local-isolation evidence.

## Current repository facts

`wrangler.jsonc` contains live declarative exports for:

- `MyMCP`
- `FamilyMCP`

The current manual workflow `.github/workflows/research-vnext-version-upload.yml` contains an eventual `wrangler versions upload` command. It has never been dispatched and has caused no Production mutation.

## Purpose

Fail closed on the newly discovered platform incompatibility before any Cloudflare write can occur.

This phase must **not** solve the incompatibility by removing or hiding `exports`. It must instead freeze a policy and make the manual version-upload workflow inoperable while the incompatible lifecycle model remains present.

## TEST BEFORE BUILD

RED test:

- `tests/research-vnext-do-platform-compatibility.test.ts`
- RED commit: `7a8ca894fa57cdc0cb47922c2e164f28a6a01e4f`

A legal RED required all of these to pass first:

1. Version Upload Isolation remains historically sealed as `PASS_VERSION_UPLOAD_ISOLATION_PATH_READY_NOT_EXECUTED`;
2. frozen Owner ABI remains exactly `123` / frozen digest;
3. Legacy retirement remains blocked;
4. `wrangler.jsonc` still contains `exports` for `MyMCP` and `FamilyMCP`;
5. `wrangler.jsonc` still states Production deploys must use `wrangler deploy`;
6. the current manual workflow still contains `wrangler versions upload` and has no DO-exports platform blocker yet;
7. marker `DO_PLATFORM_COMPATIBILITY_RED_READY=PASS` prints;
8. only then the test may fail because `src/v6/research-vnext/do-deployment-policy.ts` does not exist.

## RED evidence — ACCEPTED

Research VNext Incremental Gate:

- Run `33510088942`
- Job `99863378358`
- Change Note / protected-surface scope gate: **PASS**
- Phase 10B bounded exception: `PHASE10B_HANDLER_CUTOVER_EXCEPTION=PASS`
- all earlier Research VNext tests before the new compatibility test: **PASS**
- exact marker: `DO_PLATFORM_COMPATIBILITY_RED_READY=PASS`
- Owner tool count: `123`
- Owner ABI digest: `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- protected Durable Object exports: `MyMCP`, `FamilyMCP`
- `wrangler versions upload` present: `true`
- platform blocker present before implementation: `false`
- Legacy retirement: `BLOCKED_UNTIL_PRODUCTION_SWITCH_STABLE`
- Production mutation: **NONE**
- terminal result: **EXPECTED RED**
- exact terminal error: `ERR_MODULE_NOT_FOUND` for `src/v6/research-vnext/do-deployment-policy.ts`
- downstream incremental type-check / full `test:research` / Wrangler dry-run: correctly **SKIPPED**

Independent validation on the same RED commit:

- Type check Run `33510088974`: **SUCCESS**
- Isolation Run `33510088975`: FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE **PASS**; VNEXT failed only on the same expected missing policy module, therefore isolation finalizer failed closed as designed
- P7 / P8 / P9 / P11 / P12 / P13 / P13b / P14 / P15 / P16 workflows: **SUCCESS**

Disposition: `DO_PLATFORM_COMPATIBILITY_RED_ACCEPTED_GREEN_IMPLEMENTATION_ALLOWED`.

The failed RED evidence is immutable and is not rewritten as PASS.

## GREEN implementation allowed after accepted RED

### Policy-only module

Add:

- `src/v6/research-vnext/do-deployment-policy.ts`

It must contain no runtime imports or side effects and freeze at least:

- `versions_upload = BLOCKED_WHILE_DURABLE_OBJECT_EXPORTS_PRESENT`
- `gradual_deployment = BLOCKED_WHILE_DURABLE_OBJECT_EXPORTS_PRESENT`
- `lifecycle_deploy = WRANGLER_DEPLOY_REQUIRED`
- `remove_exports_automatically = false`
- protected exports = `MyMCP`, `FamilyMCP`
- `zero_traffic_candidate_validation = BLOCKED_PENDING_COMPATIBLE_DEPLOYMENT_DESIGN`
- `production_mutation = NONE`

### Manual workflow fail-closed correction

Modify only `.github/workflows/research-vnext-version-upload.yml` so that, immediately after checkout and before any Wrangler/Cloudflare operation, it terminates fail-closed.

Required behavior:

- detect the current `exports` block;
- emit explicit marker `DO_EXPORTS_VERSION_UPLOAD_BLOCKED`;
- exit before setup/install/planner/deployment/version commands;
- even if `exports` later disappears unexpectedly, still exit and require a new separately tested authorization phase;
- do not remove the previously prepared commands from history; they may remain unreachable in the workflow for auditability;
- no Cloudflare credential-dependent operation may precede the blocker.

## Explicitly forbidden

- modifying `wrangler.jsonc`;
- removing/renaming `MyMCP` or `FamilyMCP` exports;
- converting `exports` to `migrations`;
- dispatching the manual version-upload workflow;
- `wrangler versions upload` execution;
- gradual deployment creation;
- `wrangler deploy` execution;
- Cloudflare API writes;
- OAuth KV mutation;
- Cron mutation;
- Production MCP contact;
- PR #206 merge;
- Legacy deletion;
- public MCP ABI changes;
- Owner/Family/OAuth/Market Data/FORMAL/OHLC runtime changes.

## GREEN acceptance

Tests must prove:

- policy object exactly encodes the platform blocker;
- policy source has no imports, fetch, subprocesses, provider access or write operations;
- current `wrangler.jsonc` protected exports remain intact;
- manual workflow blocker occurs textually before setup-node, npm install, planner, Wrangler list/upload commands, or any Cloudflare-dependent operation;
- workflow remains `workflow_dispatch` only;
- no automatic CI dispatch occurs;
- previous upload commands are unreachable under current and unexpected no-exports states;
- all VNext tests, frozen ABI, type-check, full `test:research`, Wrangler dry-run and six-domain Isolation Gate pass.

## Next phase after seal

Do **not** proceed to zero-traffic version override deployment while `exports` blocks versions upload/gradual deployment.

A later phase must design a Cloudflare-supported atomic `wrangler deploy` validation/cutover strategy that preserves declarative Durable Object lifecycle, isolates unrelated OAuth/Cron side effects, proves rollback boundaries, and receives explicit Production authorization before any mutation.

## GREEN evidence

Pending.

## Final disposition

`DO_PLATFORM_COMPATIBILITY_GREEN_IMPLEMENTATION_ALLOWED`
