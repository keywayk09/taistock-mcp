# P18 — Diamond 台股官方 Market Data Layer

## Ownership

- OHLC / K線 / 技術結構：`OHLC MCP` 唯一正式來源。
- 三大法人、融資融券：`Diamond Market Data Plane`。
- 營收、財報、重大訊息、TDCC、估值：維持 Diamond Research/Market Data 既有資料層。
- Diamond 不得寫入 OHLC，也不得以 FinMind `TaiwanStockPrice` 取代正式 OHLC。

## Permanent storage policy

- Diamond persistence 採 **Cloudflare D1 only**。
- **R2 禁止使用**，不得加入 R2 binding、bucket、archive 或任何以 R2 為必要條件的正式資料流程。
- 未來新增功能若需要持久化，優先評估既有 D1 或 GitHub；不得因功能擴充重新引入 R2。

## Official-first sources

| Layer | Listed | OTC |
|---|---|---|
| Institutional | TWSE T86 | TPEx `tpex_3insti_daily_trading` |
| Margin / Short | TWSE MI_MARGN | TPEx `tpex_mainboard_margin_balance` |

FinMind 只保留為法人與融資融券的歷史補充 / fallback，不是第一官方真相源。

## Capture and archive

Cloudflare 於台北時間平日 18:30 執行第一次官方抓取，20:30 再執行一次 retry/finalize。每個 `kind × market` 獨立成功或降級，不做全域 fail-fast。

成功且能驗證來源交易日的資料才會封存至 D1：

- `tw_market_data_snapshot_d1`：immutable snapshot metadata、日期、來源、hash、readiness。
- `tw_market_data_row_d1`：該 snapshot 的個股 normalized payload JSON。
- 相同內容 hash 為 idempotent；後續官方修訂以新 hash 成為新 snapshot，不覆蓋歷史資料。

## Formal Swing join

正式 Swing 應使用：

`OHLC MCP 1D + Diamond get_tw_market_data_bundle + fundamentals/events`

readiness 採分層語意：

- OHLC 缺失：只影響技術層 / 該標的。
- institutional 缺失：`institutional=DEGRADED/UNAVAILABLE`。
- margin 缺失：`margin=DEGRADED/UNAVAILABLE`。
- Market Data 缺失不得把 OHLC pipeline 標成 blocked，也不得把其他已就緒標的全域封鎖。

## Legacy compatibility

`get_institutional`、`get_margin`、`analyze_swing_candidate` 屬舊版相容工具，不得作 P18 正式 Swing source。尤其舊 `analyze_swing_candidate` 內含 FinMind price 技術評分，P18 正式研究禁止使用該技術輸出取代 OHLC MCP。

舊 Fugle research candle/R2 runtime route 不再由 Production cron 執行；正式 OHLC 一律走 OHLC MCP。
