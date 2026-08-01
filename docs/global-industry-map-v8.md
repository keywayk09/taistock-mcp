# V8 全球產業鏈與題材知識圖譜

V8 將 MCP 從單純台股查價與籌碼工具，擴充成可長期維護的全球產業知識圖譜。目標不是預測下一波題材，而是讓每次討論個股、題材、供應鏈或海外事件時，都能從同一套結構化資料快速取得完整背景。

## 核心原則

1. 台股上市、上櫃、興櫃公司由 TWSE／TPEx 官方 OpenAPI 全量同步。
2. 每家公司可同時屬於多個產業、產品、技術、題材與供應鏈。
3. 題材關係必須保留角色、關聯度、證據等級、有效期間與最近確認日期。
4. 供應鏈以有方向的公司關係保存，例如 supplier_of、manufactures_for、provides_equipment_to。
5. AI 或新聞抽取只建立 pending 候選，核准後才進入正式分類。
6. 不以虛構關係追求形式上的 100% 題材覆蓋；官方產業可以全量，細題材與供應鏈必須有證據。

## 資料模型

### global_companies

全球公司主檔，包含：

- 國家、交易所、代號
- 中英文名稱與別名
- 官方產業、細產業
- 公司網址、資料來源
- 有效狀態與更新時間

公司 ID 使用 `國家:交易所:代號`，例如：

- `TW:TWSE:2330`
- `US:NASDAQ:NVDA`
- `JP:TSE:8035`
- `KR:KRX:000660`

### industry_themes

統一保存：

- sector
- industry
- sub_industry
- product
- technology
- theme
- supply_chain
- official_industry

題材可以形成父子樹，例如：

```text
人工智慧
└─ AI伺服器
   ├─ AI加速器
   ├─ 資料中心電源
   ├─ 液冷散熱
   └─ 資料中心高速網路
```

### company_theme_memberships

保存公司與題材的正式關係：

- 角色
- 關聯度 0～100
- 證據等級
- active／stale／archived 狀態
- valid_from／valid_to
- last_verified_at
- 備註

### supply_chain_edges

保存全球公司間的有方向關係：

- supplier_of
- customer_of
- manufactures_for
- provides_equipment_to
- provides_material_to
- technology_partner
- competitor
- substitute
- indirect_supplier
- ecosystem_member
- rumored_supplier

傳聞關係不得與官方確認關係混為一談。

### industry_evidence

分類或供應鏈關係的證據可以來自：

- 年報、公司申報
- 法說會
- 重大訊息
- 公司官網
- 交易所與主管機關
- 媒體與研究
- 人工整理
- 市場傳聞

### classification_candidates

MCP 自動抽取的新題材或供應鏈先進入 pending 候選，經 `review_classification_candidate` 核准後才寫入正式資料。

## 台股全市場同步

`sync_taiwan_company_universe` 會同步：

- TWSE 上市公司
- TPEx 上櫃公司
- TPEx 興櫃公司

並為每家公司建立官方產業分類。Cloudflare Cron 在週一至週五台北時間約 15:40 自動更新公司主檔。

公開來源 smoke test 於 2026-08-02 驗證取得：

- TWSE 上市公司：1,093 筆
- TPEx 上櫃公司：官方端點通過
- TPEx 興櫃公司：官方端點通過

實際筆數會隨上市、下市及市場狀態變動。

## 初始全球種子

V8 內建：

- 70+ 個產業、產品、技術與題材節點
- 美國、日本、韓國、荷蘭的重要產業公司主檔
- AI、半導體、HBM、先進封裝、資料中心、散熱、網通、自動化、電動車、電池、重電、國防等核心公司題材關係

這些種子讓資料庫初始化後即可進行全球題材查詢；完整全球公司與供應鏈則透過批次匯入與證據更新持續擴充。

## V8 新增 16 個 MCP 工具

- `initialize_global_industry_map`
- `sync_taiwan_company_universe`
- `import_global_industry_batch`
- `upsert_global_company`
- `upsert_industry_theme`
- `set_company_theme_membership`
- `set_supply_chain_edge`
- `add_industry_evidence`
- `create_classification_candidate`
- `review_classification_candidate`
- `get_company_industry_map`
- `get_theme_industry_map`
- `search_global_industry_map`
- `get_supply_chain_network`
- `get_global_industry_coverage`
- `get_unclassified_taiwan_companies`

V6 既有 40 個工具、V7 官方籌碼與 ETF 18 個工具全部保留，V8 合計 74 個 MCP 工具。

## 典型查詢

### 查一家公司完整背景

```json
{
  "ticker": "2330",
  "country": "TW"
}
```

使用 `get_company_industry_map`，取得公司主檔、題材角色、供應鏈上下游與證據。

### 查全球題材

```json
{
  "query": "HBM",
  "countries": ["TW", "US", "JP", "KR"],
  "min_relevance": 60
}
```

使用 `get_theme_industry_map`，比較不同市場的核心公司與供應鏈位置。

### 展開供應鏈

```json
{
  "company_id": "US:NASDAQ:NVDA",
  "direction": "both",
  "depth": 2,
  "min_confidence": 70
}
```

使用 `get_supply_chain_network` 展開最多三層的上下游網路。

### 批次匯入研究結果

`import_global_industry_batch` 可一次匯入公司、題材、公司題材關係、供應鏈邊與證據，並在 `knowledge_import_runs` 保存稽核紀錄。

## 驗證

GitHub Actions 驗證項目：

1. TypeScript type-check
2. Wrangler bundle dry-run
3. TWSE／TAIFEX 籌碼資料來源
4. SITCA 主動式 ETF 清單
5. FinMind ETF 公開清單備援
6. TWSE 上市公司官方主檔
7. TPEx 上櫃公司官方主檔
8. TPEx 興櫃公司官方主檔

## 邊界

不存在一個免費、官方且完整的全球公司供應鏈資料源。因此 V8 的「一次到位」指的是：

- 資料模型一次設計完整
- 台股公司宇宙可全量自動同步
- 全球題材、公司、供應鏈與證據可統一匯入、查詢、審核及維護
- 重要全球產業已有初始種子

不代表系統可以在沒有公開證據的情況下，憑空產生全世界所有供應商與客戶關係。後續新增資料會累積在同一套模型中，不需要再次改架構。
