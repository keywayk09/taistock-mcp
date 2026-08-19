import {
  institutionalWindows,
  marginWindows,
  normalizeTradeDate,
  normalizeTpexInstitutional,
  normalizeTpexMargin,
  normalizeTwseInstitutional,
  normalizeTwseMargin,
  type InstitutionalRow,
  type MarginRow,
  type TwMarket,
  type TwMarketDataKind,
} from "./tw-market-data";

export const TW_MARKET_DATA_VERSION = "diamond-tw-market-data/v1.1.1-d1";

const TWSE_T86 = "https://www.twse.com.tw/rwd/zh/fund/T86";
const TWSE_MARGIN = "https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN";
const TPEX_INSTITUTIONAL = "https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading";
const TPEX_MARGIN = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance";
const FINMIND = "https://api.finmindtrade.com/api/v4/data";
const WINDOWS_CALENDAR_DAYS = 90;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tw_market_data_snapshot_d1 (
    dataset_version TEXT PRIMARY KEY,
    trade_date TEXT NOT NULL,
    market TEXT NOT NULL,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    source_date_verified INTEGER NOT NULL,
    row_count INTEGER NOT NULL,
    status TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    error TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tw_market_data_d1_date_kind
    ON tw_market_data_snapshot_d1(kind, trade_date, market, captured_at DESC)`,
  `CREATE TABLE IF NOT EXISTS tw_market_data_row_d1 (
    dataset_version TEXT NOT NULL,
    symbol TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY(dataset_version, symbol)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tw_market_data_d1_symbol
    ON tw_market_data_row_d1(symbol, dataset_version)`,
] as const;

function rec(value: unknown): Record<string, any> {
  return value !== null && typeof value === "object" ? value as Record<string, any> : {};
}

function taipeiDate(ms = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function compactDate(date: string) { return date.replace(/-/g, ""); }

function subtractDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function marketNumber(value: unknown): number {
  const text = String(value ?? "").replace(/,/g, "").trim();
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

function nullableNumber(value: unknown): number | null {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text || ["--", "---", "null", "undefined"].includes(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function sourceDateFromBody(body: unknown): string | null {
  const root = rec(body);
  const direct = normalizeTradeDate(root.date ?? root.Date ?? root["資料日期"] ?? root["日期"]);
  if (direct) return direct;
  const rows = Array.isArray(body) ? body : Array.isArray(root.data) ? root.data : [];
  for (const value of rows) {
    const row = rec(value);
    const date = normalizeTradeDate(row.Date ?? row.date ?? row["資料日期"] ?? row["日期"] ?? row.TradeDate);
    if (date) return date;
  }
  return null;
}

async function fetchJson(url: URL | string, label: string) {
  const target = String(url);
  const isTpex = target.includes("tpex.org.tw/");
  const response = await fetch(url, {
    cache: "no-store",
    headers: isTpex ? {
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
      Referer: "https://www.tpex.org.tw/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    } : {
      Accept: "application/json",
      "User-Agent": "Diamond-Market-Data-D1/1.1",
    },
  });
  const text = await response.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) throw new Error(`${label}_http_${response.status}:${text.slice(0, 200)}`);
  if (typeof body === "string") throw new Error(`${label}_invalid_json:${text.slice(0, 200)}`);
  return body;
}

async function finmind(env: Env, dataset: string, params: Record<string, string>) {
  if (!env.FINMIND_TOKEN) throw new Error("FINMIND_TOKEN_not_configured");
  const url = new URL(FINMIND);
  url.searchParams.set("dataset", dataset);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${env.FINMIND_TOKEN}` },
  });
  const body = await response.json<any>();
  if (!response.ok || !Array.isArray(body?.data)) throw new Error(`FinMind_${dataset}_http_${response.status}`);
  return body.data as Record<string, any>[];
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
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(stableValue(value))));
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function ensureTwMarketDataD1Schema(env: Env) {
  if (!env.RESEARCH_DB) throw new Error("RESEARCH_DB_binding_required");
  await env.RESEARCH_DB.batch(SCHEMA.map((sql) => env.RESEARCH_DB.prepare(sql)));
}

