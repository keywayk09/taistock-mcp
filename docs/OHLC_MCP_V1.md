# OHLC MCP V1

## 目標

先建立穩定的 MCP 介面，再替換底層資料流程。MCP 不直接綁死舊的 `tv-fugle-1d`、`tv-alert-raw-tw`、`tv-github-export` 實作，而是透過統一 `OHLC_API_URL` 呼叫後端。這樣底層可逐步從 Apps Script / KV 遷移到 Cloudflare D1 + R2，而 ChatGPT 工具名稱與參數不需要跟著改。

## 架構

```text
ChatGPT / 鑽石引擎
        ↓
OHLC MCP facade（taistock-mcp）
        ↓
OHLC_API_URL（統一 Cloudflare OHLC API）
        ↓
┌───────────────┬────────────────┬────────────────┐
│ Watchlist/Job │ Raw OHLC       │ Indicator      │
│ D1            │ R2             │ D1 state + R2  │
└───────────────┴────────────────┴────────────────┘
        ↓
驗證完成後日結封存到 GitHub
```

## 市場

- `tw_stock`: 台股上市/上櫃
- `txf`: 台指期
- `mtx`: 小台
- `tmf`: 微台

## 週期

- `1m`
- `5m`
- `1d`

## MCP 工具（V1）

1. `get_ohlc_mcp_status`
   - 檢查統一後端與舊 Worker health。
   - 只讀。

2. `get_ohlc_bars`
   - 讀取 OHLC；可選擇是否帶指標。
   - 只讀。

3. `get_ohlc_symbol_status`
   - 查最後完成時間、初始化狀態、缺K、重複K與指標狀態。
   - 只讀。

4. `get_ohlc_missing_ranges`
   - 找缺漏時間範圍。
   - V1 不自動補資料，避免 MCP 無意中修改正式資料。

5. `get_ohlc_watchlist`
   - 讀追蹤池與來源。

6. `preview_alert_symbols_for_ohlc`
   - 比較快訊來源與現有追蹤池，列出尚未加入的新標的。
   - 僅預覽，不自動新增。

7. `validate_incremental_indicators`
   - 用完整歷史重算對照「上一根成熟 state + 新K」增量計算。
   - 只做驗證，不修改正式公式。

## 統一後端 API Contract

### GET `/health`

回傳服務版本、資料庫/R2連線、支援市場/週期。

### GET `/v1/bars`

Query:
- `market`
- `symbol`
- `timeframe`
- `start_date`
- `end_date`
- `include_indicators`
- `limit`（選填）

### GET `/v1/symbol-status`

Query:
- `market`
- `symbol`

### GET `/v1/missing-ranges`

Query:
- `market`
- `symbol`
- `timeframe`
- `start_date`
- `end_date`

### GET `/v1/watchlist`

Query:
- `market`
- `source=all|alerts|manual|system`
- `active_only`

### GET `/v1/watchlist/alerts/preview`

只做快訊新標的差集比較。

### POST `/v1/indicators/validate`

驗證增量與完整重算一致性。

## 環境變數

MCP facade：

- `OHLC_API_URL`：統一 OHLC Worker URL
- `OHLC_API_TOKEN`：內部 API Bearer token（建議 secret）

遷移期可選填，僅供 `get_ohlc_mcp_status` 觀察舊 Worker：

- `TV_FUGLE_1D_URL`
- `TV_FUGLE_5M_URL`
- `TV_FUGLE_1M_URL`
- `TV_ALERT_RAW_URL`
- `TV_GITHUB_EXPORT_URL`

## 快訊標的來源

舊流程已經由 `alerts_tw` / `tv-alert-raw-tw` 建立股票來源。新後端應：

1. 讀快訊 symbol。
2. 去重。
3. 與 D1 watchlist 比較。
4. 新標的建立 `pending_init`。
5. 第一次抓足夠歷史資料完成 indicator seed。
6. 之後只做增量更新。

MCP V1 先提供 `preview_alert_symbols_for_ohlc`，真正新增標的的 write tool 要等後端驗證完成、與使用者討論後才加入。

## 指標延續原則

第一次初始化：用足夠歷史 K 棒計算成熟 state。

正常更新：

```text
confirmed previous state + new confirmed bar -> next state
```

需要保存的不只是畫面上的指標值，而是遞推需要的中間 state，例如：

- EMA5/10/20/60/120/240
- RSI avg gain / avg loss / previous close
- MACD EMA12 / EMA26 / signal
- ATR14 / previous close
- KD smoothing state

只有缺K、公式改版、狀態異常或初始化時才完整重建。

## 台指期

MCP 已預留 `txf/mtx/tmf`。後端實作時必須另外處理：

- 日盤/夜盤 session
- 台灣交易日歸屬
- 近月合約
- 結算換月
- 實際合約與連續合約分開

## 最高治理原則

OHLC MCP 可以：
- 讀資料
- 找缺漏
- 驗證指標
- 建立研究結果與備案

不得因測試結果自行修改正式台股引擎、指標公式、Stable 版本或正式策略。所有正式修改必須先與使用者討論並取得明確批准。
