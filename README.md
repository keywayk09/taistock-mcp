# Taiwan Stock AI MCP

部署於 Cloudflare Workers 的台股與全球產業研究 MCP Server，提供即時行情、歷史資料、官方籌碼、ETF 持股、基本面、事件資料庫、觀察清單、投資組合，以及全球產業鏈與題材知識圖譜。

目前開發版本：**V8.0**

## V8.0 重點

- 保留 V6 既有 40 個工具
- 保留 V7 的 TWSE／TAIFEX 官方籌碼與 ETF 官方持股工具
- 從 TWSE／TPEx 官方 OpenAPI 全量同步上市、上櫃與興櫃公司
- 建立全球公司、產業、產品、技術、題材、供應鏈與證據資料模型
- 同一家公司可同時屬於多個題材，並記錄角色、關聯度與有效期間
- 供應鏈可保存供應商、客戶、代工、設備、材料、競爭與生態系關係
- AI 自動分類先進入 pending 候選，核准後才寫入正式資料
- 內建美國、日本、韓國、荷蘭重要公司與核心產業題材種子
- 週一至週五自動同步台股公司主檔
- V8 合計 74 個 MCP 工具

詳細說明：

- `docs/global-industry-map-v8.md`
- `docs/twchips-v7.md`

## 開發

```bash
npm install
npm run type-check
npx wrangler deploy --dry-run
```

## 部署

```bash
npm run deploy
```

MCP endpoint：`/mcp`

Health endpoint：`/health`
