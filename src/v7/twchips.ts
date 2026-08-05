import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fail, ok, rec, taipeiDate, type Obj } from "../v6/common";

const UPSTREAM = {
  repository: "catcat222222/twchips",
  version: "0.1.0",
  commit: "f91bb03a3307665faccc1369bad628237c3a268c",
  integration: "Cloudflare Worker TypeScript port using the same official TWSE/TAIFEX endpoints",
};

const TAIFEX_BASE = "https://www.taifex.com.tw/cht/3/";
const TWSE_BASE = "https://www.twse.com.tw/rwd/zh/";
const USER_AGENT = "taistock-mcp/7.0 (+https://github.com/keywayk09/taistock-mcp)";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const symbolSchema = z.string().trim().min(1).max(20).regex(/^[0-9A-Za-z._-]+$/);
const whoSchema = z.enum(["all", "foreign", "trust", "dealer", "外資", "外資及陸資", "投信", "自營商"]);
const sessionSchema = z.enum(["all", "regular", "after_hours"]);
const sideSchema = z.enum(["all", "CALL", "PUT"]);

const TEXT_COLUMNS = new Set([
  "交易日期", "日期", "契約", "到期月份(週別)", "買賣權", "買賣權別", "交易時段",
  "身份別", "商品名稱", "是否因訊息面暫停交易", "單位名稱", "證券代號", "證券名稱",
  "代號", "名稱", "項目", "註記",
]);

const TAIFEX_WHO: Record<string, string> = {
  foreign: "外資及陸資", 外資: "外資及陸資", 外資及陸資: "外資及陸資",
  trust: "投信", 投信: "投信",
  dealer: "自營商", 自營商: "自營商",
};
const TWSE_WHO_PREFIX: Record<string, string> = {
  foreign: "外資", 外資: "外資", 外資及陸資: "外資",
  trust: "投信", 投信: "投信",
  dealer: "自營商", 自營商: "自營商",
};
const SESSION_MAP: Record<string, string> = { regular: "一般", after_hours: "盤後" };

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function slashDate(date: string) {
  return date.replace(/-/g, "/");
}

function compactDate(date: string) {
  return date.replace(/-/g, "");
}

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dedupeHeaders(headers: string[]) {
  const counts = new Map<string, number>();
  return headers.map((raw, index) => {
    const base = raw.trim() || `column_${index + 1}`;
    const next = (counts.get(base) ?? 0) + 1;
    counts.set(base, next);
    return next === 1 ? base : `${base}_${next}`;
  });
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((x) => x.some((cell) => cell.trim() !== ""));
}

function cleanValue(header: string, input: unknown): unknown {
  const value = String(input ?? "").trim();
  if (!value || value === "-") return null;
  if (TEXT_COLUMNS.has(header)) return value;
  const cleaned = value.replace(/,/g, "").replace(/%$/, "");
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) {
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return value;
}

function rowsToObjects(rawHeaders: string[], rawRows: unknown[][]): Obj[] {
  let headers = rawHeaders.map((x) => String(x ?? "").trim());
  while (headers.length && !headers.at(-1)) headers.pop();
  headers = dedupeHeaders(headers);
  return rawRows.map((raw) => {
    const row: Obj = {};
    headers.forEach((header, index) => { row[header] = cleanValue(header, raw[index]); });
    return row;
  });
}

