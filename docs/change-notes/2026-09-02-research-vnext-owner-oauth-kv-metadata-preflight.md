# Change Note — Research VNext Owner OAuth KV Credential Metadata Preflight

- Date: `2026-09-02`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — must remain Draft/open/unmerged
- Sealed cleanup head: `ca89b77a06b79a09df3ade88a18e7225b53b2093`
- Historical transient VNext Production version: `0d7a4c8d-0ccf-4d89-9cd4-ab28fab70c5c`
- Latest known canonical main Production version after watchdog recovery: `79c49e81-b582-43ee-883e-0d0e0b6c3d39`
- Expected OAuth KV namespace: `696e3654d2fa4c3bb1a868e5095b5660`
- Expected binding fingerprint: `d1faf34e53a3901c0ca13f4c29ff354194c7a3788bd94aa7a2e37509eaf1a49b`
- Frozen Owner ABI: `123` / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production mutation authorized by this phase: `NONE`
- Legacy retirement: `BLOCKED`

## Purpose

The atomic VNext Worker deployment was structurally valid when executed, but its authenticated MCP probe was blocked because `RESEARCH_VNEXT_PROBE_TOKEN` was absent/empty. This metadata-only phase was designed to determine whether Production OAuth KV already contains a legitimate Owner grant candidate, without exposing or mutating credentials.

The live metadata attempt did **not** reach OAuth KV inspection. Its exact current-version guard detected that the VNext version was no longer active and stopped fail-closed before any OAuth KV key/value read.

## Security contract

The temporary one-shot preflight contract was fail-closed:

- exact branch + exact authorization-file trigger;
- authorization commit changes exactly one authorization JSON file;
- exact sealed source and expected Production baseline;
- GET-only Cloudflare control-plane snapshot before KV inspection;
- exact active version / OAuth KV / binding fingerprint drift rejection;
- Cloudflare OAuth KV inspection allowed only after the baseline gate;
- raw KV key names and raw KV values forbidden from evidence;
- any key identifier allowed only as SHA-256;
- `token_leak=false` required;
- `production_mutation=NONE` required;
- no Worker deploy, rollback, Cron mutation, KV write/delete, OAuth issuance/refresh, Durable Object lifecycle mutation or Legacy retirement.

A strict Owner candidate would have required Owner grant client match + role `owner` + userId `owner` + scope `owner:full` + non-expired state. Because the active-version gate failed first, candidate inspection was never executed.

## TEST BEFORE BUILD — formal RED accepted

Formal RED head:

- `6acc15f9ee5e043943be4b3fb0f62020635c47ab`

Evidence:

- Research VNext Incremental Gate Run `33538430696`: `FAILURE`
- Incremental Job `99958371628`: `FAILURE`
- scope/protected-surface gate: `SUCCESS`
- marker before terminal RED: `OWNER_OAUTH_KV_METADATA_PREFLIGHT_RED_READY=PASS`
- sealed cleanup head: `ca89b77a06b79a09df3ade88a18e7225b53b2093`
- expected VNext active version: `0d7a4c8d-0ccf-4d89-9cd4-ab28fab70c5c`
- expected OAuth KV: `696e3654d2fa4c3bb1a868e5095b5660`
- expected binding fingerprint: `d1faf34e53a3901c0ca13f4c29ff354194c7a3788bd94aa7a2e37509eaf1a49b`
- Owner ABI: `123` / frozen digest
- temporary workflow: `ABSENT`
- temporary authorization: `ABSENT`
- `token_leak=false`
- `production_mutation=NONE`
- exact terminal assertion: `temporary Owner OAuth KV metadata preflight workflow must exist only after accepted RED`

Independent validation:

- Type check Run `33538430687`: `SUCCESS`
- Research VNext Isolation Gate Run `33538430721`: `FAILURE`
- Isolation FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE: `SUCCESS`
- Isolation VNEXT: `FAILURE`

The RED remains immutable and is not rewritten as PASS.

Disposition:

`OWNER_OAUTH_KV_METADATA_PREFLIGHT_RED_ACCEPTED_GREEN_WORKFLOW_ALLOWED`

## GREEN workflow — PASS, unauthorized

Temporary GET-only workflow implementation:

- commit: `6241edc88d090d9273291ffb2c31451a36054dda`
- path: `.github/workflows/research-vnext-owner-oauth-kv-metadata-preflight.yml`
- authorization path remained `ABSENT`, so GREEN validation made no Production contact.

GREEN verification:

- Research VNext Incremental Gate Run `33538704326`: `SUCCESS`
- Type check Run `33538704343`: `SUCCESS`
- Research VNext Isolation Gate Run `33538704381`: `SUCCESS`
- Owner ABI remains frozen at 123 tools / frozen digest
- Production mutation: `NONE`

Immutable-style GREEN evidence:

- Artifact ID: `9812716553`
- Artifact name: `research-vnext-evidence-33538704326`
- Artifact digest: `sha256:5d0158f85c32b38ff4541a0eda108b8758172b923e65b3cb559a53ade28ac17b`

## Docs-only workflow seal — PASS

Workflow seal commit:

- `04dc30be69acff333ee776b1d06195ba3c8fa722`

Seal verification:

- Research VNext Incremental Gate Run `33538871472`: `SUCCESS`
- Type check Run `33538870790`: `SUCCESS`
- Research VNext Isolation Gate Run `33538870785`: `SUCCESS`

