# 2026-09-04 Owner 79-tool chip semantic bridge

## Problem

The current Owner/Family chip facade had already migrated to exact-date TWSE/TPEx on-demand reads plus MoneyDJ ranked-only broker evidence, but four tool names still exposed through the historical 79-tool Owner surface were inherited from `src/index.ts` with pre-migration semantics:

- `get_broker_chips` -> FinMind broker report + `FINMIND_TOKEN`
- `get_institutional` -> FinMind current institutional rows
- `get_margin` -> FinMind current margin rows
- `get_short_pressure` -> mixed generic official endpoints + FinMind history/current-derived summary

The 39-name frozen compatibility interceptor also still routed `get_daily_chip_report`, `get_official_stock_institutional`, `get_official_stock_margin`, and the legacy 12-point analysis chip block through Published/GitHub-live implementations that could be mistaken for current evidence.

## Fix

- Keep all public names and legacy input schemas unchanged.
- Suppress only the four inherited Owner chip handlers during `BaseMCP` registration and re-register the same names after restoration.
- `get_broker_chips` now uses MoneyDJ public secondary ranked-only evidence with exact-date verification, no FinMind token, no persistence, and an explicit missing-branch-is-not-zero boundary.
- `get_institutional`, `get_margin`, and `get_short_pressure` now use TWSE/TPEx exact-date official on-demand current evidence. Existing Published/GitHub rows are retained only as labeled historical context.
- Frozen stock-level and daily-chip aliases now call `getTwMarketChipSummaryOnDemand`.
- Legacy market-wide institutional/margin aliases remain available only as explicitly labeled `HISTORY_CONTEXT_ONLY` cross-section reads because no current on-demand whole-market cross-section exists.
- Legacy 12-point compatibility now uses the same on-demand chip facade as the current Owner/Family read plane.

## Invariants

- `/my-mcp`, `/mcp`, `/family-mcp` unchanged.
- Frozen 79-tool names unchanged.
- Modern Owner inventory remains 123 tools; no duplicate registrations.
- Family permissions unchanged and read-only.
- OHLC canonical pipeline unchanged.
- Current non-OHLC chip persistence remains `NONE`.
- Published/GitHub current-day substitution is forbidden; it is history context only.
- No CAPTCHA or anti-bot bypass is introduced.
