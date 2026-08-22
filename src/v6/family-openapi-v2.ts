export const FAMILY_OPENAPI_V2_VERSION = "family-action-openapi/v2.1.0";

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
      description: "媽媽/家人版完整唯讀介面：單股固定11點、2-5檔比較、1-8週波段候選V2。盤中可搭配Fugle等即時來源；GPT可自由使用Web做open-world研究，不限固定網站或關鍵字，並可依新線索自主追客戶、供應鏈、同業、海外新聞、法說與政策。正式Published籌碼及OHLC MCP的資料身份不可被Web或研究型行情取代。",
    },
    servers: [{ url: origin }],
    paths: {
      "/api/family/analyze": {
        post: postOperation("analyzeFamilyStock11Point", "固定1到11完整分析；結構化資料打底並允許自主Web深化研究", {
          required: ["symbol"],
          properties: { symbol, as_of_date: asOf },
        }),
      },
      "/api/family/compare": {
        post: postOperation("compareFamilyStocks11Point", "用相同11點證據框架比較2到5檔，並允許自主Web補證", {
          required: ["symbols"],
          properties: {
            symbols: { type: "array", minItems: 2, maxItems: 5, uniqueItems: true, items: symbol },
            as_of_date: asOf,
          },
        }),
      },
      "/api/family/screen": {
        post: postOperation("screenFamilySwingCandidates", "全市場快速預篩加受控深掃，產生1到8週引擎候選；Web可另外發現研究候選再交叉驗證", {
          properties: {
            mode: { type: "string", enum: ["stable", "balanced", "aggressive"], default: "balanced" },
            top_n: { type: "integer", minimum: 1, maximum: 10, default: 5 },
          },
        }),
      },
      "/api/family/query": {
        post: postOperation("queryTaiwanStockSystem", "舊版相容智慧查詢；保留唯讀資料入口", {
          required: ["query"],
          properties: {
            query: { type: "string", minLength: 1, maxLength: 2000 },
            mode: { type: "string", enum: ["auto"], default: "auto" },
            as_of_date: asOf,
          },
        }),
      },
      "/api/family/status": {
        get: {
          operationId: "getFamilyEngineCapabilities",
          summary: "確認家人版引擎、即時來源與open-world研究能力",
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
