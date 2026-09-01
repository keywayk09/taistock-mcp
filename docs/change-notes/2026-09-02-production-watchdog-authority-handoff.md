# Change Note — Production Watchdog Authority Handoff

- Date: `2026-09-02`
- Fix branch: `fix/production-watchdog-authority-handoff-20260902`
- Base main: `20a357923a35b495aefa32eee99ebd8eb14f8ee8`
- Worker: `taistock-mcp`
- Production mutation in this design/test phase: `NONE`

## Root cause

Research VNext atomic cutover successfully installed version `0d7a4c8d-0ccf-4d89-9cd4-ab28fab70c5c`, but scheduled watchdog Run `33534917011` later emitted `dispatch=true reason=production_source_stale` and dispatched canonical main deploy Run `33534927601`. That main deploy installed version `79c49e81-b582-43ee-883e-0d0e0b6c3d39`.

The collision exists because `.github/workflows/deploy-cloudflare-watchdog.yml` treats the committed main deploy receipt as desired-state authority, while an intentional unmerged cutover has no way to declare a bounded temporary authority handoff.

A second defect compounds the collision: canonical deploy now archives its per-run receipt as a GitHub Actions artifact and intentionally does not commit deployment observability metadata back to `main`, but the watchdog still reads the old committed `tmp/deploy-receipts/taistock-mcp-cloudflare.json`. Therefore the committed receipt cannot remain live Production authority.

Classification:

`PRODUCTION_WRITER_AUTHORITY_COLLISION_MAIN_WATCHDOG_VS_UNMERGED_CUTOVER`

## Target contract

Introduce a bounded, explicit Production authority lease at:

`runtime/taistock-mcp-production-authority.json`

The lease is not a deploy authorization and never contains credentials. It only controls whether the main recovery watchdog is allowed to dispatch its canonical main deploy during an explicitly authorized external cutover window.

Required active lease fields:

- `schema = TAISTOCK_MCP_PRODUCTION_AUTHORITY_V1`
- `mode = EXTERNAL_CUTOVER_LEASE`
- `worker = taistock-mcp`
- exact non-main `source_ref`
- exact lowercase 40-hex `source_sha`
- ISO-8601 `issued_at`
- ISO-8601 `expires_at`
- maximum lease duration: 6 hours
- `watchdog_main_recovery_suspended = true`
- `production_deploy_authorized = false`
- `production_mutation = NONE`
- non-empty `handoff_id`

## Fail-closed semantics

1. Lease absent → evaluate canonical main deployment truth from GitHub Actions, not a stale committed receipt.
2. Lease active and structurally valid → verify the exact source ref/SHA exists in GitHub history, then suppress canonical main recovery for that bounded window.
3. Lease expired → resume canonical main Actions-evidence recovery automatically.
4. Lease malformed, future-issued beyond tolerance, too long, or source ref/SHA unverifiable → fail the watchdog job without dispatching Production.
5. GitHub Actions evidence query failure → fail closed without dispatching Production.
6. Lease never authorizes a Worker deploy, rollback, Cron mutation, OAuth/KV mutation, Durable Object lifecycle change, or Legacy retirement.

## TEST BEFORE BUILD — authority lease formal RED accepted

RED head:

- `150400d6c9816a8959dfbfe0039fb67681c5e4e9`

Evidence:

- Type check workflow Run `33540549007`: `FAILURE`
- Job `99965419355`: `FAILURE`
- TypeScript `npm run type-check`: `SUCCESS`
- existing Research / Family / Market Data regressions reached the ops-contract test without an earlier failure
- marker before terminal RED: `PRODUCTION_WATCHDOG_AUTHORITY_HANDOFF_RED_READY=PASS`
- watchdog recovery writer: `PRESENT`
- authority evaluator: `ABSENT`
- `production_deploy_authorized=false`
- `production_mutation=NONE`
- exact terminal assertion: `production authority lease evaluator must exist only after accepted RED`
- Cloudflare dry-run step was skipped because the intended RED stopped the test workflow first
- Production contact/mutation from this RED: `NONE`