Only after this seal was one exact GET-only metadata authorization created.

## Live GET-only metadata attempt — immutable fail-closed result

Authorization commit:

- `5dc64a90d42574443ef6d13fb78fc0eb7f71439f`
- compare against workflow seal proved exactly one commit and exactly one changed file: `runtime/research-vnext-owner-oauth-kv-metadata-preflight-authorization.json`
- authorization mode: `GET_ONLY_OAUTH_KV_METADATA`
- Production mutation: `NONE`

Live run:

- Research VNext Owner OAuth KV Metadata Preflight Run `33539000173`: `FAILURE`
- Job `99960282209`: `FAILURE`

Successful steps before the fail-closed stop:

- exact authorization guard: `SUCCESS`
- exact sealed source checkout: `SUCCESS`
- GET-only Production control-plane capture: `SUCCESS`

Exact blocker:

`ACTIVE_VERSION_DRIFT`

Because the baseline gate failed at active-version equality:

- OAuth KV metadata inspection: `SKIPPED`
- OAuth KV key-list GET: `NOT_EXECUTED`
- OAuth KV value GET: `NOT_EXECUTED`
- authenticated MCP probe: `NOT_EXECUTED`
- metadata receipt validation: `SKIPPED`
- workflow artifact: `NONE`
- raw token/key disclosure: `NONE`
- `token_leak=false`
- Production mutation: `NONE`

The live failure remains immutable and is not rewritten as PASS.

## Root cause — Production writer authority collision

The active-version drift was caused by an independent canonical main Production writer, not by unexplained Cloudflare drift.

Timeline:

1. VNext atomic one-shot Run `33534878858` started at `2026-09-01T16:57:11Z` and deployed VNext version `0d7a4c8d-0ccf-4d89-9cd4-ab28fab70c5c`.
2. Scheduled watchdog Run `33534917011`, Job `99946762042`, ran on `main` shortly afterward.
3. The watchdog emitted exactly: `watchdog decision: dispatch=true reason=production_source_stale`.
4. The watchdog then executed `gh workflow run deploy-cloudflare-production.yml --ref main`.
5. That dispatched canonical main Production Run `33534927601`.
6. Canonical main deploy completed successfully and installed Current Version ID `79c49e81-b582-43ee-883e-0d0e0b6c3d39`.
7. The later metadata preflight correctly observed that expected VNext version `0d7a4c8d...` was no longer active and stopped before OAuth KV inspection.

The watchdog is scheduled as `*/5 * * * *` and uses committed file `tmp/deploy-receipts/taistock-mcp-cloudflare.json` as desired-state evidence. That committed receipt still records source SHA `28e96a137f71b4042a55461e54e70b4551be60ed` from `2026-08-27T04:40:33Z`, while current `main` is `20a357923a35b495aefa32eee99ebd8eb14f8ee8`. Therefore its `production_source_stale` decision can conflict with an intentional unmerged branch cutover.

This is classified as:

`PRODUCTION_WRITER_AUTHORITY_COLLISION_MAIN_WATCHDOG_VS_UNMERGED_VNEXT_CUTOVER`

The VNext version `0d7a4c8d...` must now be treated as **historical transient Production evidence**, not as the current active Production version.

No attempt is made to fake/update the committed main receipt, disable the watchdog blindly, or redeploy VNext before writer authority is resolved.

## Immediate temporary-surface cleanup

Cleanup order was fail-closed:

1. metadata workflow cleanup commit: `05c56fa36b28fc90549e6d300187b70d06465740`
2. metadata authorization cleanup commit: `9cab1c9d1d73d91e27fe356527d117a4eb352942`

The workflow was removed first, so deleting the authorization could not retrigger the metadata preflight. Both temporary paths were subsequently confirmed absent.

## Cleanup lifecycle formal RED — accepted

Cleanup RED head:

- `9cab1c9d1d73d91e27fe356527d117a4eb352942`

Evidence:

- Research VNext Incremental Gate Run `33539454355`: `FAILURE`
- Incremental Job `99961781716`: `FAILURE`
- scope/protected-surface gate: `SUCCESS`
- marker before terminal lifecycle RED: `OWNER_OAUTH_KV_METADATA_PREFLIGHT_RED_READY=PASS`
- exact terminal assertion: `temporary Owner OAuth KV metadata preflight workflow must exist only after accepted RED`
- Type check Run `33539454134`: `SUCCESS`
- Research VNext Isolation Gate Run `33539454258`: `FAILURE`
- Isolation VNEXT: `FAILURE`
- Isolation FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE: `SUCCESS`

This cleanup RED is accepted and remains immutable.

## Cleanup lifecycle target

The only acceptable post-cleanup state is:

`CLEANED_METADATA_PREFLIGHT_FAIL_CLOSED_ACTIVE_VERSION_DRIFT_ROOT_CAUSE_MAIN_WATCHDOG`

That state means:

- live metadata preflight failed before OAuth KV inspection;
- no credential value was read or exposed;
- no MCP probe was executed;
- no Production mutation occurred;
- temporary workflow and authorization are absent;
- the active-version drift has a proven canonical main watchdog root cause;
- VNext is not currently asserted as Production active;
- Legacy retirement remains blocked;
- any future Production cutover requires an explicit Production writer-authority handoff/fence before another VNext deploy.
