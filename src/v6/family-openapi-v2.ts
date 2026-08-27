export const FAMILY_OPENAPI_V2_VERSION = "family-action-openapi/v3.1.0";

function postOperation(operationId: string, summary: string, schema: Record<string, unknown>) {
  return {
    operationId,
    summary,
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            additionalProperties: false,
            ...schema,
          },
        },
      },
    },
    responses: {
      "200": { description: "成功" },
      "400": { description: "輸入錯誤" },
      "401": { description: "未授權" },
      "500": { description: "查詢失敗" },
    },
    "x-openai-isConsequential": false,
  };
}

export function familyOpenApiV2(origin: string) {
  const symbol = { type: "string", pattern: "^[0-9]{4,6}$" };
  const asOf = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
  return {
    openapi: "3.1.0",
    info: {
      title: "Taiwan Stock AI Family Read-Only API",
      version: FAMILY_OPENAPI_V2_VERSION,
      description: "Family V3 採 Same Research Brain, Different Permissions：家人與Owner共用市場/研究讀取能力，Family永遠唯讀。Custom GPT Action 直接暴露 Family MCP 的核心讀取能力，包括即時五檔/逐筆與正式 Published 籌碼，避免後端有能力但介面沒有工具。自然語言query會先做意圖與研究規劃，不強迫固定模板；需要完整個股研究時仍以1到11點作完整性契約。Web為open-world研究層，不限固定網站或關鍵字；正式Published籌碼及OHLC MCP的資料身份不可被Web、Fugle或FinMind取代。",
    },
    servers: [{ url: origin }],
    paths: {
      "/api/family/query": {
        post: postOperation("queryTaiwanStockSystem", "自然語言智能入口：依問題自動選擇快速單股、完整分析、多股比較、波段候選、市場背景或Open-World研究", {
          required: ["query"],
          properties: {
            query: { type: "string", minLength: 1, maxLength: 2000 },
            mode: { type: "string", enum: ["auto"], default: "auto" },
            as_of_date: asOf,
          },
        }),
      },
      "/api/family/market-context": {
        post: postOperation("getFamilyStockMarketContext", "直接讀取單股即時成交、買賣五檔、最近逐筆與短窗主動買賣流；唯讀、不持久化", {
          required: ["symbol"],
          properties: {
            symbol,
            books: { type: "boolean", default: true },
            wait_ms: { type: "integer", minimum: 0, maximum: 2500, default: 0 },
          },
        }),
      },
      "/api/family/chips": {
        post: postOperation("getFamilyMarketChipSummary", "直接讀取正式 Published generation 籌碼：三大法人、融資融券、借券與借券賣出；最多180自然日", {
          required: ["symbol"],
          properties: {
            symbol,
            as_of: asOf,
            calendar_days: { type: "integer", minimum: 30, maximum: 180, default: 60 },
            reference_price: { type: "number", exclusiveMinimum: 0 },
            estimated_financing_cost: { type: "number", exclusiveMinimum: 0 },
            financing_ratio: { type: "number", minimum: 0.1, maximum: 0.9, default: 0.6 },
          },
        }),
      },
      "/api/family/analyze": {
        post: postOperation("analyzeFamilyStock11Point", "明確要求完整個股研究時使用固定1到11完整性契約；查詢順序與Web深化仍可自主決定", {
          required: ["symbol"],
          properties: { symbol, as_of_date: asOf },
        }),
      },
      "/api/family/compare": {
        post: postOperation("compareFamilyStocks11Point", "用相同證據模型比較2到5檔；不要求機械式顯示11個段落", {
          required: ["symbols"],
          properties: {
            symbols: { type: "array", minItems: 2, maxItems: 5, uniqueItems: true, items: symbol },
            as_of_date: asOf,
          },
        }),
      },
      "/api/family/screen": {
        post: postOperation("screenFamilySwingCandidates", "全市場快速預篩加受控深掃，產生1到8週引擎候選；Web可另發現研究候選但不可冒充Engine Rank", {
          properties: {
            mode: { type: "string", enum: ["stable", "balanced", "aggressive"], default: "balanced" },
            top_n: { type: "integer", minimum: 1, maximum: 10, default: 5 },
          },
        }),
      },
      "/api/family/status": {
        get: {
          operationId: "getFamilyEngineCapabilities",
          summary: "確認Family Shared Read Plane、唯讀邊界、即時來源與Open-World研究能力",
          security: [{ bearerAuth: [] }],
          responses: { "200": { description: "成功" }, "401": { description: "未授權" } },
          "x-openai-isConsequential": false,
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "API key" },
      },
    },
  };
}
