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
- full-market source responses may be reused in a short in-memory Worker-isolate cache to reduce repeated external requests during the same research batch

### 2. Existing public chip tools keep their names

`src/v6/tw-market-data-tools.ts` routes user-facing current evidence through the isolated on-demand facade while preserving existing public tool names and input schemas.

Important stable names include:

- `get_tw_market_chip_summary`
- `get_tw_institutional_flow`
- `get_tw_margin_short`
- `get_tw_securities_lending`
- `get_tw_sbl_short_sale`
- `get_tw_market_data_bundle`
- `get_family_market_chip_summary`

Family remains read-only. The existing compatibility label `READ_ONLY_PUBLISHED_GENERATION` and the 180-calendar-day historical-read contract are retained because tests and external clients treat them as long-lived compatibility surfaces. The internal current-day provider can change without changing Family permissions or ingress.

### 3. Formal Published gateway and current on-demand facade are separated

The migration intentionally keeps the deterministic formal-history path separate from current web evidence.

`src/v6/market-data-published-gateway.ts` remains the deterministic Published-generation gateway used by formal historical/replay research. It is not converted into a live web facade.

`src/v6/tw-market-chip-on-demand-facade.ts` is the user-facing current-evidence composition layer behind the existing Owner/Family public tool names.

The facade combines:

- current requested-date official evidence from TWSE / TPEx
- official non-directional warrant activity
- ranked broker evidence as public-secondary fail-soft context
- existing GitHub market-data archive as read-only historical context only

The old GitHub archive is not the current-day decision source and no new daily chip capture is required for current reads. Formal Published replay remains deterministic and uncontaminated by current web fetches.

### 4. Automatic Cloudflare market-data capture cron disabled

Removed the `*/5 * * * *` trigger from `wrangler.jsonc`.

This is the actual configuration switch that stops automatic chip capture/publish/backfill from being scheduled by this Worker.

`src/index-automation-bridge.ts` also turns its `scheduled()` handler into a defensive `RETIRED_NOOP`. This prevents a stale external scheduler binding from silently restarting the retired non-OHLC writer. Root `/health` metadata is overlaid to report on-demand current reads, disabled scheduled chip capture, and unchanged OHLC policy.

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
- short in-memory request reuse
- no persistence
- fail-soft: broker-page failure never blocks official TWSE/TPEx chip layers
- a missing branch never means zero activity or no trading

This supports the research use case "stock -> important ranked branches". It does not claim to be a complete branch ledger and does not bypass CAPTCHA/anti-bot controls.

### 7. Official warrant activity and maintenance-ratio boundary

Added `src/v6/tw-warrant-activity-on-demand.ts` using verified free official TWSE/TPEx warrant datasets for warrant basic mapping and daily activity.

The warrant layer is intentionally non-directional:

- it may report warrant turnover / volume activity and underlying association
- it must not label turnover as aggressive buying or net buying
- it does not infer dealer hedge direction unless a separate verified directional source exists
- it is fail-soft and does not block the primary official chip layers
- current warrant responses are not persisted

True broker customer account maintenance ratio remains fail-closed because public market aggregates cannot reconstruct an individual's account collateral/debt state. The existing `ESTIMATED_POSITION_MAINTENANCE_PROXY` may be used only when reference price and estimated financing cost are explicitly available, and it must stay labeled as a proxy rather than official account maintenance ratio.

## What did NOT change

- OHLC daily canonical capture
- OHLC indicators and historical replay data
- formal deterministic Published-generation replay semantics
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
  - short request reuse
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
- `tests/tw-warrant-activity-on-demand.test.ts`
  - official warrant basic/daily activity parsing
  - underlying mapping
  - activity is explicitly non-directional
  - date/source verification and fail-soft behavior
- `tests/market-data-cloudflare-cron.test.ts`
  - old scheduler code may remain for compatibility
  - Production Wrangler config must have no automatic market-data cron trigger
- `tests/tw-market-data.test.ts`
  - official parsers remain protected
  - current read contract is on-demand
  - GitHub archive is historical-only
  - Wrangler cron is retired
  - automation bridge is defensive no-op