The RED remains immutable and is not rewritten as PASS.

Disposition:

`PRODUCTION_WATCHDOG_AUTHORITY_HANDOFF_RED_ACCEPTED_MINIMAL_GREEN_ALLOWED`

## Authority lease GREEN — executable PASS

Implementation:

- lease evaluator: `scripts/production-authority-lease.mjs`
- evaluator commit: `db2d0014188651f68cff4afb1db20776a05c03b6`
- watchdog lease gate commit: `0144c428e2e2417249167909fc755975847249f8`
- executable policy-test head: `00c767f79d82a4dd75e38aabc2f7eddfd048198d`

The evaluator is credential-free and has no Cloudflare operation. It proves four executable states:

- lease absent → `ABSENT / EVALUATE_MAIN_RECEIPT`
- valid unexpired lease → `ACTIVE / SUPPRESS_MAIN_RECOVERY`
- expired lease → `EXPIRED / EVALUATE_MAIN_RECEIPT`
- malformed/overlong lease → `INVALID / FAIL_CLOSED`, exit `78`

Type check workflow Run `33541025891`: `SUCCESS`.

No authority lease file exists on this fix branch, so this GREEN verification cannot suppress or mutate Production.

## TEST BEFORE BUILD — canonical Actions authority formal RED accepted

The first GREEN exposed the remaining authority bug: after a lease expires, the watchdog still falls back to the stale committed deploy receipt even though canonical deploy truth is now archived per run in GitHub Actions.

Second RED head:

- `068a53057d0107685034edc035876b66b57f9d8c`

Evidence:

- Type check workflow Run `33541224634`: `FAILURE`
- Job `99967663270`: `FAILURE`
- TypeScript `npm run type-check`: `SUCCESS`
- all preceding research regressions reached the ops-contract test without an earlier failure
- first authority marker: `PRODUCTION_WATCHDOG_AUTHORITY_HANDOFF_RED_READY=PASS`
- executable lease marker: `PRODUCTION_WATCHDOG_AUTHORITY_HANDOFF_EXECUTABLE_GREEN=PASS`
- second marker before terminal RED: `PRODUCTION_WATCHDOG_ACTIONS_AUTHORITY_RED_READY=PASS`
- committed receipt authority: `PRESENT`
- desired authority: `LATEST_CANONICAL_DEPLOY_ACTIONS_EVIDENCE`
- `production_mutation=NONE`
- exact terminal assertion: `watchdog must not use the stale committed deploy receipt as live Production authority`
- Cloudflare dry-run was skipped because the intended RED stopped the workflow first
- Production contact/mutation from this RED: `NONE`

This second RED is accepted and remains immutable.

Disposition:

`PRODUCTION_WATCHDOG_ACTIONS_AUTHORITY_RED_ACCEPTED_MINIMAL_GREEN_ALLOWED`

## Canonical Actions authority GREEN boundary

The minimum implementation allowed after the second accepted RED is:

- keep the bounded lease gate first and unchanged in meaning;
- remove committed deploy-receipt reads from the watchdog;
- query only the canonical `deploy-cloudflare-production.yml` runs on `main` via GitHub Actions metadata;
- if a canonical deploy is queued/in progress, do not dispatch another one;
- if the latest completed canonical deploy succeeded, compare its exact `headSha` against current main only for protected Production source paths;
- if the latest completed canonical deploy failed, retry only after the existing 15-minute backoff;
- if there is no canonical deploy evidence, allow one recovery dispatch;
- if Actions evidence is malformed/unavailable, fail closed without dispatch;
- no Cloudflare read/write is added to watchdog decision logic.

No authority lease is created by the GREEN implementation itself, so GREEN CI cannot suppress or mutate Production.
