# V7：twchips 官方籌碼資料整合

本版本把 `catcat222222/twchips` 0.1.0（參考 commit `f91bb03a3307665faccc1369bad628237c3a268c`）涵蓋的 TWSE／TAIFEX 功能移植到 Cloudflare Worker TypeScript MCP。

Cloudflare Worker 不能直接執行 Python／pandas，因此不是 `pip install twchips`，而是使用相同的官方資料端點與相同的欄位清理概念，保留既有 V6 工具不變，再新增 10 個工具。

## 新增工具

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

## 台股日報建議用法

呼叫 `get_daily_chip_report`，可一次取得：

1. 現貨外資、投信、自營商買賣金額
2. 大盤融資融券變化
3. 台指期日行情（一般盤與盤後盤）
4. 期交所法人期貨、選擇權交易與未平倉
5. 外資臺股期貨部位摘要
6. 自選股個股法人與融資融券資料

範例輸入：

```json
{
  "date": "2026-08-01",
  "fallback_days": 7,
  "watchlist": ["2330", "4566", "3293"],
  "include_raw": false
}
```

`fallback_days` 會在週末、休市日或資料尚未發布時，自動向前尋找最近交易日。

## 資料使用原則

盤中策略或歷史回測在交易日 T，只能使用 T-1 或更早已公開的籌碼資料，避免 lookahead。V7 的資料定位是盤後日報、盤前背景、選股與回測分群，不取代富果即時報價、FinMind 歷史資料或交易執行層。