async function fetchOfficialInstitutional(market: TwMarket, tradeDate: string) {
  if (market === "listed") {
    const url = new URL(TWSE_T86);
    url.searchParams.set("date", compactDate(tradeDate));
    url.searchParams.set("selectType", "ALLBUT0999");
    url.searchParams.set("response", "json");
    const body = await fetchJson(url, "TWSE_T86");
    const rows = normalizeTwseInstitutional(body, tradeDate);
    const sourceDate = sourceDateFromBody(body) ?? normalizeTradeDate(rec(body).date);
    return { rows, source: "TWSE_T86", source_date: sourceDate, source_date_verified: sourceDate === tradeDate };
  }
  const body = await fetchJson(TPEX_INSTITUTIONAL, "TPEX_3INSTI");
  const rows = normalizeTpexInstitutional(body, tradeDate);
  const sourceDate = sourceDateFromBody(body);
  return { rows, source: "TPEX_3INSTI_DAILY_TRADING", source_date: sourceDate, source_date_verified: sourceDate === tradeDate };
}

async function fetchOfficialMargin(market: TwMarket, tradeDate: string) {
  if (market === "listed") {
    const url = new URL(TWSE_MARGIN);
    url.searchParams.set("date", compactDate(tradeDate));
    url.searchParams.set("selectType", "ALL");
    url.searchParams.set("response", "json");
    const body = await fetchJson(url, "TWSE_MI_MARGN");
    const rows = normalizeTwseMargin(body, tradeDate);
    const sourceDate = sourceDateFromBody(body) ?? normalizeTradeDate(rec(body).date);
    return { rows, source: "TWSE_MI_MARGN", source_date: sourceDate, source_date_verified: sourceDate === tradeDate };
  }
  const body = await fetchJson(TPEX_MARGIN, "TPEX_MARGIN");
  const rows = normalizeTpexMargin(body, tradeDate);
  const sourceDate = sourceDateFromBody(body);
  return { rows, source: "TPEX_MAINBOARD_MARGIN_BALANCE", source_date: sourceDate, source_date_verified: sourceDate === tradeDate };
}

