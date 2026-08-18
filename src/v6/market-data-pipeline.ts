export type MarketDataPhase =
  | "fundamentals"
  | "institutional_prelim"
  | "institutional_final"
  | "margin"
  | "finalize";

type Market = "TWSE" | "TPEx";
type JsonRecord = Record<string, any>;

declare global {
  interface Env {
    RESEARCH_DB: D1Database;
    RESEARCH_BUCKET: R2Bucket;
    MARKET_DATA_GITHUB_TOKEN?: string;
    MARKET_DATA_GITHUB_REPO?: string;
    MARKET_DATA_GITHUB_BRANCH?: string;
  }
}

const TWSE_OPENAPI = "https://openapi.twse.com.tw/v1";
const TPEX_OPENAPI = "https://www.tpex.org.tw/openapi/v1";
const DEFAULT_GITHUB_REPO = "keywayk09/tv-papertrader";
const DEFAULT_GITHUB_BRANCH = "main";

const MARKET_DATA_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS market_data_runs (
    run_id TEXT PRIMARY KEY,
    trade_date TEXT NOT NULL,
    phase TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    summary_json TEXT,
    error_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_market_data_runs_date ON market_data_runs(trade_date, started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS market_data_status (
    trade_date TEXT NOT NULL,
    dataset TEXT NOT NULL,
    market TEXT NOT NULL,
    status TEXT NOT NULL,
    data_date TEXT,
    row_count INTEGER NOT NULL DEFAULT 0,
    source_url TEXT,
    r2_key TEXT,
    sha256 TEXT,
    fetched_at TEXT NOT NULL,
    error TEXT,
    PRIMARY KEY (trade_date, dataset, market)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_market_data_status_date ON market_data_status(trade_date, dataset, market)`,
  `CREATE TABLE IF NOT EXISTS market_symbols (
    symbol TEXT NOT NULL,
    market TEXT NOT NULL,
    name TEXT,
    industry TEXT,
    security_type TEXT NOT NULL DEFAULT 'COMMON_STOCK',
    active INTEGER NOT NULL DEFAULT 1,
    payload_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (symbol, market)
  )`,
  `CREATE TABLE IF NOT EXISTS institutional_daily (
    trade_date TEXT NOT NULL,
    market TEXT NOT NULL,
    symbol TEXT NOT NULL,
    name TEXT,
    foreign_net REAL NOT NULL DEFAULT 0,
    trust_net REAL NOT NULL DEFAULT 0,
    dealer_net REAL NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (trade_date, market, symbol)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_institutional_daily_symbol ON institutional_daily(symbol, trade_date DESC)`,
  `CREATE TABLE IF NOT EXISTS margin_daily (
    trade_date TEXT NOT NULL,
    market TEXT NOT NULL,
    symbol TEXT NOT NULL,
    name TEXT,
    margin_prev REAL NOT NULL DEFAULT 0,
    margin_buy REAL NOT NULL DEFAULT 0,
    margin_sell REAL NOT NULL DEFAULT 0,
    margin_cash_repay REAL NOT NULL DEFAULT 0,
    margin_balance REAL NOT NULL DEFAULT 0,
    short_prev REAL NOT NULL DEFAULT 0,
    short_sell REAL NOT NULL DEFAULT 0,
    short_buy REAL NOT NULL DEFAULT 0,
    short_repay REAL NOT NULL DEFAULT 0,
    short_balance REAL NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (trade_date, market, symbol)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_margin_daily_symbol ON margin_daily(symbol, trade_date DESC)`,
  `CREATE TABLE IF NOT EXISTS market_events (
    event_id TEXT PRIMARY KEY,
    market TEXT NOT NULL,
    symbol TEXT NOT NULL,
    event_date TEXT NOT NULL,
    event_time TEXT,
    event_type TEXT NOT NULL,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_market_events_symbol_date ON market_events(symbol, event_date DESC)`,
  `CREATE TABLE IF NOT EXISTS fundamental_versions (
    dataset TEXT NOT NULL,
    market TEXT NOT NULL,
    as_of TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (dataset, market, sha256)
  )`,
];

export type InstitutionalRow = {
  symbol: string;
  market: Market;
  name: string;
  foreignNet: number;
  trustNet: number;
  dealerNet: number;
  raw: JsonRecord;
};

export type MarginRow = {
  symbol: string;
  market: Market;
  name: string;
  marginPrev: number;
  marginBuy: number;
  marginSell: number;
  marginCashRepay: number;
  marginBalance: number;
  shortPrev: number;
  shortSell: number;
  shortBuy: number;
  shortRepay: number;
  shortBalance: number;
  raw: JsonRecord;
};

export type OfficialEvent = {
  eventId: string;
  market: Market;
  symbol: string;
  eventDate: string;
  eventTime: string | null;
  eventType: "INVESTOR_CONFERENCE" | "MATERIAL_INFORMATION";
  title: string;
  raw: JsonRecord;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function rows(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.map(record);
  const root = record(value);
  if (Array.isArray(root.data)) return root.data.map(record);
  return [];
}

function numberValue(value: unknown): number {
  const normalized = String(value ?? "").replaceAll(",", "").replaceAll("+", "").trim();
  if (!normalized || normalized === "--" || normalized === "---" || normalized === "X") return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function plainKey(value: string): string {
  return value.toLowerCase().replace(/[\s_()（）%％/\-]/g, "");
}

function pick(row: JsonRecord, candidates: string[]): unknown {
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  const normalized = new Map(Object.keys(row).map((key) => [plainKey(key), key]));
  for (const candidate of candidates) {
    const actual = normalized.get(plainKey(candidate));
    if (actual && row[actual] !== undefined && row[actual] !== null && row[actual] !== "") return row[actual];
  }
  return undefined;
}

function ordinaryStock(symbol: unknown): boolean {
  return /^[1-9]\d{3}$/.test(String(symbol ?? "").trim());
}

function taipeiDate(value = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function compactDate(value: string): string {
  return value.replaceAll("-", "");
}

export function dateFromUnknown(value: unknown, fallback: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const rocCompact = raw.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (rocCompact) return `${Number(rocCompact[1]) + 1911}-${rocCompact[2]}-${rocCompact[3]}`;
  const m = raw.match(/^(\d{4})[\/-]?(\d{2})[\/-]?(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const roc = raw.match(/^(\d{2,3})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (roc) return `${Number(roc[1]) + 1911}-${String(Number(roc[2])).padStart(2, "0")}-${String(Number(roc[3])).padStart(2, "0")}`;
  return fallback;
}

export function payloadDataDate(body: unknown, fallback = ""): string {
  const first = rows(body)[0];
  return first ? dateFromUnknown(pick(first, ["Date", "date", "資料日期", "日期"]), fallback) : fallback;
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function officialJson(url: string, source: string, attempts = 3): Promise<any> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json,text/plain,*/*",
          "User-Agent": "Taiwan-Stock-AI-Market-Data/1.0",
        },
      });
      const text = await response.text();
      let body: any = null;
      try { body = text ? JSON.parse(text) : null; } catch {}
      if (!response.ok) throw new Error(`${source} HTTP ${response.status}: ${text.slice(0, 240)}`);
      if (body === null) throw new Error(`${source} 回傳非 JSON`);
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${source} 取得失敗`);
}

async function ensureMarketDataSchema(env: Env) {
  if (!env.RESEARCH_DB || !env.RESEARCH_BUCKET) throw new Error("RESEARCH_DB 或 RESEARCH_BUCKET 尚未綁定");
  await env.RESEARCH_DB.batch(MARKET_DATA_SCHEMA_SQL.map((sql) => env.RESEARCH_DB.prepare(sql)));
}

async function putJson(env: Env, key: string, value: unknown, source: string) {
  const text = JSON.stringify(value);
  const sha256 = await sha256Text(text);
  await env.RESEARCH_BUCKET.put(key, text, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { source, sha256, storedAt: new Date().toISOString() },
  });
  return { key, sha256, rowCount: Array.isArray(value) ? value.length : rows(value).length };
}

async function setStatus(
  env: Env,
  tradeDate: string,
  dataset: string,
  market: Market,
  status: string,
  options: { dataDate?: string | null; rowCount?: number; sourceUrl?: string; r2Key?: string | null; sha256?: string | null; error?: string | null } = {},
) {
  await env.RESEARCH_DB.prepare(`
    INSERT INTO market_data_status (
      trade_date, dataset, market, status, data_date, row_count, source_url, r2_key, sha256, fetched_at, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(trade_date, dataset, market) DO UPDATE SET
      status=excluded.status, data_date=excluded.data_date, row_count=excluded.row_count,
      source_url=excluded.source_url, r2_key=excluded.r2_key, sha256=excluded.sha256,
      fetched_at=excluded.fetched_at, error=excluded.error
  `).bind(
    tradeDate,
    dataset,
    market,
    status,
    options.dataDate ?? null,
    options.rowCount ?? 0,
    options.sourceUrl ?? null,
    options.r2Key ?? null,
    options.sha256 ?? null,
    new Date().toISOString(),
    options.error ?? null,
  ).run();
}

function twseTableRows(body: unknown, titleIncludes: string): JsonRecord[] {
  const root = record(body);
  for (const rawTable of Array.isArray(root.tables) ? root.tables : []) {
    const table = record(rawTable);
    if (!String(table.title ?? "").includes(titleIncludes)) continue;
    const fields = Array.isArray(table.fields) ? table.fields.map(String) : [];
    return (Array.isArray(table.data) ? table.data : []).map((row: unknown) => {
      const values = Array.isArray(row) ? row : [];
      return Object.fromEntries(fields.map((field, index) => [field, values[index]]));
    });
  }
  return [];
}

export function normalizeTwseInstitutional(body: unknown): InstitutionalRow[] {
  const root = record(body);
  const fields = Array.isArray(root.fields) ? root.fields.map(String) : [];
  const rawRows = Array.isArray(root.data) ? root.data : [];
  return rawRows.map((item: unknown) => {
    const values = Array.isArray(item) ? item : [];
    const raw = Object.fromEntries(fields.map((field, index) => [field, values[index]]));
    const symbol = String(pick(raw, ["證券代號", "股票代號", "Code"]) ?? "").trim();
    return {
      symbol,
      market: "TWSE" as const,
      name: String(pick(raw, ["證券名稱", "股票名稱", "Name"]) ?? "").trim(),
      foreignNet: numberValue(pick(raw, ["外陸資買賣超股數(不含外資自營商)", "外陸資買賣超股數", "外資及陸資買賣超股數"])),
      trustNet: numberValue(pick(raw, ["投信買賣超股數", "投信買賣超"])),
      dealerNet: numberValue(pick(raw, ["自營商買賣超股數", "自營商買賣超"])),
      raw,
    };
  }).filter((row) => ordinaryStock(row.symbol));
}

export function normalizeTpexInstitutional(body: unknown): InstitutionalRow[] {
  return rows(body).flatMap((raw) => {
    const symbol = String(pick(raw, ["SecuritiesCompanyCode", "SecurityCode", "Code", "證券代號", "股票代號", "代號"]) ?? "").trim();
    if (!ordinaryStock(symbol)) return [];
    const foreignRaw = pick(raw, [
      "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference",
      "ForeignInvestorsInclude MainlandAreaInvestors-Difference",
      "ForeignInvestorsNetBuySell",
      "ForeignAndMainlandAreaInvestorsNetBuySell",
    ]);
    const trustRaw = pick(raw, [
      "SecuritiesInvestmentTrustCompanies-Difference",
      "InvestmentTrustNetBuySell",
      "SecuritiesInvestmentTrustCompaniesNetBuySell",
    ]);
    const dealerRaw = pick(raw, ["Dealers-Difference", "DealerNetBuySell", "DealersNetBuySell"]);
    if (foreignRaw === undefined || trustRaw === undefined || dealerRaw === undefined) return [];
    return [{
      symbol,
      market: "TPEx" as const,
      name: String(pick(raw, ["CompanyName", "SecurityName", "Name", "證券名稱", "股票名稱", "名稱"]) ?? "").trim(),
      foreignNet: numberValue(foreignRaw),
      trustNet: numberValue(trustRaw),
      dealerNet: numberValue(dealerRaw),
      raw,
    }];
  });
}

export function normalizeTwseMargin(body: unknown): MarginRow[] {
  const root = record(body);
  const tables = Array.isArray(root.tables) ? root.tables : [];
  const table = tables.map(record).find((item) => String(item.title ?? "").includes("融資融券彙總"));
  if (!table) return [];
  const fields = Array.isArray(table.fields) ? table.fields.map(String) : [];
  return (Array.isArray(table.data) ? table.data : []).map((item: unknown) => {
    const values = Array.isArray(item) ? item : [];
    const raw = Object.fromEntries(fields.map((field, index) => [field, values[index]]));
    const symbol = String(values[0] ?? pick(raw, ["股票代號", "證券代號"]) ?? "").trim();
    const marginPrev = numberValue(values[5] ?? pick(raw, ["融資前日餘額"]));
    const marginBalance = numberValue(values[6] ?? pick(raw, ["融資今日餘額", "融資當日餘額"]));
    const shortPrev = numberValue(values[11] ?? pick(raw, ["融券前日餘額"]));
    const shortBalance = numberValue(values[12] ?? pick(raw, ["融券今日餘額", "融券當日餘額"]));
    return {
      symbol,
      market: "TWSE" as const,
      name: String(values[1] ?? pick(raw, ["股票名稱", "證券名稱"]) ?? "").trim(),
      marginPrev,
      marginBuy: numberValue(values[2] ?? pick(raw, ["融資買進"])),
      marginSell: numberValue(values[3] ?? pick(raw, ["融資賣出"])),
      marginCashRepay: numberValue(values[4] ?? pick(raw, ["融資現金償還"])),
      marginBalance,
      shortPrev,
      shortSell: numberValue(values[8] ?? pick(raw, ["融券賣出"])),
      shortBuy: numberValue(values[9] ?? pick(raw, ["融券買進"])),
      shortRepay: numberValue(values[10] ?? pick(raw, ["融券現券償還"])),
      shortBalance,
      raw,
    };
  }).filter((row) => ordinaryStock(row.symbol));
}

export function normalizeTpexMargin(body: unknown): MarginRow[] {
  return rows(body).flatMap((raw) => {
    const symbol = String(pick(raw, ["SecuritiesCompanyCode", "SecurityCode", "Code", "證券代號", "股票代號", "代號"]) ?? "").trim();
    if (!ordinaryStock(symbol)) return [];
    const required = {
      marginPrev: pick(raw, ["MarginPurchaseBalancePreviousDay", "MarginPurchasePreviousBalance", "MarginPreviousBalance"]),
      marginBuy: pick(raw, ["MarginPurchase", "MarginBuy"]),
      marginSell: pick(raw, ["MarginSales", "MarginSale", "MarginSell"]),
      marginCashRepay: pick(raw, ["CashRedemption", "MarginCashRepay"]),
      marginBalance: pick(raw, ["MarginPurchaseBalance", "MarginPurchaseCurrentBalance", "MarginBalance"]),
      shortPrev: pick(raw, ["ShortSaleBalancePreviousDay", "ShortSalePreviousBalance", "ShortPreviousBalance"]),
      shortSell: pick(raw, ["ShortSale", "ShortSell"]),
      shortBuy: pick(raw, ["ShortConvering", "ShortCover", "ShortBuy"]),
      shortRepay: pick(raw, ["StockRedemption", "ShortRepay"]),
      shortBalance: pick(raw, ["ShortSaleBalance", "ShortSaleCurrentBalance", "ShortBalance"]),
    };
    if (Object.values(required).some((value) => value === undefined)) return [];
    return [{
      symbol,
      market: "TPEx" as const,
      name: String(pick(raw, ["CompanyName", "SecurityName", "Name", "證券名稱", "股票名稱", "名稱"]) ?? "").trim(),
      marginPrev: numberValue(required.marginPrev),
      marginBuy: numberValue(required.marginBuy),
      marginSell: numberValue(required.marginSell),
      marginCashRepay: numberValue(required.marginCashRepay),
      marginBalance: numberValue(required.marginBalance),
      shortPrev: numberValue(required.shortPrev),
      shortSell: numberValue(required.shortSell),
      shortBuy: numberValue(required.shortBuy),
      shortRepay: numberValue(required.shortRepay),
      shortBalance: numberValue(required.shortBalance),
      raw,
    }];
  });
}

export function classifyOfficialEvent(raw: JsonRecord, market: Market, fallbackDate: string): OfficialEvent | null {
  const symbol = String(pick(raw, ["公司代號", "股票代號", "證券代號", "SecuritiesCompanyCode", "CompanyCode", "Code"]) ?? "").trim();
  if (!ordinaryStock(symbol)) return null;
  const title = String(pick(raw, ["主旨", "Title", "Subject", "說明", "Description"]) ?? "").trim();
  const description = String(pick(raw, ["說明", "Description", "內容", "Content"]) ?? "").trim();
  const joined = `${title} ${description}`;
  const eventDate = dateFromUnknown(pick(raw, ["發言日期", "公告日期", "事實發生日", "Date", "AnnounceDate"]), fallbackDate);
  const eventTimeRaw = String(pick(raw, ["發言時間", "Time", "AnnounceTime"]) ?? "").trim();
  const eventType = /法人說明會|法說會|業績發表會|investor\s*conference/i.test(joined)
    ? "INVESTOR_CONFERENCE"
    : "MATERIAL_INFORMATION";
  const seed = JSON.stringify([market, symbol, eventDate, eventTimeRaw, title, description]);
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return {
    eventId: `${market}:${symbol}:${eventDate}:${(hash >>> 0).toString(16)}`,
    market,
    symbol,
    eventDate,
    eventTime: eventTimeRaw || null,
    eventType,
    title: title || description.slice(0, 160),
    raw,
  };
}

function normalizeSymbolMaster(body: unknown, market: Market) {
  return rows(body).map((raw) => {
    const symbol = String(pick(raw, ["公司代號", "股票代號", "證券代號", "SecuritiesCompanyCode", "CompanyCode", "Code"]) ?? "").trim();
    return {
      symbol,
      market,
      name: String(pick(raw, ["公司名稱", "公司簡稱", "股票名稱", "證券名稱", "CompanyName", "Name"]) ?? "").trim(),
      industry: String(pick(raw, ["產業別", "產業類別", "Industry", "IndustryName"]) ?? "").trim(),
      securityType: "COMMON_STOCK",
      raw,
    };
  }).filter((row) => ordinaryStock(row.symbol));
}

async function saveSymbols(env: Env, normalized: ReturnType<typeof normalizeSymbolMaster>) {
  const now = new Date().toISOString();
  const statements = normalized.map((row) => env.RESEARCH_DB.prepare(`
    INSERT INTO market_symbols (symbol, market, name, industry, security_type, active, payload_json, updated_at)
    VALUES (?, ?, ?, ?, 'COMMON_STOCK', 1, ?, ?)
    ON CONFLICT(symbol, market) DO UPDATE SET
      name=excluded.name, industry=excluded.industry, security_type='COMMON_STOCK', active=1,
      payload_json=excluded.payload_json, updated_at=excluded.updated_at
  `).bind(row.symbol, row.market, row.name, row.industry, JSON.stringify(row.raw), now));
  for (let index = 0; index < statements.length; index += 50) await env.RESEARCH_DB.batch(statements.slice(index, index + 50));
}

async function saveInstitutional(env: Env, tradeDate: string, data: InstitutionalRow[]) {
  const now = new Date().toISOString();
  const statements = data.map((row) => env.RESEARCH_DB.prepare(`
    INSERT INTO institutional_daily (trade_date, market, symbol, name, foreign_net, trust_net, dealer_net, payload_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(trade_date, market, symbol) DO UPDATE SET
      name=excluded.name, foreign_net=excluded.foreign_net, trust_net=excluded.trust_net,
      dealer_net=excluded.dealer_net, payload_json=excluded.payload_json, updated_at=excluded.updated_at
  `).bind(tradeDate, row.market, row.symbol, row.name, row.foreignNet, row.trustNet, row.dealerNet, JSON.stringify(row.raw), now));
  for (let index = 0; index < statements.length; index += 50) await env.RESEARCH_DB.batch(statements.slice(index, index + 50));
}

async function saveMargin(env: Env, tradeDate: string, data: MarginRow[]) {
  const now = new Date().toISOString();
  const statements = data.map((row) => env.RESEARCH_DB.prepare(`
    INSERT INTO margin_daily (
      trade_date, market, symbol, name, margin_prev, margin_buy, margin_sell, margin_cash_repay,
      margin_balance, short_prev, short_sell, short_buy, short_repay, short_balance, payload_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(trade_date, market, symbol) DO UPDATE SET
      name=excluded.name, margin_prev=excluded.margin_prev, margin_buy=excluded.margin_buy,
      margin_sell=excluded.margin_sell, margin_cash_repay=excluded.margin_cash_repay,
      margin_balance=excluded.margin_balance, short_prev=excluded.short_prev, short_sell=excluded.short_sell,
      short_buy=excluded.short_buy, short_repay=excluded.short_repay, short_balance=excluded.short_balance,
      payload_json=excluded.payload_json, updated_at=excluded.updated_at
  `).bind(
    tradeDate, row.market, row.symbol, row.name, row.marginPrev, row.marginBuy, row.marginSell,
    row.marginCashRepay, row.marginBalance, row.shortPrev, row.shortSell, row.shortBuy,
    row.shortRepay, row.shortBalance, JSON.stringify(row.raw), now,
  ));
  for (let index = 0; index < statements.length; index += 50) await env.RESEARCH_DB.batch(statements.slice(index, index + 50));
}

async function saveEvents(env: Env, data: OfficialEvent[]) {
  const now = new Date().toISOString();
  const statements = data.map((event) => env.RESEARCH_DB.prepare(`
    INSERT INTO market_events (event_id, market, symbol, event_date, event_time, event_type, title, source, payload_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'OFFICIAL', ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET
      event_time=excluded.event_time, event_type=excluded.event_type, title=excluded.title,
      payload_json=excluded.payload_json, updated_at=excluded.updated_at
  `).bind(event.eventId, event.market, event.symbol, event.eventDate, event.eventTime, event.eventType, event.title, JSON.stringify(event.raw), now));
  for (let index = 0; index < statements.length; index += 50) await env.RESEARCH_DB.batch(statements.slice(index, index + 50));
}

async function collectSymbolMaster(env: Env, tradeDate: string) {
  const sources: Array<{ market: Market; url: string }> = [
    { market: "TWSE", url: `${TWSE_OPENAPI}/opendata/t187ap03_L` },
    { market: "TPEx", url: `${TPEX_OPENAPI}/mopsfin_t187ap03_O` },
  ];
  const results = [];
  for (const source of sources) {
    try {
      const body = await officialJson(source.url, `${source.market} symbol master`);
      const normalized = normalizeSymbolMaster(body, source.market);
      if (!normalized.length) throw new Error("ordinary-stock rows = 0");
      await saveSymbols(env, normalized);
      const raw = await putJson(env, `market/tw/raw/${tradeDate}/${source.market.toLowerCase()}/symbol-master.json`, body, source.market);
      await setStatus(env, tradeDate, "symbol_master", source.market, "READY", {
        dataDate: tradeDate, rowCount: normalized.length, sourceUrl: source.url, r2Key: raw.key, sha256: raw.sha256,
      });
      results.push({ market: source.market, status: "READY", rowCount: normalized.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await setStatus(env, tradeDate, "symbol_master", source.market, "PENDING", { sourceUrl: source.url, error: message });
      results.push({ market: source.market, status: "PENDING", error: message });
    }
  }
  return results;
}

async function collectInstitutional(env: Env, tradeDate: string, final: boolean) {
  const compact = compactDate(tradeDate);
  const sources: Array<{ market: Market; url: string; normalize: (value: unknown) => InstitutionalRow[] }> = [
    {
      market: "TWSE",
      url: `https://www.twse.com.tw/rwd/zh/fund/T86?date=${compact}&selectType=ALLBUT0999&response=json`,
      normalize: normalizeTwseInstitutional,
    },
    { market: "TPEx", url: `${TPEX_OPENAPI}/tpex_3insti_daily_trading`, normalize: normalizeTpexInstitutional },
  ];
  const combined: InstitutionalRow[] = [];
  const results = [];
  for (const source of sources) {
    try {
      const body = await officialJson(source.url, `${source.market} institutional`);
      if (source.market === "TPEx") {
        const servedDate = payloadDataDate(body);
        if (!servedDate || servedDate !== tradeDate) throw new Error(`TPEx institutional served ${servedDate || "UNKNOWN"}; requested ${tradeDate}`);
      }
      const normalized = source.normalize(body);
      if (!normalized.length) throw new Error("institutional ordinary-stock rows = 0");
      await saveInstitutional(env, tradeDate, normalized);
      combined.push(...normalized);
      const suffix = final ? "final" : "preliminary";
      const raw = await putJson(env, `market/tw/raw/${tradeDate}/${source.market.toLowerCase()}/institutional-${suffix}.json`, body, source.market);
      await setStatus(env, tradeDate, "institutional", source.market, final ? "FINAL" : "PRELIMINARY", {
        dataDate: tradeDate, rowCount: normalized.length, sourceUrl: source.url, r2Key: raw.key, sha256: raw.sha256,
      });
      results.push({ market: source.market, status: final ? "FINAL" : "PRELIMINARY", rowCount: normalized.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await setStatus(env, tradeDate, "institutional", source.market, "PENDING", { sourceUrl: source.url, error: message });
      results.push({ market: source.market, status: "PENDING", error: message });
    }
  }
  if (combined.length) await putJson(env, `market/tw/daily/${tradeDate}/institutional.json`, { tradeDate, final, rows: combined }, "OFFICIAL");
  return results;
}

async function collectMargin(env: Env, tradeDate: string) {
  const compact = compactDate(tradeDate);
  const sources: Array<{ market: Market; url: string; normalize: (value: unknown) => MarginRow[] }> = [
    {
      market: "TWSE",
      url: `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${compact}&selectType=ALL&response=json`,
      normalize: normalizeTwseMargin,
    },
    { market: "TPEx", url: `${TPEX_OPENAPI}/tpex_mainboard_margin_balance`, normalize: normalizeTpexMargin },
  ];
  const combined: MarginRow[] = [];
  const results = [];
  for (const source of sources) {
    try {
      const body = await officialJson(source.url, `${source.market} margin`);
      if (source.market === "TPEx") {
        const servedDate = payloadDataDate(body);
        if (!servedDate || servedDate !== tradeDate) throw new Error(`TPEx margin served ${servedDate || "UNKNOWN"}; requested ${tradeDate}`);
      }
      const normalized = source.normalize(body);
      if (!normalized.length) throw new Error("margin ordinary-stock rows = 0; official data may not be published yet");
      await saveMargin(env, tradeDate, normalized);
      combined.push(...normalized);
      const raw = await putJson(env, `market/tw/raw/${tradeDate}/${source.market.toLowerCase()}/margin.json`, body, source.market);
      await setStatus(env, tradeDate, "margin", source.market, "FINAL", {
        dataDate: tradeDate, rowCount: normalized.length, sourceUrl: source.url, r2Key: raw.key, sha256: raw.sha256,
      });
      results.push({ market: source.market, status: "FINAL", rowCount: normalized.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await setStatus(env, tradeDate, "margin", source.market, "PENDING", { sourceUrl: source.url, error: message });
      results.push({ market: source.market, status: "PENDING", error: message });
    }
  }
  if (combined.length) await putJson(env, `market/tw/daily/${tradeDate}/margin.json`, { tradeDate, rows: combined }, "OFFICIAL");
  return results;
}

const FINANCIAL_ENDPOINTS: Array<{ market: Market; dataset: string; path: string }> = [
  ...["basi", "bd", "ci", "fh", "ins", "mim"].flatMap((kind) => [
    { market: "TWSE" as const, dataset: `income_${kind}`, path: `${TWSE_OPENAPI}/opendata/t187ap06_L_${kind}` },
    { market: "TWSE" as const, dataset: `balance_${kind}`, path: `${TWSE_OPENAPI}/opendata/t187ap07_L_${kind}` },
  ]),
  ...["basi", "bd", "ci", "fh", "ins", "mim"].map((kind) => ({
    market: "TPEx" as const,
    dataset: `income_${kind}`,
    path: `${TPEX_OPENAPI}/mopsfin_t187ap06_O_${kind}`,
  })),
  ...["basi", "bd", "ci", "fh", "ins", "mim"].map((kind) => ({
    market: "TPEx" as const,
    dataset: `balance_${kind}`,
    path: `${TPEX_OPENAPI}/mopsfin_t187ap07_O_${kind}`,
  })),
];

async function saveFundamentalVersion(env: Env, dataset: string, market: Market, asOf: string, body: unknown, sourceUrl: string) {
  const text = JSON.stringify(body);
  const sha256 = await sha256Text(text);
  const key = `market/tw/fundamentals/${dataset}/${market.toLowerCase()}/${sha256}.json`;
  const existing = await env.RESEARCH_BUCKET.head(key);
  if (!existing) await env.RESEARCH_BUCKET.put(key, text, { httpMetadata: { contentType: "application/json; charset=utf-8" }, customMetadata: { source: market, sha256, storedAt: new Date().toISOString() } });
  const rowCount = rows(body).length;
  await env.RESEARCH_DB.prepare(`
    INSERT OR IGNORE INTO fundamental_versions (dataset, market, as_of, row_count, sha256, r2_key, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(dataset, market, asOf, rowCount, sha256, key, new Date().toISOString()).run();
  await setStatus(env, asOf, dataset, market, rowCount ? "READY_AS_OF" : "PENDING", {
    dataDate: asOf, rowCount, sourceUrl, r2Key: key, sha256,
    error: rowCount ? null : "rows = 0",
  });
  return { dataset, market, rowCount, sha256, r2Key: key };
}

async function collectFundamentalsAndEvents(env: Env, tradeDate: string) {
  const symbolMaster = await collectSymbolMaster(env, tradeDate);
  const revenueSources: Array<{ market: Market; url: string }> = [
    { market: "TWSE", url: `${TWSE_OPENAPI}/opendata/t187ap05_L` },
    { market: "TPEx", url: `${TPEX_OPENAPI}/mopsfin_t187ap05_O` },
  ];
  const revenue = [];
  for (const source of revenueSources) {
    try {
      const body = await officialJson(source.url, `${source.market} revenue`);
      revenue.push(await saveFundamentalVersion(env, "revenue", source.market, tradeDate, body, source.url));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await setStatus(env, tradeDate, "revenue", source.market, "PENDING", { sourceUrl: source.url, error: message });
      revenue.push({ market: source.market, status: "PENDING", error: message });
    }
  }

  const financials = [];
  for (const endpoint of FINANCIAL_ENDPOINTS) {
    try {
      const body = await officialJson(endpoint.path, `${endpoint.market} ${endpoint.dataset}`);
      financials.push(await saveFundamentalVersion(env, endpoint.dataset, endpoint.market, tradeDate, body, endpoint.path));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await setStatus(env, tradeDate, endpoint.dataset, endpoint.market, "PENDING", { sourceUrl: endpoint.path, error: message });
      financials.push({ dataset: endpoint.dataset, market: endpoint.market, status: "PENDING", error: message });
    }
  }

  const eventSources: Array<{ market: Market; url: string }> = [
    { market: "TWSE", url: `${TWSE_OPENAPI}/opendata/t187ap04_L` },
    { market: "TPEx", url: `${TPEX_OPENAPI}/mopsfin_t187ap04_O` },
  ];
  const allEvents: OfficialEvent[] = [];
  const eventResults = [];
  for (const source of eventSources) {
    try {
      const body = await officialJson(source.url, `${source.market} events`);
      const normalized = rows(body).map((row) => classifyOfficialEvent(row, source.market, tradeDate)).filter((event): event is OfficialEvent => Boolean(event));
      await saveEvents(env, normalized);
      allEvents.push(...normalized);
      const raw = await putJson(env, `market/tw/raw/${tradeDate}/${source.market.toLowerCase()}/events.json`, body, source.market);
      await setStatus(env, tradeDate, "events", source.market, "READY", {
        dataDate: tradeDate, rowCount: normalized.length, sourceUrl: source.url, r2Key: raw.key, sha256: raw.sha256,
      });
      eventResults.push({ market: source.market, status: "READY", rowCount: normalized.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await setStatus(env, tradeDate, "events", source.market, "PENDING", { sourceUrl: source.url, error: message });
      eventResults.push({ market: source.market, status: "PENDING", error: message });
    }
  }
  await putJson(env, `market/tw/daily/${tradeDate}/events.json`, { tradeDate, rows: allEvents }, "OFFICIAL");
  return { symbolMaster, revenue, financials, events: eventResults };
}

function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function githubContentsUrl(repo: string, path: string) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `https://api.github.com/repos/${repo}/contents/${encodedPath}`;
}

async function mirrorGithubFile(env: Env, path: string, content: string, message: string) {
  if (!env.MARKET_DATA_GITHUB_TOKEN) return { status: "PENDING_SECRET", path };
  const repo = env.MARKET_DATA_GITHUB_REPO || DEFAULT_GITHUB_REPO;
  const branch = env.MARKET_DATA_GITHUB_BRANCH || DEFAULT_GITHUB_BRANCH;
  const url = githubContentsUrl(repo, path);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const read = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${env.MARKET_DATA_GITHUB_TOKEN}`, "User-Agent": "Taiwan-Stock-AI-Market-Data/1.0" },
    });
    let sha: string | undefined;
    if (read.ok) {
      const current = record(await read.json());
      sha = typeof current.sha === "string" ? current.sha : undefined;
    } else if (read.status !== 404) {
      throw new Error(`GitHub read ${path} HTTP ${read.status}`);
    }
    const body: JsonRecord = { message, content: utf8Base64(content), branch };
    if (sha) body.sha = sha;
    const write = await fetch(url, {
      method: "PUT",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${env.MARKET_DATA_GITHUB_TOKEN}`, "Content-Type": "application/json", "User-Agent": "Taiwan-Stock-AI-Market-Data/1.0" },
      body: JSON.stringify(body),
    });
    if (write.ok) return { status: "READY", path };
    if ((write.status === 409 || write.status === 422) && attempt < 3) continue;
    throw new Error(`GitHub write ${path} HTTP ${write.status}: ${(await write.text()).slice(0, 300)}`);
  }
  throw new Error(`GitHub write ${path} CAS retry exhausted`);
}

async function readR2Json(env: Env, key: string): Promise<any | null> {
  const object = await env.RESEARCH_BUCKET.get(key);
  if (!object) return null;
  try { return JSON.parse(await object.text()); } catch { return null; }
}

export async function buildMarketDayManifest(env: Env, tradeDate: string) {
  const result = await env.RESEARCH_DB.prepare(`
    SELECT dataset, market, status, data_date, row_count, source_url, r2_key, sha256, fetched_at, error
    FROM market_data_status WHERE trade_date = ? ORDER BY dataset, market
  `).bind(tradeDate).all<any>();
  const statuses = result.results;
  const get = (dataset: string, market: Market) => statuses.find((row) => row.dataset === dataset && row.market === market) ?? null;
  const institutionalReady = (["TWSE", "TPEx"] as Market[]).every((market) => ["FINAL", "READY"].includes(String(get("institutional", market)?.status ?? "")));
  const marginReady = (["TWSE", "TPEx"] as Market[]).every((market) => String(get("margin", market)?.status ?? "") === "FINAL");
  const symbolReady = (["TWSE", "TPEx"] as Market[]).every((market) => String(get("symbol_master", market)?.status ?? "") === "READY");
  const overall = !symbolReady || !institutionalReady ? "READY_WITH_PENDING" : marginReady ? "MARKET_DAY_VERIFIED" : "READY_WITH_PENDING";
  const manifest = {
    schema_version: "DIAMOND_MARKET_DATA_V1",
    trade_date: tradeDate,
    generated_at: new Date().toISOString(),
    universe: "TWSE+TPEx COMMON_STOCK (4-digit, non-zero-leading symbol)",
    overall,
    gates: {
      institutional: institutionalReady ? "READY" : "PENDING",
      margin: marginReady ? "READY" : "PENDING",
      symbol_master: symbolReady ? "READY" : "PENDING",
      fundamentals: "AS_OF_NON_BLOCKING",
      events: "NON_BLOCKING",
    },
    statuses,
  };
  await putJson(env, `market/tw/daily/${tradeDate}/manifest.json`, manifest, "DIAMOND_MARKET_DATA_V1");
  return manifest;
}

async function mirrorDailySnapshot(env: Env, tradeDate: string, manifest: unknown) {
  const [institutional, margin, events] = await Promise.all([
    readR2Json(env, `market/tw/daily/${tradeDate}/institutional.json`),
    readR2Json(env, `market/tw/daily/${tradeDate}/margin.json`),
    readR2Json(env, `market/tw/daily/${tradeDate}/events.json`),
  ]);
  const [year, month, day] = tradeDate.split("-");
  const root = `data/market/tw/daily/${year}/${month}/${day}`;
  const files: Array<[string, unknown]> = [
    [`${root}/manifest.json`, manifest],
    [`${root}/institutional.json`, institutional],
    [`${root}/margin.json`, margin],
    [`${root}/events.json`, events],
  ];
  const results = [];
  for (const [path, value] of files) {
    if (value === null) continue;
    try {
      results.push(await mirrorGithubFile(env, path, `${JSON.stringify(value, null, 2)}\n`, `data: mirror Taiwan market ${tradeDate} ${path.split("/").at(-1)}`));
    } catch (error) {
      results.push({ status: "FAILED", path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

export async function getMarketDataStatus(env: Env, tradeDate = taipeiDate()) {
  await ensureMarketDataSchema(env);
  const manifest = await readR2Json(env, `market/tw/daily/${tradeDate}/manifest.json`);
  const latestRun = await env.RESEARCH_DB.prepare(`
    SELECT run_id, trade_date, phase, started_at, finished_at, status, summary_json, error_json
    FROM market_data_runs WHERE trade_date = ? ORDER BY started_at DESC LIMIT 1
  `).bind(tradeDate).first<any>();
  return { tradeDate, manifest, latestRun };
}

export async function runMarketDataPipeline(env: Env, phase: MarketDataPhase, scheduledAt = new Date()) {
  await ensureMarketDataSchema(env);
  const tradeDate = taipeiDate(scheduledAt);
  const startedAt = new Date().toISOString();
  const runId = `${tradeDate}:${phase}:${startedAt}`;
  await env.RESEARCH_DB.prepare(`
    INSERT INTO market_data_runs (run_id, trade_date, phase, started_at, status)
    VALUES (?, ?, ?, ?, 'running')
  `).bind(runId, tradeDate, phase, startedAt).run();
  try {
    let result: unknown;
    if (phase === "fundamentals") result = await collectFundamentalsAndEvents(env, tradeDate);
    else if (phase === "institutional_prelim") result = await collectInstitutional(env, tradeDate, false);
    else if (phase === "institutional_final") result = await collectInstitutional(env, tradeDate, true);
    else if (phase === "margin") result = await collectMargin(env, tradeDate);
    else {
      // Finalize is also a repair pass: re-fetch only the time-sensitive datasets so late official publication self-heals.
      const institutional = await collectInstitutional(env, tradeDate, true);
      const margin = await collectMargin(env, tradeDate);
      const manifest = await buildMarketDayManifest(env, tradeDate);
      const githubMirror = await mirrorDailySnapshot(env, tradeDate, manifest);
      result = { institutional, margin, manifest, githubMirror };
    }
    const manifest = phase === "finalize" ? record(result).manifest : await buildMarketDayManifest(env, tradeDate);
    const summary = { phase, result, manifest };
    await env.RESEARCH_DB.prepare(`
      UPDATE market_data_runs SET finished_at = ?, status = 'done', summary_json = ? WHERE run_id = ?
    `).bind(new Date().toISOString(), JSON.stringify(summary), runId).run();
    return { runId, tradeDate, status: "done", ...summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.RESEARCH_DB.prepare(`
      UPDATE market_data_runs SET finished_at = ?, status = 'failed', error_json = ? WHERE run_id = ?
    `).bind(new Date().toISOString(), JSON.stringify({ message }), runId).run();
    return { runId, tradeDate, phase, status: "failed", error: message };
  }
}

export function marketDataPhaseForCron(cron: string): MarketDataPhase | null {
  if (cron === "10 9 * * 1-5") return "fundamentals"; // 17:10 Asia/Taipei
  if (cron === "10 10 * * 1-5") return "institutional_prelim"; // 18:10
  if (cron === "10 12 * * 1-5") return "institutional_final"; // 20:10
  if (cron === "10 13 * * 1-5" || cron === "30 13 * * 1-5") return "margin"; // 21:10 / 21:30
  if (cron === "10 14 * * 1-5" || cron === "30 14 * * 1-5") return "finalize"; // 22:10 / 22:30
  return null;
}
