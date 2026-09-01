# Change Note — Research VNext Production Control-Plane One-Shot Cleanup

- Date: `2026-09-01`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — remains Draft/open/unmerged
- Frozen Owner ABI: `123` / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Canonical sealed snapshot source: `9fa1499eeaeb2ccaa7e118502f8b618c76401a31`
- Production deploy authorized: `false`
- Production mutation: `NONE`

## Live read-only Production control-plane evidence

The temporary connector-compatible one-shot bridge was authorized only after the bridge seal had three green checks. The authorization commit changed exactly one file and triggered exactly one push-only one-shot run.

- Authorization commit: `3c02d378e57681f29e16c5b6ca3f903e24882ef3`
- Live snapshot run: `33527987699`
- Live snapshot job: `99923622130`
- Workflow conclusion: `SUCCESS`
- Artifact ID: `9808495101`
- Artifact name: `research-vnext-production-control-plane-one-shot-33527987699`
- Artifact digest: `sha256:f38b86c862b1bce5d2c0d06a94b7d2ebf7ed0c29caa9cfa39102ad35c304e000`
- Snapshot status: `READ_ONLY_SNAPSHOT_VALID`
- Worker: `taistock-mcp`
- Source SHA: `9fa1499eeaeb2ccaa7e118502f8b618c76401a31`
- Active deployment ID: `8e4b3922-e96b-4e2b-b365-65e2e9f71968`
- Active version ID: `75f989b9-e798-4d32-a95f-7253b4e703ec`
- Active version percentage: `100`
- Cron schedule: `*/5 * * * *`
- Protected exports: `MyMCP`, `FamilyMCP`
- Durable Object bindings: `MCP_OBJECT -> MyMCP`, `FAMILY_MCP_OBJECT -> FamilyMCP`
- Binding fingerprint: `d1faf34e53a3901c0ca13f4c29ff354194c7a3788bd94aa7a2e37509eaf1a49b`
- Rollback target version ID: `75f989b9-e798-4d32-a95f-7253b4e703ec`
- Hard blocker: `REQUIRED_ACTIVE`
- Read-only capture: `true`
- Production deploy authorized: `false`
- Production mutation: `NONE`

No Production deploy, rollback, MCP invocation, OHLC write, resource provisioning, trigger mutation, OAuth KV mutation, Cron mutation, or Durable Object lifecycle mutation was authorized or executed by this snapshot.

## Immediate temporary cleanup

Cleanup was performed immediately after immutable evidence was downloaded and inspected.

The order was intentionally fail-closed:

1. remove the temporary one-shot workflow first, so deleting authorization cannot trigger a second run;
2. remove the authorization file second, after the workflow no longer exists.

- Temporary workflow cleanup commit: `98eb80511bb0fd72a4cd73d234307ffef12f7ff5`
- Authorization cleanup commit: `0944ba36e1dd6366bc0faea542837d958ee8c6c1`
- `.github/workflows/research-vnext-production-control-plane-one-shot.yml`: `ABSENT`
- `runtime/research-vnext-production-control-plane-one-shot-authorization.json`: `ABSENT`
- Additional one-shot Production snapshot run after cleanup: `NONE`
- Production deploy authorized: `false`
- Production mutation: `NONE`

## Initial cleanup CI — immutable RED

The first cleanup verification correctly exposed a lifecycle mismatch in the frozen bridge test. The cleanup itself was correct; the test still required the temporary workflow to remain present after the cleanup requirement had removed it.

- Cleanup head: `0944ba36e1dd6366bc0faea542837d958ee8c6c1`
- Research VNext Incremental Gate Run `33528106454`: `FAILURE`
- Incremental Job `99924027398`: `FAILURE`
- Scope gate: `PASS`
- Type check Run `33528106399`: `SUCCESS`
- Research VNext Isolation Gate Run `33528106531`: `FAILURE`
- Exact incremental assertion: `temporary one-shot GET-only bridge workflow must exist only after accepted RED`
- Root cause: the pre-cleanup test contract had no post-cleanup lifecycle state.
- Production deploy authorized: `false`
- Production mutation: `NONE`

This failure is immutable and must not be relabeled PASS.

## TEST BEFORE BUILD — cleanup lifecycle RED

The one-shot bridge test is extended before any cleanup evidence seal is accepted.

