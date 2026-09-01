# Change Note — Research VNext Post-Authority Production Baseline

- Date: `2026-09-02`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — remains Draft/open/unmerged
- Sealed VNext source before this phase: `6dc5beb02c168ad6c7c74c314fc9cf704253391a`
- Frozen Owner ABI: `123` / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production mutation authorized by baseline capture: `NONE`

## Preconditions already proven

Production writer authority repair is now canonical on main:

- PR #207 merged as main commit `9e642058f44e2a57738709bbcb335c51256012ca`.
- merge-trigger Run `33541947347`: `SUCCESS`.
- canonical main Production deploy Run `33541960849`: `SUCCESS`.
- canonical main deployed Version ID: `02def751-acf1-4e18-baca-cd19cdca361e`.
- OAuth KV remained `696e3654d2fa4c3bb1a868e5095b5660`.
- protected Durable Object bindings remained `MyMCP` / `FamilyMCP`.
- Cron remained `*/5 * * * *`.
- live full-market smoke passed with listed `1092`, OTC `888`.
- canonical deployment receipt artifact ID `9813955544`, digest `sha256:939c565b57e13770c635d1ae2e15345ededa15cac50d072ead86358396fac074`.

A bounded main authority lease was then installed:

- main commit `2ff6ef09addf2e81b2015c355515c75a08938375`.
- source ref `refactor/research-vnext-foundation-20260901`.
- source SHA `6dc5beb02c168ad6c7c74c314fc9cf704253391a`.
- expires `2026-09-01T23:40:00Z`.
- `watchdog_main_recovery_suspended=true`.
- `production_deploy_authorized=false`.
- `production_mutation=NONE`.

The runtime-only lease commit did not trigger the canonical Production deploy workflow.

## Purpose

Capture a new immutable GET-only Production control-plane receipt after the writer-authority repair and canonical main deployment. This receipt becomes the exact predeploy baseline for any later Research VNext recutover.

The baseline capture itself does not deploy VNext and does not authorize a Production mutation.

## Temporary bridge contract

A distinct temporary one-shot workflow may exist only after an accepted RED. It must:

- trigger only on push to `refactor/research-vnext-foundation-20260901` and only when exact authorization path changes;
- require the authorization commit to change exactly one file;
- require exact schema `RESEARCH_VNEXT_POST_AUTHORITY_BASELINE_AUTH_V1`;
- require mode `READ_ONLY_PRODUCTION_CONTROL_PLANE_SNAPSHOT`;
- require exact sealed source `6dc5beb02c168ad6c7c74c314fc9cf704253391a`;
- require `production_deploy_authorized=false` and `production_mutation=NONE`;
- checkout the exact sealed source into a separate directory;
- execute exactly the sealed GET-only snapshot client;
- expose Cloudflare credentials only to that one snapshot step;
- perform no POST/PUT/PATCH/DELETE, deploy, rollback, Cron mutation, KV write/delete, OAuth issuance/refresh, DO lifecycle change or Legacy retirement;
- upload one immutable-style receipt artifact;
- be removed before its authorization file is removed after the single live attempt.

Required live receipt includes:

- status `READ_ONLY_SNAPSHOT_VALID`;
- source SHA `6dc5beb02c168ad6c7c74c314fc9cf704253391a`;
- exact current active deployment/version;
- 100% active version percentage;
- Cron `*/5 * * * *`;
- OAuth KV ID;
- `MyMCP` / `FamilyMCP` bindings;
- binding fingerprint;
- rollback target equal to the current active version;
- `read_only_capture=true`;
- `token_leak=false`;
- `production_deploy_authorized=false`;
- `production_mutation=NONE`.

## TEST BEFORE BUILD — formal RED accepted

Formal RED head: `3bde877be867f2a3da19d34143b895f13b6f8be6`.

Evidence:

