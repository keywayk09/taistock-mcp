import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  dateSchema,
  fail,
  finmind,
  num,
  ok,
  rec,
  round,
  stockSchema,
  taipeiDate,
  type Obj,
} from "../v6/common";

const SITCA_ACTIVE_ETF_URL = "https://www.sitca.org.tw/ROC/SITCA_ETF/etf_statement.aspx";
const ACTIVE_ETF_DATASETS = {
  info: "TaiwanStockActiveETFInfo",
  holdings: "TaiwanStockActiveETFHolding",
  changes: "TaiwanStockActiveETFHoldingChange",
} as const;

const assetTypeSchema = z.enum(["all", "stock", "bond", "futures", "option", "cash", "etf", "repo", "other"]);
const sourceFormatSchema = z.enum(["auto", "json", "csv", "html"]);
const requestMethodSchema = z.enum(["GET", "POST"]);

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function cleanNumber(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || text === "-" || text === "--") return 0;
  const parsed = Number(text.replace(/,/g, "").replace(/%$/, "").replace(/[()]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[\s_()（）%％:：/\\.-]/g, "");
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripHtml(value: string) {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const clean = rows.filter((values) => values.some((value) => value.trim()));
  if (!clean.length) return [] as Obj[];
  const headers = clean[0].map((value, index) => value.trim() || `column_${index + 1}`);
  return clean.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])) as Obj);
}

function parseHtmlTables(text: string) {
  const output: Obj[] = [];
  for (const tableMatch of text.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rawRows = [...tableMatch[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
      [...row[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map((cell) => stripHtml(cell[1])));
    const rows = rawRows.filter((values) => values.some(Boolean));
    if (rows.length < 2) continue;
    const headers = rows[0].map((value, index) => value || `column_${index + 1}`);
    for (const values of rows.slice(1)) {
      output.push(Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])) as Obj);
    }
  }
  return output;
}

function objectArrays(value: unknown, depth = 0): Obj[][] {
  if (depth > 8) return [];
  if (Array.isArray(value)) {
    const objects = value.filter((item) => item && typeof item === "object" && !Array.isArray(item)).map((item) => rec(item));
    const nested = value.flatMap((item) => objectArrays(item, depth + 1));
    return objects.length ? [objects, ...nested] : nested;
  }
  if (value && typeof value === "object") return Object.values(rec(value)).flatMap((item) => objectArrays(item, depth + 1));
  return [];
}

function parseJsonRows(text: string) {
  const parsed = JSON.parse(text);
  const arrays = objectArrays(parsed);
  return arrays.sort((a, b) => b.length - a.length)[0] ?? [];
}

function valueByAliases(row: Obj, aliases: string[]) {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const target = normalizeKey(alias);
    const key = keys.find((candidate) => normalizeKey(candidate) === target);
    if (key) return { key, value: row[key] };
  }
  for (const alias of aliases) {
    const target = normalizeKey(alias);
    const key = keys.find((candidate) => normalizeKey(candidate).includes(target));
    if (key) return { key, value: row[key] };
  }
  return { key: "", value: null };
}

function inferAssetType(componentId: string, componentName: string, raw: unknown) {
  const value = String(raw ?? "").toLowerCase();
  if (value.includes("bond") || value.includes("債")) return "bond";
  if (value.includes("future") || value.includes("期貨")) return "futures";
  if (value.includes("option") || value.includes("選擇權")) return "option";
  if (value.includes("cash") || value.includes("現金")) return "cash";
  if (value.includes("repo") || value.includes("附買回")) return "repo";
  if (value.includes("etf")) return "etf";
  if (/^[0-9A-Za-z.\-]{2,20}$/.test(componentId) || componentName) return "stock";
  return "other";
}

