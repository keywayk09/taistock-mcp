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
- structured Wrangler output and `versions list --json` are available for machine-readable version evidence.

This phase freezes those constraints into repository tests and prepares a future manually authorized, undeployed version-upload path. It does **not** execute that path.

## Existing deployment blockers

`wrangler.jsonc` currently contains:

- `OAUTH_KV` binding without a namespace `id`;
- a `*/5 * * * *` Cron declaration;
- Durable Object bindings for `MyMCP` and `FamilyMCP`.

The canonical Production workflow resolves/creates OAuth KV and separately PUTs Cron schedules. Reusing it would therefore mutate unrelated control-plane resources.

A bounded version-upload path must instead treat the existing OAuth KV namespace ID as a pre-existing immutable input and must disable Wrangler automatic resource provisioning.

## Purpose

Prepare and test a manual-only workflow that can, in a later explicitly authorized phase, upload a new `taistock-mcp` Worker **version without deploying it to traffic and without changing triggers or creating resources**.

The future workflow must:

1. require `workflow_dispatch` only;
2. require exact confirmation `UPLOAD_UNDEPLOYED_VNEXT_VERSION`;
3. accept the existing OAuth KV namespace ID only from dedicated secret `RESEARCH_VNEXT_OAUTH_KV_ID`;
4. validate that ID is exactly 32 hex characters;
5. generate a temporary Wrangler config that injects that existing ID;
6. remove the `triggers` block from the temporary upload config so the artifact itself does not carry a Cron mutation intent;
7. invoke only `wrangler versions upload` for the write step;
8. force `--experimental-provision=false` and `--experimental-auto-create=false`;
9. never invoke `wrangler deploy`, `wrangler versions deploy`, `wrangler triggers deploy`, Cloudflare REST resource creation, or Cron mutation;
10. resolve the uploaded version ID via read-only `wrangler versions list --json` and store a receipt;
11. not contact Production MCP and not shift traffic;
12. leave Legacy fallback intact.

## Planned artifacts after legal RED

- `scripts/research-vnext-version-upload-plan.mjs`
  - pure local config planner;
  - no network calls or subprocesses;
  - validates source config and existing KV ID;
  - injects the KV ID and strips the Cron trigger block;
  - returns a deterministic plan receipt.

- `.github/workflows/research-vnext-version-upload.yml`
  - manual-only;
  - future Cloudflare version upload only;
  - no deployment or trigger mutation;
  - no automatic execution in this phase.

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

The failure occurred only after every premise and frozen ABI check passed. Implementation is authorized only for the local planner and manual undeployed version-upload workflow described here; no Production execution is authorized.

## GREEN requirements

After accepted RED, add only the local planner + manual workflow plus test-only adjustments if required.

Local tests must prove:

- valid 32-hex existing KV ID is injected exactly once;
- invalid/missing KV IDs fail closed;
- generated upload config contains no `triggers` block;
- source config is never modified;
- planner source contains no `fetch`, `child_process`, `exec`, `spawn`, Cloudflare REST API or deployment command;
- workflow is `workflow_dispatch` only and `contents: read`;
- workflow requires `UPLOAD_UNDEPLOYED_VNEXT_VERSION`;
- workflow invokes `wrangler versions upload` and read-only `versions list --json` only;
- workflow disables Wrangler automatic provisioning/auto-create;
- workflow has no `wrangler deploy`, `versions deploy`, `triggers deploy`, Cloudflare REST resource mutation, or Production MCP probe;
- no Production workflow is dispatched by CI.

Then require all VNext tests, frozen ABI, type-check, full `test:research`, Wrangler dry-run and six-domain Isolation Gate.

## Explicitly forbidden in this phase

- dispatching the new version-upload workflow;
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
- Owner/Family/OAuth/Market Data/FORMAL/OHLC runtime changes;
- public ABI changes.

## GREEN evidence

Pending.

## Next gate after GREEN

Even after this phase passes, actual `versions upload` remains a Production-account mutation and requires a separately authorized execution phase. Because Durable Objects prevent relying on preview URLs, validation of the uploaded version will later require a separately tested zero-traffic deployment/version-override plan before any traffic shift.

## Final disposition

`VERSION_UPLOAD_ISOLATION_GREEN_IMPLEMENTATION_ALLOWED`
