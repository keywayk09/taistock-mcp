# Diamond Market Data V1

Status: implementation branch / shadow only. Do not merge or deploy until CI and manual Cloudflare→GitHub shadow validation pass.

## Goal

Create a staged official-data layer for the Diamond Engine so swing research no longer assembles TWSE/TPEx/MOPS facts ad hoc at decision time.

This layer is independent from OHLC production:

- Diamond may read verified OHLC later.
- Diamond must never write `data/OHLC/` or gate OHLC production.
- Failure of TWSE, TPEx, MOPS-style feeds or Diamond ranking must not block OHLC.

## Universe

`MARKET_UNIVERSE` is ordinary common stocks from TWSE + TPEx, including KY companies when represented as an ordinary 4-digit stock code.

V1 excludes ETF/ETN/warrants/bonds/preferred products and does not add emerging-market securities.

The official company master is collected first. V1 uses a conservative 4-digit non-zero-leading symbol filter as the executable common-stock boundary.

Planned research universes:

1. `MARKET_UNIVERSE`: all TWSE + TPEx common stocks.
2. `SWING_SCREEN_UNIVERSE`: tradable/data-valid subset.
3. `SWING_RESEARCH_UNIVERSE`: enough verified 1D history + market facts for formal ranking.

A future `SWING_1D_BACKFILL_REQUEST` may request ~350–360 days of 1D only for high-potential symbols missing daily history. Swing discovery must not expand 1m/5m automatically.

## Sources

### Institutional

- TWSE: official T86 daily security-level institutional trading report.
- TPEx: official `tpex_3insti_daily_trading` OpenAPI feed.

Collected for the full market. Normalized fields are foreign net shares, investment-trust net shares and dealer net shares. Rolling 1/3/5/10/20-day features are derived later.

### Margin / short

- TWSE: official MI_MARGN daily report.
- TPEx: official `tpex_mainboard_margin_balance` OpenAPI feed.

Normalized fields include previous balance, buy/sell/repay and current balance for margin and short positions. If the official trade date is not available yet, status is `PENDING`; prior-day data must never masquerade as current-day data.

### Revenue / financial statements

Official TWSE/TPEx OpenAPI company disclosures are stored as versioned AS-OF datasets. Revenue and quarterly statements are slow-moving facts. Identical payloads are deduplicated by SHA/content-addressed GitHub path.

### Official events

Daily material-information feeds from TWSE/TPEx are collected incrementally. Rows containing terms such as 法人說明會 / 法說會 / 業績發表會 are classified as `INVESTOR_CONFERENCE`; other rows remain `MATERIAL_INFORMATION`.

## Runtime storage

Cloudflare is the execution layer. **GitHub is the canonical Market Data V1 archive.**

Market Data V1 does not use R2, Google Drive or D1 as required canonical storage. Existing Diamond `RESEARCH_DB` / `RESEARCH_BUCKET` bindings remain untouched for unrelated research features.

Canonical paths in `keywayk09/tv-papertrader`:

```text
data/market/tw/reference/symbol-master.json
data/market/tw/daily/YYYY/MM/DD/manifest.json
data/market/tw/daily/YYYY/MM/DD/institutional.json
data/market/tw/daily/YYYY/MM/DD/margin.json
data/market/tw/daily/YYYY/MM/DD/events.json
data/market/tw/fundamentals/<dataset>/<market>/<sha256>.json
```

GitHub writes use read-before-write CAS retry on 409/422.

## GitHub credential contract

Diamond Market Data V1 uses the same **secret name** as the OHLC Worker:

`GITHUB_TOKEN`

Cloudflare secrets are Worker-scoped. Therefore `tv-fugle-1d` already having `GITHUB_TOKEN` does **not** automatically provide it to `taistock-mcp`; the Diamond Worker must bind its own `GITHUB_TOKEN` value.

Optional vars:

- `MARKET_DATA_GITHUB_REPO` (default `keywayk09/tv-papertrader`)
- `MARKET_DATA_GITHUB_BRANCH` (default `main`)

The runtime compatibility adapter maps the existing V1 collector's internal legacy credential field to `GITHUB_TOKEN`. No second Cloudflare secret named `MARKET_DATA_GITHUB_TOKEN` is required.

Without `GITHUB_TOKEN`, the Market Data run returns `PENDING_SECRET` and cannot produce a canonical GitHub day.

## Staged schedule

Cloudflare cron is UTC. Times below are Asia/Taipei:

| Taipei | UTC cron | Phase | Purpose |
|---|---|---|---|
| 17:10 | `10 9 * * 1-5` | `fundamentals` | symbol master, revenue, financial AS-OF cache, official events |
| 18:10 | `10 10 * * 1-5` | `institutional_prelim` | first institutional capture |
| 20:10 | `10 12 * * 1-5` | `institutional_final` | refresh/final institutional capture |
| 21:10 | `10 13 * * 1-5` | `margin` | first margin/short attempt |
| 21:30 | `30 13 * * 1-5` | `margin` | retry if official data is late |
| 22:10 | `10 14 * * 1-5` | `finalize` | repair institutional + margin and build manifest |
| 22:30 | `30 14 * * 1-5` | `finalize` | final retry / final daily receipt |

Existing research close/repair crons remain unchanged.

## Data gate

The daily manifest schema is `DIAMOND_MARKET_DATA_V1`.

- `MARKET_DAY_VERIFIED`: symbol master + final institutional + final margin are all READY/FINAL for both TWSE and TPEx.
- `READY_WITH_PENDING`: at least one required time-sensitive dataset is still pending.
- Fundamentals and events are AS-OF / non-blocking in V1.

## API / manual operations

Authorized endpoints:

- `GET /market-data/status?date=YYYY-MM-DD`
- `POST /market-data/run?phase=fundamentals`
- `POST /market-data/run?phase=institutional_prelim`
- `POST /market-data/run?phase=institutional_final`
- `POST /market-data/run?phase=margin`
- `POST /market-data/run?phase=finalize`

These use the same authorization gate as the existing research endpoints.

## Merge gate

Before PR merge:

1. latest PR head must pass full CI;
2. `taistock-mcp` must have Worker-scoped `GITHUB_TOKEN`;
3. one manual Cloudflare shadow run must write the expected `data/market/tw/` files;
4. verify trade date, source date, row counts, source SHA/status and `MARKET_DAY_VERIFIED` semantics;
5. verify Diamond writes nothing under `data/OHLC/`.

Only after these checks should PR #32 be merged.

## Next layer after V1 capture is proven

After source validation and daily reliability are proven, build a separate feature/snapshot layer joining verified 1D OHLC with market facts to compute MA5/10/20/60/120/240, ATR/structure, RS, institutional continuity, margin/short changes, revenue acceleration, quarterly metrics, event flags and cross-sectional ranking.

Then reduce full market → top 100–200 → deep research 20–30 → formal 3–5 `SWING_DECISION_RECEIPT` cases.
