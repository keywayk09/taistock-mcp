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

Family remains read-only. The existing compatibility label `READ_ONLY_PUBLISHED_GENERATION` and the 180-calendar-day historical-read contract are retained because tests and external clients treat them as long-lived compatibility surfaces. The internal current-day provider can change without changing Family permissions or ingress.

### 3. Existing GitHub chip archive becomes historical context only

`src/v6/market-data-published-gateway.ts` is now an on-demand-first compatibility facade.

- current requested-date official evidence: TWSE / TPEx direct on-demand
- ranked broker evidence: public secondary, fail-soft
- existing GitHub market-data archive: read-only historical context only
- old archive is not the current-day decision source
- no requirement to continue daily chip capture to keep current reads working

The historical writer/parser code is retained during migration so old research data remains readable and rollback is simple.

### 4. Automatic Cloudflare market-data capture cron disabled

Removed the `*/5 * * * *` trigger from `wrangler.jsonc`.

This is the actual configuration switch that stops automatic chip capture/publish/backfill from being scheduled by this Worker.

`src/index-automation-bridge.ts` also turns its `scheduled()` handler into a defensive `RETIRED_NOOP`. This prevents a stale external scheduler binding from silently restarting the retired non-OHLC writer. Root `/health` metadata is overlaid to report `OFFICIAL_EXACT_DATE_ON_DEMAND`, `scheduled_chip_capture=DISABLED`, and `ohlc_policy=UNCHANGED_CANONICAL_PIPELINE`.

The old scheduler implementation remains in the codebase as dormant compatibility/history code. OHLC is not owned by this cron and is unchanged.

### 5. Source routing registry

Added `src/v6/tw-chip-intelligence-registry.ts`.

It records source roles, completeness, date-verification rules and persistence policy without storing market data.

### 6. Ranked broker-branch adapter

Added `src/v6/tw-broker-ranked-on-demand.ts` and attached it to the existing chip-summary facade without adding a new public MCP route.

Current contract:

- source: MoneyDJ public stock -> broker ranking page
- tier: `PUBLIC_SECONDARY`
- completeness: `RANKED_ONLY`
- exact page update date must match the requested date
- date mismatch -> `PENDING`
- parser failure -> `ERROR`, never fake empty/zero data
- explicit no-data page -> `READY_EMPTY`
- 10-minute in-memory request reuse
- no persistence
- fail-soft: broker-page failure never blocks official TWSE/TPEx chip layers
- a missing branch never means zero activity or no trading

This supports the research use case "stock -> important ranked branches". It does not claim to be a complete branch ledger and does not bypass CAPTCHA/anti-bot controls.

### 7. Warrant and maintenance-ratio boundary

Free official warrant data sources were identified for a later verified adapter: TWSE/TPEx daily warrant transaction/basic-data datasets expose warrant code/name, transaction date, amount/volume and underlying mappings. However, the production adapter remains fail-closed until field units and call/put/underlying mapping are regression-tested. Paid broker-by-broker warrant transaction products are not substituted or scraped as if they were free public data.

True broker customer account maintenance ratio also remains fail-closed because public market aggregates cannot reconstruct an individual's account collateral/debt state. The existing `ESTIMATED_POSITION_MAINTENANCE_PROXY` may be used only when reference price and estimated financing cost are explicitly available, and it must stay labeled as a proxy rather than official account maintenance ratio.

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
- `tests/tw-broker-ranked-on-demand.test.ts`
  - ranked buy/sell parsing
  - signed sell net lots
  - turnover-share parsing
  - source-date verification
  - short-lived cache
  - date mismatch -> `PENDING`
  - explicit no-data -> `READY_EMPTY`
- `tests/market-data-cloudflare-cron.test.ts`
  - old scheduler code may remain for compatibility
  - Production Wrangler config must have no automatic market-data cron trigger
- `tests/tw-market-data.test.ts`
  - official parsers remain protected
  - current read contract is on-demand
  - GitHub archive is historical-only
  - Wrangler cron is retired
  - automation bridge is defensive no-op
- existing public ingress tests continue to protect Owner and Family MCP URLs

## Problems found during migration

### Problem A — stopping the GitHub Action was not enough

Root cause: `wrangler.jsonc` still contained a Cloudflare `*/5 * * * *` cron trigger. The Worker scheduled handler could therefore continue the old market-data capture even after external automation changes.

Fix: remove the Wrangler cron binding and make the production automation bridge scheduler a defensive no-op. Retain dormant scheduler code only for compatibility/history tests.

### Problem B — Family compatibility label drift

Root cause: the migration initially changed the contract field `family_access` from `READ_ONLY_PUBLISHED_GENERATION` to `READ_ONLY_SAME_PROVIDER`. Existing tests correctly treated the former string as a frozen compatibility contract.

Fix: restore `family_access: "READ_ONLY_PUBLISHED_GENERATION"` and add a separate internal-provider field. Family behavior remains read-only and the public contract does not drift.

### Problem C — old cron test expected the retired trigger

Root cause: `tests/market-data-cloudflare-cron.test.ts` was designed to prove the old scheduled pipeline was enabled, so it asserted the presence of `*/5 * * * *`.

Fix: convert the test into a retirement contract: old implementation may remain, but `wrangler.jsonc` must not expose an automatic trigger.

### Problem D — Family 180-day retention compatibility marker was accidentally removed

Root cause: the first on-demand contract rewrite simplified metadata and dropped `history_window_calendar_days: 180` plus the "最多180自然日" tool-description marker. Family compatibility tests caught the regression.

Fix: restore the 180-day historical-read marker and keep the current-day provider change separate from the historical retention contract.

### Problem E — old P19 market-data test encoded obsolete persistence/cron semantics

Root cause: `tests/tw-market-data.test.ts` still asserted the literal old `D1/R2 forbidden` text and required the old Wrangler `*/5` cron. Those assertions represented the retired architecture rather than an invariant.

Fix: preserve all official parser regressions and stable public tool-name checks, but migrate the architecture assertions to the intended invariants: exact-date on-demand current reads, no current persistence, no previous-day substitution, legacy archive read-only, no Wrangler chip cron, defensive scheduler no-op, OHLC unchanged.

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
7. Ranked broker adapter tests pass.
8. Market-data cron retirement test passes.
9. Health metadata reports on-demand current reads and disabled scheduled chip capture.
10. Broker/warrant/maintenance capabilities are not overstated beyond verified source contracts.
