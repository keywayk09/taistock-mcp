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

Current Cloudflare APIs provide read-only GET surfaces for active deployments, Cron schedules, Worker settings/bindings, and KV namespace discovery. The future snapshot workflow must use GET-only control-plane reads.

`POST`, `PUT`, `PATCH`, `DELETE`, `wrangler deploy`, `wrangler rollback`, versions upload/deploy, and any Production mutation are forbidden.

The existing canonical Production workflow is explicitly unsuitable for this snapshot because it contains OAuth KV creation, `wrangler deploy`, and Cron `PUT` side effects.

## TEST BEFORE BUILD

RED test:

- `tests/research-vnext-production-control-plane-snapshot.test.ts`
- formal RED commit: `ac705b002de1ee5f3ed3c443a2453d4cdfa2d513`

A legal RED requires:

1. Atomic Execution Mechanics final PASS disposition present;
2. Owner ABI exactly `123` / frozen digest;
3. hard-blocked Production execution workflow still sealed and credential/command-free;
4. atomic deploy authorization remains `production_deploy_authorized=false` / `production_mutation=NONE`;
5. source `wrangler.jsonc` still contains expected OAuth KV, Cron, exports, and DO bindings;
6. canonical Production workflow still proves why it cannot be reused for read-only snapshotting;
7. marker `PRODUCTION_CONTROL_PLANE_SNAPSHOT_RED_READY=PASS` prints;
8. only then may the test fail because `src/v6/research-vnext/production-control-plane-snapshot.ts` does not exist.

## RED evidence — ACCEPTED

Research VNext Incremental Gate:

- Run `33520542304`
- Job `99898361402`
- Change Note / protected-surface scope gate: **PASS**
- Phase 10B bounded exception: **PASS**
- prior VNext authorization/preflight/mechanics/skeleton tests before this phase: **PASS**
- exact marker: `PRODUCTION_CONTROL_PLANE_SNAPSHOT_RED_READY=PASS`
- Owner tool count: `123`
- Owner ABI digest: `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Atomic Execution Mechanics: `SEALED`
- blocked execution workflow: `SEALED`
- protected exports: `MyMCP`, `FamilyMCP`
- expected Cron: `*/5 * * * *`
- Production deploy authorized: `false`
- Production mutation: **NONE**
- terminal result: **EXPECTED RED**
- exact terminal error: `ERR_MODULE_NOT_FOUND` for `src/v6/research-vnext/production-control-plane-snapshot.ts`
- downstream incremental type-check / full `test:research` / canonical dry-run / atomic-config dry-run: correctly **SKIPPED**

Independent validation on the formal RED commit:

- Type check Run `33520542270`: **SUCCESS**, including type-check, full `test:research`, and canonical Wrangler dry-run
- Isolation Run `33520542377`: FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE **PASS**; VNEXT failed only on the same expected missing snapshot module; isolation finalizer failed closed

Disposition: `PRODUCTION_CONTROL_PLANE_SNAPSHOT_RED_ACCEPTED_GREEN_IMPLEMENTATION_ALLOWED`.

The earlier orphan Git object `4454acad0871ad342302f12b49653a16d17523c4` never became branch head and is explicitly **not** formal RED evidence.

## GREEN implementation

Implementation commit:

- `440ee3f5107344cdfe1ee9fc9fff1d77bf87ae3c`

Added only:

- `src/v6/research-vnext/production-control-plane-snapshot.ts`

The module is pure/deterministic and contains no imports, network access, subprocesses, Cloudflare calls, Production endpoints, Wrangler/curl commands, or mutation capability. It validates the complete normalized pre-deploy snapshot contract and returns a frozen receipt with the active version captured as the future rollback-target candidate while keeping deploy authorization false.

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

## GREEN evidence

Pending verification on this note-only trigger commit. Runtime implementation remains exactly `440ee3f5107344cdfe1ee9fc9fff1d77bf87ae3c`.

## Final disposition

`PRODUCTION_CONTROL_PLANE_SNAPSHOT_GREEN_VERIFICATION_PENDING`
