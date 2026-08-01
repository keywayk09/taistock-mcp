# V7：官方籌碼與 ETF 持股異動整合

本版本把 `catcat222222/twchips` 0.1.0（參考 commit `f91bb03a3307665faccc1369bad628237c3a268c`）涵蓋的 TWSE／TAIFEX 功能移植到 Cloudflare Worker TypeScript MCP，並加入 FinMind 主動式 ETF 每日持股與持股異動資料。

Cloudflare Worker 不能直接執行 Python／pandas，因此不是 `pip install twchips`，而是使用相同的官方資料端點與欄位清理概念。既有 V6 工具全部保留，V7 新增 15 個工具，總數 55 個。

## TWSE／TAIFEX 新增工具

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

## 主動式 ETF 新增工具

- `get_active_etf_list`：上市櫃主動式 ETF 清單
- `get_active_etf_holdings`：單一 ETF 每日持股、權重及資產類別
- `get_active_etf_holding_changes`：相鄰快照的新增、剔除、加碼、減碼
- `get_stock_active_etf_activity`：反查哪些主動式 ETF 新增、剔除或調整某檔股票
- `get_active_etf_daily_change_report`：全部主動式 ETF 盤後持股異動摘要

ETF 持股明細與持股異動資料需要 FinMind sponsor 會員權限。申購或贖回會造成整體持股股數等比例變化，因此股數增加或減少不必然等於經理人主動買賣；新增及剔除則以相鄰持股快照由零變有、由有變零判定。

## 台股日報建議用法

呼叫 `get_daily_chip_report`，可一次取得：

1. 現貨外資、投信、自營商買賣金額
2. 大盤融資融券變化
3. 台指期日行情（一般盤與盤後盤）
4. 期交所法人期貨、選擇權交易與未平倉
5. 外資臺股期貨部位摘要
6. 自選股個股法人與融資融券資料

再搭配 `get_active_etf_daily_change_report`，補入：

1. 主動式 ETF 當日新增持股
2. 主動式 ETF 當日剔除持股
3. 最大加碼與最大減碼標的
4. 單一股票被哪些主動式 ETF 同步新增或剔除

`get_daily_chip_report` 範例：

```json
{
  "date": "2026-08-01",
  "fallback_days": 7,
  "watchlist": ["2330", "4566", "3293"],
  "include_raw": false
}
```

`get_active_etf_holding_changes` 範例：

```json
{
  "etf_id": "00981A",
  "date": "2026-08-01",
  "asset_type": "stock",
  "include_increased_decreased": true
}
```

`fallback_days` 會在週末、休市日或資料尚未發布時，自動向前尋找最近交易日。

## 被動式 ETF 的限制

目前新增剔除工具先涵蓋主動式 ETF。被動式 ETF 的正式定期換股名單通常來自指數公司公告、投信每日持股檔或付費指數成分資料，各發行商格式不同，沒有單一免費標準 API。後續可用發行商 adapter 加 D1 每日快照比較，或串接授權資料源，擴充至 0050、0056、00878 等被動式 ETF。

## 資料使用原則

盤中策略或歷史回測在交易日 T，只能使用 T-1 或更早已公開的籌碼資料，避免 lookahead。V7 的資料定位是盤後日報、盤前背景、選股與回測分群，不取代富果即時報價、FinMind 歷史資料或交易執行層。
