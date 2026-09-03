# 2026-09-04 Taiwan Chip Data On-Demand Migration

## Purpose

Move non-OHLC Taiwan stock chip data away from automatic daily bulk capture/persistence and toward read-only, exact-date, on-demand retrieval. Keep the existing OHLC canonical pipeline unchanged and keep all public MCP entrypoints stable for Owner and Family users.

## Public entrypoints — frozen, unchanged

- Owner primary: `/my-mcp`
- Owner legacy compatibility alias: `/mcp`
- Family / Mom: `/family-mcp`

These paths remain protected by `tests/public-ingress-freeze.test.ts`. This migration must never require reconnecting the ChatGPT app or changing the Family MCP URL.

## What changed

### 1. New on-demand official chip gateway

Added `src/v6/tw-chip-on-demand.ts`.

Current exact-date providers:

- TWSE T86 — listed institutional flow
- TPEx `tpex_3insti_daily_trading` — OTC institutional flow
- TWSE MI_MARGN — listed margin / short
- TPEx `tpex_mainboard_margin_balance` — OTC margin / short
- TWSE TWT72U — securities lending / return / balance
- TWSE TWT93U — listed SBL short sale
- TPEx `tpex_margin_sbl` + `tpex_short_sell` — OTC SBL short sale

Rules:

- source date must exactly match requested date
- no previous-day substitution
- not-yet-published data returns `PENDING`
- source errors are isolated by layer and do not block unrelated layers
- exact-date dataset with no symbol row is `READY_EMPTY`, never silently coerced to zero
- current raw and normalized responses are not persisted
- full-market source responses may be reused in a 5-minute in-memory Worker-isolate cache to reduce repeated external requests during the same research batch

### 2. Existing public chip tools keep their names

`src/v6/tw-market-data-tools.ts` now routes current evidence through the on-demand provider while preserving existing public tool names and input schemas.

Important stable names include:

- `get_tw_market_chip_summary`
- `get_tw_institutional_flow`
- `get_tw_margin_short`
- `get_tw_securities_lending`
- `get_tw_sbl_short_sale`
- `get_tw_market_data_bundle`
- `get_family_market_chip_summary`

Family remains read-only. The existing compatibility label `READ_ONLY_PUBLISHED_GENERATION` is retained because tests and external clients treat it as part of the long-lived contract; the internal current-day provider can change without changing Family permissions or ingress.

### 3. Existing GitHub chip archive becomes historical context only

`src/v6/market-data-published-gateway.ts` is now an on-demand-first compatibility facade.

- current requested-date evidence: TWSE / TPEx direct on-demand
- existing GitHub market-data archive: read-only historical context only
- old archive is not the current-day decision source
- no requirement to continue daily chip capture to keep current reads working

The historical writer/parser code is retained during migration so old research data remains readable and rollback is simple.

### 4. Automatic Cloudflare market-data capture cron disabled

Removed the `*/5 * * * *` trigger from `wrangler.jsonc`.

This is the actual switch that stops automatic chip capture/publish/backfill from being scheduled by this Worker.

The old scheduler implementation remains in the codebase as dormant compatibility/history code, but without a Wrangler cron binding it does not run automatically.

OHLC is not owned by this cron and is unchanged.

### 5. Source routing registry

Added `src/v6/tw-chip-intelligence-registry.ts`.

It records source roles, completeness, date-verification rules and persistence policy without storing market data.

Broker branch routing is currently `EXPERIMENTAL` / `RANKED_ONLY`; it must never be represented as a complete branch inventory until the public-source contract is verified.

Warrant and true account-level maintenance ratio remain fail-closed until their field/source contracts are verified. A market-data proxy must never be labeled as a broker customer's official account maintenance ratio.

## What did NOT change

- OHLC daily canonical capture
- OHLC indicators and historical replay data
- `/my-mcp`
- `/mcp`
- `/family-mcp`
- Family read-only permission boundary
- Owner authentication boundary
- crypto engine routing
- existing historical chip archive contents

## Tests added / updated

- `tests/tw-chip-on-demand.test.ts`
  - exact-date normalization
  - margin / short values
  - lending values
  - SBL values
  - 5-minute request reuse
  - date mismatch -> `PENDING`
  - previous-day substitution remains forbidden
- `tests/market-data-cloudflare-cron.test.ts`
  - old scheduler code may remain for compatibility
  - Production Wrangler config must have no automatic market-data cron trigger
- existing public ingress tests continue to protect Owner and Family MCP URLs

## Problems found during migration

### Problem A — stopping the GitHub Action was not enough

Root cause: `wrangler.jsonc` still contained a Cloudflare `*/5 * * * *` cron trigger. The Worker scheduled handler could therefore continue the old market-data capture even after external automation changes.

Fix: remove the Wrangler cron binding. Retain dormant scheduler code only for compatibility/history tests.

### Problem B — Family compatibility test failed after an internal label change

Root cause: the migration initially changed the contract field `family_access` from `READ_ONLY_PUBLISHED_GENERATION` to `READ_ONLY_SAME_PROVIDER`. Existing tests correctly treated the former string as a frozen compatibility contract.

Fix: restore `family_access: "READ_ONLY_PUBLISHED_GENERATION"` and add a separate internal-provider field. Family behavior remains read-only and the public contract does not drift.

### Problem C — old cron test expected the retired trigger

Root cause: `tests/market-data-cloudflare-cron.test.ts` was designed to prove the old scheduled pipeline was enabled, so it asserted the presence of `*/5 * * * *`.

Fix: convert the test into a retirement contract: old implementation may remain, but `wrangler.jsonc` must not expose an automatic trigger.

## Rollback

Before Production merge, all changes live on isolated branch `test/on-demand-chip-registry-v1` in PR #221.

Rollback before merge: close PR / delete branch.

Rollback after merge: revert the migration commit(s). Existing historical parsers and archive readers remain present, so rollback does not require reconstructing deleted historical code.

## Production acceptance gates

Do not merge/deploy unless all are true:

1. TypeScript check passes.
2. Full `test:research` passes.
3. Wrangler dry-run passes.
4. Public ingress freeze passes for `/my-mcp`, `/mcp`, `/family-mcp`.
5. Family isolation/read-only tests pass.
6. On-demand exact-date unit tests pass.
7. Market-data cron retirement test passes.
8. Production health metadata no longer claims automatic GitHub market-data capture.
9. Broker/warrant/maintenance capabilities are not overstated beyond verified source contracts.