- Research VNext Incremental Gate Run `33542255647`: `FAILURE`.
- Incremental job `99971117810`: scope gate `SUCCESS`; all preceding VNext tests passed until the new bridge test.
- RED marker: `POST_AUTHORITY_PRODUCTION_BASELINE_RED_READY=PASS`.
- exact terminal assertion: `temporary post-authority GET-only baseline workflow must exist only after accepted RED`.
- Type check Run `33542255730`: `SUCCESS`.
- Research VNext Isolation Gate Run `33542255677`: `FAILURE` only because domain `VNEXT` failed on the same intended RED; `FAMILY`, `MARKET_DATA`, `FORMAL_BLIND`, `OWNER_OPS`, and `BUNDLE` all `SUCCESS`.
- temporary workflow: `ABSENT`.
- temporary authorization: `ABSENT`.
- `token_leak=false`.
- `production_deploy_authorized=false`.
- `production_mutation=NONE`.
- Production contact/mutation from RED: `NONE`.

This RED is accepted and remains immutable; it will not be rewritten as PASS.

Disposition:

`POST_AUTHORITY_PRODUCTION_BASELINE_RED_ACCEPTED_GET_ONLY_GREEN_ALLOWED`

## GET-only bridge GREEN

Implementation head: `3808ba865f78cf688e31b859e2131b53fb0efddd`.

The only new execution surface was `.github/workflows/research-vnext-post-authority-production-baseline.yml`. No authorization file existed at the GREEN head, so this workflow could not run its live capture path during GREEN verification.

GREEN evidence:

- Research VNext Incremental Gate Run `33548028150`: `SUCCESS`.
- Type check Run `33548028389`: `SUCCESS`.
- Research VNext Isolation Gate Run `33548028192`: `SUCCESS` across `VNEXT`, `FAMILY`, `MARKET_DATA`, `FORMAL_BLIND`, `OWNER_OPS`, and `BUNDLE`.
- Incremental evidence artifact ID `9816289469`.
- Incremental evidence digest `sha256:edfd51e8acbf6ec4c387e1684c41b62f32c2421263f0be05f51c2367efc3dab8`.
- workflow trigger: exact branch + exact authorization path only.
- authorization commit contract: exactly one changed file.
- sealed source checkout: `6dc5beb02c168ad6c7c74c314fc9cf704253391a`.
- Cloudflare credentials were scoped only to the GET-only snapshot step.
- no deploy, rollback, Cron write, KV write/delete, OAuth issuance/refresh, DO lifecycle change, or Legacy retirement was present.
- authorization at GREEN: `ABSENT`.
- `production_deploy_authorized=false`.
- `production_mutation=NONE`.

## Docs-only seal and one-time live capture

The bridge was sealed before authorization and then executed exactly once.

- docs-only seal head: `8f92f302...`.
- seal Incremental Run `33548207977`: `SUCCESS`.
- seal Type Run `33548207974`: `SUCCESS`.
- seal Isolation Run `33548208050`: `SUCCESS`.
- one-file authorization head: `4b9a9b67dbfc5564a128db66d36f7e961e054aa1`.
- live GET-only baseline Run `33548350116`: `SUCCESS`.
- live evidence artifact ID `9816384247`.
- live evidence digest `sha256:09988733fdcb120674f76fc9c1d8db218cf4110ef9d44e60ed9a40cff5ae6135`.
- observed active Version ID: `72cb66b1-ea3d-4eea-bb70-21c0fe40ef4f`.
- binding fingerprint remained `d1faf34e53a3901c0ca13f4c29ff354194c7a3788bd94aa7a2e37509eaf1a49b`.
- OAuth KV and Cron remained unchanged.
- `read_only_capture=true`.
- `token_leak=false`.
- `production_deploy_authorized=false`.
- `production_mutation=NONE`.

The observed Version ID differs from the earlier canonical-main deployment ID and is preserved as historical evidence. This baseline phase does not infer or rewrite its writer attribution.

## Temporary-surface cleanup — completed

The one-shot execution surface was removed immediately after the successful capture:

- workflow removed first at cleanup commit `47fea3a1...`;
- authorization removed second at cleanup commit `d873ac51650737ece6b24b2101430697ed5d58ec`;
- temporary workflow: `ABSENT`;
- temporary authorization: `ABSENT`;
- no deploy or rollback was performed by cleanup;
- no additional Production mutation was authorized.

The earlier RED remains immutable. The completed live capture and subsequent cleanup are a later lifecycle state and must not cause the RED-only bridge assertion to fire again.

Final lifecycle disposition:

`POST_AUTHORITY_PRODUCTION_BASELINE_COMPLETED_READ_ONLY_TEMPORARY_SURFACES_CLEANED`
