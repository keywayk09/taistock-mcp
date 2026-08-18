import { runFamilyQuery } from "../v8/family-query";
import { runFamilyStockSelection } from "../v8/family-stock-selection-v18";

type JsonRecord = Record<string, any>;
type FamilyReadIdentity = "owner" | "mom" | "sister";
type FamilyReadRoute = "stock_selection" | "smart_query";

type FamilyReadEnv = Env & {
  MCP_API_KEY?: string;
  MOM_GPT_API_KEY?: string;
  SISTER_GPT_API_KEY?: string;
  GITHUB_TOKEN?: string;
  MARKET_DATA_GITHUB_REPO?: string;
  MARKET_DATA_GITHUB_BRANCH?: string;
};

const FAMILY_READ_VERSION = "family-read-api/v1.0.0";
const DEFAULT_MARKET_DATA_REPO = "keywayk09/tv-papertrader";
const DEFAULT_MARKET_DATA_BRANCH = "main";

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.replace(/^Bearer\s+/i, "").trim();
}

export function resolveFamilyReadIdentity(request: Request, env: FamilyReadEnv): FamilyReadIdentity | null {
  const supplied = bearerToken(request);
  if (!supplied) return null;
  const candidates: Array<[FamilyReadIdentity, string | undefined]> = [
    ["owner", env.MCP_API_KEY],
    ["mom", env.MOM_GPT_API_KEY],
    ["sister", env.SISTER_GPT_API_KEY],
  ];
  for (const [identity, secret] of candidates) {
    const expected = secret?.trim();
    if (expected && constantTimeEqual(supplied, expected)) return identity;
  }
  return null;
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  };
}

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

function taipeiDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export function classifyFamilyReadIntent(query: string): FamilyReadRoute {
  const text = query.trim();
  const explicitSymbol = /(?<!\d)\d{4}(?!\d)/.test(text);
  if (/選股|挑股|候選股|股票池|top\s*\d+/i.test(text)) return "stock_selection";
  if (!explicitSymbol && /低位階|低檔|低基期|回檔|拉回|回踩|突破|起漲|開始轉強|穩健|積極/.test(text)) {
    return "stock_selection";
  }
  if (!explicitSymbol && /(?:找|推薦|挑|選).{0,12}(?:檔|支|股票|個股|標的)/.test(text)) return "stock_selection";
  return "smart_query";
}

function marketDataRoot(tradeDate: string) {
  const [year, month, day] = tradeDate.split("-");
  return `data/market/tw/daily/${year}/${month}/${day}`;
}