- `tests/market-data-family-read-contract.test.ts`
  - public Family tool name, read-only permission and 180-day history contract stay frozen
  - current Family evidence routes through the isolated on-demand facade
  - deterministic Published gateway remains historical/replay context behind the facade
- `tests/public-ingress-freeze.test.ts`
  - all existing OAuth/path/public ingress ABI assertions remain intact
  - verified official warrant routes are accepted without weakening the non-directional activity boundary
  - maintenance-ratio public source remains fail-closed
- `tests/no-r2-policy.test.ts`
  - no D1/R2 market-data persistence remains a permanent boundary
  - OHLC canonical GitHub location remains frozen
  - current chip evidence is explicitly non-persistent
  - OAuth KV is explicitly ephemeral session state, not market-data storage
  - retired chip cron must remain absent and the defensive scheduler no-op must remain present
- `tests/automation-research-rest.test.ts`
  - Automation namespace stays bounded/read-only
  - ordinary requests still delegate to the canonical app
  - only root `/health` may overlay current on-demand metadata after delegation
  - the retired non-OHLC scheduler may not delegate back to the legacy scheduled writer
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

### Problem F — Family test was coupled to the old internal implementation function

Root cause: after separating formal replay from current web evidence, `get_family_market_chip_summary` correctly moved from direct `getTwMarketChipSummaryPublished(...)` calls to `getTwMarketChipSummaryOnDemand(...)`. The old test asserted the exact internal function name, so CI failed even though the public Family contract, permission boundary and 180-day history semantics were unchanged.

Fix: update the test to protect the real invariant instead of the retired implementation detail: Family stays read-only, public tool/ingress stays unchanged, current evidence uses the isolated on-demand facade, and the facade retains the deterministic Published gateway only as historical/replay context.

### Problem G — public ingress test still treated warrant capability as unverified

Root cause: the source registry had already promoted official TWSE/TPEx warrant activity routes to `READY`, but `tests/public-ingress-freeze.test.ts` still required the older planned/fail-closed warrant state.

Fix: keep every original Owner/Family OAuth and path ABI assertion intact, then update only the warrant capability assertions. The new invariant is that official warrant turnover/volume activity is available on demand but remains explicitly non-directional and cannot be promoted into net-buy, aggressor-side or dealer-hedging claims.

### Problem H — no-R2 test encoded an obsolete "all application persistence is GitHub" sentence

Root cause: `tests/no-r2-policy.test.ts` required a literal comment saying all application persistence is GitHub-only and also required the retired `*/5` Cloudflare cron. That no longer describes the intended design: OHLC remains canonical GitHub data, while current non-OHLC chip evidence is deliberately not persisted anywhere.

Fix: preserve the permanent no-D1/no-R2 market-data boundary, canonical GitHub repository/branch checks and Durable Object namespace protection, while changing the persistence assertions to the actual contract: OHLC canonical unchanged, current chip persistence `NONE`, OAuth KV is ephemeral session state, and the retired chip cron must remain absent behind a `RETIRED_NOOP` scheduler fence.

### Problem I — Automation bridge test was coupled to direct delegation syntax

Root cause: `tests/automation-research-rest.test.ts` required the exact source strings `return app.fetch(request, env, ctx)` and `return app.scheduled(controller, env, ctx)`. The current wrapper must capture the canonical response before returning it so that only `/` and `/health` can overlay accurate on-demand migration metadata, and scheduled non-OHLC capture is intentionally retired.

Fix: keep all Automation read-only, revision-pinning, Blind-cutoff and secret-leakage tests unchanged. Replace only the internal-syntax assertions with behavioral architecture invariants: Automation routes remain bounded, ordinary traffic delegates to `app.fetch`, health overlay is restricted to root health paths, and `scheduled()` is a defensive `RETIRED_NOOP` rather than a route back to the legacy writer.

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
8. Warrant activity adapter tests pass and remain non-directional.
9. Market-data cron retirement test passes.
10. Health metadata reports on-demand current reads and disabled scheduled chip capture.
11. Broker/warrant/maintenance capabilities are not overstated beyond verified source contracts.
12. Formal Published replay tests remain deterministic and do not call current web sources.
13. No-D1/no-R2 market-data persistence boundary passes with current chip persistence set to `NONE`.
14. Automation research bridge tests pass with the health-only overlay and retired scheduler semantics.
