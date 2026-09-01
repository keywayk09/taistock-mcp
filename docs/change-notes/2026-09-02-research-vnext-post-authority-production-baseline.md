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

## TEST BEFORE BUILD

The formal RED must prove all preconditions above and then fail only because the distinct temporary workflow is absent. No authorization file exists during RED.

RED failures remain immutable and will not be rewritten as PASS.