async function archiveD1Snapshot(env: Env, input: {
  trade_date: string;
  market: TwMarket;
  kind: TwMarketDataKind;
  source: string;
  source_date_verified: boolean;
  rows: Array<InstitutionalRow | MarginRow>;
}) {
  await ensureTwMarketDataD1Schema(env);
  if (!input.source_date_verified) throw new Error(`source_date_not_verified:${input.kind}:${input.market}:${input.trade_date}`);
  if (!input.rows.length) throw new Error(`official_rows_empty:${input.kind}:${input.market}:${input.trade_date}`);
  const rows = [...input.rows].sort((a, b) => a.symbol.localeCompare(b.symbol));
  const content = { schema_version: TW_MARKET_DATA_VERSION, trade_date: input.trade_date, market: input.market, kind: input.kind, source: input.source, rows };
  const hash = await sha256(content);
  const datasetVersion = `sha256:${hash}`;
  const capturedAt = new Date().toISOString();

  const existing = await env.RESEARCH_DB.prepare(
    `SELECT dataset_version,row_count FROM tw_market_data_snapshot_d1 WHERE dataset_version=?`
  ).bind(datasetVersion).first<any>();

  if (!existing) {
    const statements = rows.map((row) => env.RESEARCH_DB.prepare(
      `INSERT OR IGNORE INTO tw_market_data_row_d1(dataset_version,symbol,payload_json) VALUES(?,?,?)`
    ).bind(datasetVersion, row.symbol, JSON.stringify(row)));
    for (let i = 0; i < statements.length; i += 50) await env.RESEARCH_DB.batch(statements.slice(i, i + 50));
    await env.RESEARCH_DB.prepare(`INSERT INTO tw_market_data_snapshot_d1(
      dataset_version,trade_date,market,kind,source,source_date_verified,row_count,status,content_sha256,captured_at,error
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(
      datasetVersion,input.trade_date,input.market,input.kind,input.source,1,rows.length,"READY",hash,capturedAt,null,
    ).run();
  }

  return {
    ok: true as const,
    idempotent: Boolean(existing),
    dataset_version: datasetVersion,
    storage: "D1_ONLY" as const,
    captured_at: existing ? null : capturedAt,
  };
}

export async function runTwMarketDataDaily(env: Env, tradeDate = taipeiDate()) {
  await ensureTwMarketDataD1Schema(env);
  const jobs: Array<{kind:TwMarketDataKind;market:TwMarket}> = [
    { kind:"institutional", market:"listed" },
    { kind:"institutional", market:"otc" },
    { kind:"margin", market:"listed" },
    { kind:"margin", market:"otc" },
  ];
  const results:any[] = [];
  for (const job of jobs) {
    try {
      const fetched = job.kind === "institutional"
        ? await fetchOfficialInstitutional(job.market, tradeDate)
        : await fetchOfficialMargin(job.market, tradeDate);
      if (!fetched.source_date_verified) {
        throw new Error(`official_source_date_mismatch:expected=${tradeDate}:actual=${fetched.source_date ?? "unknown"}`);
      }
      if (!fetched.rows.length) throw new Error("official_source_empty");
      const archived = await archiveD1Snapshot(env, {
        trade_date: tradeDate,
        market: job.market,
        kind: job.kind,
        source: fetched.source,
        source_date_verified: true,
        rows: fetched.rows,
      });
      results.push({ ...job, status:"READY", rows:fetched.rows.length, source:fetched.source, source_date:fetched.source_date, ...archived });
    } catch (error) {
      results.push({ ...job, status:"DEGRADED", rows:0, error:error instanceof Error ? error.message : String(error) });
    }
  }
  const ready = results.filter((x) => x.status === "READY").length;
  return {
    ok:true,
    version:TW_MARKET_DATA_VERSION,
    storage:"D1_ONLY",
    trade_date:tradeDate,
    status:ready === results.length ? "READY" : ready ? "DEGRADED" : "UNAVAILABLE",
    blocking:false,
    market_data_failure_blocks_ohlc:false,
    ready_count:ready,
    total_count:results.length,
    results,
  };
}

async function loadOfficialRows(env: Env, kind: TwMarketDataKind, symbol: string, asOf: string) {
  await ensureTwMarketDataD1Schema(env);
  const result = await env.RESEARCH_DB.prepare(`
    SELECT s.dataset_version,s.trade_date,s.market,s.source,s.row_count,s.captured_at,r.payload_json
    FROM tw_market_data_snapshot_d1 s
    JOIN tw_market_data_row_d1 r ON r.dataset_version=s.dataset_version
    WHERE s.kind=? AND s.trade_date<=? AND s.status='READY' AND r.symbol=?
    ORDER BY s.trade_date DESC,s.captured_at DESC
    LIMIT 200
  `).bind(kind,asOf,symbol).all<any>();
  const rows:any[] = [];
  const datasets:any[] = [];
  const seen = new Set<string>();
  for (const item of result.results) {
    const key = `${item.trade_date}|${item.market}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const row = JSON.parse(String(item.payload_json));
      rows.push(row);
      datasets.push({ dataset_version:item.dataset_version,trade_date:item.trade_date,market:item.market,source:item.source,row_count:item.row_count,storage:"D1_ONLY" });
    } catch {}
  }
  rows.sort((a,b) => String(a.trade_date).localeCompare(String(b.trade_date)));
  return { rows, datasets };
}

