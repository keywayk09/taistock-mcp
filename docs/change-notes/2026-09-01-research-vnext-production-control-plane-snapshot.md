# Change Note — Research VNext Production Control-Plane Snapshot Core

- Date: `2026-09-01`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — must remain Draft/open/unmerged
- Prerequisite mechanics seal: `f3a434ad4083dca7a59ac311c4f4aa165dc18fc2`
- Mechanics seal CI: Incremental `33517446399` SUCCESS; Type check `33517446294` SUCCESS; Isolation `33517446284` SUCCESS
- Frozen Owner ABI: `123` tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production deploy authorization: **FALSE**
- Production deploy: **NONE**
- Production mutation: **NONE**

## Purpose

Freeze a deterministic, fail-closed contract for the future read-only Production control-plane snapshot before any Production execution authorization can exist.

This phase validates normalized snapshot facts only. It does **not** contact Cloudflare, add credentials, execute network requests, modify the blocked Production execution workflow, deploy, rollback, mutate OAuth KV, mutate Cron, or merge PR #206.

## Snapshot facts required

A valid snapshot must contain exactly:

- Worker name `taistock-mcp`;
- exact 40-hex source SHA;
- active deployment ID as UUID;
- one active version ID as UUID at exactly `100%` traffic;
- Cron schedules exactly `["*/5 * * * *"]`;
- existing OAuth KV namespace ID as exactly 32 hex characters;
- protected exports exactly `MyMCP`, `FamilyMCP` in canonical order;
- Durable Object bindings exactly:
  - `MCP_OBJECT` → `MyMCP`
  - `FAMILY_MCP_OBJECT` → `FamilyMCP`;
- a 64-hex binding fingerprint;
- hard blocker still active;
- read-only capture explicitly true;
- `productionAuthorizationIssued=false`.

The active version becomes the only permitted future rollback target candidate. The snapshot itself never authorizes deploy or rollback.

## Cloudflare API semantics frozen for the future workflow

Current Cloudflare APIs provide read-only GET surfaces for:

- active deployments: `GET /accounts/{account_id}/workers/scripts/{script_name}/deployments`;
- Cron schedules: `GET /accounts/{account_id}/workers/scripts/{script_name}/schedules`;
- Worker settings/bindings: `GET /accounts/{account_id}/workers/scripts/{script_name}/settings`;
- KV namespaces: read/list GET only.

The future snapshot workflow must use GET-only control-plane reads. `POST`, `PUT`, `PATCH`, `DELETE`, `wrangler deploy`, `wrangler rollback`, versions upload/deploy, and any Production mutation are forbidden.

The existing canonical Production workflow is explicitly unsuitable for this snapshot because it contains OAuth KV creation, `wrangler deploy`, and Cron `PUT` side effects.

## TEST BEFORE BUILD

RED test:

- `tests/research-vnext-production-control-plane-snapshot.test.ts`
- RED commit: `4454acad0871ad342302f12b49653a16d17523c4`

A legal RED requires:

1. Atomic Execution Mechanics final PASS disposition present;
2. Owner ABI exactly `123` / frozen digest;
3. hard-blocked Production execution workflow still sealed and credential/command-free;
4. atomic deploy authorization remains `production_deploy_authorized=false` / `production_mutation=NONE`;
5. source `wrangler.jsonc` still contains expected OAuth KV, Cron, exports, and DO bindings;
6. canonical Production workflow still proves why it cannot be reused for read-only snapshotting;
7. marker `PRODUCTION_CONTROL_PLANE_SNAPSHOT_RED_READY=PASS` prints;
8. only then may the test fail because `src/v6/research-vnext/production-control-plane-snapshot.ts` does not exist.

Any earlier failure is a premise/harness failure and does not authorize implementation.

## GREEN implementation allowed after accepted RED

Add only:

- `src/v6/research-vnext/production-control-plane-snapshot.ts`

Required APIs:

- `RESEARCH_VNEXT_PRODUCTION_CONTROL_PLANE_SNAPSHOT_VERSION`
- `buildProductionControlPlaneSnapshot(input)`

The module must be pure/deterministic, have no imports, no network access, no subprocesses, and no executable Production command strings.

## Explicitly forbidden

- adding the live Cloudflare snapshot workflow before this core contract is GREEN and sealed;
- modifying/removing the Production execution hard blocker;
- Cloudflare credentials in runtime code;
- Production MCP contact;
- POST/PUT/PATCH/DELETE Cloudflare calls;
- Wrangler deploy/rollback/version mutation;
- OAuth KV mutation;
- Cron mutation;
- Legacy deletion;
- PR #206 merge.

## RED evidence

Pending.

## GREEN evidence

Pending.

## Final disposition

`PRODUCTION_CONTROL_PLANE_SNAPSHOT_RED_PENDING`