function decodeBase64Utf8(value: string) {
  const binary = atob(value.replaceAll("\n", ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function readGithubJson(env: FamilyReadEnv, path: string): Promise<any | null> {
  const token = env.GITHUB_TOKEN?.trim();
  if (!token) return null;
  const repo = env.MARKET_DATA_GITHUB_REPO || DEFAULT_MARKET_DATA_REPO;
  const branch = env.MARKET_DATA_GITHUB_BRANCH || DEFAULT_MARKET_DATA_BRANCH;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`https://api.github.com/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "Taiwan-Stock-AI-Family-Read/1.0",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub read ${path} HTTP ${response.status}`);
  const body = record(await response.json());
  if (typeof body.content !== "string") return null;
  try { return JSON.parse(decodeBase64Utf8(body.content)); }
  catch { return null; }
}

function rowSymbol(value: unknown) {
  const row = record(value);
  return String(row.symbol ?? row.stock_id ?? row.ticker ?? row.code ?? "").trim();
}

function symbolsFromSelection(value: unknown) {
  const candidates = Array.isArray(record(value).candidates) ? record(value).candidates : [];
  return [...new Set(candidates.map(rowSymbol).filter((symbol) => /^\d{4}$/.test(symbol)))].slice(0, 10);
}

function symbolsFromQueryResult(value: unknown) {
  const resolved = Array.isArray(record(value).resolved_symbols) ? record(value).resolved_symbols : [];
  return [...new Set(resolved.map(String).filter((symbol) => /^\d{4}$/.test(symbol)))].slice(0, 10);
}

function filterRowsForSymbols(value: unknown, symbols: string[]) {
  const rows = Array.isArray(record(value).rows) ? record(value).rows : [];
  if (!symbols.length) return [];
  const wanted = new Set(symbols);
  return rows.filter((row: unknown) => wanted.has(rowSymbol(row)));
}

async function canonicalMarketDataSnapshot(env: FamilyReadEnv, tradeDate: string, symbols: string[]) {
  if (!env.GITHUB_TOKEN?.trim()) {
    return {
      status: "PENDING_GITHUB_TOKEN",
      trade_date: tradeDate,
      canonical_source: "GitHub",
      symbols,
      note: "Family Read API 仍可回傳既有只讀分析；Market Data canonical enrichment 等待此 Worker 的 GITHUB_TOKEN。",
    };
  }

  const root = marketDataRoot(tradeDate);
  try {
    const [manifest, institutional, margin, events] = await Promise.all([
      readGithubJson(env, `${root}/manifest.json`),
      readGithubJson(env, `${root}/institutional.json`),
      readGithubJson(env, `${root}/margin.json`),
      readGithubJson(env, `${root}/events.json`),
    ]);
    return {
      status: manifest ? "AVAILABLE" : "NOT_READY",
      trade_date: tradeDate,
      canonical_source: "GitHub",
      repository: env.MARKET_DATA_GITHUB_REPO || DEFAULT_MARKET_DATA_REPO,
      branch: env.MARKET_DATA_GITHUB_BRANCH || DEFAULT_MARKET_DATA_BRANCH,
      market_day_status: record(manifest).overall ?? null,
      manifest_sources: record(manifest).datasets ?? null,
      symbols,
      institutional: {
        phase: record(institutional).phase ?? null,
        fetched_at: record(institutional).fetched_at ?? null,
        sources: record(institutional).sources ?? [],
        rows: filterRowsForSymbols(institutional, symbols),
      },
      margin: {
        fetched_at: record(margin).fetched_at ?? null,
        sources: record(margin).sources ?? [],
        rows: filterRowsForSymbols(margin, symbols),
      },
      events: {
        fetched_at: record(events).fetched_at ?? null,
        sources: record(events).sources ?? [],
        rows: filterRowsForSymbols(events, symbols),
      },
    };
  } catch (error) {
    return {
      status: "DEGRADED",
      trade_date: tradeDate,
      canonical_source: "GitHub",
      symbols,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function familyReadOpenApiSchema(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Taiwan Stock AI Family Read API V1",
      version: FAMILY_READ_VERSION,
      description: "家人共用的單一只讀入口。支援個股、比較、基本面、財務、籌碼、題材、供應鏈與波段選股；後端自動路由，並在可用時併入 GitHub canonical Market Data。",
    },
    servers: [{ url: origin }],
    paths: {
      "/api/family/read": {
        post: {
          operationId: "queryTaiwanStockFamilySystem",
          summary: "家人版台股智慧查詢",
          description: "把使用者原始問題完整送出。此端點嚴格只讀，不可觸發 Market Data ingestion、研究資料修改或任何下單。",
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
                    as_of_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "查詢成功" },
            "400": { description: "輸入格式錯誤" },
            "401": { description: "家人 API Key 錯誤或缺少" },
            "405": { description: "只允許 POST" },
            "500": { description: "後端查詢失敗" },
          },
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

export async function handleFamilyReadApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/family/read") return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (request.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405, { allow: "POST, OPTIONS", ...corsHeaders() });
  }

  const identity = resolveFamilyReadIdentity(request, env as FamilyReadEnv);
  if (!identity) {
    return jsonResponse(
      { error: "unauthorized" },
      401,
      { "www-authenticate": 'Bearer realm="taistock-family-read"', ...corsHeaders() },
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 32_000) return jsonResponse({ error: "payload_too_large" }, 413, corsHeaders());

  let body: unknown;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: "invalid_json" }, 400, corsHeaders()); }
  const input = record(body);
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query) return jsonResponse({ error: "query_required" }, 400, corsHeaders());
  if (query.length > 2_000) return jsonResponse({ error: "query_too_long" }, 400, corsHeaders());

  const rawAsOfDate = typeof input.as_of_date === "string" ? input.as_of_date : undefined;
  if (rawAsOfDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawAsOfDate)) {
    return jsonResponse({ error: "invalid_as_of_date" }, 400, corsHeaders());
  }
  const asOfDate = rawAsOfDate || taipeiDate();
  const route = classifyFamilyReadIntent(query);

  try {
    if (route === "stock_selection") {
      const result = await runFamilyStockSelection(env, { query, as_of_date: rawAsOfDate });
      const symbols = symbolsFromSelection(result);
      const marketData = await canonicalMarketDataSnapshot(env as FamilyReadEnv, asOfDate, symbols);
      return jsonResponse({
        ...record(result),
        family_read: {
          version: FAMILY_READ_VERSION,
          read_only: true,
          identity,
          route,
          as_of_date: asOfDate,
          canonical_market_data: marketData,
          prohibited_actions: ["market-data ingestion", "research write", "strategy promotion", "order placement"],
        },
      }, 200, corsHeaders());
    }

    const result = await runFamilyQuery(env, { query, mode: "auto", as_of_date: rawAsOfDate });
    const symbols = symbolsFromQueryResult(result);
    const marketData = await canonicalMarketDataSnapshot(env as FamilyReadEnv, asOfDate, symbols);
    return jsonResponse({
      ...record(result),
      family_read: {
        version: FAMILY_READ_VERSION,
        read_only: true,
        identity,
        route,
        as_of_date: asOfDate,
        canonical_market_data: marketData,
        prohibited_actions: ["market-data ingestion", "research write", "strategy promotion", "order placement"],
      },
    }, 200, corsHeaders());
  } catch (error) {
    return jsonResponse({
      error: "family_read_failed",
      route,
      message: error instanceof Error ? error.message : String(error),
      family_read_version: FAMILY_READ_VERSION,
      read_only: true,
    }, 500, corsHeaders());
  }
}
