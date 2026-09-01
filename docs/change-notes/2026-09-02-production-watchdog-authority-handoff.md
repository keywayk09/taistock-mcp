# Change Note — Production Watchdog Authority Handoff

- Date: `2026-09-02`
- Fix branch: `fix/production-watchdog-authority-handoff-20260902`
- Base main: `20a357923a35b495aefa32eee99ebd8eb14f8ee8`
- Worker: `taistock-mcp`
- Production mutation in this design/test phase: `NONE`

## Root cause

Research VNext atomic cutover successfully installed version `0d7a4c8d-0ccf-4d89-9cd4-ab28fab70c5c`, but scheduled watchdog Run `33534917011` later emitted `dispatch=true reason=production_source_stale` and dispatched canonical main deploy Run `33534927601`. That main deploy installed version `79c49e81-b582-43ee-883e-0d0e0b6c3d39`.

The collision exists because `.github/workflows/deploy-cloudflare-watchdog.yml` treats the committed main deploy receipt as desired-state authority, while an intentional unmerged cutover has no way to declare a bounded temporary authority handoff.

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

1. Lease absent → preserve existing watchdog receipt evaluation and main recovery behavior.
2. Lease active and structurally valid → verify the exact source ref/SHA exists in GitHub history, then suppress canonical main recovery for that bounded window.
3. Lease expired → resume existing main recovery behavior automatically.
4. Lease malformed, future-issued beyond tolerance, too long, or source ref/SHA unverifiable → fail the watchdog job without dispatching Production.
5. Lease never authorizes a Worker deploy, rollback, Cron mutation, OAuth/KV mutation, Durable Object lifecycle change, or Legacy retirement.

## TEST BEFORE BUILD

The RED test must land before the evaluator/workflow implementation. It must prove current watchdog lacks the authority lease contract and fail only on that missing capability.

No Production action is authorized by the RED or GREEN implementation commits.
