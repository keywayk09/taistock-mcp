# 2026-09-04 MoneyDJ multi-window broker evidence

## Goal

Improve broker-branch evidence for swing and longer-horizon Taiwan-stock research without changing the historical 79-tool ABI, public MCP ingress, Family permissions, or the OHLC canonical pipeline.

## Evidence-first source verification

Read-only diagnostics against MoneyDJ's public broker-ranking page verified the period selector and the server behavior before implementation.

MoneyDJ's fixed period selector is:

- selector 1 = 近一日
- selector 2 = 近五日
- selector 3 = 近十日
- selector 4 = 近20日
- selector 5 = 近40日
- selector 6 = 近60日
- selector 7 = 近120日
- selector 8 = 近240日

The fixed server pages use the selector suffix, so `_2` is 5D, `_3` is 10D, `_4` is 20D and `_6` is 60D. `_5` is **40D, not 5D**. A direct experiment also proved that `?e=2` is not a fixed-window selector and still returns the one-day view.

MoneyDJ's custom interval JavaScript uses `e=<startDate>&f=<endDate>`. Custom-range support is intentionally not exposed in the frozen public tool schema in this change.

A live read-only 2330 check for source date 2026-09-04 verified that 1D, 5D, 10D, 20D and 60D are distinct MoneyDJ server-side interval rankings with materially different leaders and displayed ranked-row totals. The implementation therefore does **not** sum daily Top-N rows, avoiding ranking-truncation bias.

A second read-only probe verified MoneyDJ exact-day custom ranges. `e=2026-09-03&f=2026-09-03` returned the 2026-09-03 broker ranking, while `e=2026-09-04&f=2026-09-04` matched the ordinary 2026-09-04 one-day page in both leading rows and displayed totals. Therefore the public `date` argument now genuinely supports historical 1D broker queries without previous-day substitution or a latest-page fallback.

## Runtime design

`tw-broker-ranked-on-demand/v1.3.0` uses MoneyDJ custom exact-date range for 1D (`e=as_of&f=as_of`) and fixed server windows for 5/10/20/40/60/120/240 views. The default explicit broker bundle uses 1/5/10/20/60.

The bundle:

- fetches 1D through MoneyDJ custom exact-date range and each multi-day fixed interval independently
- verifies both requested source date and the selected source window
- caps origin concurrency at 3
- reuses the existing 10-minute per-URL in-isolate cache
- preserves Big5-aware decoding and one retry for transient 502/503/504/520
- keeps MoneyDJ `PUBLIC_SECONDARY / RANKED_ONLY`
- never interprets a branch absent from a ranked window as zero; absence is `UNKNOWN/null`
- builds a cross-window branch matrix with observed windows, net lots, average net lots per trading day and categorical persistence/reversal patterns
- treats broker names only as execution-channel evidence, never investor identity
- persists no current raw or normalized broker data

The adapter can support 120D for future bounded L-horizon deep analysis, but 120D is not included in the default legacy-tool bundle to avoid unnecessary origin load. It must not be enabled across whole-universe scans.

For a historical `date`, the 1D exact-date query is authoritative for that requested day. Fixed multi-day MoneyDJ pages remain anchored to their own published source date; if that source date does not equal the requested date they must stay `PENDING/UNKNOWN`. The system must never fabricate historical 5D/10D/20D/60D rankings by summing daily ranked pages.

## Frozen 79-tool compatibility

The public `get_broker_chips` input schema remains exactly:

- `symbol`
- `date`
- `top_n`

No `window`, `window_days`, `period` or other public input was added. Existing ChatGPT clients therefore do not need to reconnect or refresh their cached tool schema.

The existing one-day fields remain top-level for ABI continuity. A new `multi_window` response sidecar adds compact 5D/10D/20D/60D interval results, the cross-window branch matrix, and S/M/L interpretation lenses.

## Safety boundaries

- MoneyDJ remains secondary ranked evidence, not official exchange truth.
- Missing branch/window is unknown, never zero.
- No daily-ranked summation is allowed.
- Exact-date mismatch remains fail-closed; no previous-day substitution.
- No CAPTCHA or anti-bot bypass.
- No whole-universe broker fan-out.
- `/my-mcp`, `/mcp`, `/family-mcp` are unchanged.
- Family stays read-only.
- OHLC canonical pipeline is unchanged.