function normalizeOfficialRows(rawRows: Obj[], etfId: string, requestedDate: string) {
  const output = rawRows.map((row) => {
    const date = valueByAliases(row, ["date", "資料日期", "日期", "投資組合日期", "基準日"]);
    const id = valueByAliases(row, ["component_stock_id", "component_id", "stock_id", "symbol", "ticker", "code", "證券代號", "股票代號", "成分股代號", "標的代號"]);
    const name = valueByAliases(row, ["component_stock_name", "component_name", "stock_name", "name", "證券名稱", "股票名稱", "成分股名稱", "標的名稱"]);
    const shares = valueByAliases(row, ["shares", "quantity", "holding_shares", "持有股數", "持股股數", "持股數", "股數", "數量", "張數"]);
    const weight = valueByAliases(row, ["weight_percent", "weight", "ratio", "holding_ratio", "持股比例", "投資比例", "權重", "比重", "占淨資產比例"]);
    const marketValue = valueByAliases(row, ["market_value", "marketvalue", "市值", "投資金額", "評價金額"]);
    const asset = valueByAliases(row, ["asset_type", "assettype", "資產類型", "資產別", "類別"]);
    const currency = valueByAliases(row, ["currency", "幣別"]);
    const componentId = String(id.value ?? "").trim();
    const componentName = String(name.value ?? "").trim();
    let shareValue = cleanNumber(shares.value);
    if (normalizeKey(shares.key).includes("張數")) shareValue *= 1000;
    return {
      date: String(date.value ?? requestedDate).trim().replace(/\//g, "-") || requestedDate,
      etf_id: etfId,
      component_id: componentId,
      component_name: componentName,
      asset_type: inferAssetType(componentId, componentName, asset.value),
      shares: shareValue,
      weight_percent: cleanNumber(weight.value),
      market_value: cleanNumber(marketValue.value),
      currency: String(currency.value ?? "").trim(),
    };
  }).filter((row) => row.component_id || row.component_name);
  const dateCounts = new Map<string, number>();
  output.forEach((row) => dateCounts.set(row.date, (dateCounts.get(row.date) ?? 0) + 1));
  const bestDate = [...dateCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? requestedDate;
  return output.map((row) => ({ ...row, date: row.date || bestDate }));
}

type Holding = ReturnType<typeof normalizeOfficialRows>[number];
type HoldingChange = {
  date: string;
  etf_id: string;
  component_id: string;
  component_name: string;
  buy_shares: number;
  sell_shares: number;
  net_change_shares: number;
};

type OfficialSource = {
  etf_id: string;
  issuer: string;
  source_url: string;
  source_format: "auto" | "json" | "csv" | "html";
  request_method: "GET" | "POST";
  request_body_template: string | null;
  enabled: number;
  updated_at: string;
};

function dateList(rows: Holding[]) {
  return [...new Set(rows.map((row) => row.date))].filter(Boolean).sort();
}

function filterAsset(rows: Holding[], assetType: string) {
  return assetType === "all" ? rows : rows.filter((row) => row.asset_type === assetType);
}

function snapshotMap(rows: Holding[], date: string, assetType: string) {
  return new Map(filterAsset(rows.filter((row) => row.date === date), assetType)
    .map((row) => [row.component_id || row.component_name, row] as const));
}

function compareSnapshots(rows: Holding[], changes: HoldingChange[], currentDate: string, previousDate: string, assetType: string) {
  const current = snapshotMap(rows, currentDate, assetType);
  const previous = snapshotMap(rows, previousDate, assetType);
  const direct = new Map(changes.filter((row) => row.date === currentDate).map((row) => [row.component_id || row.component_name, row] as const));
  const keys = [...new Set([...current.keys(), ...previous.keys(), ...direct.keys()])];
  return keys.map((key) => {
    const now = current.get(key) ?? null;
    const before = previous.get(key) ?? null;
    const change = direct.get(key) ?? null;
    const shareDelta = (now?.shares ?? 0) - (before?.shares ?? 0);
    const weightDelta = now && before ? round(now.weight_percent - before.weight_percent, 4) : null;
    const status = !before && now ? "added"
      : before && !now ? "removed"
      : shareDelta > 0 || (weightDelta ?? 0) > 0 ? "increased"
      : shareDelta < 0 || (weightDelta ?? 0) < 0 ? "decreased"
      : "unchanged";
    return {
      component_id: now?.component_id ?? before?.component_id ?? change?.component_id ?? "",
      component_name: now?.component_name ?? before?.component_name ?? change?.component_name ?? "",
      asset_type: now?.asset_type ?? before?.asset_type ?? "unknown",
      status,
      previous_shares: before?.shares ?? 0,
      current_shares: now?.shares ?? 0,
      share_delta: shareDelta,
      previous_weight_percent: before?.weight_percent ?? 0,
      current_weight_percent: now?.weight_percent ?? 0,
      weight_change_percentage_points: weightDelta,
      reported_buy_shares: change?.buy_shares ?? 0,
      reported_sell_shares: change?.sell_shares ?? 0,
      currency: now?.currency ?? before?.currency ?? "",
    };
  }).filter((row) => row.status !== "unchanged");
}

function statusSummary(rows: ReturnType<typeof compareSnapshots>) {
  const count = (status: string) => rows.filter((row) => row.status === status).length;
  return {
    added: count("added"),
    removed: count("removed"),
    increased: count("increased"),
    decreased: count("decreased"),
  };
}

function sourceNote(source: "official" | "finmind" | "mixed" = "official") {
  return {
    source,
    source_priority: ["投信官方網站每日投資組合", "D1官方快照快取", "FinMind選用備援"],
    core_requires_finmind_sponsor: false,
    official_disclosure_reference: SITCA_ACTIVE_ETF_URL,
    caution: "新增與剔除以相鄰完整持股快照判定；申購或贖回可能造成股數等比例變動，加碼減碼需同看權重。",
  };
}

async function ensureTables(env: Env) {
  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS etf_official_sources (
      etf_id TEXT PRIMARY KEY,
      issuer TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL,
      source_format TEXT NOT NULL DEFAULT 'auto',
      request_method TEXT NOT NULL DEFAULT 'GET',
      request_body_template TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS etf_holding_snapshots (
      etf_id TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      component_id TEXT NOT NULL DEFAULT '',
      component_name TEXT NOT NULL DEFAULT '',
      asset_type TEXT NOT NULL DEFAULT 'other',
      shares REAL NOT NULL DEFAULT 0,
      weight_percent REAL NOT NULL DEFAULT 0,
      market_value REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (etf_id, snapshot_date, component_id, component_name)
    );
    CREATE INDEX IF NOT EXISTS idx_etf_holding_date ON etf_holding_snapshots(etf_id, snapshot_date);
    CREATE INDEX IF NOT EXISTS idx_etf_component ON etf_holding_snapshots(component_id, snapshot_date);
  `);
}

async function listSources(env: Env, enabledOnly = false) {
  await ensureTables(env);
  const statement = enabledOnly
    ? env.DB.prepare("SELECT * FROM etf_official_sources WHERE enabled = 1 ORDER BY etf_id")
    : env.DB.prepare("SELECT * FROM etf_official_sources ORDER BY etf_id");
  const result = await statement.all<OfficialSource>();
  return result.results ?? [];
}

async function sourceFor(env: Env, etfId: string) {
  await ensureTables(env);
  return await env.DB.prepare("SELECT * FROM etf_official_sources WHERE etf_id = ? AND enabled = 1")
    .bind(etfId).first<OfficialSource>();
}

function renderTemplate(template: string, etfId: string, date: string) {
  return template
    .replaceAll("{etf_id}", etfId)
    .replaceAll("{date}", date)
    .replaceAll("{compact_date}", date.replaceAll("-", ""))
    .replaceAll("{slash_date}", date.replaceAll("-", "/"));
}

async function fetchOfficialRows(source: OfficialSource, date: string) {
  const url = renderTemplate(source.source_url, source.etf_id, date);
  const body = source.request_body_template ? renderTemplate(source.request_body_template, source.etf_id, date) : undefined;
  const response = await fetch(url, {
    method: source.request_method,
    headers: {
      Accept: "application/json,text/csv,text/html,*/*",
      "Content-Type": source.request_method === "POST" ? "application/x-www-form-urlencoded;charset=UTF-8" : "text/plain",
      "User-Agent": "taistock-mcp/7.1",
    },
    body: source.request_method === "POST" ? body : undefined,
  });
  if (!response.ok) throw new Error(`官方ETF來源 HTTP ${response.status}: ${url}`);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("spreadsheet") || contentType.includes("excel") || /\.xlsx?(?:\?|$)/i.test(url)) {
    throw new Error("此官方來源為 Excel；請改填同站的 CSV、JSON 或 HTML 持股網址");
  }
  const text = await response.text();
  const format = source.source_format === "auto"
    ? contentType.includes("json") || text.trimStart().startsWith("{") || text.trimStart().startsWith("[") ? "json"
      : contentType.includes("csv") || /\.csv(?:\?|$)/i.test(url) ? "csv"
      : "html"
    : source.source_format;
  const rawRows = format === "json" ? parseJsonRows(text) : format === "csv" ? parseCsv(text) : parseHtmlTables(text);
  const rows = normalizeOfficialRows(rawRows, source.etf_id, date);
  if (!rows.length) throw new Error(`官方ETF來源解析不到持股列：${url}`);
  return { url, format, rows };
}

async function saveSnapshot(env: Env, rows: Holding[], sourceUrl: string) {
  await ensureTables(env);
  const fetchedAt = new Date().toISOString();
  const dates = dateList(rows);
  for (const date of dates) {
    await env.DB.prepare("DELETE FROM etf_holding_snapshots WHERE etf_id = ? AND snapshot_date = ?")
      .bind(rows[0]?.etf_id ?? "", date).run();
  }
  for (const row of rows) {
    await env.DB.prepare(`INSERT OR REPLACE INTO etf_holding_snapshots
      (etf_id, snapshot_date, component_id, component_name, asset_type, shares, weight_percent, market_value, currency, source_url, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(row.etf_id, row.date, row.component_id, row.component_name, row.asset_type, row.shares, row.weight_percent, row.market_value, row.currency, sourceUrl, fetchedAt)
      .run();
  }
  return { dates, inserted: rows.length, fetched_at: fetchedAt };
}

function dbHolding(row: Obj): Holding {
  return {
    date: String(row.snapshot_date ?? ""),
    etf_id: String(row.etf_id ?? ""),
    component_id: String(row.component_id ?? ""),
    component_name: String(row.component_name ?? ""),
    asset_type: String(row.asset_type ?? "other"),
    shares: num(row.shares),
    weight_percent: num(row.weight_percent),
    market_value: num(row.market_value),
    currency: String(row.currency ?? ""),
  };
}

async function cachedHoldings(env: Env, etfId: string, startDate: string, endDate: string) {
  await ensureTables(env);
  const result = await env.DB.prepare(`SELECT * FROM etf_holding_snapshots
    WHERE etf_id = ? AND snapshot_date BETWEEN ? AND ? ORDER BY snapshot_date, weight_percent DESC`)
    .bind(etfId, startDate, endDate).all<Obj>();
  return (result.results ?? []).map(dbHolding);
}

async function allCachedHoldings(env: Env, startDate: string, endDate: string) {
  await ensureTables(env);
  const result = await env.DB.prepare(`SELECT * FROM etf_holding_snapshots
    WHERE snapshot_date BETWEEN ? AND ? ORDER BY etf_id, snapshot_date, weight_percent DESC`)
    .bind(startDate, endDate).all<Obj>();
  return (result.results ?? []).map(dbHolding);
}

function finmindHolding(row: unknown): Holding {
  const value = rec(row);
  return {
    date: String(value.date ?? ""),
    etf_id: String(value.stock_id ?? ""),
    component_id: String(value.component_stock_id ?? ""),
    component_name: String(value.component_stock_name ?? ""),
    asset_type: String(value.asset_type ?? "other"),
    shares: num(value.shares),
    weight_percent: num(value.weight),
    market_value: num(value.market_value),
    currency: String(value.currency ?? ""),
  };
}

function finmindChange(row: unknown): HoldingChange {
  const value = rec(row);
  const buy = num(value.buy), sell = num(value.sell);
  return {
    date: String(value.date ?? ""),
    etf_id: String(value.stock_id ?? ""),
    component_id: String(value.component_stock_id ?? ""),
    component_name: String(value.component_stock_name ?? ""),
    buy_shares: buy,
    sell_shares: sell,
    net_change_shares: buy - sell,
  };
}

async function refreshOne(env: Env, etfId: string, date: string, override?: Partial<OfficialSource>) {
  const saved = await sourceFor(env, etfId);
  const source: OfficialSource = {
    etf_id: etfId,
    issuer: override?.issuer ?? saved?.issuer ?? "",
    source_url: override?.source_url ?? saved?.source_url ?? "",
    source_format: override?.source_format ?? saved?.source_format ?? "auto",
    request_method: override?.request_method ?? saved?.request_method ?? "GET",
    request_body_template: override?.request_body_template ?? saved?.request_body_template ?? null,
    enabled: 1,
    updated_at: saved?.updated_at ?? new Date().toISOString(),
  };
  if (!source.source_url) throw new Error(`${etfId} 尚未設定投信官方持股網址`);
  const fetched = await fetchOfficialRows(source, date);
  const savedResult = await saveSnapshot(env, fetched.rows, fetched.url);
  return { source, ...fetched, ...savedResult };
}

async function officialActiveList() {
  const response = await fetch(SITCA_ACTIVE_ETF_URL, { headers: { Accept: "text/html", "User-Agent": "taistock-mcp/7.1" } });
  if (!response.ok) throw new Error(`SITCA ETF清單 HTTP ${response.status}`);
  const html = await response.text();
  const text = stripHtml(html);
  const rows: { etf_id: string; etf_name: string }[] = [];
  for (const match of text.matchAll(/\b(\d{5}[AD])\s+(主動[^0-9]{2,40}?)(?=\s+\d{5}[AD]\b|$)/g)) {
    rows.push({ etf_id: match[1], etf_name: match[2].trim() });
  }
  const unique = [...new Map(rows.map((row) => [row.etf_id, row])).values()];
  if (!unique.length) throw new Error("SITCA頁面未解析到主動式ETF代號");
  return unique;
}

async function finmindActiveList(env: Env) {
  return (await finmind(env, ACTIVE_ETF_DATASETS.info, {})).map((row) => {
    const value = rec(row);
    return {
      date: String(value.date ?? ""),
      etf_id: String(value.stock_id ?? ""),
      etf_name: String(value.stock_name ?? ""),
      category: String(value.category ?? ""),
      market: String(value.type ?? ""),
    };
  });
}

export function registerEtfTools(server: McpServer, env: Env) {
  server.registerTool("get_active_etf_list", {
    description: "取得主動式ETF清單；優先使用投信投顧公會公開頁，FinMind公開清單僅作備援。",
    inputSchema: {
      category: z.enum(["all", "domestic", "foreign"]).optional().default("all"),
      market: z.enum(["all", "twse", "tpex"]).optional().default("all"),
    },
  }, async ({ category, market }) => {
    try {
      const sources = new Map((await listSources(env)).map((row) => [row.etf_id, row]));
      try {
        const rows = (await officialActiveList()).map((row) => ({ ...row, official_source_configured: sources.has(row.etf_id) }));
        return ok({ ...sourceNote("official"), count: rows.length, data: rows });
      } catch (officialError) {
        const rows = (await finmindActiveList(env))
          .filter((row) => (category === "all" || row.category === category) && (market === "all" || row.market === market))
          .map((row) => ({ ...row, official_source_configured: sources.has(row.etf_id) }));
        return ok({ ...sourceNote("finmind"), fallback_reason: errorText(officialError), count: rows.length, data: rows });
      }
    } catch (error) { return fail(error); }
  });

  server.registerTool("set_active_etf_official_source", {
    description: "設定單一ETF的投信官方每日持股網址；支援CSV、JSON、HTML表格與日期/代號網址模板。",
    inputSchema: {
      etf_id: stockSchema,
      issuer: z.string().trim().max(100).optional().default(""),
      source_url: z.string().url(),
      source_format: sourceFormatSchema.optional().default("auto"),
      request_method: requestMethodSchema.optional().default("GET"),
      request_body_template: z.string().max(4000).optional(),
      enabled: z.boolean().optional().default(true),
    },
  }, async ({ etf_id, issuer, source_url, source_format, request_method, request_body_template, enabled }) => {
    try {
      await ensureTables(env);
      const updatedAt = new Date().toISOString();
      await env.DB.prepare(`INSERT OR REPLACE INTO etf_official_sources
        (etf_id, issuer, source_url, source_format, request_method, request_body_template, enabled, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(etf_id, issuer, source_url, source_format, request_method, request_body_template ?? null, enabled ? 1 : 0, updatedAt).run();
      return ok({ ...sourceNote("official"), etf_id, issuer, source_url, source_format, request_method, enabled, updated_at: updatedAt });
    } catch (error) { return fail(error); }
  });

  server.registerTool("list_active_etf_official_sources", {
    description: "列出已設定的投信官方ETF持股來源與啟用狀態。",
    inputSchema: { enabled_only: z.boolean().optional().default(false) },
  }, async ({ enabled_only }) => {
    try {
      const rows = await listSources(env, enabled_only);
      return ok({ ...sourceNote("official"), count: rows.length, data: rows });
    } catch (error) { return fail(error); }
  });

  server.registerTool("refresh_active_etf_official_holdings", {
    description: "從已設定的投信官方網址下載ETF持股並存入D1每日快照；不需要FinMind sponsor。",
    inputSchema: {
      etf_id: stockSchema,
      date: dateSchema.optional().default(taipeiDate()),
      source_url: z.string().url().optional(),
      source_format: sourceFormatSchema.optional(),
      request_method: requestMethodSchema.optional(),
      request_body_template: z.string().max(4000).optional(),
    },
  }, async ({ etf_id, date, source_url, source_format, request_method, request_body_template }) => {
    try {
      const result = await refreshOne(env, etf_id, date, { source_url, source_format, request_method, request_body_template });
      return ok({ ...sourceNote("official"), etf_id, requested_date: date, resolved_dates: result.dates, rows: result.inserted, source_url: result.url, format: result.format, fetched_at: result.fetched_at });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_active_etf_holdings", {
    description: "查詢主動式ETF持股；投信官方D1快照優先，可選擇即時更新，FinMind sponsor資料僅為明確開啟的備援。",
    inputSchema: {
      etf_id: stockSchema,
      start_date: dateSchema.optional(),
      end_date: dateSchema.optional(),
      asset_type: assetTypeSchema.optional().default("stock"),
      latest_only: z.boolean().optional().default(true),
      refresh_official: z.boolean().optional().default(false),
      allow_finmind_fallback: z.boolean().optional().default(false),
      top_n: z.number().int().min(1).max(1000).optional().default(200),
    },
  }, async ({ etf_id, start_date, end_date, asset_type, latest_only, refresh_official, allow_finmind_fallback, top_n }) => {
    try {
      const end = end_date ?? taipeiDate();
      const start = start_date ?? shiftDate(end, -60);
      const errors: string[] = [];
      if (refresh_official) {
        try { await refreshOne(env, etf_id, end); } catch (error) { errors.push(errorText(error)); }
      }
      let rows = await cachedHoldings(env, etf_id, start, end);
      let source: "official" | "finmind" = "official";
      if (!rows.length && allow_finmind_fallback) {
        rows = (await finmind(env, ACTIVE_ETF_DATASETS.holdings, { data_id: etf_id, start_date: start, end_date: end })).map(finmindHolding);
        source = "finmind";
      }
      if (!rows.length) throw new Error(`${etf_id} 尚無官方持股快照；請先設定官方來源並執行 refresh_active_etf_official_holdings`);
      const dates = dateList(rows);
      const latestDate = dates.at(-1) ?? null;
      let selected = filterAsset(rows, asset_type);
      if (latest_only && latestDate) selected = selected.filter((row) => row.date === latestDate);
      selected.sort((a, b) => b.weight_percent - a.weight_percent || Math.abs(b.market_value) - Math.abs(a.market_value));
      return ok({
        ...sourceNote(source), etf_id, requested_range: { start_date: start, end_date: end }, latest_available_date: latestDate,
        asset_type, total_rows: selected.length, data: selected.slice(0, top_n), truncated: selected.length > top_n, partial_errors: errors,
      });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_active_etf_holding_changes", {
    description: "比較主動式ETF最近兩個完整官方持股快照，辨識新增、剔除、加碼與減碼；FinMind僅選用備援。",
    inputSchema: {
      etf_id: stockSchema,
      date: dateSchema.optional().default(taipeiDate()),
      lookback_days: z.number().int().min(3).max(120).optional().default(30),
      asset_type: assetTypeSchema.optional().default("stock"),
      include_increased_decreased: z.boolean().optional().default(true),
      refresh_official: z.boolean().optional().default(false),
      allow_finmind_fallback: z.boolean().optional().default(false),
      top_n: z.number().int().min(1).max(1000).optional().default(300),
    },
  }, async ({ etf_id, date, lookback_days, asset_type, include_increased_decreased, refresh_official, allow_finmind_fallback, top_n }) => {
    try {
      const start = shiftDate(date, -lookback_days);
      const errors: string[] = [];
      if (refresh_official) {
        try { await refreshOne(env, etf_id, date); } catch (error) { errors.push(errorText(error)); }
      }
      let rows = await cachedHoldings(env, etf_id, start, date);
      let changes: HoldingChange[] = [];
      let source: "official" | "finmind" = "official";
      if (dateList(rows).length < 2 && allow_finmind_fallback) {
        const [holdingRows, changeRows] = await Promise.all([
          finmind(env, ACTIVE_ETF_DATASETS.holdings, { data_id: etf_id, start_date: start, end_date: date }),
          finmind(env, ACTIVE_ETF_DATASETS.changes, { data_id: etf_id, start_date: start, end_date: date }),
        ]);
        rows = holdingRows.map(finmindHolding);
        changes = changeRows.map(finmindChange);
        source = "finmind";
      }
      const dates = dateList(rows);
      const currentDate = dates.at(-1) ?? null;
      const previousDate = dates.at(-2) ?? null;
      if (!currentDate || !previousDate) throw new Error(`${etf_id} 不足兩個完整持股快照，無法判定新增或剔除`);
      let compared = compareSnapshots(rows, changes, currentDate, previousDate, asset_type);
      if (!include_increased_decreased) compared = compared.filter((row) => row.status === "added" || row.status === "removed");
      compared.sort((a, b) => {
        const priority: Record<string, number> = { added: 0, removed: 1, increased: 2, decreased: 3 };
        return (priority[a.status] ?? 9) - (priority[b.status] ?? 9)
          || Math.abs(b.weight_change_percentage_points ?? 0) - Math.abs(a.weight_change_percentage_points ?? 0)
          || Math.abs(b.share_delta) - Math.abs(a.share_delta);
      });
      return ok({
        ...sourceNote(source), etf_id, requested_date: date, current_date: currentDate, previous_date: previousDate,
        asset_type, summary: statusSummary(compared), total_changes: compared.length,
        data: compared.slice(0, top_n), truncated: compared.length > top_n, partial_errors: errors,
      });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_stock_active_etf_activity", {
    description: "從官方快照反查某檔股票被哪些主動式ETF新增、剔除、加碼或減碼。",
    inputSchema: {
      symbol: stockSchema,
      date: dateSchema.optional().default(taipeiDate()),
      lookback_days: z.number().int().min(3).max(120).optional().default(30),
    },
  }, async ({ symbol, date, lookback_days }) => {
    try {
      const rows = await allCachedHoldings(env, shiftDate(date, -lookback_days), date);
      const grouped = new Map<string, Holding[]>();
      rows.forEach((row) => grouped.set(row.etf_id, [...(grouped.get(row.etf_id) ?? []), row]));
      const activity = [...grouped.entries()].flatMap(([etfId, etfRows]) => {
        const dates = dateList(etfRows);
        const currentDate = dates.at(-1);
        const previousDate = dates.at(-2);
        if (!currentDate || !previousDate) return [];
        const match = compareSnapshots(etfRows, [], currentDate, previousDate, "stock")
          .find((row) => row.component_id === symbol);
        return match ? [{ etf_id: etfId, current_date: currentDate, previous_date: previousDate, ...match }] : [];
      }).sort((a, b) => Math.abs(b.share_delta) - Math.abs(a.share_delta));
      return ok({ ...sourceNote("official"), symbol, requested_date: date, etf_count: activity.length, data: activity });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_active_etf_daily_change_report", {
    description: "以投信官方D1快照彙整全部主動式ETF新增、剔除、加碼及減碼；可先批次更新所有已設定來源。",
    inputSchema: {
      date: dateSchema.optional().default(taipeiDate()),
      lookback_days: z.number().int().min(3).max(120).optional().default(30),
      refresh_registered_sources: z.boolean().optional().default(false),
      top_n: z.number().int().min(5).max(300).optional().default(50),
    },
  }, async ({ date, lookback_days, refresh_registered_sources, top_n }) => {
    try {
      const refreshErrors: { etf_id: string; error: string }[] = [];
      const refreshed: { etf_id: string; rows: number; dates: string[] }[] = [];
      if (refresh_registered_sources) {
        for (const source of await listSources(env, true)) {
          try {
            const result = await refreshOne(env, source.etf_id, date);
            refreshed.push({ etf_id: source.etf_id, rows: result.inserted, dates: result.dates });
          } catch (error) { refreshErrors.push({ etf_id: source.etf_id, error: errorText(error) }); }
        }
      }
      const rows = await allCachedHoldings(env, shiftDate(date, -lookback_days), date);
      const grouped = new Map<string, Holding[]>();
      rows.forEach((row) => grouped.set(row.etf_id, [...(grouped.get(row.etf_id) ?? []), row]));
      const skipped: { etf_id: string; reason: string }[] = [];
      const compared = [...grouped.entries()].flatMap(([etfId, etfRows]) => {
        const dates = dateList(etfRows);
        const currentDate = dates.at(-1);
        const previousDate = dates.at(-2);
        if (!currentDate || !previousDate) {
          skipped.push({ etf_id: etfId, reason: "不足兩個完整快照" });
          return [];
        }
        return compareSnapshots(etfRows, [], currentDate, previousDate, "stock")
          .map((row) => ({ etf_id: etfId, current_date: currentDate, previous_date: previousDate, ...row }));
      });
      const additions = compared.filter((row) => row.status === "added")
        .sort((a, b) => b.current_weight_percent - a.current_weight_percent).slice(0, top_n);
      const removals = compared.filter((row) => row.status === "removed")
        .sort((a, b) => b.previous_weight_percent - a.previous_weight_percent).slice(0, top_n);
      const increases = compared.filter((row) => row.status === "increased")
        .sort((a, b) => Math.abs(b.weight_change_percentage_points ?? 0) - Math.abs(a.weight_change_percentage_points ?? 0)).slice(0, top_n);
      const decreases = compared.filter((row) => row.status === "decreased")
        .sort((a, b) => Math.abs(b.weight_change_percentage_points ?? 0) - Math.abs(a.weight_change_percentage_points ?? 0)).slice(0, top_n);
      return ok({
        ...sourceNote("official"), requested_date: date, etfs_analyzed: grouped.size, summary: statusSummary(compared),
        additions, removals, largest_increases: increases, largest_decreases: decreases,
        refreshed, skipped, partial_errors: refreshErrors,
      });
    } catch (error) { return fail(error); }
  });
}
