# Data 原始資料

此目錄保存可重現研究結果所需的資料說明與索引。

## 資料類型

- 個股日 K
- 個股 1 分／5 分 OHLCV
- 台指期日盤／夜盤 OHLCV
- 市場篩選結果
- 訊號事件資料
- MFE／MAE 計算結果
- 趨勢線幾何資料
- 圖表與截圖索引

## 建議結構

```text
data/
├── raw/             # 原始資料，不修改
├── processed/       # 清理與標準化後資料
├── features/        # 研究特徵
├── labels/          # AI／人工 Verdict
└── indexes/         # 檔案索引與版本資訊
```

Git 不保存空資料夾，資料實際產生時再建立。

## 重要規則

1. 原始資料不可覆寫。
2. 每份處理後資料必須記錄來源、時間、時區與處理版本。
3. 日盤與夜盤必須明確分離。
4. 除權息、換月、價格單位與缺漏資料必須留下處理紀錄。
5. 禁止提交 API Key、Token、帳號、Cookie 或其他機密。
6. 大型 OHLCV 檔案若不適合進 Git，應只提交索引、摘要與外部儲存位置說明。
7. 研究報告必須能由原始資料重新計算。

## 最低資料欄位

```text
timestamp, market, symbol, session, timeframe,
open, high, low, close, volume, source, timezone,
data_version, processing_version
```
