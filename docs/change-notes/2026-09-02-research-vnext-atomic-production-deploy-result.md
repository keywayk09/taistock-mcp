# Change Note — Research VNext Atomic Production Deploy Result

- Date: `2026-09-02`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — remains Draft/open/unmerged
- Deployment source: `87bf6d22cc9ed9a44a8017aa860d956f1ec6eef7`
- One-shot authorization commit: `0e60309171a5839b01c4cc80f84c3a7153d16239`
- One-shot run: `33534878858`
- One-shot job: `99946635363`
- Immutable artifact: `9811214109`
- Artifact digest: `sha256:3ca25cf38fab2e1520e0a5a25688a4c2068aa67c0c670610f0628f7f0b35c8e2`
- Frozen Owner ABI: `123` / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`

## Immutable run result

The GitHub Actions run conclusion is `FAILURE` and remains immutable. It must not be rewritten as PASS.

The failure occurred **after** the single authorized Worker deployment and after postdeploy control-plane validation.

Successful steps before the terminal validation failure:

- exact one-file authorization guard: `SUCCESS`
- exact sealed source checkout: `SUCCESS`
- GET-only predeploy control-plane snapshot: `SUCCESS`
- exact live baseline drift gate: `SUCCESS`
- atomic deploy plan: `SUCCESS`
- Wrangler dry-run: `SUCCESS`
- exact mutation-intent receipt: `SUCCESS`
- exactly one Production `wrangler deploy`: `SUCCESS`
- GET-only postdeploy control-plane validation: `SUCCESS`

## Production deployment evidence

Predeploy active version:

`75f989b9-e798-4d32-a95f-7253b4e703ec`

Postdeploy active version:

`0d7a4c8d-0ccf-4d89-9cd4-ab28fab70c5c`

Postdeploy active percentage: `100`

The immutable pre/post receipts prove all protected control-plane properties were preserved:

- cron unchanged: `*/5 * * * *`
- OAuth KV binding preserved
- full binding fingerprint unchanged: `d1faf34e53a3901c0ca13f4c29ff354194c7a3788bd94aa7a2e37509eaf1a49b`
- protected Durable Object exports preserved: `MyMCP`, `FamilyMCP`
- Durable Object bindings preserved: `MCP_OBJECT -> MyMCP`, `FAMILY_MCP_OBJECT -> FamilyMCP`
- no DO migration/lifecycle change
- `read_only_capture=true`
- `token_leak=false`
- resource provisioning: `DISABLED`
- trigger mutation intent in generated deploy config: `NONE`
- automatic rollback: `false`

The deploy log reports Worker startup success and new Current Version ID `0d7a4c8d-0ccf-4d89-9cd4-ab28fab70c5c`.

## Terminal probe failure — credential blocker, not runtime regression evidence

The read-only MCP probe failed with:

`protocol_negotiation_failed:modern=http_401:;legacy=http_401:`

The Actions environment showed `RESEARCH_VNEXT_PROBE_TOKEN` was empty. The repository's canonical Production validation workflow also depends on the same `secrets.RESEARCH_VNEXT_PROBE_TOKEN`; no alternate in-repository probe credential path is available.

`probe.json` in the immutable artifact is empty because the probe process failed before writing a receipt.

Therefore the failure is classified as:

`POSTDEPLOY_AUTHENTICATED_MCP_PROBE_BLOCKED_BY_MISSING_GITHUB_SECRET`

It is **not** classified as a demonstrated Production runtime regression.

## Autonomous rollback decision

Decision: `NO_ROLLBACK`

Reason:

- the Worker deployment itself succeeded;
- the new version became 100% active;
- exact postdeploy control-plane validation succeeded;
- cron, OAuth KV, full binding fingerprint, DO exports and DO bindings were preserved;
- the only failed validation was an authenticated probe attempted with an empty token;
- rolling back on a missing validation credential would mutate a structurally validated Production deployment without evidence that the new runtime is defective.

Rollback target `75f989b9-e798-4d32-a95f-7253b4e703ec` remains historical predeploy evidence only and is not executed.

## Cleanup requirement

The temporary one-shot workflow and authorization must now be removed in this order:

1. delete `.github/workflows/research-vnext-atomic-production-one-shot.yml`;
2. delete `runtime/research-vnext-atomic-production-one-shot-authorization.json`.

Deleting the workflow first prevents authorization-file cleanup from retriggering the one-shot.

After cleanup, the lifecycle test must be updated test-first to accept only the exact state:

`DEPLOYED_CONTROL_PLANE_PASS_AUTHENTICATED_PROBE_CREDENTIAL_BLOCKED_NO_ROLLBACK_TEMPORARY_SURFACES_CLEANED`

This state must **not** be mislabeled as a fully authenticated runtime probe PASS.

Legacy retirement remains blocked.
