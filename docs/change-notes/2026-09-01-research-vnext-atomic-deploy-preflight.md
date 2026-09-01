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
4. For Cron Triggers, omitting `triggers.crons` does not disable an existing Cron Trigger; explicitly setting `crons: []` is the disabling operation.
5. Wrangler automatic provisioning / auto-create can be explicitly disabled.

Therefore the only safe work in this phase is a **local atomic-deploy configuration planner plus CI dry-run**. No real deployment command may execute.

## Current repository constraints

`wrangler.jsonc` currently contains:

- Worker name `taistock-mcp`;
- `OAUTH_KV` binding without an ID;
- `triggers.crons = ["*/5 * * * *"]`;
- declarative Durable Object `exports` for `MyMCP` and `FamilyMCP` with SQLite storage;
- matching Durable Object bindings;
- no legacy `migrations` block.

The canonical Production workflow currently performs unrelated control-plane work around deployment:

- resolves or creates OAuth KV, including a possible KV namespace `POST`;
- deploys with `wrangler deploy`;
- explicitly `PUT`s the five-minute Cron schedule afterward.

That canonical workflow is **not** reused in this phase.

## Purpose

Prove that a future atomic Production deploy can be represented by a temporary Wrangler config which:

1. preserves the existing declarative Durable Object `exports` exactly;
2. injects an already-existing OAuth KV namespace ID as immutable input;
3. removes the `triggers` block from the temporary deploy config without touching source `wrangler.jsonc`;
4. never emits `crons: []`;
5. disables Wrangler automatic provisioning and auto-create;
6. passes `wrangler deploy --dry-run` in CI;
7. encodes that any eventual real deploy is an immediate 100% traffic switch and therefore requires a later explicit Production authorization and rollback gate.

## TEST BEFORE BUILD

RED test:

- `tests/research-vnext-atomic-deploy-preflight.test.ts`

A legal RED must prove all premises first:

- DO Platform Compatibility is sealed `PASS_DO_PLATFORM_COMPATIBILITY_FAIL_CLOSED_PRODUCTION_UNCHANGED`;
- public ABI remains exactly `123` / frozen digest;
- DO policy still blocks versions upload / gradual deployment and requires `WRANGLER_DEPLOY_REQUIRED`;
- source `wrangler.jsonc` still has exact protected exports, missing OAuth KV ID, and existing five-minute Cron;
- canonical Production deploy still contains the unrelated KV-create and Cron-PUT side effects this phase is isolating;
- blocked version-upload workflow remains fail-closed;
- marker `ATOMIC_DEPLOY_PREFLIGHT_RED_READY=PASS` prints;
- only then may the test fail because `scripts/research-vnext-atomic-deploy-plan.mjs` does not exist.

Any earlier failure is a premise/harness failure and does not authorize implementation.

## GREEN implementation allowed after accepted RED

Add only:

- `scripts/research-vnext-atomic-deploy-plan.mjs` — pure local planner / CLI; no network, Cloudflare API, subprocess, or deploy execution;
- bounded test-only additions to `.github/workflows/research-vnext-foundation-gate.yml` so CI builds the temporary config with a fake 32-hex namespace ID and runs **only** `wrangler deploy --dry-run` against it.

The source `wrangler.jsonc` must remain byte-unchanged.

### Planner contract

The planner must fail closed unless:

- Worker name is exactly `taistock-mcp`;
- exactly one `OAUTH_KV` binding exists and source has no `id`;
- source Cron is exactly `*/5 * * * *`;
- `MyMCP` and `FamilyMCP` declarative exports are present as live SQLite Durable Objects;
- matching Durable Object bindings remain present;
- no `migrations` block exists;
- supplied existing KV ID is exactly 32 hex characters.

Generated temporary config must:

- inject the KV ID exactly once;
- preserve the protected `exports` declaration;
- preserve Durable Object bindings;
- contain no `triggers` block and no `crons: []`;
- not mutate the source string.

Receipt must not contain the KV ID and must explicitly state:

- dry-run only;
- real deployment mode = atomic immediate 100% traffic;
- Production deployment not authorized;
- trigger mutation intent = none;
- resource provisioning = disabled;
- protected exports preserved.

### CI dry-run contract

Incremental Gate may invoke only:

`wrangler deploy --dry-run`

against the generated temporary config, with:

- `--experimental-provision=false`
- `--experimental-auto-create=false`

No Cloudflare token/account secret is needed or allowed for this new step.

## Explicitly forbidden

- any real `wrangler deploy`;
- dispatching any Production workflow;
- `wrangler versions upload` execution;
- gradual deployment;
- modifying source `wrangler.jsonc`;
- removing/changing `MyMCP` or `FamilyMCP` exports;
- OAuth KV create/update/delete;
- Cron mutation;
- Production MCP contact;
- traffic shift;
- public ABI change;
- Legacy deletion;
- PR #206 merge.

## GREEN evidence

Pending legal RED.

## Final disposition

`ATOMIC_DEPLOY_PREFLIGHT_RED_PENDING`
