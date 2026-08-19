export const TW_MARKET_DATA_VERSION = "diamond-tw-market-data/v1.0.0";

export type TwMarket = "listed" | "otc";
export type TwMarketDataKind = "institutional" | "margin";

export type InstitutionalRow = {
  trade_date: string;
  symbol: string;
  name: string;
  market: TwMarket;
  foreign_net_shares: number;
  trust_net_shares: number;
  dealer_net_shares: number;
  total_net_shares: number;
  source: string;
  source_priority: "OFFICIAL" | "FALLBACK";
};

export type MarginRow = {
  trade_date: string;
  symbol: string;
  name: string;
  market: TwMarket;
  margin_previous_balance_lots: number | null;
  margin_balance_lots: number | null;
  margin_balance_change_lots: number | null;
  short_previous_balance_lots: number | null;
  short_balance_lots: number | null;
  short_balance_change_lots: number | null;
  source: string;
  source_priority: "OFFICIAL" | "FALLBACK";
};

const TWSE_T86 = "https://www.twse.com.tw/rwd/zh/fund/T86";
const TWSE_MARGIN = "https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN";
const TPEX_INSTITUTIONAL = "https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading";
const TPEX_MARGIN = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance";
const FINMIND = "https://api.finmindtrade.com/api/v4/data";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tw_market_data_snapshot_index (
    dataset_version TEXT PRIMARY KEY,
    trade_date TEXT NOT NULL,
    market TEXT NOT NULL,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    source_date_verified INTEGER NOT NULL,
    row_count INTEGER NOT NULL,
    status TEXT NOT NULL,
    r2_key TEXT NOT NULL UNIQUE,
    content_sha256 TEXT NOT NULL,
    archived_at TEXT NOT NULL,
    error TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tw_market_data_date_kind ON tw_market_data_snapshot_index(kind, trade_date, market, archived_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tw_market_data_status ON tw_market_data_snapshot_index(status, trade_date, kind)`,
] as const;

function rec(value: unknown): Record<string, any> {
  return value !== null && typeof value === "object" ? value as Record<string, any> : {};
}

export function marketNumber(value: unknown): number {
  const text = String(value ?? "").replace(/<[^>]*>/g, "").replace(/,/g, "").replace(/\+/g, "").trim();
  if (!text || ["--", "---", "N/A", "null", "undefined"].includes(text)) return 0;
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

function nullableMarketNumber(value: unknown): number | null {
  const text = String(value ?? "").replace(/<[^>]*>/g, "").replace(/,/g, "").replace(/\+/g, "").trim();
  if (!text || ["--", "---", "N/A", "null", "undefined"].includes(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function pad2(value: string | number) { return String(value).padStart(2, "0"); }

export function normalizeTradeDate(value: unknown): string | null {
  const raw = String(value ?? "").replace(/<[^>]*>/g, "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
  const parts = raw.match(/^(\d{2,4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
  if (parts) {
    let year = Number(parts[1]);
    if (year < 1911) year += 1911;
    if (year >= 1900 && year <= 2200) return `${year}-${pad2(parts[2])}-${pad2(parts[3])}`;
  }
  const rocCompact = raw.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (rocCompact) return `${Number(rocCompact[1]) + 1911}-${rocCompact[2]}-${rocCompact[3]}`;
  return null;
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/<[^>]*>/g, "").replace(/[\s_()（）%％/\\.,:：;；\-]/g, "");
}

function findValue(row: Record<string, any>, aliases: string[]): unknown {
  const map = new Map(Object.entries(row).map(([key, value]) => [normalizeKey(key), value]));
  for (const alias of aliases) {
    const key = normalizeKey(alias);
    if (map.has(key)) return map.get(key);
  }
  for (const [key, value] of map) {
    if (aliases.some((alias) => key.includes(normalizeKey(alias)) || normalizeKey(alias).includes(key))) return value;
  }
  return undefined;
}

function rowSymbol(row: Record<string, any>) {
  return String(findValue(row, ["證券代號", "證券代碼", "股票代號", "公司代號", "SecuritiesCompanyCode", "Code", "stock_id", "symbol"]) ?? "").trim().replace(/\s/g, "");
}

function rowName(row: Record<string, any>) {
  return String(findValue(row, ["證券名稱", "股票名稱", "公司名稱", "CompanyName", "SecuritiesCompanyName", "Name", "stock_name"]) ?? "").trim();
}

function objectsFromFields(fields: unknown, data: unknown): Record<string, any>[] {
  if (!Array.isArray(fields) || !Array.isArray(data)) return [];
  return data.filter(Array.isArray).map((values: any[]) => Object.fromEntries((fields as any[]).map((field, index) => [String(field), values[index]])));
}

function responseRows(body: unknown): Record<string, any>[] {
  if (Array.isArray(body)) return body.map(rec);
  const root = rec(body);
  if (Array.isArray(root.data) && Array.isArray(root.fields)) return objectsFromFields(root.fields, root.data);
  if (Array.isArray(root.data)) return root.data.map(rec);
  return [];
}

function dateFromRows(rows: Record<string, any>[], fallback?: unknown) {
  const dates = rows.map((row) => normalizeTradeDate(findValue(row, ["資料日期", "日期", "Date", "date", "TradeDate"]))).filter((x): x is string => Boolean(x));
  if (dates.length) return [...new Set(dates)].sort().at(-1) ?? null;
  return normalizeTradeDate(fallback);
}

export function normalizeTwseInstitutional(body: unknown, requestedDate: string): InstitutionalRow[] {
  const root = rec(body);
  return responseRows(body).map((row): InstitutionalRow | null => {
    const symbol = rowSymbol(row);
    if (!/^\d{4,6}$/.test(symbol)) return null;
    return {
      trade_date: normalizeTradeDate(root.date) ?? requestedDate,
      symbol,
      name: rowName(row),
      market: "listed",
      foreign_net_shares: marketNumber(findValue(row, ["外陸資買賣超股數(不含外資自營商)", "外陸資買賣超股數", "外資及陸資買賣超股數"])),
      trust_net_shares: marketNumber(findValue(row, ["投信買賣超股數"])),
      dealer_net_shares: marketNumber(findValue(row, ["自營商買賣超股數"])),
      total_net_shares: marketNumber(findValue(row, ["三大法人買賣超股數", "合計買賣超股數"])),
      source: "TWSE_T86",
      source_priority: "OFFICIAL",
    };
  }).filter((x): x is InstitutionalRow => Boolean(x));
}

export function normalizeTpexInstitutional(body: unknown, requestedDate: string): InstitutionalRow[] {
  const rows = responseRows(body);
  return rows.map((row): InstitutionalRow | null => {
    const symbol = rowSymbol(row);
    if (!/^\d{4,6}$/.test(symbol)) return null;
    const tradeDate = normalizeTradeDate(findValue(row, ["Date", "日期", "資料日期", "TradeDate"])) ?? requestedDate;
    const foreign = marketNumber(findValue(row, [
      "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference",
      "ForeignInvestorsincludeMainlandAreaInvestorsForeignDealersexcludedDifference",
      "外資及陸資買賣超股數", "外陸資買賣超股數",
    ]));
    const trust = marketNumber(findValue(row, ["Securities Investment Trust Companies-Difference", "SecuritiesInvestmentTrustCompaniesDifference", "投信買賣超股數"]));
    const dealer = marketNumber(findValue(row, ["Dealers-Difference", "DealersDifference", "自營商買賣超股數"]));
    const totalRaw = findValue(row, ["Total Difference", "TotalDifference", "三大法人買賣超股數", "合計買賣超股數"]);
    return {
      trade_date: tradeDate,
      symbol,
      name: rowName(row),
      market: "otc",
      foreign_net_shares: foreign,
      trust_net_shares: trust,
      dealer_net_shares: dealer,
      total_net_shares: totalRaw === undefined ? foreign + trust + dealer : marketNumber(totalRaw),
      source: "TPEX_3INSTI_DAILY_TRADING",
      source_priority: "OFFICIAL",
    };
  }).filter((x): x is InstitutionalRow => Boolean(x));
}

function findTwseMarginTable(body: unknown): Record<string, any>[] {
  const root = rec(body);
  if (Array.isArray(root.tables)) {
    for (const tableValue of root.tables) {
      const table = rec(tableValue);
      const title = String(table.title ?? "");
      if (/融資融券彙總|信用交易/.test(title) && Array.isArray(table.fields) && Array.isArray(table.data)) {
        const rows = objectsFromFields(table.fields, table.data);
        if (rows.some((row) => /^\d{4,6}$/.test(rowSymbol(row)))) return rows;
      }
    }
  }
  return responseRows(body);
}

function normalizeMarginRow(row: Record<string, any>, market: TwMarket, tradeDate: string, source: string): MarginRow | null {
  const symbol = rowSymbol(row);
  if (!/^\d{4,6}$/.test(symbol)) return null;
  const marginPrev = nullableMarketNumber(findValue(row, ["融資前日餘額", "融資前日餘額張數", "MarginPurchaseYesterdayBalance", "MarginPurchasePreviousBalance"]));
  const marginNow = nullableMarketNumber(findValue(row, ["融資今日餘額", "融資今日餘額張數", "MarginPurchaseTodayBalance", "MarginPurchaseBalance"]));
  const marginChangeRaw = nullableMarketNumber(findValue(row, ["融資增減", "融資餘額增減", "MarginPurchaseChange", "MarginPurchaseBalanceChange"]));
  const shortPrev = nullableMarketNumber(findValue(row, ["融券前日餘額", "融券前日餘額張數", "ShortSaleYesterdayBalance", "ShortSalePreviousBalance"]));
  const shortNow = nullableMarketNumber(findValue(row, ["融券今日餘額", "融券今日餘額張數", "ShortSaleTodayBalance", "ShortSaleBalance"]));
  const shortChangeRaw = nullableMarketNumber(findValue(row, ["融券增減", "融券餘額增減", "ShortSaleChange", "ShortSaleBalanceChange"]));
  return {
    trade_date: tradeDate,
    symbol,
    name: rowName(row),
    market,
    margin_previous_balance_lots: marginPrev,
    margin_balance_lots: marginNow,
    margin_balance_change_lots: marginChangeRaw ?? (marginNow !== null && marginPrev !== null ? marginNow - marginPrev : null),
    short_previous_balance_lots: shortPrev,
    short_balance_lots: shortNow,
    short_balance_change_lots: shortChangeRaw ?? (shortNow !== null && shortPrev !== null ? shortNow - shortPrev : null),
    source,
    source_priority: "OFFICIAL",
  };
}

export function normalizeTwseMargin(body: unknown, requestedDate: string): MarginRow[] {
  const root = rec(body);
  const rows = findTwseMarginTable(body);
  const tradeDate = dateFromRows(rows, root.date) ?? requestedDate;
  return rows.map((row) => normalizeMarginRow(row, "listed", tradeDate, "TWSE_MI_MARGN")).filter((x): x is MarginRow => Boolean(x));
}

export function normalizeTpexMargin(body: unknown, requestedDate: string): MarginRow[] {
  const rows = responseRows(body);
  return rows.map((row) => {
    const tradeDate = normalizeTradeDate(findValue(row, ["Date", "日期", "資料日期", "TradeDate"])) ?? requestedDate;
    return normalizeMarginRow(row, "otc", tradeDate, "TPEX_MAINBOARD_MARGIN_BALANCE");
  }).filter((x): x is MarginRow => Boolean(x));
}

function taipeiDateFromMs(ms = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

function subtractDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

async function fetchJson(url: URL | string, label: string) {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Diamond-Market-Data/1.0" } });
  const text = await response.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) throw new Error(`${label}_http_${response.status}:${text.slice(0,200)}`);
  return body;
}

async function finmind(env: Env, dataset: string, params: Record<string, string>) {
  if (!env.FINMIND_TOKEN) throw new Error("FINMIND_TOKEN_not_configured");
  const url = new URL(FINMIND);
  url.searchParams.set("dataset", dataset);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${env.FINMIND_TOKEN}` } });
  const body = await response.json<any>();
  if (!response.ok || !Array.isArray(body?.data)) throw new Error(`FinMind_${dataset}_http_${response.status}`);
  return body.data as Record<string, any>[];
}

