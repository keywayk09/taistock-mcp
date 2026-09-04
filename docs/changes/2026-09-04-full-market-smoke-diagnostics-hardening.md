# 2026-09-04 Full-Market Production Smoke Diagnostics Hardening

## Context

Production deploy run `33825845342` attempt 1 successfully deployed main SHA `87b7e8a1514d96070533cd86dd12696b937bf3b4` and successfully retired all persisted Worker cron schedules, but `/health/full-market` returned HTTP 503 during all three smoke attempts.

The same SHA was re-run without code changes in attempt 2. The first full-market smoke then succeeded with 1086 listed and 887 OTC rows, while cron retirement again verified that the remote Worker schedule list was empty.

Historical commit `3bb26a8c2af500fe41dfce01f4a5dfbb2ad51ccf` (`Fix full-market Production health (#214)`) already documented this source path as latency-sensitive: a live complete response previously required 50.84 seconds. The stable source contract intentionally remains fail-closed when listed coverage is below 400 or OTC coverage is below 250.

## Problem

The canonical Production deployment workflow used `curl --fail` when requesting `/health/full-market`.

When the endpoint correctly returned a degraded HTTP 503 response with diagnostic JSON, curl exited with code 22 before the response body was retained in the useful failure artifact. As a result, attempt 1 proved that full-market was degraded but did not preserve enough evidence to identify whether TWSE OpenAPI, MOPSFIN TPEx universe, or one or more TWSE MIS OTC batches caused the coverage failure.

This is an observability defect, not a request to relax the fail-closed market coverage contract.

## Change

The Production smoke now uses `curl --fail-with-body` for both `/health` and `/health/full-market` reads.

This preserves the existing HTTP failure semantics while retaining error/degraded response bodies in `/tmp/smoke-health.json` and `/tmp/smoke-full-market.json`. If all retries fail, the existing deployment diagnostic artifact can therefore record the actual endpoint JSON, including source providers, row counts, and source-specific errors.

## Invariants

- `/health/full-market` still returns 503 when the stable universe is not usable.
- Minimum coverage remains 400 listed / 250 OTC.
- No source fallback is added.
- No stale or previous-day substitution is introduced.
- No OHLC behavior changes.
- No Owner/Family ingress changes.
- No Worker cron is restored.
- Current non-OHLC chip persistence remains `NONE`.

## Regression protection

`tests/deploy-cloudflare-workflow.test.ts` requires `--fail-with-body` on Production health smoke requests and forbids the old body-dropping `curl --fail ... /health/full-market` form.

## Production acceptance

Do not merge until PR TypeScript, full research regression, Wrangler dry-run, and Production Single Writer Guard are green. After merge, verify the canonical Production deploy still reports no Worker schedules and a healthy full-market contract.