function normalizeFinmindInstitutional(rows: Record<string, any>[], symbol: string): InstitutionalRow[] {
  const grouped = new Map<string, InstitutionalRow>();
  for (const row of rows) {
    const date = normalizeTradeDate(row.date);
    if (!date) continue;
    const current = grouped.get(date) ?? {
      trade_date:date,symbol,name:"",market:"listed" as TwMarket,
      foreign_net_shares:0,trust_net_shares:0,dealer_net_shares:0,total_net_shares:0,
      source:"FINMIND_HISTORY",source_priority:"FALLBACK" as const,
    };
    const category = String(row.name ?? row.type ?? row.institutional_investors ?? "").toLowerCase();
    const net = marketNumber(row.buy) - marketNumber(row.sell);
    if (/foreign|外資|陸資/.test(category)) current.foreign_net_shares += net;
    else if (/trust|投信/.test(category)) current.trust_net_shares += net;
    else if (/dealer|自營/.test(category)) current.dealer_net_shares += net;
    current.total_net_shares = current.foreign_net_shares + current.trust_net_shares + current.dealer_net_shares;
    grouped.set(date,current);
  }
  return [...grouped.values()].sort((a,b)=>a.trade_date.localeCompare(b.trade_date));
}

function normalizeFinmindMargin(rows: Record<string, any>[], symbol: string): MarginRow[] {
  return rows.map((row): MarginRow | null => {
    const date = normalizeTradeDate(row.date);
    if (!date) return null;
    const marginPrev = nullableNumber(row.MarginPurchaseYesterdayBalance);
    const marginNow = nullableNumber(row.MarginPurchaseTodayBalance);
    const shortPrev = nullableNumber(row.ShortSaleYesterdayBalance);
    const shortNow = nullableNumber(row.ShortSaleTodayBalance);
    return {
      trade_date:date,symbol,name:"",market:"listed",
      margin_previous_balance_lots:marginPrev,
      margin_balance_lots:marginNow,
      margin_balance_change_lots:marginNow !== null && marginPrev !== null ? marginNow-marginPrev : null,
      short_previous_balance_lots:shortPrev,
      short_balance_lots:shortNow,
      short_balance_change_lots:shortNow !== null && shortPrev !== null ? shortNow-shortPrev : null,
      source:"FINMIND_HISTORY",source_priority:"FALLBACK",
    };
  }).filter((x):x is MarginRow=>Boolean(x)).sort((a,b)=>a.trade_date.localeCompare(b.trade_date));
}

function mergeByDate<T extends {trade_date:string;source_priority:"OFFICIAL"|"FALLBACK"}>(fallback:T[], official:T[]) {
  const map = new Map<string,T>();
  for (const row of fallback) map.set(row.trade_date,row);
  for (const row of official) map.set(row.trade_date,row);
  return [...map.values()].sort((a,b)=>a.trade_date.localeCompare(b.trade_date));
}

export async function getTwInstitutionalFlow(env: Env, input: {symbol:string;as_of?:string;calendar_days?:number}) {
  const asOf = input.as_of ?? taipeiDate();
  const calendarDays = Math.max(30,Math.min(180,Number(input.calendar_days ?? 60)));
  const official = await loadOfficialRows(env,"institutional",input.symbol,asOf);
  let fallback:InstitutionalRow[] = [], fallbackError:string|null = null;
  try {
    fallback = normalizeFinmindInstitutional(await finmind(env,"TaiwanStockInstitutionalInvestorsBuySell",{
      data_id:input.symbol,start_date:subtractDays(asOf,calendarDays),end_date:asOf,
    }),input.symbol);
  } catch (error) { fallbackError=error instanceof Error?error.message:String(error); }
  const rows = mergeByDate(fallback,official.rows as InstitutionalRow[]).slice(-120);
  const officialDays = rows.filter((x)=>x.source_priority==="OFFICIAL").length;
  return {
    ok:true,version:TW_MARKET_DATA_VERSION,storage:"D1_ONLY",symbol:input.symbol,as_of:asOf,
    status:rows.length ? (officialDays ? "READY" : "DEGRADED") : "UNAVAILABLE",blocking:false,
    source_priority:["TWSE/TPEx official D1 snapshot","FinMind fallback/history"],
    data_quality:{official_days:officialDays,total_days:rows.length,fallback_error:fallbackError},
    windows:institutionalWindows(rows),rows,datasets:official.datasets,
  };
}

