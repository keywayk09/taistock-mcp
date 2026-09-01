# Change Note — Research VNext Owner OAuth KV Credential Metadata Preflight

- Date: `2026-09-02`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — must remain Draft/open/unmerged
- Sealed cleanup head: `ca89b77a06b79a09df3ade88a18e7225b53b2093`
- Current Production version: `0d7a4c8d-0ccf-4d89-9cd4-ab28fab70c5c`
- Expected OAuth KV namespace: `696e3654d2fa4c3bb1a868e5095b5660`
- Expected binding fingerprint: `d1faf34e53a3901c0ca13f4c29ff354194c7a3788bd94aa7a2e37509eaf1a49b`
- Frozen Owner ABI: `123` / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production mutation authorized by this phase: `NONE`

## Purpose

The atomic Production Worker deploy is structurally validated and sealed, but the authenticated MCP runtime probe remains blocked because `RESEARCH_VNEXT_PROBE_TOKEN` was absent/empty. This phase determines whether the existing Production OAuth KV already contains a legitimate, live Owner grant candidate that can later support a read-only authenticated probe.

This phase is **metadata-only**. It does not perform an MCP tool call and does not expose, rotate, issue, refresh, delete or mutate any OAuth credential.

## Security contract

A temporary one-shot preflight may be created only after accepted RED. Its contract must be fail-closed:

- exact branch + exact authorization-file trigger;
- authorization commit changes exactly one authorization JSON file;
- exact sealed source/head and current Production baseline;
- GET-only Cloudflare control-plane snapshot before KV inspection;
- exact active version / OAuth KV / binding fingerprint drift rejection;
- Cloudflare OAuth KV APIs are GET-only;
- raw KV key names are never logged or emitted;
- raw KV values are never logged or emitted;
- any key identifier in evidence is SHA-256 only;
- evidence may contain only structural metadata such as candidate count, role/userId/scope booleans, expiry/TTL presence and hashed key identifiers;
- `token_leak=false` must be explicit;
- `production_mutation=NONE` must be explicit;
- no Worker deploy, rollback, Cron mutation, KV write/delete, OAuth issuance/refresh, Durable Object lifecycle mutation or Legacy retirement.

A strict candidate is only structurally eligible when the decoded token record proves all of:

- its `clientId` matches a client referenced by an existing `grant:owner:` record;
- role resolves to `owner` from the token record or its nested props/tokenProps;
- userId = `owner`;
- scope contains `owner:full`;
- record is not demonstrably expired.

Metadata eligibility alone is **not** an authenticated runtime PASS and does not authorize Legacy retirement.

## TEST BEFORE BUILD — formal RED accepted

Formal RED head:

- `6acc15f9ee5e043943be4b3fb0f62020635c47ab`

Evidence:

- Research VNext Incremental Gate Run `33538430696`: `FAILURE`
- Incremental Job `99958371628`: `FAILURE`
- scope/protected-surface gate: `SUCCESS`
- marker before terminal RED: `OWNER_OAUTH_KV_METADATA_PREFLIGHT_RED_READY=PASS`
- sealed cleanup head: `ca89b77a06b79a09df3ade88a18e7225b53b2093`
- expected active Production version: `0d7a4c8d-0ccf-4d89-9cd4-ab28fab70c5c`
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
- same-head P7 / P8 / P9 / P12 / P13 / P13b / P14 / P15 / P16: `SUCCESS`
- Owner ABI remains frozen at 123 tools / frozen digest
- Production mutation: `NONE`

Immutable-style GREEN evidence:

- Artifact ID: `9812716553`
- Artifact name: `research-vnext-evidence-33538704326`
- Artifact digest: `sha256:5d0158f85c32b38ff4541a0eda108b8758172b923e65b3cb559a53ade28ac17b`

Workflow contract:

- exact push branch and exact one-file authorization trigger;
- exact sealed source `ca89b77a06b79a09df3ade88a18e7225b53b2093`;
- GET-only Production control-plane baseline before OAuth KV inspection;
- active version/OAuth KV/binding fingerprint fail-closed drift checks;
- GET-only Cloudflare OAuth KV key/value reads;
- raw key names and raw values never emitted;
- key identifiers may appear only as SHA-256 hashes;
- strict Owner candidate requires Owner grant client match + owner role + owner userId + `owner:full` scope + non-expired state;
- metadata receipt explicitly emits `token_leak=false`, `production_mutation=NONE`, `authenticated_mcp_probe_executed=false`, `legacy_retirement_authorized=false`;
- no Worker deploy/rollback, OAuth issuance/refresh, KV write/delete, Cron mutation, DO lifecycle mutation or Legacy retirement.

Disposition before seal:

`PASS_OWNER_OAUTH_KV_METADATA_PREFLIGHT_WORKFLOW_GREEN_UNAUTHORIZED`

## Docs-only workflow seal

This docs-only commit must itself pass:

- Research VNext Incremental Gate;
- Type check;
- Research VNext Isolation Gate.

Only after all three are `SUCCESS` may one exact GET-only metadata authorization be created. The authorization does not authorize an MCP probe or any Production mutation.