The cleanup-aware contract preserves every original pre-cleanup bridge assertion. It permits both temporary files to be absent only when all of these are true:

- the live snapshot run/job/artifact and artifact digest are documented exactly;
- the snapshot reports `READ_ONLY_SNAPSHOT_VALID`;
- active deployment/version and exact rollback target are recorded;
- binding fingerprint is recorded;
- both exact cleanup commits are recorded;
- Production deploy authorization remains false;
- Production mutation remains none;
- a final cleanup disposition is explicitly sealed only after the new RED is observed.

Expected marker before the deliberate terminal RED:

`PRODUCTION_CONTROL_PLANE_ONE_SHOT_CLEANUP_RED_READY=PASS`

The final cleanup disposition is intentionally absent from the RED commit. Therefore the cleanup-aware test failed closed until this RED was accepted.

## Formal cleanup lifecycle RED — ACCEPTED, IMMUTABLE

- RED commit: `70db5fa5d486d7be52c3962bdfd7e1baaf394435`
- Research VNext Incremental Gate Run `33528665575`: `FAILURE`
- Incremental Job `99925908031`: `FAILURE`
- Change Note / protected-surface scope gate: `PASS`
- Marker before terminal RED: `PRODUCTION_CONTROL_PLANE_ONE_SHOT_CLEANUP_RED_READY=PASS`
- Exact terminal assertion: `cleanup evidence disposition must be sealed only after accepted RED`
- Type check Run `33528665464`: `SUCCESS`
- Research VNext Isolation Gate Run `33528665510`: `FAILURE`
- Isolation domains FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE: `SUCCESS`
- Isolation domain VNEXT: `FAILURE` only because of the same expected cleanup disposition RED
- Owner tool count remains: `123`
- Owner ABI digest remains: `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production deploy authorized: `false`
- Production mutation: `NONE`

Both the initial cleanup lifecycle mismatch failure and this formal cleanup RED remain immutable evidence and are not rewritten as PASS.

## GREEN cleanup evidence disposition

The required live receipt, exact cleanup commits, no-second-run condition, frozen ABI, and no-mutation constraints are now documented after the formal RED was accepted. No runtime, workflow, authorization, public ABI, Production resource, OAuth KV, Cron, Durable Object lifecycle, OHLC, or Legacy behavior is changed by this docs-only GREEN implementation.

`PASS_PRODUCTION_CONTROL_PLANE_ONE_SHOT_LIVE_SNAPSHOT_CAPTURED_AND_TEMPORARY_BRIDGE_CLEANED_PRODUCTION_UNCHANGED`

## GREEN verification — PASS

- GREEN implementation commit: `1a24f33bbe570fac40b3a369eb998ce7ceedd389`
- Research VNext Incremental Gate Run `33528819105`: `SUCCESS`
- Incremental Job `99926425337`: `SUCCESS`
- Change Note / protected-surface scope gate: `PASS`
- all Research VNext tests: `PASS`
- Type check: `PASS`
- full existing research regression: `PASS`
- Cloudflare Wrangler dry-run only: `PASS`
- atomic deploy-config dry-run only: `PASS`
- Evidence Artifact ID: `9808859251`
- Evidence Artifact name: `research-vnext-evidence-33528819105`
- Evidence Artifact digest: `sha256:446573a4b4a0e111918f07ce92fe60191f09cf28a349c43d40963300ed6371f3`
- Independent Type check Run `33528819075`: `SUCCESS`
- Independent Research VNext Isolation Gate Run `33528819071`: `SUCCESS`
- Production deploy authorized: `false`
- Production mutation: `NONE`

## Cleanup seal — PASS

Cleanup seal commit:

- `00f046995004ec65c1209e9664259e6a10fd85ce`

Required seal verification completed successfully:

- Research VNext Incremental Gate Run `33528997296`: `SUCCESS`
- Type check Run `33528997181`: `SUCCESS`
- Research VNext Isolation Gate Run `33528997209`: `SUCCESS`

Therefore temporary one-shot cleanup is **SEALED**. This seal does not promote the earlier live receipt to a complete Production snapshot acceptance; receipt completeness is evaluated separately.

PR #206 remains Draft/open/unmerged. Production deploy remains unauthorized. Production mutation remains `NONE`.