async function postTaifexCsv(path: string, data: Record<string, string>) {
  const started = Date.now();
  const response = await fetch(`${TAIFEX_BASE}${path}`, {
    method: "POST",
    headers: {
      Accept: "text/csv,*/*",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams(data),
  });
  if (!response.ok) throw new Error(`TAIFEX ${path} HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const text = new TextDecoder("big5").decode(bytes);
  if (text.trimStart().startsWith("<")) return { columns: [] as string[], rows: [] as Obj[], latency_ms: Date.now() - started };
  const parsed = parseCsv(text);
  if (!parsed.length) return { columns: [] as string[], rows: [] as Obj[], latency_ms: Date.now() - started };
  const rows = rowsToObjects(parsed[0], parsed.slice(1));
  return { columns: Object.keys(rows[0] ?? {}), rows, latency_ms: Date.now() - started };
}

async function getTwseJson(path: string, params: Record<string, string>) {
  const started = Date.now();
  const url = new URL(`${TWSE_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  const text = await response.text();
  if (!response.ok) throw new Error(`TWSE ${path} HTTP ${response.status}: ${text.slice(0, 200)}`);
  let body: any;
  try { body = JSON.parse(text); } catch { throw new Error(`TWSE ${path} 回傳非 JSON`); }
  return { body, latency_ms: Date.now() - started };
}

function jsonTable(table: unknown): Obj[] {
  const root = rec(table);
  const fields = Array.isArray(root.fields) ? root.fields.map((x: unknown) => String(x).trim()) : [];
  const groups = Array.isArray(root.groups) ? root.groups : [];
  let headers = fields;
  if (groups.length) {
    const generated: string[] = [];
    let cursor = 0;
    for (const group of groups) {
      const g = rec(group);
      const prefix = String(g.title ?? "").trim();
      const span = Number(g.span ?? 0);
      for (let i = 0; i < span && cursor < fields.length; i++, cursor++) {
        generated.push(prefix && prefix !== "股票" ? `${prefix}${fields[cursor]}` : fields[cursor]);
      }
    }
    headers = [...generated, ...fields.slice(generated.length)];
  }
  const data = Array.isArray(root.data) ? root.data : [];
  return rowsToObjects(headers, data);
}

async function twseInstitutional(date: string) {
  const result = await getTwseJson("fund/BFI82U", { response: "json", dayDate: compactDate(date), type: "day" });
  return { rows: rec(result.body).stat === "OK" ? jsonTable(result.body) : [], latency_ms: result.latency_ms, stat: rec(result.body).stat ?? null };
}

async function twseInstitutionalStocks(date: string) {
  const result = await getTwseJson("fund/T86", { response: "json", date: compactDate(date), selectType: "ALLBUT0999" });
  return { rows: rec(result.body).stat === "OK" ? jsonTable(result.body) : [], latency_ms: result.latency_ms, stat: rec(result.body).stat ?? null };
}

async function twseMargin(date: string) {
  const result = await getTwseJson("marginTrading/MI_MARGN", { response: "json", date: compactDate(date), selectType: "ALL" });
  const tables = Array.isArray(rec(result.body).tables) ? rec(result.body).tables : [];
  return {
    market_rows: rec(result.body).stat === "OK" && tables[0] ? jsonTable(tables[0]) : [],
    stock_rows: rec(result.body).stat === "OK" && tables[1] ? jsonTable(tables[1]) : [],
    latency_ms: result.latency_ms,
    stat: rec(result.body).stat ?? null,
  };
}

async function taifexDaily(path: "futDataDown" | "optDataDown", date: string, product: string) {
  const day = slashDate(date);
  return postTaifexCsv(path, { down_type: "1", commodity_id: product, queryStartDate: day, queryEndDate: day });
}

async function taifexInstitutional(date: string) {
  const day = slashDate(date);
  return postTaifexCsv("totalTableDateDown", { queryStartDate: day, queryEndDate: day, queryDate: day });
}

async function taifexFuturesPositions(date: string) {
  const day = slashDate(date);
  return postTaifexCsv("futContractsDateDown", { queryStartDate: day, queryEndDate: day, queryDate: day });
}

async function taifexOptionsPositions(date: string) {
  const day = slashDate(date);
  return postTaifexCsv("callsAndPutsDateDown", { queryStartDate: day, queryEndDate: day, queryDate: day });
}

function filterSession(rows: Obj[], session: string) {
  if (session === "all") return rows;
  return rows.filter((row) => String(row["交易時段"] ?? "") === SESSION_MAP[session]);
}

function filterTaifexWho(rows: Obj[], who: string) {
  if (who === "all") return rows;
  const target = TAIFEX_WHO[who];
  return rows.filter((row) => String(row["身份別"] ?? "") === target);
}

function filterTwseWho(rows: Obj[], who: string) {
  if (who === "all") return rows;
  const prefix = TWSE_WHO_PREFIX[who];
  return rows.filter((row) => String(row["單位名稱"] ?? "").startsWith(prefix));
}

function filterProduct(rows: Obj[], product?: string) {
  if (!product) return rows;
  const needle = product.trim().toLowerCase();
  return rows.filter((row) => String(row["商品名稱"] ?? row["契約"] ?? "").toLowerCase().includes(needle));
}

function filterSide(rows: Obj[], side: string) {
  if (side === "all") return rows;
  return rows.filter((row) => String(row["買賣權別"] ?? row["買賣權"] ?? "").toUpperCase() === side);
}

function rowSymbol(row: Obj) {
  return String(row["證券代號"] ?? row["代號"] ?? row.stock_id ?? row.symbol ?? "").trim();
}

function numberByKey(row: Obj, exact: string[], includes: string[][] = []): number | null {
  for (const key of exact) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  for (const terms of includes) {
    const key = Object.keys(row).find((candidate) => terms.every((term) => candidate.includes(term)));
    const value = key ? row[key] : null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function marketInstitutionalSummary(rows: Obj[]) {
  const units = rows.map((row) => ({
    unit: String(row["單位名稱"] ?? row["身份別"] ?? ""),
    buy: numberByKey(row, ["買進金額"], [["買進", "金額"]]),
    sell: numberByKey(row, ["賣出金額"], [["賣出", "金額"]]),
    net: numberByKey(row, ["買賣差額"], [["買賣", "差額"], ["淨額"]]),
  }));
  const sumPrefix = (prefix: string) => units.filter((x) => x.unit.startsWith(prefix)).reduce((sum, x) => sum + (x.net ?? 0), 0);
  return {
    units,
    foreign_net: sumPrefix("外資"),
    trust_net: sumPrefix("投信"),
    dealer_net: sumPrefix("自營商"),
  };
}

function futuresPositionSummary(rows: Obj[]) {
  return rows.map((row) => ({
    identity: String(row["身份別"] ?? ""),
    product: String(row["商品名稱"] ?? row["契約"] ?? ""),
    side: String(row["買賣權別"] ?? row["買賣權"] ?? ""),
    net_trade_contracts: numberByKey(row, ["多空交易口數淨額"], [["多空", "交易", "口數", "淨額"]]),
    long_open_interest: numberByKey(row, ["多方未平倉口數"], [["多方", "未平倉", "口數"]]),
    short_open_interest: numberByKey(row, ["空方未平倉口數"], [["空方", "未平倉", "口數"]]),
    net_open_interest: numberByKey(row, ["多空未平倉口數淨額"], [["多空", "未平倉", "口數", "淨額"]]),
  }));
}

function marginSummary(rows: Obj[]) {
  return rows.map((row) => ({
    item: String(row["項目"] ?? row["名稱"] ?? ""),
    previous_balance: numberByKey(row, ["前日餘額"], [["前日", "餘額"]]),
    today_balance: numberByKey(row, ["今日餘額"], [["今日", "餘額"]]),
    buy: numberByKey(row, ["買進"], [["買進"]]),
    sell: numberByKey(row, ["賣出"], [["賣出"]]),
    cash_or_stock_repayment: numberByKey(row, ["現金(券)償還"], [["償還"]]),
  }));
}

async function resolveTradingDate(requested: string, fallbackDays: number) {
  const errors: string[] = [];
  for (let offset = 0; offset <= fallbackDays; offset++) {
    const candidate = shiftDate(requested, -offset);
    try {
      const result = await twseInstitutional(candidate);
      if (result.rows.length) return { date: candidate, institutional: result, errors };
      errors.push(`${candidate}: 證交所查無資料`);
    } catch (error) {
      errors.push(`${candidate}: ${errorText(error)}`);
    }
  }
  throw new Error(`最近${fallbackDays + 1}個日曆日找不到證交所資料`);
}

export function registerTwchipsTools(server: McpServer, _env: Env) {
  server.registerTool("get_official_market_institutional", {
    description: "證交所官方指定日期三大法人整體市場買賣金額；功能對齊 twchips.twse.institutional。",
    inputSchema: { date: dateSchema.optional().default(taipeiDate()), who: whoSchema.optional().default("all") },
  }, async ({ date, who }) => {
    try {
      const result = await twseInstitutional(date);
      const rows = filterTwseWho(result.rows, who);
      return ok({ source: "TWSE official", upstream: UPSTREAM, date, who, summary: marketInstitutionalSummary(rows), data: rows, latency_ms: result.latency_ms, stat: result.stat });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_official_stock_institutional", {
    description: "證交所官方指定日期全市場個股三大法人買賣超，可篩選單一股票；功能對齊 twchips.twse.institutional_stocks。",
    inputSchema: { date: dateSchema.optional().default(taipeiDate()), symbol: symbolSchema.optional() },
  }, async ({ date, symbol }) => {
    try {
      const result = await twseInstitutionalStocks(date);
      const rows = symbol ? result.rows.filter((row) => rowSymbol(row) === symbol) : result.rows;
      return ok({ source: "TWSE official", upstream: UPSTREAM, date, symbol: symbol ?? null, data: rows, latency_ms: result.latency_ms, stat: result.stat });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_official_market_margin", {
    description: "證交所官方指定日期整體市場融資融券統計；功能對齊 twchips.twse.margin。",
    inputSchema: { date: dateSchema.optional().default(taipeiDate()) },
  }, async ({ date }) => {
    try {
      const result = await twseMargin(date);
      return ok({ source: "TWSE official", upstream: UPSTREAM, date, summary: marginSummary(result.market_rows), data: result.market_rows, latency_ms: result.latency_ms, stat: result.stat });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_official_stock_margin", {
    description: "證交所官方指定日期全市場個股融資融券餘額，可篩選單一股票；功能對齊 twchips.twse.margin_stocks。",
    inputSchema: { date: dateSchema.optional().default(taipeiDate()), symbol: symbolSchema.optional() },
  }, async ({ date, symbol }) => {
    try {
      const result = await twseMargin(date);
      const rows = symbol ? result.stock_rows.filter((row) => rowSymbol(row) === symbol) : result.stock_rows;
      return ok({ source: "TWSE official", upstream: UPSTREAM, date, symbol: symbol ?? null, data: rows, latency_ms: result.latency_ms, stat: result.stat });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_taifex_futures_daily", {
    description: "期交所指定日期期貨日行情，支援商品代號及一般盤/盤後盤篩選；功能對齊 twchips.taifex.futures_daily。",
    inputSchema: { date: dateSchema.optional().default(taipeiDate()), product: z.string().trim().min(1).max(20).optional().default("TX"), session: sessionSchema.optional().default("all") },
  }, async ({ date, product, session }) => {
    try {
      const result = await taifexDaily("futDataDown", date, product);
      return ok({ source: "TAIFEX official", upstream: UPSTREAM, date, product, session, data: filterSession(result.rows, session), columns: result.columns, latency_ms: result.latency_ms });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_taifex_options_daily", {
    description: "期交所指定日期選擇權完整日行情鏈，支援商品代號及一般盤/盤後盤篩選；功能對齊 twchips.taifex.options_daily。",
    inputSchema: { date: dateSchema.optional().default(taipeiDate()), product: z.string().trim().min(1).max(20).optional().default("TXO"), session: sessionSchema.optional().default("all"), limit: z.number().int().min(1).max(5000).optional().default(2000) },
  }, async ({ date, product, session, limit }) => {
    try {
      const result = await taifexDaily("optDataDown", date, product);
      const rows = filterSession(result.rows, session);
      return ok({ source: "TAIFEX official", upstream: UPSTREAM, date, product, session, total_rows: rows.length, truncated: rows.length > limit, data: rows.slice(0, limit), columns: result.columns, latency_ms: result.latency_ms });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_taifex_institutional_general", {
    description: "期交所指定日期三大法人期貨與選擇權總表，可依法人篩選；功能對齊 twchips.taifex.institutional。",
    inputSchema: { date: dateSchema.optional().default(taipeiDate()), who: whoSchema.optional().default("all") },
  }, async ({ date, who }) => {
    try {
      const result = await taifexInstitutional(date);
      const rows = filterTaifexWho(result.rows, who);
      return ok({ source: "TAIFEX official", upstream: UPSTREAM, date, who, data: rows, columns: result.columns, latency_ms: result.latency_ms });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_taifex_futures_positions", {
    description: "期交所指定日期三大法人各期貨商品交易及未平倉，可依法人與商品名稱篩選；功能對齊 twchips.taifex.institutional_futures。",
    inputSchema: { date: dateSchema.optional().default(taipeiDate()), who: whoSchema.optional().default("all"), product: z.string().trim().max(50).optional() },
  }, async ({ date, who, product }) => {
    try {
      const result = await taifexFuturesPositions(date);
      const rows = filterProduct(filterTaifexWho(result.rows, who), product);
      return ok({ source: "TAIFEX official", upstream: UPSTREAM, date, who, product: product ?? null, summary: futuresPositionSummary(rows), data: rows, columns: result.columns, latency_ms: result.latency_ms });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_taifex_options_positions", {
    description: "期交所指定日期三大法人選擇權CALL/PUT交易及未平倉，可依法人、商品與買賣權篩選；功能對齊 twchips.taifex.institutional_options。",
    inputSchema: { date: dateSchema.optional().default(taipeiDate()), who: whoSchema.optional().default("all"), product: z.string().trim().max(50).optional(), side: sideSchema.optional().default("all") },
  }, async ({ date, who, product, side }) => {
    try {
      const result = await taifexOptionsPositions(date);
      const rows = filterSide(filterProduct(filterTaifexWho(result.rows, who), product), side);
      return ok({ source: "TAIFEX official", upstream: UPSTREAM, date, who, product: product ?? null, side, summary: futuresPositionSummary(rows), data: rows, columns: result.columns, latency_ms: result.latency_ms });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_daily_chip_report", {
    description: "產生台股盤後籌碼日報資料包：現貨三大法人、融資融券、台指期行情、法人期貨與選擇權部位，並可加入自選股官方籌碼。",
    inputSchema: {
      date: dateSchema.optional().default(taipeiDate()),
      fallback_days: z.number().int().min(0).max(10).optional().default(7),
      watchlist: z.array(symbolSchema).max(30).optional().default([]),
      include_raw: z.boolean().optional().default(false),
    },
  }, async ({ date, fallback_days, watchlist, include_raw }) => {
    try {
      const resolved = await resolveTradingDate(date, fallback_days);
      const day = resolved.date;
      const uniqueWatchlist = [...new Set(watchlist as string[])];
      const settled = await Promise.allSettled([
        Promise.resolve(resolved.institutional),
        twseMargin(day),
        uniqueWatchlist.length ? twseInstitutionalStocks(day) : Promise.resolve({ rows: [], latency_ms: 0, stat: null }),
        taifexDaily("futDataDown", day, "TX"),
        taifexInstitutional(day),
        taifexFuturesPositions(day),
        taifexOptionsPositions(day),
      ]);
      const errors = [...resolved.errors];
      settled.forEach((result) => { if (result.status === "rejected") errors.push(errorText(result.reason)); });
      const cash = settled[0].status === "fulfilled" ? settled[0].value : { rows: [], latency_ms: 0, stat: null };
      const margin = settled[1].status === "fulfilled" ? settled[1].value : { market_rows: [], stock_rows: [], latency_ms: 0, stat: null };
      const stockInstitutional = settled[2].status === "fulfilled" ? settled[2].value : { rows: [], latency_ms: 0, stat: null };
      const txDaily = settled[3].status === "fulfilled" ? settled[3].value : { rows: [], columns: [], latency_ms: 0 };
      const futuresGeneral = settled[4].status === "fulfilled" ? settled[4].value : { rows: [], columns: [], latency_ms: 0 };
      const futuresPositions = settled[5].status === "fulfilled" ? settled[5].value : { rows: [], columns: [], latency_ms: 0 };
      const optionsPositions = settled[6].status === "fulfilled" ? settled[6].value : { rows: [], columns: [], latency_ms: 0 };
      const watchlistRows = uniqueWatchlist.map((symbol) => ({
        symbol,
        institutional: stockInstitutional.rows.filter((row: Obj) => rowSymbol(row) === symbol),
        margin: margin.stock_rows.filter((row: Obj) => rowSymbol(row) === symbol),
      }));
      const foreignTx = filterProduct(filterTaifexWho(futuresPositions.rows, "foreign"), "臺股期貨");
      const report: Obj = {
        source: "TWSE + TAIFEX official",
        upstream_reference: UPSTREAM,
        requested_date: date,
        trading_date: day,
        generated_at: new Date().toISOString(),
        data_policy: "盤中策略應只使用前一交易日以前已公布資料，避免 lookahead。",
        cash_market: {
          institutional: marketInstitutionalSummary(cash.rows),
          margin: marginSummary(margin.market_rows),
        },
        derivatives: {
          tx_daily: txDaily.rows,
          institutional_general: futuresGeneral.rows,
          foreign_tx_summary: futuresPositionSummary(foreignTx),
          futures_positions_summary: futuresPositionSummary(futuresPositions.rows),
          options_positions_summary: futuresPositionSummary(optionsPositions.rows),
        },
        watchlist: watchlistRows,
        partial_errors: errors,
      };
      if (include_raw) report.raw = {
        cash_institutional: cash.rows,
        market_margin: margin.market_rows,
        stock_margin: margin.stock_rows,
        stock_institutional: stockInstitutional.rows,
        futures_positions: futuresPositions.rows,
        options_positions: optionsPositions.rows,
      };
      return ok(report);
    } catch (error) { return fail(error); }
  });
}
