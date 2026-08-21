import {
  finmind,
  fugle,
  normalizeDailyBars,
  normalizeQuote,
  rec,
  technicalSummary,
} from "./common";
import { getTwMarketChipSummaryPublished } from "./market-data-published-gateway";

export const FAMILY_ACTION_COMPAT_VERSION = "family-action-compat/v1";

type FamilyActionInput = {
  query: string;
  mode?: "auto";
  as_of_date?: string;
};

type RuntimeFamilyEnv = Env & { MOM_GPT_API_KEY?: string };

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  };
}

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function bearerAuthorized(request: Request, secret?: string) {
  const expected = secret?.trim();
  if (!expected) return false;
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;
  return constantTimeEqual(authorization.slice(7), expected);
}

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function subtractDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function extractSymbols(query: string) {
  return [...new Set(query.match(/(?<!\d)\d{4,6}(?!\d)/g) ?? [])].slice(0, 5);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function settled<T>(label: string, promise: Promise<T>) {
  try {
    return { ok: true as const, label, value: await promise, error: null };
  } catch (error) {
    return { ok: false as const, label, value: null, error: errorText(error) };
  }
}

function latestRows(rows: any[], count: number) {
  return [...rows]
    .sort((a, b) => String(a?.date ?? "").localeCompare(String(b?.date ?? "")))
    .slice(-count);
}

async function buildStockRead(env: Env, symbol: string, asOf: string) {
  const start180 = subtractDays(asOf, 180);
  const start550 = subtractDays(asOf, 550);
  const start1150 = subtractDays(asOf, 1_150);

  const [chip, quote, prices, company, revenue, income, balance, cashflow] = await Promise.all([
    settled("published_chip", getTwMarketChipSummaryPublished(env, {
      symbol,
      as_of: asOf,
      calendar_days: 180,
    })),
    settled("fugle_quote", fugle(env, `/intraday/quote/${encodeURIComponent(symbol)}`)),
    settled("finmind_price", finmind(env, "TaiwanStockPrice", {
      data_id: symbol,
      start_date: start180,
      end_date: asOf,
    })),
    settled("finmind_company", finmind(env, "TaiwanStockInfo", { data_id: symbol })),
    settled("finmind_revenue", finmind(env, "TaiwanStockMonthRevenue", {
      data_id: symbol,
      start_date: start550,
      end_date: asOf,
    })),
    settled("finmind_income", finmind(env, "TaiwanStockFinancialStatements", {
      data_id: symbol,
      start_date: start1150,
      end_date: asOf,
    })),
    settled("finmind_balance", finmind(env, "TaiwanStockBalanceSheet", {
      data_id: symbol,
      start_date: start1150,
      end_date: asOf,
    })),
    settled("finmind_cashflow", finmind(env, "TaiwanStockCashFlowsStatement", {
      data_id: symbol,
      start_date: start1150,
      end_date: asOf,
    })),
  ]);

  const bars = prices.ok ? normalizeDailyBars(prices.value) : [];
  const technical = bars.length ? technicalSummary(bars) : null;
  const latestBar = bars.at(-1) ?? null;
  const normalizedQuote = quote.ok ? normalizeQuote(quote.value, symbol) : null;
  const companyRows = company.ok ? company.value : [];

  return {
    symbol,
    company: companyRows.length ? rec(companyRows[0]) : null,
    market_snapshot: {
      formal_ohlc: false,
      source: normalizedQuote?.close ? "FUGLE_DISPLAY_QUOTE" : latestBar ? "FINMIND_DISPLAY_FALLBACK" : "UNAVAILABLE",
      quote: normalizedQuote?.close ? normalizedQuote : null,
      latest_daily_bar: latestBar,
      note: "此相容 REST API 僅提供家用顯示/研究資料；正式 OHLC/K線仍以 OHLC MCP 為準。",
    },
    technical: {
      status: technical ? "READY" : "UNAVAILABLE",
      source: prices.ok ? "FINMIND_DISPLAY_FALLBACK" : "UNAVAILABLE",
      summary: technical,
      recent_daily_bars: bars.slice(-30),
      formal_ohlc: false,
    },
    chip: chip.ok ? chip.value : {
      ok: false,
      status: "UNAVAILABLE",
      reason: chip.error,
    },
    fundamentals: {
      monthly_revenue: revenue.ok ? latestRows(revenue.value, 18) : [],
      income_statement_rows: income.ok ? latestRows(income.value, 60) : [],
      balance_sheet_rows: balance.ok ? latestRows(balance.value, 60) : [],
      cashflow_rows: cashflow.ok ? latestRows(cashflow.value, 60) : [],
      source: "FINMIND_READ_ONLY_FALLBACK",
      errors: [revenue, income, balance, cashflow]
        .filter((item) => !item.ok)
        .map((item) => `${item.label}:${item.error}`),
    },
    data_quality: {
      published_chip: chip.ok,
      fugle_quote: quote.ok,
      finmind_price: prices.ok,
      finmind_company: company.ok,
      read_only: true,
      writes_allowed: false,
    },
  };
}

export async function runFamilyActionCompatQuery(env: Env, input: FamilyActionInput) {
  const query = String(input.query ?? "").trim();
  if (!query) throw new Error("query is required");
  if (query.length > 2_000) throw new Error("query is too long");
  const asOf = input.as_of_date && /^\d{4}-\d{2}-\d{2}$/.test(input.as_of_date)
    ? input.as_of_date
    : taipeiDate();
  const symbols = extractSymbols(query);
  const stockAnalyses = await Promise.all(symbols.map((symbol) => buildStockRead(env, symbol, asOf)));
  const route = symbols.length > 1 ? "stock_compare" : symbols.length === 1 ? "stock_analysis" : "read_only_query";

  return {
    service: "Taiwan Stock AI Family Read-Only API",
    version: FAMILY_ACTION_COMPAT_VERSION,
    compatibility: "LEGACY_CUSTOM_GPT_ACTION_RESTORED_ON_MODERN_READ_PLANE",
    read_only: true,
    route,
    query,
    as_of_date: asOf,
    resolved_symbols: symbols,
    stock_analyses: stockAnalyses,
    global_search: symbols.length ? null : {
      status: "NO_EXPLICIT_SYMBOL",
      note: "舊 Action 相容入口已恢復；無股票代號的全市場選股仍由 Family MCP 的 screen_family_swing_candidates 處理。",
    },
    response_instructions: [
      "請以繁體中文先給結論，再解釋理由。",
      "正式 Published 籌碼與顯示/降級行情資料必須分開標示。",
      "資料不足時明示，不可自行補數字。",
      "不得聲稱已修改、修復、寫入或下單；此 API 永遠唯讀。",
    ],
  };
}

export function familyActionOpenApi(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Taiwan Stock AI Family Read-Only API",
      version: FAMILY_ACTION_COMPAT_VERSION,
      description: "舊版 Custom GPT Action 相容入口；只讀，不允許任何 Production 寫入。",
    },
    servers: [{ url: origin }],
    paths: {
      "/api/family/query": {
        post: {
          operationId: "queryTaiwanStockSystem",
          summary: "智慧查詢台股唯讀資料",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["query"],
                  properties: {
                    query: { type: "string", minLength: 1, maxLength: 2000 },
                    mode: { type: "string", enum: ["auto"], default: "auto" },
                    as_of_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "查詢成功" }, "400": { description: "輸入錯誤" }, "401": { description: "未授權" } },
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

export function familyPrivacyHtml(origin: string) {
  const safeOrigin = origin.replace(/[<>&\"']/g, "");
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>台股引擎隱私權政策</title></head><body><main><h1>台股引擎隱私權政策</h1><p>本政策適用於台股引擎只讀 API（${safeOrigin}）。</p><p>服務僅處理使用者主動提交的股票查詢與提供查詢所需的公開市場資料；不提供下單，也不允許透過家人 API 修改 GitHub、策略或 Production 設定。</p><p>資料可能來自 TWSE、TPEx、Fugle、FinMind 與 GitHub canonical store。正式籌碼資料以 Published generation 為準；正式 OHLC/K線仍由 OHLC MCP 提供。</p><p>本服務為研究輔助，不構成投資建議或獲利保證。</p></main></body></html>`;
}

export async function handleFamilyActionCompat(request: Request, env: Env, url: URL): Promise<Response | null> {
  const runtimeEnv = env as RuntimeFamilyEnv;

  if (url.pathname === "/api/family/query") {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, { allow: "POST, OPTIONS", ...corsHeaders() });
    if (!bearerAuthorized(request, runtimeEnv.MOM_GPT_API_KEY)) {
      return jsonResponse({ error: "unauthorized" }, 401, { "www-authenticate": 'Bearer realm="taistock-family"', ...corsHeaders() });
    }
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 32_000) return jsonResponse({ error: "payload_too_large" }, 413, corsHeaders());
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400, corsHeaders());
    }
    const input = body !== null && typeof body === "object" ? body as Record<string, unknown> : {};
    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (!query) return jsonResponse({ error: "query_required" }, 400, corsHeaders());
    if (query.length > 2_000) return jsonResponse({ error: "query_too_long" }, 400, corsHeaders());
    try {
      const result = await runFamilyActionCompatQuery(env, {
        query,
        mode: "auto",
        as_of_date: typeof input.as_of_date === "string" ? input.as_of_date : undefined,
      });
      return jsonResponse(result, 200, corsHeaders());
    } catch (error) {
      return jsonResponse({ error: "family_query_failed", message: errorText(error) }, 500, corsHeaders());
    }
  }

  if (url.pathname === "/family-openapi.json") return jsonResponse(familyActionOpenApi(url.origin));
  if (url.pathname === "/privacy" || url.pathname === "/privacy-policy") {
    return new Response(familyPrivacyHtml(url.origin), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=3600",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
      },
    });
  }

  return null;
}
