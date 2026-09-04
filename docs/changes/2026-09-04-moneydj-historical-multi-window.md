# 2026-09-04 MoneyDJ exact historical multi-window broker ranges

## Problem

The frozen `get_broker_chips` bridge could query an exact historical 1D page, but its 5D/10D/20D/60D sidecar used MoneyDJ's fixed latest-window pages. For a request such as `2026-09-03`, those fixed pages were anchored to the latest published source date and correctly stayed `PENDING`. This was safe but incomplete.

## Evidence-first live proof

Before changing runtime code, an isolated draft-PR diagnostic used TWSE's official historical holiday schedule to resolve exact trading-day boundaries and then queried MoneyDJ custom server ranges ending `2026-09-03`.

Verified live ranges for 2330:

- 1D: 2026-09-03 .. 2026-09-03; displayed ranked totals buy 2,484 / sell 3,058; first buy branch `凱基-台北 +700`; first sell branch `花旗環球 -906`.
- 5D: 2026-08-28 .. 2026-09-03; displayed ranked totals buy 11,023 / sell 19,196.
- 10D: 2026-08-21 .. 2026-09-03; displayed ranked totals buy 25,179 / sell 22,624.
- 20D: 2026-08-07 .. 2026-09-03; displayed ranked totals buy 50,975 / sell 45,331.
- 60D: 2026-06-11 .. 2026-09-03; displayed ranked totals buy 139,788 / sell 243,883.

All five MoneyDJ responses reported `最後更新日：2026/09/03`, and the rankings/totals were materially distinct. This proves MoneyDJ performs the custom interval ranking server-side; the implementation does not need to sum daily Top-N outputs.

The one-shot live diagnostic was removed after proof. Permanent CI uses deterministic fixtures only.

## Runtime change

`tw-broker-ranked-on-demand/v1.4.0` now resolves multi-day ranges using TWSE's official historical market holiday schedule:

`https://www.twse.com.tw/rwd/zh/holidaySchedule/holidaySchedule?response=json&queryYear=<ROC year>`

For each requested N-day window:

1. Confirm `requested_as_of` is an actual TWSE trading day.
2. Count backward exactly N TWSE trading sessions, skipping weekends and official closed dates. Explicit TWSE `開始交易日` / `最後交易日` rows remain trading sessions.
3. Query MoneyDJ's public custom range with `e=<start>&f=<requested_as_of>`.
4. Require MoneyDJ `最後更新日` to equal `requested_as_of`; otherwise stay fail-closed.
5. Parse only MoneyDJ ranked public-page output.

The yearly TWSE calendar is cached in-memory for six hours per Worker isolate only. No current raw or normalized broker data is persisted.

## Compatibility and safety

- Existing public tool name and input schema remain unchanged: `get_broker_chips(symbol,date,top_n)`.
- `/my-mcp`, `/mcp`, and `/family-mcp` are unchanged.
- No OHLC code, Queue, Cron, Durable Object, CAS, Universe, staged finalizer, or canonical OHLC storage is changed.
- MoneyDJ remains `PUBLIC_SECONDARY / RANKED_ONLY`.
- Missing ranked branch remains `UNKNOWN/null`, never zero.
- Broker names remain execution-channel evidence, never investor identity.
- `daily_rank_summing=false` remains mandatory.
- `previous_day_substitution=false` remains mandatory.
- MoneyDJ Big5 decoding and transient 502/503/504/520 retry behavior remain intact.
- No CAPTCHA or anti-bot bypass is used.

## Regression anchors

Permanent tests freeze the historical 2026-09-03 boundaries:

- 5D start = 2026-08-28
- 10D start = 2026-08-21
- 20D start = 2026-08-07
- 60D start = 2026-06-11

They also require exact custom MoneyDJ URLs ending `2026-09-03`, one cached TWSE yearly calendar read, server-side interval aggregation, no daily-ranked summation, no previous-day substitution, and missing-branch UNKNOWN semantics.
