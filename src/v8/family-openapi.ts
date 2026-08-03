export function familyOpenApiSchema(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Taiwan Stock AI Family Read-Only API",
      version: "8.4.0",
      description: "單一只讀入口。GPT 可把台股、財務、籌碼、題材、同業或供應鏈問題送到此 API，由後端自動解析並回傳相關資料。",
    },
    servers: [{ url: origin }],
    paths: {
      "/api/family/query": {
        post: {
          operationId: "queryTaiwanStockSystem",
          summary: "智慧查詢整套台股資料系統",
          description: "將使用者原始問題完整送出。適用於個股完整分析、股票比較、基本面、財務、籌碼、題材、同業與全球供應鏈。此端點只能讀取，不能修改資料。",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { "$ref": "#/components/schemas/FamilyQueryRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "查詢成功",
              content: {
                "application/json": {
                  schema: { "$ref": "#/components/schemas/FamilyQueryResponse" },
                },
              },
            },
            "400": {
              description: "輸入格式錯誤",
              content: {
                "application/json": {
                  schema: { "$ref": "#/components/schemas/ErrorResponse" },
                },
              },
            },
            "401": {
              description: "API Key 錯誤或缺少",
              content: {
                "application/json": {
                  schema: { "$ref": "#/components/schemas/ErrorResponse" },
                },
              },
            },
            "405": {
              description: "只允許 POST",
              content: {
                "application/json": {
                  schema: { "$ref": "#/components/schemas/ErrorResponse" },
                },
              },
            },
            "500": {
              description: "後端查詢失敗",
              content: {
                "application/json": {
                  schema: { "$ref": "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
          "x-openai-isConsequential": false,
        },
      },
    },
    components: {
      schemas: {
        FamilyQueryRequest: {
          type: "object",
          additionalProperties: false,
          required: ["query"],
          properties: {
            query: {
              type: "string",
              minLength: 1,
              maxLength: 2000,
              description: "使用者的完整原始問題，不要刪減股票代號、公司名稱、比較條件或分析需求。",
            },
            mode: {
              type: "string",
              enum: ["auto"],
              default: "auto",
              description: "固定使用自動路由。",
            },
            as_of_date: {
              type: "string",
              pattern: "^\\d{4}-\\d{2}-\\d{2}$",
              description: "選填，格式 YYYY-MM-DD；未填使用台北當日。",
            },
          },
        },
        FamilyQueryResponse: {
          type: "object",
          additionalProperties: true,
          required: ["service", "read_only", "query", "as_of_date"],
          properties: {
            service: { type: "string" },
            version: { type: "string" },
            read_only: { type: "boolean", const: true },
            route: { type: "string" },
            query: { type: "string" },
            as_of_date: { type: "string" },
            resolved_symbols: { type: "array", items: { type: "string" } },
            stock_analyses: { type: "array", items: { type: "object", additionalProperties: true } },
            global_search: { type: "object", additionalProperties: true },
            response_instructions: { type: "array", items: { type: "string" } },
          },
        },
        ErrorResponse: {
          type: "object",
          additionalProperties: true,
          properties: {
            error: { type: "string" },
            message: { type: "string" },
          },
        },
      },
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API key",
        },
      },
    },
  };
}

export function familyPrivacyPolicyHtml(origin: string) {
  const apiOrigin = origin.replace(/[<>&\"']/g, "");
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>台股引擎隱私權政策</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.75;color:#1f2937;background:#f8fafc;margin:0;padding:24px}
main{max-width:760px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:32px;box-shadow:0 8px 28px rgba(15,23,42,.06)}
h1{font-size:28px;margin:0 0 8px;color:#111827}h2{font-size:19px;margin-top:28px;color:#111827}p,li{font-size:15px}.meta{color:#64748b}.notice{background:#f1f5f9;border-radius:10px;padding:14px}a{color:#2563eb}
</style>
</head>
<body>
<main>
<h1>台股引擎隱私權政策</h1>
<p class="meta">生效日期：2026 年 8 月 4 日</p>
<p>本政策適用於「台股引擎」及其只讀台股查詢 API（${apiOrigin}）。</p>

<h2>一、處理的資料</h2>
<p>服務會接收使用者主動輸入的查詢文字，例如股票代號、公司名稱、指定日期、比較條件與分析需求，以及提供服務所需的基本技術請求資訊。</p>
<p>本服務不要求使用者提供姓名、電話、地址、付款資料或證券帳戶資料。請勿在查詢中輸入不必要的個人資料或機密資訊。</p>

<h2>二、使用目的</h2>
<ul>
<li>辨識股票、產業與分析需求。</li>
<li>查詢公開市場、財務、籌碼、公司公告與產業資料。</li>
<li>回傳只讀分析資料、偵錯、維護安全及防止濫用。</li>
</ul>

<h2>三、資料來源與第三方處理</h2>
<p>服務可能向臺灣證券交易所、證券櫃檯買賣中心、公開資訊觀測站、臺灣集中保管結算所、臺灣期貨交易所、Fugle、FinMind 或其他公開資料來源傳送必要的股票代號與查詢日期。服務運行於 Cloudflare 基礎設施；使用者也受 ChatGPT／OpenAI 本身的隱私政策與控制項約束。</p>

<h2>四、保存與分享</h2>
<p>只讀查詢端點不會刻意將使用者的完整查詢內容寫入本服務的 D1 研究資料庫。基礎設施供應商可能為維運、安全與防濫用保留必要的技術日誌。本服務不出售個人資料，也不將查詢內容用於廣告投放。</p>

<h2>五、安全與權限</h2>
<p>公開分享的 GPT 透過伺服器端 API 金鑰存取只讀端點。此端點不能新增、修改、刪除、匯入、核准或覆蓋研究資料。服務採取合理的存取控制與速率限制，但任何網路服務皆無法保證絕對安全。</p>

<h2>六、使用者選擇</h2>
<p>使用者可以停止使用本 GPT，或避免提交不希望處理的內容。由於服務不建立一般使用者帳戶或個人檔案，通常沒有可供查詢或匯出的個人帳戶資料。</p>

<h2>七、投資風險聲明</h2>
<p class="notice">本服務提供公開資料整理與研究輔助，不構成投資建議、獲利保證或代客下單。資料可能延遲、不完整或因來源異常而暫時無法取得，使用者應自行核實並承擔投資決策風險。</p>

<h2>八、政策更新與聯絡</h2>
<p>本政策可能因服務功能或法規需求更新。技術問題可透過專案維護頁面提出：<a href="https://github.com/keywayk09/taistock-mcp">GitHub 專案</a>。</p>
</main>
</body>
</html>`;
}
