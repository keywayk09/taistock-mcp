# Taistock Safe Crawler V1

此模組為台股公開資料採集而自行實作，不依賴或複製 Crawl4AI 原始碼。

## V1 安全邊界

- 只允許 HTTPS。
- 僅允許 `www.twse.com.tw`、`mops.twse.com.tw`、`www.tpex.org.tw`。
- 禁止帳號密碼、非 443 連接埠、本機、私有 IP、link-local 與保留位址。
- 每次重新導向都重新驗證，且禁止跨網域重新導向。
- 不執行 JavaScript、不啟動瀏覽器、不保存 Cookie、不登入網站。
- 僅接受 HTML、XHTML、純文字。
- 預設逾時 12 秒、下載上限 2 MB、最多 2 次重新導向、輸出上限 80,000 字元。
- 結果包含 SHA-256、來源、抓取時間、信任分數及安全資訊。

## 尚未啟用

本分支只加入獨立模組，尚未掛接至公開 MCP tool、尚未部署、尚未修改既有交易或分析工具。

## 使用方式

```ts
import { crawlMops, crawlTpex, crawlTwse } from "../safe-crawler";

const result = await crawlTwse("/zh/");
```

不要把 `safeCrawl(url)` 直接暴露成未驗證、可由外部輸入任意 URL 的 MCP 工具。

## 後續安全工作

Cloudflare Workers 無法直接取得 DNS 解析結果，因此目前主要依靠封閉網域白名單與重新導向限制。未來若開放公司官網，必須在獨立閘道加入 DNS 解析後 IP 驗證、DNS rebinding 防護、速率限制、快取與稽核紀錄，再逐站核准。
