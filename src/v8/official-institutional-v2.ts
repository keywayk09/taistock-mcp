import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fail, ok, rec, taipeiDate, type Obj } from "../v6/common";

const USER_AGENT = "taistock-mcp/8.4 (+https://github.com/keywayk09/taistock-mcp)";
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const symbolSchema = z.string().trim().min(1).max(20).regex(/^[0-9A-Za-z._-]+$/);

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function compactDate(date: string) {
  return date.replaceAll("-", "");
}

function cleanHeader(value: unknown) {
  return String(value ?? "").trim();
}

function cleanValue(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || text === "-") return null;
  const numeric = Number(text.replace(/,/g, "").replace(/%$/, ""));
  return Number.isFinite(numeric) ? numeric : text;
}

function rowsFromTable(table: unknown): Obj[] {
  const root = rec(table);
  const fields = Array.isArray(root.fields) ? root.fields.map(cleanHeader) : [];
  const data = Array.isArray(root.data) ? root.data : [];
  return data.map((raw) => {
    const values = Array.isArray(raw) ? raw : [];
    return Object.fromEntries(fields.map((field, index) => [field, cleanValue(values[index])]));
  });
}

function rowSymbol(row: Obj) {
  const aliases = ["證券代號", "公司代號", "代號", "SecuritiesCompanyCode", "Code", "stock_id", "symbol"];
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== null) return String(row[alias]).trim();
  }
  return "";
}

async function fetchJson(url: string | URL, source: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${source} HTTP ${response.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${source} 回傳非 JSON`);
  }
}

async function fetchTwse(date: string) {
  const url = new URL("https://www.twse.com.tw/rwd/zh/fund/T86");
  url.searchParams.set("response", "json");
  url.searchParams.set("date", compactDate(date));
  url.searchParams.set("selectType", "ALLBUT0999");
  const body = await fetchJson(url, "TWSE 個股三大法人");
  return {
    rows: rec(body).stat === "OK" ? rowsFromTable(body) : [],
    stat: rec(body).stat ?? null,
    url: url.toString(),
  };
}

async function fetchTpex() {
  const url = "https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading";
  const body = await fetchJson(url, "TPEx 個股三大法人");
  const rows = Array.isArray(body) ? body.map((row) => rec(row)) : [];
  return { rows, url };
}

async function queryOfficialInstitutional(requestedDate: string, symbol?: string, fallbackDays = 10) {
  const errors: string[] = [];
  const symbolValue = symbol?.trim();

  for (let offset = 0; offset <= fallbackDays; offset++) {
    const candidate = shiftDate(requestedDate, -offset);
    try {
      const twse = await fetchTwse(candidate);
      const filtered = symbolValue ? twse.rows.filter((row) => rowSymbol(row) === symbolValue) : twse.rows;
      if (filtered.length) {
        return {
          source: "TWSE official",
          market: "TWSE",
          requested_date: requestedDate,
          resolved_date: candidate,
          fallback_days_used: offset,
          symbol: symbolValue ?? null,
          data: filtered,
          source_url: twse.url,
          partial_errors: errors,
        };
      }
      if (twse.rows.length && symbolValue) break;
      errors.push(`${candidate}: TWSE 查無符合資料`);
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    const tpex = await fetchTpex();
    const filtered = symbolValue ? tpex.rows.filter((row) => rowSymbol(row) === symbolValue) : tpex.rows;
    if (filtered.length) {
      const resolvedDate = String(filtered[0]?.Date ?? filtered[0]?.日期 ?? filtered[0]?.資料日期 ?? taipeiDate());
      return {
        source: "TPEx official",
        market: "TPEX",
        requested_date: requestedDate,
        resolved_date: resolvedDate,
        fallback_days_used: null,
        symbol: symbolValue ?? null,
        data: filtered,
        source_url: tpex.url,
        note: "TPEx OpenAPI 回傳最新官方交易日資料；若指定日期不是最新交易日，resolved_date 會與 requested_date 不同。",
        partial_errors: errors,
      };
    }
    errors.push("TPEx 查無符合資料");
  } catch (error) {
    errors.push(`TPEx: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    source: "TWSE + TPEx official",
    market: null,
    requested_date: requestedDate,
    resolved_date: null,
    symbol: symbolValue ?? null,
    data: [],
    partial_errors: errors,
    diagnosis: "官方介面無符合資料；這不等同於證券不存在，也不應把 HTTP 400 直接解讀為無資料。",
  };
}

export function registerOfficialInstitutionalV2(server: McpServer) {
  server.registerTool("get_official_stock_institutional_v2", {
    description: "官方個股三大法人修正版：上市查 TWSE、上櫃查 TPEx；自動回退最近交易日，並將 HTTP 400 與查無資料分開處理。新分析應優先使用此工具。",
    inputSchema: {
      date: dateSchema.optional().default(taipeiDate()),
      symbol: symbolSchema.optional(),
      fallback_days: z.number().int().min(0).max(15).optional().default(10),
    },
  }, async ({ date, symbol, fallback_days }) => {
    try {
      return ok(await queryOfficialInstitutional(date, symbol, fallback_days));
    } catch (error) {
      return fail(error);
    }
  });
}
