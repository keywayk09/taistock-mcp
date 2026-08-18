# Diamond Market Data V1

Status: implementation branch / shadow only. Do not merge or deploy until CI and manual source validation pass.

## Goal

Create a staged, official-data market layer for the Diamond Engine so swing research no longer has to assemble TWSE/TPEx/MOPS facts ad hoc at decision time.

This layer is independent from OHLC production:

- Diamond may read verified OHLC later.
- Diamond must never write `data/OHLC/` or gate OHLC production.
- Failure of TWSE, TPEx, MOPS-style feeds, R2 mirror, or Diamond ranking must not block OHLC.

## Universe

`MARKET_UNIVERSE` is all ordinary common stocks from TWSE + TPEx, including KY companies when represented as an ordinary 4-digit stock code.

V1 excludes ETF/ETN/warrants/bonds/preferred products and does not add emerging-market securities.

The official company master is collected first. V1 uses a conservative 4-digit non-zero-leading symbol filter as the executable common-stock boundary while preserving raw official rows for audit.

Planned research universes:

1. `MARKET_UNIVERSE`: all TWSE + TPEx common stocks.
2. `SWING_SCREEN_UNIVERSE`: tradable/data-valid subset.
3. `SWING_RESEARCH_UNIVERSE`: enough verified 1D history + market facts for formal ranking.

A future `SWING_1D_BACKFILL_REQUEST` may request ~350–360 days of 1D only for high-potential symbols missing daily history. Swing discovery must not expand 1m/5m automatically.

## Sources

### Institutional

- TWSE: official T86 daily security-level institutional trading report.
- TPEx: official `tpex_3insti_daily_trading` OpenAPI feed.

Collected for the full market, not only selected candidates.

Normalized fields:

- foreign net shares
- investment-trust net shares
- dealer net shares

Rolling 1/3/5/10/20-day features are derived later from the daily fact table, not fabricated by the source collector.

### Margin / short

- TWSE: official MI_MARGN daily report.
- TPEx: official `tpex_mainboard_margin_balance` OpenAPI feed.

Normalized fields include previous balance, buy/sell/repay and current balance for margin and short positions.

If the official trade date is not available yet, status is `PENDING`; prior-day data must never masquerade as current-day data.

### Revenue / financial statements

Official TWSE/TPEx OpenAPI company disclosures are stored as versioned AS-OF datasets.

Revenue and quarterly statements are slow-moving facts. The daily snapshot references the newest information that was publicly available by the snapshot cutoff; it does not require a fictitious same-day filing.

Identical payload SHA values are deduplicated in R2/D1.

### Official events

Daily material-information feeds from TWSE/TPEx are collected incrementally. Rows containing terms such as 法人說明會 / 法說會 / 業績發表會 are classified as `INVESTOR_CONFERENCE`; other rows remain `MATERIAL_INFORMATION`.

A dedicated investor-conference parser can be added later without changing the V1 storage contract.

## Runtime storage

Cloudflare is the execution path. GitHub is the canonical market-data archive.

### D1 (`RESEARCH_DB`)

Queryable normalized facts and status/index tables:

- `market_data_runs`
- `market_data_status`
- `market_symbols`
- `institutional_daily`
- `margin_daily`
- `market_events`
- `fundamental_versions`

### GitHub canonical storage

Raw/normalized daily market facts are written directly to GitHub under `data/market/tw/`. No R2 dependency is used in V1.

## GitHub canonical daily storage

Finalize writes the frozen daily snapshot directly into `keywayk09/tv-papertrader`:

```text
data/market/tw/daily/YYYY/MM/DD/manifest.json
data/market/tw/daily/YYYY/MM/DD/institutional.json
data/market/tw/daily/YYYY/MM/DD/margin.json
data/market/tw/daily/YYYY/MM/DD/events.json
```

GitHub is the canonical daily archive and uses read-before-write CAS retry. It requires the Cloudflare secret:

`MARKET_DATA_GITHUB_TOKEN`

Optional vars:

- `MARKET_DATA_GITHUB_REPO` (default `keywayk09/tv-papertrader`)
- `MARKET_DATA_GITHUB_BRANCH` (default `main`)

Without the secret, archival status is `PENDING_SECRET`; D1 index/status remains available but the day is not canonical-complete.

## Staged schedule

Cloudflare cron is UTC. Times below are Asia/Taipei:

| Taipei | UTC cron | Phase | Purpose |
|---|---|---|---|
| 17:10 | `10 9 * * 1-5` | `fundamentals` | symbol master, revenue, financial AS-OF cache, official events |
| 18:10 | `10 10 * * 1-5` | `institutional_prelim` | first institutional capture |
| 20:10 | `10 12 * * 1-5` | `institutional_final` | refresh/final institutional capture |
| 21:10 | `10 13 * * 1-5` | `margin` | first margin/short attempt |
| 21:30 | `30 13 * * 1-5` | `margin` | retry if official data is late |
| 22:10 | `10 14 * * 1-5` | `finalize` | repair institutional + margin, build manifest, mirror |
| 22:30 | `30 14 * * 1-5` | `finalize` | final retry / final daily receipt |

Existing research close/repair crons remain unchanged.

## Data gate

The daily manifest schema is `DIAMOND_MARKET_DATA_V1`.

States:

- `MARKET_DAY_VERIFIED`: symbol master + final institutional + final margin are all ready.
- `READY_WITH_PENDING`: enough data exists to continue non-final research, but at least one time-sensitive source is pending.
- Per-dataset source errors remain local to that dataset.

Fundamentals and events are AS-OF / non-blocking in V1. A missing margin publication does not erase valid price/institutional/fundamental facts.

## API / manual operations

Authorized endpoints:

- `GET /market-data/status?date=YYYY-MM-DD`
- `POST /market-data/run?phase=fundamentals`
- `POST /market-data/run?phase=institutional_prelim`
- `POST /market-data/run?phase=institutional_final`
- `POST /market-data/run?phase=margin`
- `POST /market-data/run?phase=finalize`

These use the same authorization gate as the existing research endpoints.

## Next layer after V1 capture is proven

Do not put ranking logic into the collector. After source validation and daily reliability are proven, build a separate feature/snapshot layer that joins verified 1D OHLC with the market facts and computes:

- MA5/10/20/60/120/240, slopes, ATR, volume/price structure
- RS versus TAIEX and sector
- foreign/trust 1/3/5/10/20-day continuity and percentiles
- margin/short changes and divergences
- revenue acceleration / quarterly metrics
- event flags
- cross-sectional ranking

Then reduce full market → top 100–200 → deep research 20–30 → formal 3–5 `SWING_DECISION_RECEIPT` cases.

This sequencing preserves the locked Swing V1 research philosophy while fixing its data availability layer.