function compactDate(date: string) { return date.replace(/-/g, ""); }

async function fetchOfficialInstitutional(market: TwMarket, tradeDate: string) {
  if (market === "listed") {
    const url = new URL(TWSE_T86);
    url.searchParams.set("date", compactDate(tradeDate));
    url.searchParams.set("selectType", "ALLBUT0999");
    url.searchParams.set("response", "json");
    const body = await fetchJson(url, "TWSE_T86");
    const rows = normalizeTwseInstitutional(body, tradeDate);
    const root = rec(body);
    const sourceDate = normalizeTradeDate(root.date) ?? dateFromRows(rows as any[], tradeDate);
    return { rows, source: "TWSE_T86", source_date: sourceDate, source_date_verified: sourceDate === tradeDate, raw_status: root.stat ?? null };
  }
  const body = await fetchJson(TPEX_INSTITUTIONAL, "TPEX_3INSTI");
  const rows = normalizeTpexInstitutional(body, tradeDate);
  const sourceDate = dateFromRows(responseRows(body));
  return { rows, source: "TPEX_3INSTI_DAILY_TRADING", source_date: sourceDate, source_date_verified: sourceDate === tradeDate, raw_status: rows.length ? "OK" : "EMPTY" };
}

async function fetchOfficialMargin(market: TwMarket, tradeDate: string) {
  if (market === "listed") {
    const url = new URL(TWSE_MARGIN);
    url.searchParams.set("date", compactDate(tradeDate));
    url.searchParams.set("selectType", "ALL");
    url.searchParams.set("response", "json");
    const body = await fetchJson(url, "TWSE_MI_MARGN");
    const rows = normalizeTwseMargin(body, tradeDate);
    const root = rec(body);
    const sourceDate = normalizeTradeDate(root.date) ?? dateFromRows(findTwseMarginTable(body));
    return { rows, source: "TWSE_MI_MARGN", source_date: sourceDate, source_date_verified: sourceDate === tradeDate, raw_status: root.stat ?? null };
  }
  const body = await fetchJson(TPEX_MARGIN, "TPEX_MARGIN");
  const rows = normalizeTpexMargin(body, tradeDate);
  const sourceDate = dateFromRows(responseRows(body));
  return { rows, source: "TPEX_MAINBOARD_MARGIN_BALANCE", source_date: sourceDate, source_date_verified: sourceDate === tradeDate, raw_status: rows.length ? "OK" : "EMPTY" };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source).sort().map((key) => [key, stableValue(source[key])]));
  }
  return value === undefined ? null : value;
}

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(stableValue(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function ensureTwMarketDataSchema(env: Env) {
  if (!env.RESEARCH_DB) throw new Error("RESEARCH_DB_binding_required");
  if (!env.RESEARCH_BUCKET) throw new Error("RESEARCH_BUCKET_binding_required");
  await env.RESEARCH_DB.batch(SCHEMA.map((sql) => env.RESEARCH_DB.prepare(sql)));
}

async function archiveSnapshot(env: Env, input: {
  trade_date: string;
  market: TwMarket;
  kind: TwMarketDataKind;
  source: string;
  source_date_verified: boolean;
  rows: Array<InstitutionalRow | MarginRow>;
}) {
  await ensureTwMarketDataSchema(env);
  if (!input.source_date_verified) throw new Error(`source_date_not_verified:${input.kind}:${input.market}:${input.trade_date}`);
  if (!input.rows.length) throw new Error(`official_rows_empty:${input.kind}:${input.market}:${input.trade_date}`);
  const payload = { schema_version: TW_MARKET_DATA_VERSION, ...input, archived_payload_at: new Date().toISOString() };
  const content = { ...payload, archived_payload_at: undefined };
  const hash = await sha256(content);
  const datasetVersion = `sha256:${hash}`;
  const r2Key = `tw-market-data/v1/${input.trade_date}/${input.kind}/${input.market}/${hash}.json`;
  const existing = await env.RESEARCH_DB.prepare(`SELECT dataset_version,r2_key FROM tw_market_data_snapshot_index WHERE dataset_version=?`).bind(datasetVersion).first<any>();
  if (existing) return { ok:true as const, idempotent:true as const, dataset_version:datasetVersion, r2_key:String(existing.r2_key) };
  const existingObject = await env.RESEARCH_BUCKET.get(r2Key);
  if (!existingObject) await env.RESEARCH_BUCKET.put(r2Key, JSON.stringify(payload), { httpMetadata:{ contentType:"application/json" }, customMetadata:{ trade_date:input.trade_date, kind:input.kind, market:input.market, dataset_version:datasetVersion } });
  const archivedAt = new Date().toISOString();
  try {
    await env.RESEARCH_DB.prepare(`INSERT INTO tw_market_data_snapshot_index(dataset_version,trade_date,market,kind,source,source_date_verified,row_count,status,r2_key,content_sha256,archived_at,error) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      datasetVersion,input.trade_date,input.market,input.kind,input.source,1,input.rows.length,"READY",r2Key,hash,archivedAt,null,
    ).run();
  } catch (error) {
    if (!existingObject) await env.RESEARCH_BUCKET.delete(r2Key);
    throw error;
  }
  return { ok:true as const, idempotent:false as const, dataset_version:datasetVersion, r2_key:r2Key, archived_at:archivedAt };
}

export async function runTwMarketDataDaily(env: Env, tradeDate = taipeiDateFromMs()) {
  await ensureTwMarketDataSchema(env);
  const jobs: Array<{kind:TwMarketDataKind;market:TwMarket}> = [
    { kind:"institutional", market:"listed" }, { kind:"institutional", market:"otc" },
    { kind:"margin", market:"listed" }, { kind:"margin", market:"otc" },
  ];
  const results = [] as any[];
  for (const job of jobs) {
    try {
      const fetched = job.kind === "institutional" ? await fetchOfficialInstitutional(job.market, tradeDate) : await fetchOfficialMargin(job.market, tradeDate);
      if (!fetched.source_date_verified) throw new Error(`official_source_date_mismatch:expected=${tradeDate}:actual=${fetched.source_date ?? "unknown"}`);
      if (!fetched.rows.length) throw new Error(`official_source_empty:${String(fetched.raw_status ?? "")}`);
      const archived = await archiveSnapshot(env, { trade_date:tradeDate, market:job.market, kind:job.kind, source:fetched.source, source_date_verified:true, rows:fetched.rows });
      results.push({ ...job, status:"READY", rows:fetched.rows.length, source:fetched.source, source_date:fetched.source_date, ...archived });
    } catch (error) {
      results.push({ ...job, status:"DEGRADED", rows:0, error:error instanceof Error ? error.message : String(error) });
    }
  }
  const ready = results.filter((x) => x.status === "READY").length;
  return { ok:true, version:TW_MARKET_DATA_VERSION, trade_date:tradeDate, status:ready === results.length ? "READY" : ready ? "DEGRADED" : "UNAVAILABLE", blocking:false, market_data_failure_blocks_ohlc:false, ready_count:ready, total_count:results.length, results };
}

async function loadArchivedRows(env: Env, kind: TwMarketDataKind, symbol: string, asOf: string, maxSnapshots = 80) {
  await ensureTwMarketDataSchema(env);
  const index = await env.RESEARCH_DB.prepare(`SELECT * FROM tw_market_data_snapshot_index WHERE kind=? AND trade_date<=? AND status='READY' ORDER BY trade_date DESC, archived_at DESC LIMIT ?`).bind(kind, asOf, maxSnapshots).all<any>();
  const seen = new Set<string>();
  const rows: any[] = [];
  const datasets: any[] = [];
  for (const item of index.results) {
    const key = `${item.trade_date}|${item.market}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const object = await env.RESEARCH_BUCKET.get(String(item.r2_key));
    if (!object) continue;
    const payload = await object.json<any>();
    const matched = Array.isArray(payload?.rows) ? payload.rows.filter((row:any) => String(row.symbol) === symbol) : [];
    if (matched.length) {
      rows.push(...matched);
      datasets.push({ dataset_version:item.dataset_version, trade_date:item.trade_date, market:item.market, source:item.source, row_count:item.row_count });
    }
  }
  return { rows: rows.sort((a,b) => String(a.trade_date).localeCompare(String(b.trade_date))), datasets };
}

function normalizeFinmindInstitutional(rows: Record<string, any>[], symbol: string): InstitutionalRow[] {
  const grouped = new Map<string, InstitutionalRow>();
  for (const row of rows) {
    const date = normalizeTradeDate(row.date);
    if (!date) continue;
    const current = grouped.get(date) ?? { trade_date:date, symbol, name:"", market:"listed" as TwMarket, foreign_net_shares:0, trust_net_shares:0, dealer_net_shares:0, total_net_shares:0, source:"FINMIND_HISTORY", source_priority:"FALLBACK" as const };
    const category = String(row.name ?? row.type ?? row.institutional_investors ?? "").toLowerCase();
    const net = marketNumber(row.buy) - marketNumber(row.sell);
    if (/foreign|外資|陸資/.test(category)) current.foreign_net_shares += net;
    else if (/trust|投信/.test(category)) current.trust_net_shares += net;
    else if (/dealer|自營/.test(category)) current.dealer_net_shares += net;
    current.total_net_shares = current.foreign_net_shares + current.trust_net_shares + current.dealer_net_shares;
    grouped.set(date, current);
  }
  return [...grouped.values()].sort((a,b) => a.trade_date.localeCompare(b.trade_date));
}

function normalizeFinmindMargin(rows: Record<string, any>[], symbol: string): MarginRow[] {
  return rows.map((row): MarginRow | null => {
    const date = normalizeTradeDate(row.date);
    if (!date) return null;
    const marginPrev = nullableMarketNumber(row.MarginPurchaseYesterdayBalance);
    const marginNow = nullableMarketNumber(row.MarginPurchaseTodayBalance);
    const shortPrev = nullableMarketNumber(row.ShortSaleYesterdayBalance);
    const shortNow = nullableMarketNumber(row.ShortSaleTodayBalance);
    return { trade_date:date, symbol, name:"", market:"listed", margin_previous_balance_lots:marginPrev, margin_balance_lots:marginNow, margin_balance_change_lots:marginNow !== null && marginPrev !== null ? marginNow-marginPrev : null, short_previous_balance_lots:shortPrev, short_balance_lots:shortNow, short_balance_change_lots:shortNow !== null && shortPrev !== null ? shortNow-shortPrev : null, source:"FINMIND_HISTORY", source_priority:"FALLBACK" };
  }).filter((x): x is MarginRow => Boolean(x)).sort((a,b) => a.trade_date.localeCompare(b.trade_date));
}

async function finmindInstitutionalHistory(env: Env, symbol: string, asOf: string, calendarDays: number) {
  const rows = await finmind(env, "TaiwanStockInstitutionalInvestorsBuySell", { data_id:symbol, start_date:subtractDays(asOf, calendarDays), end_date:asOf });
  return normalizeFinmindInstitutional(rows, symbol);
}

async function finmindMarginHistory(env: Env, symbol: string, asOf: string, calendarDays: number) {
  const rows = await finmind(env, "TaiwanStockMarginPurchaseShortSale", { data_id:symbol, start_date:subtractDays(asOf, calendarDays), end_date:asOf });
  return normalizeFinmindMargin(rows, symbol);
}

function mergeByDate<T extends {trade_date:string;source_priority:"OFFICIAL"|"FALLBACK"}>(fallback: T[], official: T[]) {
  const map = new Map<string,T>();
  for (const row of fallback) map.set(row.trade_date,row);
  for (const row of official) map.set(row.trade_date,row);
  return [...map.values()].sort((a,b)=>a.trade_date.localeCompare(b.trade_date));
}

const WINDOWS = [1,3,5,10,20] as const;

export function institutionalWindows(rows: InstitutionalRow[]) {
  const sorted = [...rows].sort((a,b)=>a.trade_date.localeCompare(b.trade_date));
  const sums = (n:number) => {
    const slice = sorted.slice(-n);
    return { days:slice.length, foreign_net_shares:slice.reduce((s,x)=>s+x.foreign_net_shares,0), trust_net_shares:slice.reduce((s,x)=>s+x.trust_net_shares,0), dealer_net_shares:slice.reduce((s,x)=>s+x.dealer_net_shares,0), total_net_shares:slice.reduce((s,x)=>s+x.total_net_shares,0) };
  };
  return Object.fromEntries(WINDOWS.map((n)=>[`${n}d`,sums(n)]));
}

export function marginWindows(rows: MarginRow[]) {
  const sorted = [...rows].sort((a,b)=>a.trade_date.localeCompare(b.trade_date));
  const latest = sorted.at(-1) ?? null;
  const sums = (n:number) => {
    const slice = sorted.slice(-n);
    return { days:slice.length, margin_balance_change_lots:slice.reduce((s,x)=>s+(x.margin_balance_change_lots ?? 0),0), short_balance_change_lots:slice.reduce((s,x)=>s+(x.short_balance_change_lots ?? 0),0) };
  };
  return { latest, windows:Object.fromEntries(WINDOWS.map((n)=>[`${n}d`,sums(n)])) };
}

export async function getTwInstitutionalFlow(env: Env, input: {symbol:string;as_of?:string;calendar_days?:number}) {
  const asOf = input.as_of ?? taipeiDateFromMs();
  const calendarDays = Math.max(30,Math.min(180,Number(input.calendar_days ?? 60)));
  const archived = await loadArchivedRows(env,"institutional",input.symbol,asOf,80);
  let fallback: InstitutionalRow[] = [], fallbackError:string|null=null;
  try { fallback = await finmindInstitutionalHistory(env,input.symbol,asOf,calendarDays); } catch (error) { fallbackError=error instanceof Error?error.message:String(error); }
  const rows = mergeByDate(fallback,archived.rows as InstitutionalRow[]).slice(-120);
  const officialDays = rows.filter((x)=>x.source_priority==="OFFICIAL").length;
  return { ok:true, version:TW_MARKET_DATA_VERSION, symbol:input.symbol, as_of:asOf, status:rows.length ? (officialDays ? "READY" : "DEGRADED") : "UNAVAILABLE", blocking:false, source_priority:["TWSE/TPEx official archived snapshot","FinMind fallback/history"], data_quality:{official_days:officialDays,total_days:rows.length,fallback_error:fallbackError}, windows:institutionalWindows(rows), rows, datasets:archived.datasets };
}

export async function getTwMarginShort(env: Env, input: {symbol:string;as_of?:string;calendar_days?:number}) {
  const asOf = input.as_of ?? taipeiDateFromMs();
  const calendarDays = Math.max(30,Math.min(180,Number(input.calendar_days ?? 60)));
  const archived = await loadArchivedRows(env,"margin",input.symbol,asOf,80);
  let fallback: MarginRow[] = [], fallbackError:string|null=null;
  try { fallback = await finmindMarginHistory(env,input.symbol,asOf,calendarDays); } catch (error) { fallbackError=error instanceof Error?error.message:String(error); }
  const rows = mergeByDate(fallback,archived.rows as MarginRow[]).slice(-120);
  const officialDays = rows.filter((x)=>x.source_priority==="OFFICIAL").length;
  return { ok:true, version:TW_MARKET_DATA_VERSION, symbol:input.symbol, as_of:asOf, status:rows.length ? (officialDays ? "READY" : "DEGRADED") : "UNAVAILABLE", blocking:false, source_priority:["TWSE/TPEx official archived snapshot","FinMind fallback/history"], data_quality:{official_days:officialDays,total_days:rows.length,fallback_error:fallbackError}, ...marginWindows(rows), rows, datasets:archived.datasets };
}

export async function getTwMarketDataBundle(env: Env, input: {symbol:string;as_of?:string;calendar_days?:number}) {
  const [institutional,margin] = await Promise.all([getTwInstitutionalFlow(env,input),getTwMarginShort(env,input)]);
  const degradedLayers = [institutional.status==="READY"?null:"institutional",margin.status==="READY"?null:"margin"].filter(Boolean);
  return { ok:true, version:TW_MARKET_DATA_VERSION, symbol:input.symbol, as_of:input.as_of ?? taipeiDateFromMs(), status:degradedLayers.length ? (degradedLayers.length===2&&institutional.status==="UNAVAILABLE"&&margin.status==="UNAVAILABLE"?"UNAVAILABLE":"DEGRADED") : "READY", degraded_layers:degradedLayers, market_data_blocks_ohlc:false, ohlc_dependency:"OHLC_MCP_ONLY", formal_swing_policy:"JOIN_OHLC_WITH_DIAMOND_MARKET_DATA; NEVER SUBSTITUTE FINMIND_PRICE_FOR_OHLC", institutional, margin };
}

export async function getTwMarketDataStatus(env: Env, tradeDate?:string) {
  await ensureTwMarketDataSchema(env);
  const date = tradeDate ?? taipeiDateFromMs();
  const result = await env.RESEARCH_DB.prepare(`SELECT trade_date,market,kind,source,row_count,status,source_date_verified,dataset_version,archived_at,error FROM tw_market_data_snapshot_index WHERE trade_date<=? ORDER BY trade_date DESC, archived_at DESC LIMIT 40`).bind(date).all<any>();
  const latest = new Map<string,any>();
  for (const row of result.results) { const key=`${row.kind}|${row.market}`; if(!latest.has(key)) latest.set(key,row); }
  const layers=[...latest.values()];
  const exact=layers.filter((x)=>x.trade_date===date&&x.status==="READY"&&Number(x.source_date_verified)===1).length;
  return { ok:true,version:TW_MARKET_DATA_VERSION,requested_trade_date:date,status:exact===4?"READY":layers.length?"DEGRADED":"UNAVAILABLE",blocking:false,market_data_failure_blocks_ohlc:false,expected_layers:4,exact_ready_layers:exact,layers };
}
