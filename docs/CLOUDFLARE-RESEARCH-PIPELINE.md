# Cloudflare TRAI 盤後研究資料管線

## 正式分工

- Cloudflare Worker：排程、富果 API、資料正規化、品質檢查、缺K補抓、MCP 查詢。
- R2：保存快照、1分K、5分K與每次執行摘要。
- D1：保存候選池、資料品質索引、引擎標籤與研究案例。
- GitHub：保存程式、每日復盤、核心案例、假說與 Decision Log；不作為每日行情抓取端。

## 排程

Cloudflare Cron 使用 UTC：

- `40 5 * * 1-5`：台灣時間平日13:40，抓上市／上櫃快照，建立候選池並抓5分K。
- `55 5 * * 1-5`：台灣時間平日13:55，重抓失敗／缺K案例，並替候選池前8名補1分K。

休市日若富果無資料，執行結果會記錄為 partial 或 failed，不會虛構K線。

## 候選池

預設最多40檔，來源為：

1. 成交值前段。
2. 絕對漲跌幅前段。
3. 日內振幅前段。
4. 固定研究名單及 `RESEARCH_SYMBOLS`。

採候選池而非全市場逐檔抓分K，是為了避免 Cloudflare Worker 子請求與富果方案限額；全市場快照仍完整保存在R2。

## 綁定

- `RESEARCH_DB`：D1資料庫 `taistock-research`。
- `RESEARCH_BUCKET`：R2 bucket `taistock-research-data`。
- `FUGLE_API_KEY`：Cloudflare Secret。
- `MCP_API_KEY`：保護手動執行與研究HTTP端點。

## HTTP端點

均位於原 Worker：

- `GET /health`：公開服務健康狀態，不顯示秘密。
- `GET /research/status`：需 `Authorization: Bearer <MCP_API_KEY>` 或 `X-API-Key`。
- `POST /research/run?mode=close|repair`：需授權，可手動測試。
- `GET /research/candles/{symbol}?date=YYYY-MM-DD&timeframe=1m|5m`：需授權。

## MCP工具

- `get_research_pipeline_status`
- `get_research_universe`
- `get_stored_intraday_candles`

## R2路徑

```text
fugle/snapshots/YYYY-MM-DD/TSE.json
fugle/snapshots/YYYY-MM-DD/OTC.json
fugle/candles/YYYY-MM-DD/5m/{symbol}.json
fugle/candles/YYYY-MM-DD/1m/{symbol}.json
research/universe/YYYY-MM-DD/selected.json
research/runs/YYYY-MM-DD/{run-id}.json
```

## 資料品質

每個 candle set 保存：

- bar_count
- first_time / last_time
- missing_count
- duplicate_count
- invalid_ohlc_count
- status：ok / incomplete / failed
- error
- R2 key

正式復盤只能使用 `ok`；`incomplete` 必須標示限制，`failed` 不可用替代資料冒充富果資料。
