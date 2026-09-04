# 2026-09-04 Production Worker Cron Retirement Hotfix

## Context

PR #221 migrated current non-OHLC Taiwan chip evidence to exact-date on-demand reads and removed the old `*/5 * * * *` trigger from `wrangler.jsonc`. The deployed Worker also changed `scheduled()` to a defensive `RETIRED_NOOP`, so an unexpected schedule could no longer restart the retired chip writer.

During the first Production deployment after PR #221, the canonical deploy workflow exposed a second independent scheduler authority that had not been covered by the migration tests.

## Problem found after Production deployment

`.github/workflows/deploy-cloudflare-production.yml` still contained a step named `Install and verify five-minute Cron Trigger`.

After `wrangler deploy`, that step called the Cloudflare Workers schedules API and explicitly wrote:

```json
[{"cron":"*/5 * * * *"}]
```

Therefore removing `triggers.crons` from `wrangler.jsonc` was not sufficient. Every canonical Production deployment could recreate the remote Worker schedule.

## Impact

The newly deployed Worker was already protected by `scheduled() -> RETIRED_NOOP`, so the resurrected schedule did not restart non-OHLC chip capture/persistence. It could, however, wake the Worker every five minutes unnecessarily and contradicted the intended `scheduled_chip_capture=DISABLED` contract.

OHLC was not affected; the canonical OHLC pipeline remains separately owned and unchanged.

## Root cause

Scheduler ownership existed in two places:

1. `wrangler.jsonc` — removed by PR #221.
2. `.github/workflows/deploy-cloudflare-production.yml` — legacy deployment mutation that explicitly reinstalled the remote schedule.

The original migration tests covered Wrangler configuration and the Worker `scheduled()` handler but did not assert that the canonical Production deployment workflow could not recreate a Cloudflare schedule.

## Hotfix

The Production deploy workflow now:

- keeps the existing Worker deploy and OAuth KV resolution unchanged;
- replaces the old cron-install step with `Remove and verify all Worker Cron Triggers`;
- calls the same Cloudflare schedules endpoint with `PUT []` after a successful deploy;
- reads the schedules endpoint back and fails if any Worker schedule remains;
- records `scheduled_chip_capture: DISABLED` and `worker_cron_schedules: []` in the per-run deployment receipt;
- changes the failure reason to `CRON_TRIGGER_RETIREMENT_FAILED`;
- changes the success reason to `DEPLOYED_NO_CRON_AND_FULL_MARKET_SMOKE_VERIFIED`;
- strengthens Production smoke verification to require:
  - `market_data.scheduled_chip_capture == DISABLED`
  - `market_data.current_chip_persistence == NONE`
  - `market_data.ohlc_policy == UNCHANGED_CANONICAL_PIPELINE`.

## Regression protection

`tests/deploy-cloudflare-workflow.test.ts` now asserts that the canonical Production workflow:

- contains the schedule-retirement step;
- writes an empty schedules array rather than a five-minute cron;
- verifies the remote schedule list is empty;
- emits the new retirement success/failure receipt states;
- does not contain the retired cron-install step or cron payload;
- preserves the existing Owner/Family deployment and Production watchdog authority contracts.

## Production acceptance

Do not declare this hotfix complete until:

1. branch TypeScript / research / deployment workflow tests pass;
2. PR is merged to `main`;
3. the latest canonical `Deploy taistock-mcp to Cloudflare` run for the hotfix main SHA succeeds;
4. its `Remove and verify all Worker Cron Triggers` step succeeds;
5. Production smoke succeeds with on-demand/no-persistence/OHLC-unchanged metadata;
6. the deployment receipt reports no Worker cron schedules.

## Rollback

If the hotfix deployment fails before schedule retirement is verified, do not restore the legacy five-minute schedule. Keep the current Worker `scheduled()` no-op fence in place, inspect the Cloudflare schedules API failure, and correct the retirement path on an isolated branch.
