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

A candidate is only structurally eligible when the decoded record proves all of:

- role = `owner`;
- userId = `owner`;
- scope contains `owner:full`;
- record is not demonstrably expired.

Metadata eligibility alone is **not** an authenticated runtime PASS and does not authorize Legacy retirement.

## TEST BEFORE BUILD — RED candidate

The RED test must prove the sealed postdeploy cleanup state, Owner ABI, current Production baseline expectations and token-leak rules first, then fail only because the temporary metadata-preflight workflow does not yet exist.

Before accepted RED:

- temporary workflow: `ABSENT`;
- temporary authorization: `ABSENT`;
- Production contact by this phase: `NONE`;
- Production mutation: `NONE`.
