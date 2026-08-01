# V7：官方籌碼與主動式 ETF 持股整合

本版本把 `catcat222222/twchips` 0.1.0（參考 commit `f91bb03a3307665faccc1369bad628237c3a268c`）涵蓋的 TWSE／TAIFEX 功能移植到 Cloudflare Worker TypeScript MCP，並加入 FinMind 主動式 ETF 持股異動工具。

Cloudflare Worker 不能直接執行 Python／pandas，因此不是 `pip install twchips`，而是使用相同官方資料端點與欄位清理概念，保留既有 V6 工具不變。

## 新增工具

### TWSE／TAIFEX

- `get_official_market_institutional`：證交所整體三大法人
- `get_official_stock_institutional`：證交所個股三大法人
- `get_official_market_margin`：證交所整體融資融券
- `get_official_stock_margin`：證交所個股融資融券
- `get_taifex_futures_daily`：期貨日行情
- `get_taifex_options_daily`：選擇權日行情鏈
- `get_taifex_institutional_general`：期交所三大法人總表
- `get_taifex_futures_positions`：法人期貨商品部位
- `get_taifex_options_positions`：法人選擇權 CALL／PUT 部位
- `get_daily_chip_report`：台股盤後籌碼日報資料包

### 主動式 ETF

- `get_active_etf_list`：主動式 ETF 清單
- `get_active_etf_holdings`：單一 ETF 完整持股快照
- `get_active_etf_holding_changes`：單一 ETF 新增、剔除、加碼、減碼
- `get_stock_active_etf_activity`：反查某檔股票被哪些 ETF 調整
- `get_active_etf_daily_change_report`：全體主動式 ETF 日報摘要

## 台股日報建議用法

呼叫 `get_daily_chip_report`，可一次取得：

1. 現貨外資、投信、自營商買賣金額
2. 大盤融資融券變化
3. 台指期日行情（一般盤與盤後盤）
4. 期交所法人期貨、選擇權交易與未平倉
5. 外資臺股期貨部位摘要
6. 自選股個股法人與融資融券資料

範例：

```json
{
  "date": "2026-08-01",
  "fallback_days": 7,
  "watchlist": ["2330", "4566", "3293"],
  "include_raw": false
}
```

主動式 ETF 日報使用 `get_active_etf_daily_change_report`；全市場查詢依 FinMind 官方規格逐日取得單一日期快照，再比較最近兩個有效持股日。只比較前後兩日均有完整 ETF 快照的基金，避免某檔 ETF 當日未發布資料時被誤判為全部剔除。

## 新增／剔除規則

- 新增：前一快照沒有該標的，最新快照出現。
- 剔除：前一快照持有，最新快照不再出現。
- 加碼／減碼：前後均持有，以股數與權重變化判斷。
- 單一 ETF 若不足兩個快照，不產生新增／剔除結論。
- 申購或贖回可能使全部持股股數等比例變動，因此加減碼不能直接解讀成經理人主動看多或看空。

## 權限與限制

`TaiwanStockActiveETFHolding` 與 `TaiwanStockActiveETFHoldingChange` 需要 FinMind sponsor 權限。被動式 ETF 的正式指數換股公告、投信持股檔與指數授權資料尚未整合，不宣稱已涵蓋全部被動式 ETF 新增／剔除。

## 驗證

GitHub Actions `Verify V7` 會執行：

1. `npm run type-check`
2. `wrangler deploy --dry-run`
3. TWSE 三大法人、個股法人、融資融券 smoke test
4. TAIFEX 期貨日行情、法人總表、期貨與選擇權部位 smoke test
5. FinMind 主動式 ETF 公開清單與欄位 smoke test

2026-07-31 測試資料已通過上述公開資料來源驗證，當次取得 FinMind 主動式 ETF 清單 37 筆。FinMind sponsor 持股與異動資料仍需使用實際 sponsor Token 在 Cloudflare Preview／正式環境驗證。

## 資料使用原則

盤中策略或歷史回測在交易日 T，只能使用 T-1 或更早已公開的籌碼資料，避免 lookahead。V7 的資料定位是盤後日報、盤前背景、選股與回測分群，不取代富果即時報價、FinMind 歷史資料或交易執行層。
