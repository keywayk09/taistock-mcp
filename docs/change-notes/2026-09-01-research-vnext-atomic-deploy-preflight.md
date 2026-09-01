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

## GREEN implementation allowed

Add only:

- `scripts/research-vnext-atomic-deploy-plan.mjs` — pure local planner / CLI; no network, Cloudflare API, subprocess or deploy execution;
- bounded test-only additions to `.github/workflows/research-vnext-foundation-gate.yml` to build a temporary config using a fake 32-hex KV ID and execute **only** `wrangler deploy --dry-run` against it.

Source `wrangler.jsonc` must remain unchanged.

### Planner contract

Fail closed unless:

- Worker name is exactly `taistock-mcp`;
- exactly one `OAUTH_KV` binding exists and source has no `id`;
- source Cron is exactly `*/5 * * * *`;
- `MyMCP` and `FamilyMCP` exports remain live SQLite Durable Objects;
- matching Durable Object bindings remain present;
- no `migrations` exists;
- supplied KV ID is exactly 32 hex characters.

Generated config must inject the ID exactly once, preserve protected exports/bindings, remove `triggers`, never emit empty Cron configuration, and leave source input unchanged.

Receipt must not contain the KV ID and must state: dry-run only; real deployment mode = atomic immediate 100%; Production deployment unauthorized; trigger mutation intent none; resource provisioning disabled; Production mutation none.

### CI dry-run contract

The new Incremental Gate step must use only `wrangler deploy --dry-run` with:

- `--experimental-provision=false`
- `--experimental-auto-create=false`

No Cloudflare credentials may be used by that step.

## Explicitly forbidden

- real `wrangler deploy`;
- Production workflow dispatch;
- versions upload / gradual deployment execution;
- source `wrangler.jsonc` mutation;
- protected export mutation;
- OAuth KV mutation;
- Cron mutation;
- Production MCP contact;
- traffic shift;
- ABI change;
- Legacy deletion;
- PR #206 merge.

## GREEN evidence

Pending implementation.

## Final disposition

`ATOMIC_DEPLOY_PREFLIGHT_GREEN_IMPLEMENTATION_ALLOWED`
