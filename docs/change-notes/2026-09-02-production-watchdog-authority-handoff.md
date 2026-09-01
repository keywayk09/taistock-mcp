# Change Note — Production Watchdog Authority Handoff

- Date: `2026-09-02`
- Fix branch: `fix/production-watchdog-authority-handoff-20260902`
- Base main: `20a357923a35b495aefa32eee99ebd8eb14f8ee8`
- Worker: `taistock-mcp`
- Production mutation in this design/test phase: `NONE`

## Root cause

Research VNext atomic cutover successfully installed version `0d7a4c8d-0ccf-4d89-9cd4-ab28fab70c5c`, but scheduled watchdog Run `33534917011` later emitted `dispatch=true reason=production_source_stale` and dispatched canonical main deploy Run `33534927601`. That main deploy installed version `79c49e81-b582-43ee-883e-0d0e0b6c3d39`.

The collision exists because `.github/workflows/deploy-cloudflare-watchdog.yml` treated the committed main deploy receipt as desired-state authority, while an intentional unmerged cutover had no way to declare a bounded temporary authority handoff.

A second defect compounded the collision: canonical deploy archives its per-run receipt as a GitHub Actions artifact and intentionally does not commit deployment observability metadata back to `main`, while the old watchdog still read `tmp/deploy-receipts/taistock-mcp-cloudflare.json`. Therefore that committed receipt cannot be live Production authority.

Classification:

`PRODUCTION_WRITER_AUTHORITY_COLLISION_MAIN_WATCHDOG_VS_UNMERGED_CUTOVER`

## Final contract

A bounded, explicit Production authority lease may exist at:

`runtime/taistock-mcp-production-authority.json`

The lease is not a deploy authorization and never contains credentials. It only controls whether the main recovery watchdog may dispatch its canonical main deploy during an explicitly authorized external cutover window.

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

Fail-closed semantics:

1. Lease absent → evaluate canonical main deployment truth from GitHub Actions, never the stale committed receipt.
2. Lease active and structurally valid → verify exact source ref/SHA ancestry, then suppress canonical main recovery for the bounded window.
3. Lease expired → resume canonical main Actions-evidence recovery automatically.
4. Lease malformed, future-issued beyond tolerance, too long, or source ref/SHA unverifiable → exit fail-closed without dispatch.
5. GitHub Actions evidence query failure/malformed evidence → fail closed without dispatch.
6. Lease never authorizes Worker deploy, rollback, Cron mutation, OAuth/KV mutation, Durable Object lifecycle change or Legacy retirement.

## TEST BEFORE BUILD — authority lease formal RED accepted

RED head: `150400d6c9816a8959dfbfe0039fb67681c5e4e9`

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
- Production contact/mutation from this RED: `NONE`

The RED remains immutable and is not rewritten as PASS.

Disposition: `PRODUCTION_WATCHDOG_AUTHORITY_HANDOFF_RED_ACCEPTED_MINIMAL_GREEN_ALLOWED`

## Authority lease GREEN — executable PASS

Implementation:

- evaluator: `scripts/production-authority-lease.mjs`
- evaluator commit: `db2d0014188651f68cff4afb1db20776a05c03b6`
- watchdog lease-gate commit: `0144c428e2e2417249167909fc755975847249f8`
- executable policy-test head: `00c767f79d82a4dd75e38aabc2f7eddfd048198d`

Executable states proved:

- absent → `ABSENT / EVALUATE_MAIN_RECEIPT`
- valid unexpired → `ACTIVE / SUPPRESS_MAIN_RECOVERY`
- expired → `EXPIRED / EVALUATE_MAIN_RECEIPT`
- malformed/overlong → `INVALID / FAIL_CLOSED`, exit `78`

Type check workflow Run `33541025891`: `SUCCESS`.

No authority lease existed during GREEN verification, so this phase could not suppress or mutate Production.

## TEST BEFORE BUILD — canonical Actions authority formal RED accepted

Second RED head: `068a53057d0107685034edc035876b66b57f9d8c`

Evidence:

- Type check workflow Run `33541224634`: `FAILURE`
- Job `99967663270`: `FAILURE`
- TypeScript `npm run type-check`: `SUCCESS`
- first marker: `PRODUCTION_WATCHDOG_AUTHORITY_HANDOFF_RED_READY=PASS`
- executable lease marker: `PRODUCTION_WATCHDOG_AUTHORITY_HANDOFF_EXECUTABLE_GREEN=PASS`
- second marker before terminal RED: `PRODUCTION_WATCHDOG_ACTIONS_AUTHORITY_RED_READY=PASS`
- committed receipt authority: `PRESENT`
- desired authority: `LATEST_CANONICAL_DEPLOY_ACTIONS_EVIDENCE`
- `production_mutation=NONE`
- exact terminal assertion: `watchdog must not use the stale committed deploy receipt as live Production authority`
- Production contact/mutation from this RED: `NONE`

The second RED remains immutable and is not rewritten as PASS.

Disposition: `PRODUCTION_WATCHDOG_ACTIONS_AUTHORITY_RED_ACCEPTED_MINIMAL_GREEN_ALLOWED`

## Canonical Actions authority GREEN — PASS

GREEN implementation commit:

- `18a7c647022653d0afc9538f394bb916cd42eb3c`

Final watchdog behavior:

- bounded lease evaluation remains first;
- active lease requires exact branch/SHA ancestry verification;
- committed deploy receipt is no longer read as authority;
- canonical deployment truth is read with `gh run list --workflow deploy-cloudflare-production.yml --branch main`;
- queued/in-progress canonical deploy → no duplicate dispatch, `canonical_deploy_in_progress`;
- no canonical deploy evidence → one recovery dispatch may be requested;
- latest canonical failure → retry only after 900 seconds;
- latest canonical success → compare exact deploy `headSha` to current main only across protected Production source paths;
- same protected source → `latest_successful_deploy`, no dispatch;
- protected source drift → `production_source_stale`, recovery dispatch allowed;
- malformed/unavailable Actions evidence → fail closed, no dispatch.

GREEN verification:

- Type check workflow Run `33541548262`: `SUCCESS`
- workflow produces no CI artifact by design; run/job logs are the immutable CI evidence
- `PRODUCTION_WATCHDOG_AUTHORITY_HANDOFF_EXECUTABLE_GREEN=PASS`
- `PRODUCTION_WATCHDOG_ACTIONS_AUTHORITY_GREEN=PASS`
- no authority lease file existed during GREEN
- Production deploy authorized by GREEN: `false`
- Production mutation from GREEN: `NONE`

## Docs-only final seal

This commit changes this Change Note only. It does not create an authority lease and cannot contact or mutate Production.

The seal itself must pass the repository Type check workflow. Only after that run is `SUCCESS` may this phase be sealed as:

`PASS_PRODUCTION_WATCHDOG_BOUNDED_AUTHORITY_HANDOFF_ACTIONS_AUTHORITY_GREEN_SEALED`

After that seal, PR #207 may be merged to `main`. The merge is intentionally separate from Research VNext PR #206: PR #206 remains Draft/open/unmerged. After #207 merge, canonical main deployment and the updated watchdog must be observed before any new VNext Production cutover is authorized.
