# V7.1：官方籌碼與 ETF 每日持股整合

本版本把 `catcat222222/twchips` 0.1.0（參考 commit `f91bb03a3307665faccc1369bad628237c3a268c`）涵蓋的 TWSE／TAIFEX 功能移植到 Cloudflare Worker TypeScript MCP，並把 ETF 模組改為「投信官方網站每日投資組合優先」。

Cloudflare Worker 不能直接執行 Python／pandas，因此不是 `pip install twchips`，而是使用相同官方資料端點與欄位清理概念，保留既有 V6 工具不變。

## ETF 資料來源順位

1. 各投信公司官方網站每日公布的完整投資組合
2. Cloudflare D1 保存的官方持股快照
3. 投信投顧公會公開的主動式 ETF 清單
4. FinMind 僅作選用備援，不再是核心持股功能的必要條件

主動式 ETF 核心功能不需要 FinMind sponsor。FinMind 的 sponsor 持股資料只有在工具參數明確設定 `allow_finmind_fallback=true` 時才會使用。

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

### ETF 官方來源與快照

- `get_active_etf_list`：SITCA 公開主動式 ETF 清單，FinMind 公開清單備援
- `set_active_etf_official_source`：設定單一 ETF 的投信官方持股網址
- `list_active_etf_official_sources`：列出已設定的官方來源
- `refresh_active_etf_official_holdings`：下載官方持股並存入 D1
- `get_active_etf_holdings`：查官方持股快照
- `get_active_etf_holding_changes`：比較相鄰官方快照的新增、剔除、加碼、減碼
- `get_stock_active_etf_activity`：反查某檔股票被哪些 ETF 調整
- `get_active_etf_daily_change_report`：全體已建檔 ETF 的每日異動摘要

## 官方網址設定

官方來源支援：

- CSV
- JSON
- HTML 表格
- GET 或 POST
- 網址及 POST body 日期模板

可使用的模板：

- `{etf_id}`
- `{date}`，例如 `2026-08-01`
- `{compact_date}`，例如 `20260801`
- `{slash_date}`，例如 `2026/08/01`

設定範例：

```json
{
  "etf_id": "00981A",
  "issuer": "統一投信",
  "source_url": "https://投信官方網站/portfolio?code={etf_id}&date={compact_date}",
  "source_format": "json",
  "request_method": "GET",
  "enabled": true
}
```

設定後執行：

```json
{
  "etf_id": "00981A",
  "date": "2026-08-01"
}
```

呼叫 `refresh_active_etf_official_holdings`，即可把當日官方投資組合保存到 D1。若官方網站只有 Excel，需改找同站的 CSV、JSON 或 HTML 持股網址；V7.1 暫不直接解析 xlsx。

## 台股日報用法

`get_daily_chip_report` 負責現貨三大法人、融資融券、期貨與選擇權部位。

`get_active_etf_daily_change_report` 負責 ETF 當日：

- 新增持股
- 剔除持股
- 加碼
- 減碼
- 某檔股票被多檔 ETF 同步調整

可設定 `refresh_registered_sources=true`，先更新全部已啟用的投信官方來源，再產生日報。

## 新增／剔除規則

- 新增：前一完整快照沒有該標的，最新完整快照出現。
- 剔除：前一完整快照持有，最新完整快照不再出現。
- 加碼／減碼：前後均持有，以股數與權重變化共同判斷。
- 單一 ETF 不足兩個完整快照，不產生新增／剔除結論。
- 申購或贖回可能使全部持股股數等比例變動，因此加減碼不能直接解讀成經理人主動看多或看空。

## 驗證

GitHub Actions `Verify V7` 會執行：

1. `npm run type-check`
2. `wrangler deploy --dry-run`
3. TWSE 三大法人、個股法人、融資融券 smoke test
4. TAIFEX 期貨日行情、法人總表、期貨與選擇權部位 smoke test
5. SITCA 主動式 ETF 公開清單 smoke test
6. FinMind 公開 ETF 清單備援 smoke test

正式合併前仍需挑至少一個投信官方 CSV／JSON／HTML 持股網址，完成 `set → refresh → holdings → changes` 的端到端測試。

## 資料使用原則

盤中策略或歷史回測在交易日 T，只能使用 T-1 或更早已公開的籌碼資料，避免 lookahead。V7.1 的資料定位是盤後日報、盤前背景、選股與回測分群，不取代富果即時報價或交易執行層。
