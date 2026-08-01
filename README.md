# Taiwan Stock AI MCP

部署於 Cloudflare Workers 的台股 MCP Server，提供即時行情、歷史資料、官方籌碼、基本面、事件資料庫、觀察清單與投資組合工具。

目前開發版本：**V7.1**

## V7.1 重點

- 保留 V6 既有工具
- 新增 TWSE／TAIFEX 官方籌碼工具
- 新增台股盤後籌碼日報資料包
- ETF 改為投信官方網站每日投資組合優先
- 使用 Cloudflare D1 保存 ETF 官方持股快照
- 可比較 ETF 新增、剔除、加碼與減碼
- FinMind ETF sponsor 資料降為選用備援，不是核心功能必要條件

詳細說明請見 `docs/twchips-v7.md`。

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