export async function getTwMarginShort(env: Env, input: {symbol:string;as_of?:string;calendar_days?:number}) {
  const asOf = input.as_of ?? taipeiDate();
  const calendarDays = Math.max(30,Math.min(180,Number(input.calendar_days ?? 60)));
  const official = await loadOfficialRows(env,"margin",input.symbol,asOf);
  let fallback:MarginRow[] = [], fallbackError:string|null = null;
  try {
    fallback = normalizeFinmindMargin(await finmind(env,"TaiwanStockMarginPurchaseShortSale",{
      data_id:input.symbol,start_date:subtractDays(asOf,calendarDays),end_date:asOf,
    }),input.symbol);
  } catch (error) { fallbackError=error instanceof Error?error.message:String(error); }
  const rows = mergeByDate(fallback,official.rows as MarginRow[]).slice(-120);
  const officialDays = rows.filter((x)=>x.source_priority==="OFFICIAL").length;
  return {
    ok:true,version:TW_MARKET_DATA_VERSION,storage:"D1_ONLY",symbol:input.symbol,as_of:asOf,
    status:rows.length ? (officialDays ? "READY" : "DEGRADED") : "UNAVAILABLE",blocking:false,
    source_priority:["TWSE/TPEx official D1 snapshot","FinMind fallback/history"],
    data_quality:{official_days:officialDays,total_days:rows.length,fallback_error:fallbackError},
    ...marginWindows(rows),rows,datasets:official.datasets,
  };
}

export async function getTwMarketDataBundle(env: Env, input: {symbol:string;as_of?:string;calendar_days?:number}) {
  const [institutional,margin] = await Promise.all([getTwInstitutionalFlow(env,input),getTwMarginShort(env,input)]);
  const degradedLayers = [institutional.status==="READY"?null:"institutional",margin.status==="READY"?null:"margin"].filter(Boolean);
  return {
    ok:true,version:TW_MARKET_DATA_VERSION,storage:"D1_ONLY",symbol:input.symbol,as_of:input.as_of ?? taipeiDate(),
    status:degradedLayers.length ? (degradedLayers.length===2&&institutional.status==="UNAVAILABLE"&&margin.status==="UNAVAILABLE"?"UNAVAILABLE":"DEGRADED") : "READY",
    degraded_layers:degradedLayers,market_data_blocks_ohlc:false,ohlc_dependency:"OHLC_MCP_ONLY",
    formal_swing_policy:"JOIN_OHLC_WITH_DIAMOND_MARKET_DATA; NEVER SUBSTITUTE FINMIND_PRICE_FOR_OHLC",
    institutional,margin,
  };
}

export async function getTwMarketDataStatus(env: Env, tradeDate?:string) {
  await ensureTwMarketDataD1Schema(env);
  const date = tradeDate ?? taipeiDate();
  const result = await env.RESEARCH_DB.prepare(`
    SELECT trade_date,market,kind,source,row_count,status,source_date_verified,dataset_version,captured_at,error
    FROM tw_market_data_snapshot_d1 WHERE trade_date<=?
    ORDER BY trade_date DESC,captured_at DESC LIMIT 80
  `).bind(date).all<any>();
  const latest = new Map<string,any>();
  for (const row of result.results) {
    const key=`${row.kind}|${row.market}`;
    if(!latest.has(key)) latest.set(key,row);
  }
  const layers=[...latest.values()];
  const exact=layers.filter((x)=>x.trade_date===date&&x.status==="READY"&&Number(x.source_date_verified)===1).length;
  return {
    ok:true,version:TW_MARKET_DATA_VERSION,storage:"D1_ONLY",requested_trade_date:date,
    status:exact===4?"READY":layers.length?"DEGRADED":"UNAVAILABLE",blocking:false,
    market_data_failure_blocks_ohlc:false,expected_layers:4,exact_ready_layers:exact,layers,
  };
}
