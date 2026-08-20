import { readGitHubJson } from "./github-data-store.ts";
import {
  institutionalWindows,
  marginWindows,
  marketNumber,
  normalizeTradeDate,
  securitiesLendingWindows,
  sblShortSaleWindows,
  type InstitutionalRow,
  type MarginRow,
  type SecuritiesLendingRow,
  type SblShortSaleRow,
  type TwMarketDataKind,
} from "./tw-market-data.ts";

export const TW_MARKET_DATA_VERSION = "diamond-tw-market-data/v2.0.0-github";
const FINMIND = "https://api.finmindtrade.com/api/v4/data";

export type MarketDataManifestLayer = {
  kind: TwMarketDataKind;
  market: "listed" | "otc";
  status: "READY" | "DEGRADED" | "MISSING";
  source: string | null;
  row_count: number;
  dataset_version: string | null;
  content_sha256: string | null;
  snapshot_path: string | null;
  captured_at: string | null;
  error?: string | null;
};

export type MarketDataManifest = {
  schema_version: "diamond-market-data-manifest/v2";
  trade_date: string;
  storage: "GITHUB_ONLY";
  layers: MarketDataManifestLayer[];
  updated_at: string;
};

type SymbolMonthShard = {
  schema_version: "diamond-market-data-symbol-shard/v2";
  month: string;
  prefix: string;
  symbols: Record<string, Partial<Record<TwMarketDataKind, any[]>>>;
  updated_at: string;
};

function taipeiDate(ms = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ms));
}

function subtractDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function monthRange(start: string, end: string) {
  const cursor = new Date(`${start.slice(0,7)}-01T00:00:00Z`);
  const last = new Date(`${end.slice(0,7)}-01T00:00:00Z`);
  const out: string[] = [];
  while (cursor <= last) {
    out.push(cursor.toISOString().slice(0,7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

function manifestPath(date: string) {
  const [y,m,d] = date.split("-");
  return `data/market-data/daily/${y}/${m}/${d}/manifest.json`;
}

function shardPath(month: string, symbol: string) {
  const [year, mon] = month.split("-");
  const prefix = symbol.slice(0,2);
  return `data/market-data/index/${year}/${mon}/${prefix}.json`;
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

function nullableNumber(value: unknown): number | null {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text || ["--", "---", "null", "undefined"].includes(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function normalizeFinmindInstitutional(rows: Record<string, any>[], symbol: string): InstitutionalRow[] {
  const grouped = new Map<string, InstitutionalRow>();
  for (const row of rows) {
    const date = normalizeTradeDate(row.date);
    if (!date) continue;
    const current = grouped.get(date) ?? {
      trade_date:date,symbol,name:"",market:"listed",
      foreign_net_shares:0,trust_net_shares:0,dealer_net_shares:0,total_net_shares:0,
      source:"FINMIND_HISTORY",source_priority:"FALLBACK",
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
      margin_previous_balance_lots:marginPrev,margin_balance_lots:marginNow,
      margin_balance_change_lots:marginNow !== null && marginPrev !== null ? marginNow-marginPrev : null,
      short_previous_balance_lots:shortPrev,short_balance_lots:shortNow,
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

async function loadOfficialRows<T>(env: Env, kind: TwMarketDataKind, symbol: string, asOf: string, calendarDays = 90) {
  const start = subtractDays(asOf, calendarDays);
  const months = monthRange(start, asOf);
  const reads = await Promise.all(months.map((month) => readGitHubJson<SymbolMonthShard>(env, shardPath(month, symbol))));
  const rows:T[] = [];
  const datasets:any[] = [];
  for (const read of reads) {
    const shard = read.value;
    const kindRows = shard?.symbols?.[symbol]?.[kind] ?? [];
    for (const row of kindRows) {
      const date = String((row as any).trade_date ?? "");
      if (date >= start && date <= asOf) rows.push(row as T);
    }
    if (kindRows.length) datasets.push({ path:read.path, sha:read.sha, storage:"GITHUB_ONLY" });
  }
  rows.sort((a:any,b:any)=>String(a.trade_date).localeCompare(String(b.trade_date)));
  return { rows, datasets };
}

export async function getTwInstitutionalFlow(env: Env, input: {symbol:string;as_of?:string;calendar_days?:number}) {
  const asOf = input.as_of ?? taipeiDate();
  const calendarDays = Math.max(30,Math.min(180,Number(input.calendar_days ?? 60)));
  const official = await loadOfficialRows<InstitutionalRow>(env,"institutional",input.symbol,asOf,calendarDays);
  let fallback:InstitutionalRow[] = [], fallbackError:string|null = null;
  try {
    fallback = normalizeFinmindInstitutional(await finmind(env,"TaiwanStockInstitutionalInvestorsBuySell",{
      data_id:input.symbol,start_date:subtractDays(asOf,calendarDays),end_date:asOf,
    }),input.symbol);
  } catch (error) { fallbackError=error instanceof Error?error.message:String(error); }
  const rows = mergeByDate(fallback,official.rows).slice(-120);
  const officialDays = rows.filter((x)=>x.source_priority==="OFFICIAL").length;
  return {
    ok:true,version:TW_MARKET_DATA_VERSION,storage:"GITHUB_ONLY",symbol:input.symbol,as_of:asOf,
    status:rows.length ? (officialDays ? "READY" : "DEGRADED") : "UNAVAILABLE",blocking:false,
    source_priority:["TWSE/TPEx official GitHub archive","FinMind fallback/history"],
    data_quality:{official_days:officialDays,total_days:rows.length,fallback_error:fallbackError},
    windows:institutionalWindows(rows),rows,datasets:official.datasets,
  };
}

export async function getTwMarginShort(env: Env, input: {symbol:string;as_of?:string;calendar_days?:number}) {
  const asOf = input.as_of ?? taipeiDate();
  const calendarDays = Math.max(30,Math.min(180,Number(input.calendar_days ?? 60)));
  const official = await loadOfficialRows<MarginRow>(env,"margin",input.symbol,asOf,calendarDays);
  let fallback:MarginRow[] = [], fallbackError:string|null = null;
  try {
    fallback = normalizeFinmindMargin(await finmind(env,"TaiwanStockMarginPurchaseShortSale",{
      data_id:input.symbol,start_date:subtractDays(asOf,calendarDays),end_date:asOf,
    }),input.symbol);
  } catch (error) { fallbackError=error instanceof Error?error.message:String(error); }
  const rows = mergeByDate(fallback,official.rows).slice(-120);
  const officialDays = rows.filter((x)=>x.source_priority==="OFFICIAL").length;
  return {
    ok:true,version:TW_MARKET_DATA_VERSION,storage:"GITHUB_ONLY",symbol:input.symbol,as_of:asOf,
    status:rows.length ? (officialDays ? "READY" : "DEGRADED") : "UNAVAILABLE",blocking:false,
    source_priority:["TWSE/TPEx official GitHub archive","FinMind fallback/history"],
    data_quality:{official_days:officialDays,total_days:rows.length,fallback_error:fallbackError},
    ...marginWindows(rows),rows,datasets:official.datasets,
  };
}

export async function getTwSecuritiesLending(env: Env, input: {symbol:string;as_of?:string;calendar_days?:number}) {
  const asOf = input.as_of ?? taipeiDate();
  const calendarDays = Math.max(30,Math.min(180,Number(input.calendar_days ?? 60)));
  const official = await loadOfficialRows<SecuritiesLendingRow>(env,"securities_lending",input.symbol,asOf,calendarDays);
  const rows = official.rows.slice(-120);
  return {
    ok:true,version:TW_MARKET_DATA_VERSION,storage:"GITHUB_ONLY",symbol:input.symbol,as_of:asOf,
    status:rows.length ? "READY" : "UNAVAILABLE",blocking:false,
    terminology:{ returned_shares:"官方還券/了結股數；可作借券回補完成量觀察，不等同盤中買回成交量" },
    ...securitiesLendingWindows(rows),rows,datasets:official.datasets,
  };
}

export async function getTwSblShortSale(env: Env, input: {symbol:string;as_of?:string;calendar_days?:number}) {
  const asOf = input.as_of ?? taipeiDate();
  const calendarDays = Math.max(30,Math.min(180,Number(input.calendar_days ?? 60)));
  const official = await loadOfficialRows<SblShortSaleRow>(env,"sbl_short_sale",input.symbol,asOf,calendarDays);
  const rows = official.rows.slice(-120);
  return {
    ok:true,version:TW_MARKET_DATA_VERSION,storage:"GITHUB_ONLY",symbol:input.symbol,as_of:asOf,
    status:rows.length ? "READY" : "UNAVAILABLE",blocking:false,
    terminology:{ returned_shares:"借券賣出還券/回補後返還量", balance_shares:"借券賣出尚未回補餘額" },
    ...sblShortSaleWindows(rows),rows,datasets:official.datasets,
  };
}

export async function getTwMarketDataBundle(env: Env, input: {symbol:string;as_of?:string;calendar_days?:number}) {
  const [institutional,margin,securitiesLending,sblShortSale] = await Promise.all([
    getTwInstitutionalFlow(env,input), getTwMarginShort(env,input), getTwSecuritiesLending(env,input), getTwSblShortSale(env,input),
  ]);
  const layers = { institutional, margin, securities_lending:securitiesLending, sbl_short_sale:sblShortSale };
  const degradedLayers = Object.entries(layers).filter(([,value])=>value.status!=="READY").map(([key])=>key);
  return {
    ok:true,version:TW_MARKET_DATA_VERSION,storage:"GITHUB_ONLY",symbol:input.symbol,as_of:input.as_of ?? taipeiDate(),
    status:degradedLayers.length ? (degradedLayers.length===4?"UNAVAILABLE":"DEGRADED") : "READY",
    degraded_layers:degradedLayers,market_data_blocks_ohlc:false,ohlc_dependency:"OHLC_MCP_ONLY",
    formal_swing_policy:"JOIN_OHLC_WITH_DIAMOND_MARKET_DATA; NEVER_SUBSTITUTE_FINMIND_PRICE_FOR_OHLC",
    ...layers,
  };
}

export async function getTwMarketDataStatus(env: Env, tradeDate?:string) {
  const date = tradeDate ?? taipeiDate();
  const manifest = await readGitHubJson<MarketDataManifest>(env, manifestPath(date));
  const layers = manifest.value?.layers ?? [];
  const exactReady = layers.filter((x)=>x.status==="READY").length;
  const expected = 8;
  return {
    ok:true,version:TW_MARKET_DATA_VERSION,storage:"GITHUB_ONLY",requested_trade_date:date,
    status:exactReady===expected?"READY":layers.length?"DEGRADED":"UNAVAILABLE",blocking:false,
    market_data_failure_blocks_ohlc:false,expected_layers:expected,exact_ready_layers:exactReady,
    manifest_path:manifest.path,manifest_sha:manifest.sha,layers,
  };
}
