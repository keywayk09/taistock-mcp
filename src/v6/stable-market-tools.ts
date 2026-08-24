import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  arr,
  fetchJson,
  fugle,
  normalizeQuote,
  rec,
  round,
  type Obj,
} from "./common";
import { probeGitHubDataRead } from "./github-user-data";

/**
 * Frozen full-market source contract.
 *
 * Required market-wide path:
 * - TWSE quotes: TWSE OpenAPI STOCK_DAY_ALL
 * - TPEx universe: MOPSFIN t187ap03_O.csv
 * - TPEx quotes: TWSE MIS otc_<symbol>.tw batches
 *
 * Fugle market snapshots/rankings and FinMind are intentionally NOT required
 * for market-wide scanning. They previously failed from Cloudflare egress with
 * 403 / invalid-token errors and must not be reintroduced into this required
 * path without an explicit source-contract migration and regression test.
 */
export const STABLE_MARKET_TOOLS_VERSION = "stable-market-tools/v1.0.0";
export const STABLE_MARKET_SOURCE_CONTRACT = "tw-full-market-source-contract/v1.0.0";

const TWSE_QUOTES_URL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";
const MOPSFIN_TWSE_COMPANIES_CSV = "https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv";
const MOPSFIN_TPEX_COMPANIES_CSV = "https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv";
const TWSE_MIS_URL = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp";
const CBC_FX_DAILY = "https://cpx.cbc.gov.tw/api/OpenData/FTDOpenData_Day";
const USER_AGENT = "taistock-mcp-stable-market/1.0 (+https://github.com/keywayk09/taistock-mcp)";
const MIS_BATCH_SIZE = 100;
const MIN_COVERAGE = { TWSE: 400, TPEx: 250 } as const;
const CACHE_TTL_MS = 15_000;

type StableMarket = "TWSE" | "TPEx";
type LegacyMarket = "TSE" | "OTC";

export type StableSnapshotRow = {
  market: StableMarket;
  symbol: string;
  name: string;
  sector: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  previous_close: number | null;
  change: number | null;
  change_percent: number | null;
  trade_volume: number | null;
  trade_value: number;
  last_updated: string | null;
  source: string;
  trade_value_basis: "official" | "last_x_volume_estimate";
};

type MarketSnapshot = {
  market: StableMarket;
  provider: string;
  rows: StableSnapshotRow[];
  raw_count: number;
  normalized_count: number;
  errors: string[];
};

export type StableMarketUniverse = {
  version: string;
  source_contract: string;
  retrieved_at: string;
  TWSE: MarketSnapshot;
  TPEx: MarketSnapshot;
  rows: StableSnapshotRow[];
  usable: boolean;
  optional_metadata_errors: string[];
};

type CompanyMeta = { symbol: string; name: string; sector: string };

let cachedUniverse: { at: number; value: StableMarketUniverse } | null = null;
let inflightUniverse: Promise<StableMarketUniverse> | null = null;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[\s_()（）%％:：/\\.\-]/g, "");
}

function numberValue(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!text || text === "-" || text === "--" || text === "N/A") return null;
  const parsed = Number(text.replace(/,/g, "").replace(/[+Xx]/g, "").replace(/%$/, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function isOrdinaryStock(symbol: string, name: string) {
  if (!/^\d{4}$/.test(symbol.trim())) return false;
  return !/(ETF|ETN|指數|債券|債|權證|正2|反1|槓桿|特別股)/i.test(name);
}

function rowsFromBody(body: unknown): Obj[] {
  if (Array.isArray(body)) return body.map(rec);
  const root = rec(body);
  if (Array.isArray(root.data)) return root.data.map(rec);
  const nested = rec(root.data);
  if (Array.isArray(nested.data)) return nested.data.map(rec);
  if (Array.isArray(nested.quotes)) return nested.quotes.map(rec);
  if (Array.isArray(root.quotes)) return root.quotes.map(rec);
  return [];
}

function objectPick(row: Obj, aliases: string[]) {
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const target = normalizedKey(alias);
    const exact = keys.find((key) => normalizedKey(key) === target);
    if (exact) return row[exact];
  }
  for (const alias of aliases) {
    const target = normalizedKey(alias);
    const fuzzy = keys.find((key) => normalizedKey(key).includes(target));
    if (fuzzy) return row[fuzzy];
  }
  return null;
}

function parseCsv(text: string) {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index++) {
    const ch = input[index];
    if (quoted) {
      if (ch === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n") {
      row.push(field.trim());
      field = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) {
    row.push(field.trim());
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  return rows;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function loadCompanyMaster(url: string, market: StableMarket) {
  const response = await fetchWithTimeout(url, {
    redirect: "manual",
    headers: {
      Accept: "text/csv,text/plain,*/*",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
      "User-Agent": USER_AGENT,
    },
  });
  const location = response.headers.get("location");
  const text = await response.text();
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`MOPSFIN ${market} company CSV HTTP ${response.status} redirect blocked${location ? ` -> ${location}` : ""}`);
  }
  if (!response.ok) throw new Error(`MOPSFIN ${market} company CSV HTTP ${response.status}: ${text.slice(0, 180)}`);
  const table = parseCsv(text);
  if (table.length < 2) throw new Error(`MOPSFIN ${market} company CSV empty`);
  const header = table[0].map((value) => value.trim());
  const findIndex = (names: string[]) => header.findIndex((value) => names.some((name) => normalizedKey(value).includes(normalizedKey(name))));
  const symbolIndex = findIndex(["公司代號", "證券代號"]);
  const shortNameIndex = findIndex(["公司簡稱", "證券簡稱"]);
  const fullNameIndex = findIndex(["公司名稱", "證券名稱"]);
  const sectorIndex = findIndex(["產業別", "產業類別", "產業"]);
  const universe = table.slice(1).flatMap((cells) => {
    const symbol = String(cells[symbolIndex >= 0 ? symbolIndex : 1] ?? "").trim();
    const name = String(cells[shortNameIndex >= 0 ? shortNameIndex : (fullNameIndex >= 0 ? fullNameIndex : 2)] ?? "").trim();
    if (!isOrdinaryStock(symbol, name)) return [];
    return [{ symbol, name, sector: sectorIndex >= 0 ? String(cells[sectorIndex] ?? "").trim() : "" } satisfies CompanyMeta];
  });
  const deduped = new Map(universe.map((item) => [item.symbol, item]));
  return [...deduped.values()];
}

async function loadTwseOfficial(meta: Map<string, CompanyMeta>): Promise<MarketSnapshot> {
  try {
    const response = await fetchWithTimeout(TWSE_QUOTES_URL, {
      redirect: "manual",
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`TWSE OpenAPI HTTP ${response.status}: ${text.slice(0, 180)}`);
    const raw = rowsFromBody(JSON.parse(text));
    const rows = raw.flatMap((item) => {
      const symbol = String(objectPick(item, ["Code", "證券代號", "股票代號", "代號"]) ?? "").trim();
      const fallbackMeta = meta.get(symbol);
      const name = String(objectPick(item, ["Name", "證券名稱", "股票名稱", "名稱"]) ?? fallbackMeta?.name ?? "").trim();
      if (!isOrdinaryStock(symbol, name)) return [];
      const close = numberValue(objectPick(item, ["ClosingPrice", "Close", "收盤價", "收盤"]));
      if (close == null || close <= 0) return [];
      const change = numberValue(objectPick(item, ["Change", "ChangeAmount", "漲跌價差", "漲跌"]));
      const previous = change == null ? null : close - change;
      const tradeValue = numberValue(objectPick(item, ["TradeValue", "TradingValue", "TradingAmount", "成交金額", "成交值"])) ?? 0;
      return [{
        market: "TWSE" as const,
        symbol,
        name,
        sector: fallbackMeta?.sector ?? "",
        open: numberValue(objectPick(item, ["OpeningPrice", "Open", "開盤價"])),
        high: numberValue(objectPick(item, ["HighestPrice", "High", "最高價"])),
        low: numberValue(objectPick(item, ["LowestPrice", "Low", "最低價"])),
        close,
        previous_close: previous,
        change,
        change_percent: previous != null && previous > 0 ? round((close / previous - 1) * 100, 2) : null,
        trade_volume: numberValue(objectPick(item, ["TradeVolume", "TradingShares", "成交股數", "成交量"])),
        trade_value: tradeValue,
        last_updated: String(objectPick(item, ["Date", "TradeDate", "日期"]) ?? "").trim() || null,
        source: "TWSE OpenAPI STOCK_DAY_ALL",
        trade_value_basis: "official" as const,
      } satisfies StableSnapshotRow];
    });
    return {
      market: "TWSE",
      provider: "TWSE_OPENAPI_STOCK_DAY_ALL",
      rows,
      raw_count: raw.length,
      normalized_count: rows.length,
      errors: rows.length >= MIN_COVERAGE.TWSE ? [] : [`TWSE OpenAPI coverage only ${rows.length}`],
    };
  } catch (error) {
    return { market: "TWSE", provider: "UNAVAILABLE", rows: [], raw_count: 0, normalized_count: 0, errors: [errorText(error)] };
  }
}

function chunked<T>(items: T[], size: number) {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

async function fetchMisOtcBatch(symbols: string[]) {
  const url = new URL(TWSE_MIS_URL);
  url.searchParams.set("ex_ch", symbols.map((symbol) => `otc_${symbol}.tw`).join("|"));
  url.searchParams.set("json", "1");
  url.searchParams.set("delay", "0");
  url.searchParams.set("_", String(Date.now()));
  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
      Referer: "https://mis.twse.com.tw/stock/index.jsp",
      "User-Agent": USER_AGENT,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`TWSE MIS OTC HTTP ${response.status}: ${text.slice(0, 180)}`);
  let body: any;
  try { body = JSON.parse(text); }
  catch { throw new Error("TWSE MIS OTC returned invalid JSON"); }
  if (String(body?.rtcode ?? "0000") !== "0000") {
    throw new Error(`TWSE MIS OTC rtcode=${String(body?.rtcode)} ${String(body?.rtmessage ?? "")}`);
  }
  return Array.isArray(body?.msgArray) ? body.msgArray.map(rec) : [];
}

function normalizeMisOtcRow(raw: Obj, fallback: CompanyMeta): StableSnapshotRow | null {
  const symbol = String(raw.c ?? fallback.symbol ?? "").trim();
  const name = String(raw.n ?? raw.nf ?? fallback.name ?? "").trim();
  if (!isOrdinaryStock(symbol, name)) return null;
  const last = numberValue(raw.z) ?? numberValue(raw.pz) ?? numberValue(raw.y);
  const previous = numberValue(raw.y);
  if (last == null || last <= 0) return null;
  const volumeLots = numberValue(raw.v);
  return {
    market: "TPEx",
    symbol,
    name,
    sector: fallback.sector,
    open: numberValue(raw.o),
    high: numberValue(raw.h),
    low: numberValue(raw.l),
    close: last,
    previous_close: previous,
    change: previous != null ? last - previous : null,
    change_percent: previous != null && previous > 0 ? round((last / previous - 1) * 100, 2) : null,
    trade_volume: volumeLots != null ? volumeLots * 1000 : null,
    trade_value: volumeLots != null && volumeLots > 0 ? last * volumeLots * 1000 : 0,
    last_updated: [raw.d, raw.t].filter(Boolean).join(" ") || null,
    source: "MOPSFIN TPEx company master + TWSE MIS OTC quotes",
    trade_value_basis: "last_x_volume_estimate",
  };
}

async function loadTpexMopsMis(universe: CompanyMeta[]): Promise<MarketSnapshot> {
  try {
    if (universe.length < MIN_COVERAGE.TPEx) throw new Error(`MOPSFIN TPEx ordinary-stock universe only ${universe.length}`);
    const meta = new Map(universe.map((item) => [item.symbol, item]));
    const batches = chunked(universe.map((item) => item.symbol), MIS_BATCH_SIZE);
    const results: PromiseSettledResult<Obj[]>[] = new Array(batches.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(4, batches.length) }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= batches.length) return;
        try { results[index] = { status: "fulfilled", value: await fetchMisOtcBatch(batches[index]) }; }
        catch (reason) { results[index] = { status: "rejected", reason }; }
      }
    });
    await Promise.all(workers);
    const raw: Obj[] = [];
    const errors: string[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") raw.push(...result.value);
      else errors.push(`MIS batch ${index + 1}/${batches.length}: ${errorText(result.reason)}`);
    });
    const deduped = new Map<string, StableSnapshotRow>();
    for (const item of raw) {
      const symbol = String(item.c ?? "").trim();
      const fallback = meta.get(symbol);
      if (!fallback) continue;
      const row = normalizeMisOtcRow(item, fallback);
      if (row) deduped.set(row.symbol, row);
    }
    const rows = [...deduped.values()];
    if (rows.length < MIN_COVERAGE.TPEx) errors.push(`MOPSFIN+MIS normalized TPEx coverage only ${rows.length}/${universe.length}`);
    return {
      market: "TPEx",
      provider: rows.length ? "MOPSFIN_COMPANY_MASTER_MIS_OTC" : "UNAVAILABLE",
      rows,
      raw_count: raw.length,
      normalized_count: rows.length,
      errors,
    };
  } catch (error) {
    return { market: "TPEx", provider: "UNAVAILABLE", rows: [], raw_count: 0, normalized_count: 0, errors: [errorText(error)] };
  }
}

async function buildStableMarketUniverse(): Promise<StableMarketUniverse> {
  const optionalMetadataErrors: string[] = [];
  const [listedMetaResult, otcMetaResult] = await Promise.allSettled([
    loadCompanyMaster(MOPSFIN_TWSE_COMPANIES_CSV, "TWSE"),
    loadCompanyMaster(MOPSFIN_TPEX_COMPANIES_CSV, "TPEx"),
  ]);
  const listedMeta = listedMetaResult.status === "fulfilled" ? listedMetaResult.value : [];
  if (listedMetaResult.status === "rejected") optionalMetadataErrors.push(`TWSE company metadata:${errorText(listedMetaResult.reason)}`);
  const otcMeta = otcMetaResult.status === "fulfilled" ? otcMetaResult.value : [];
  if (otcMetaResult.status === "rejected") optionalMetadataErrors.push(`TPEx company universe:${errorText(otcMetaResult.reason)}`);

  const [twse, tpex] = await Promise.all([
    loadTwseOfficial(new Map(listedMeta.map((item) => [item.symbol, item]))),
    loadTpexMopsMis(otcMeta),
  ]);
  return {
    version: STABLE_MARKET_TOOLS_VERSION,
    source_contract: STABLE_MARKET_SOURCE_CONTRACT,
    retrieved_at: new Date().toISOString(),
    TWSE: twse,
    TPEx: tpex,
    rows: [...twse.rows, ...tpex.rows],
    usable: twse.normalized_count >= MIN_COVERAGE.TWSE && tpex.normalized_count >= MIN_COVERAGE.TPEx,
    optional_metadata_errors: optionalMetadataErrors,
  };
}

export async function loadStableMarketUniverse(force = false) {
  const now = Date.now();
  if (!force && cachedUniverse && now - cachedUniverse.at < CACHE_TTL_MS) return cachedUniverse.value;
  if (!force && inflightUniverse) return inflightUniverse;
  inflightUniverse = buildStableMarketUniverse();
  try {
    const value = await inflightUniverse;
    if (value.usable) cachedUniverse = { at: Date.now(), value };
    return value;
  } finally {
    inflightUniverse = null;
  }
}

function marketRows(universe: StableMarketUniverse, legacyMarket: LegacyMarket) {
  return legacyMarket === "TSE" ? universe.TWSE.rows : universe.TPEx.rows;
}

function aggregateMarket(rows: StableSnapshotRow[]) {
  const tradable = rows.filter((row) => row.close > 0 && row.change_percent != null);
  const sorted = [...tradable].sort((a, b) => (a.change_percent ?? 0) - (b.change_percent ?? 0));
  const median = sorted.length ? Number(sorted[Math.floor(sorted.length / 2)].change_percent ?? 0) : 0;
  const advancers = tradable.filter((row) => (row.change_percent ?? 0) > 0).length;
  const decliners = tradable.filter((row) => (row.change_percent ?? 0) < 0).length;
  const unchanged = tradable.length - advancers - decliners;
  const totalTradeValue = tradable.reduce((sum, row) => sum + row.trade_value, 0);
  return {
    stocks: tradable.length,
    advancers,
    decliners,
    unchanged,
    advance_decline_ratio: decliners ? round(advancers / decliners, 3) : null,
    median_change_percent: round(median, 2),
    total_trade_value: totalTradeValue,
    top_gainers: [...tradable].sort((a, b) => (b.change_percent ?? 0) - (a.change_percent ?? 0)).slice(0, 10),
    top_losers: [...tradable].sort((a, b) => (a.change_percent ?? 0) - (b.change_percent ?? 0)).slice(0, 10),
    top_volume: [...tradable].sort((a, b) => (b.trade_volume ?? 0) - (a.trade_volume ?? 0)).slice(0, 10),
    top_value: [...tradable].sort((a, b) => b.trade_value - a.trade_value).slice(0, 10),
  };
}

function sectorAggregation(rows: StableSnapshotRow[], topN: number) {
  const groups = new Map<string, StableSnapshotRow[]>();
  for (const row of rows) {
    const sector = row.sector.trim();
    if (!sector) continue;
    const list = groups.get(sector) ?? [];
    list.push(row);
    groups.set(sector, list);
  }
  const sectors = [...groups.entries()].map(([sector, stocks]) => {
    const liquid = stocks.filter((row) => row.change_percent != null && (row.trade_volume ?? 0) > 0);
    if (!liquid.length) return null;
    const average = liquid.reduce((sum, row) => sum + Number(row.change_percent ?? 0), 0) / liquid.length;
    const weight = liquid.reduce((sum, row) => sum + row.trade_value, 0);
    const weighted = weight > 0
      ? liquid.reduce((sum, row) => sum + Number(row.change_percent ?? 0) * row.trade_value, 0) / weight
      : average;
    return {
      sector,
      stock_count: liquid.length,
      average_change_percent: round(average, 2),
      value_weighted_change_percent: round(weighted, 2),
      advancers: liquid.filter((row) => Number(row.change_percent ?? 0) > 0).length,
      decliners: liquid.filter((row) => Number(row.change_percent ?? 0) < 0).length,
      trade_value: weight,
      leaders: [...liquid].sort((a, b) => Number(b.change_percent ?? 0) - Number(a.change_percent ?? 0)).slice(0, 5),
    };
  }).filter((row): row is NonNullable<typeof row> => row !== null && row.stock_count >= 2);
  return {
    strongest: [...sectors].sort((a, b) => b.value_weighted_change_percent - a.value_weighted_change_percent).slice(0, topN),
    weakest: [...sectors].sort((a, b) => a.value_weighted_change_percent - b.value_weighted_change_percent).slice(0, topN),
  };
}

function regimeFromAggregate(total: ReturnType<typeof aggregateMarket>) {
  const ad = total.advance_decline_ratio ?? 0;
  if (ad >= 1.5 && total.median_change_percent > 0.5) return "risk_on" as const;
  if (ad <= 0.67 && total.median_change_percent < -0.5) return "risk_off" as const;
  return "mixed" as const;
}

function toLegacyRow(row: StableSnapshotRow) {
  return {
    symbol: row.symbol,
    name: row.name,
    type: "COMMONSTOCK",
    open: row.open ?? 0,
    high: row.high ?? 0,
    low: row.low ?? 0,
    close: row.close,
    change: row.change ?? 0,
    change_percent: row.change_percent ?? 0,
    trade_volume: row.trade_volume ?? 0,
    trade_value: row.trade_value,
    last_updated: row.last_updated,
    market: row.market,
    sector: row.sector,
    provider: row.source,
    trade_value_basis: row.trade_value_basis,
  };
}

function rankingRows(rows: StableSnapshotRow[], ranking: "gainers" | "losers" | "volume" | "value", topN: number) {
  const copy = rows.filter((row) => row.close > 0);
  if (ranking === "gainers") copy.sort((a, b) => Number(b.change_percent ?? -Infinity) - Number(a.change_percent ?? -Infinity));
  else if (ranking === "losers") copy.sort((a, b) => Number(a.change_percent ?? Infinity) - Number(b.change_percent ?? Infinity));
  else if (ranking === "volume") copy.sort((a, b) => Number(b.trade_volume ?? 0) - Number(a.trade_volume ?? 0));
  else copy.sort((a, b) => b.trade_value - a.trade_value);
  return copy.slice(0, topN).map(toLegacyRow);
}

async function healthData(env: Env, testSymbol: string) {
  const stablePromise = loadStableMarketUniverse(true);
  const requiredChecks = [
    { source: "GitHub", run: async () => probeGitHubDataRead(env) },
    { source: "Fugle", run: async () => {
      const started = Date.now();
      const quote = normalizeQuote(await fugle(env, `/intraday/quote/${testSymbol}`), testSymbol);
      return { latency_ms: Date.now() - started, latest: quote.last_updated, symbol: quote.symbol, role: "single_stock_realtime" };
    } },
    { source: "CBC", run: async () => {
      const response = await fetchJson(CBC_FX_DAILY, { headers: { Accept: "application/json" } }, "CBC");
      return { latency_ms: response.latency_ms, rows: arr(response.body).length, role: "macro_optional_to_stock_scan" };
    } },
  ];
  const settled = await Promise.allSettled(requiredChecks.map((check) => check.run()));
  const data: any[] = settled.map((result, index) => result.status === "fulfilled"
    ? { source: requiredChecks[index].source, required: true, status: "ok", ...result.value }
    : { source: requiredChecks[index].source, required: true, status: "error", error: errorText(result.reason) });

  let stable: StableMarketUniverse;
  try {
    stable = await stablePromise;
    data.push({
      source: "TWSE",
      required: true,
      status: stable.TWSE.normalized_count >= MIN_COVERAGE.TWSE ? "ok" : "error",
      provider: stable.TWSE.provider,
      rows: stable.TWSE.normalized_count,
      errors: stable.TWSE.errors,
      role: "full_market_listed",
    });
    data.push({
      source: "TPEx",
      required: true,
      status: stable.TPEx.normalized_count >= MIN_COVERAGE.TPEx ? "ok" : "error",
      provider: stable.TPEx.provider,
      rows: stable.TPEx.normalized_count,
      errors: stable.TPEx.errors,
      role: "full_market_otc",
    });
  } catch (error) {
    const message = errorText(error);
    data.push({ source: "TWSE", required: true, status: "error", error: message, role: "full_market_listed" });
    data.push({ source: "TPEx", required: true, status: "error", error: message, role: "full_market_otc" });
    stable = {
      version: STABLE_MARKET_TOOLS_VERSION,
      source_contract: STABLE_MARKET_SOURCE_CONTRACT,
      retrieved_at: new Date().toISOString(),
      TWSE: { market: "TWSE", provider: "UNAVAILABLE", rows: [], raw_count: 0, normalized_count: 0, errors: [message] },
      TPEx: { market: "TPEx", provider: "UNAVAILABLE", rows: [], raw_count: 0, normalized_count: 0, errors: [message] },
      rows: [], usable: false, optional_metadata_errors: [],
    };
  }

  data.push({
    source: "FinMind",
    required: false,
    status: "not_required",
    role: "optional_legacy_enrichment",
    note: "FinMind token is intentionally outside the frozen full-market scan contract; an invalid token cannot degrade market-wide scanning.",
  });
  const core = data.filter((row) => row.required === true);
  const overall = core.every((row) => row.status === "ok") ? "healthy" : core.some((row) => row.status === "ok") ? "degraded" : "down";
  return {
    checked_at: new Date().toISOString(),
    overall,
    version: STABLE_MARKET_TOOLS_VERSION,
    source_contract: STABLE_MARKET_SOURCE_CONTRACT,
    full_market_usable: stable.usable,
    data,
    retired_required_dependencies: {
      fugle_market_rankings: "RETIRED_FROM_REQUIRED_PATH",
      fugle_full_market_snapshot: "RETIRED_FROM_REQUIRED_PATH",
      finmind_market_scan: "RETIRED_FROM_REQUIRED_PATH",
      direct_tpex_openapi_quotes: "RETIRED_FROM_REQUIRED_PATH",
    },
  };
}

export function registerStableMarketTools(server: McpServer, env: Env) {
  server.registerTool("get_market_rankings", {
    description: "穩定版全市場排行：上市走 TWSE 官方，櫃買走 MOPSFIN 公司母表 + TWSE MIS；不依賴 Fugle 排行權限或 FinMind token。",
    inputSchema: {
      markets: z.array(z.enum(["TSE", "OTC"])).min(1).max(2).optional().default(["TSE", "OTC"]),
      ranking: z.enum(["gainers", "losers", "volume", "value"]).optional().default("gainers"),
      top_n: z.number().int().min(1).max(100).optional().default(20),
    },
  }, async ({ markets, ranking, top_n }) => {
    const universe = await loadStableMarketUniverse();
    if (!universe.usable) throw new Error(`全市場資料未達完整門檻：TWSE=${universe.TWSE.normalized_count}, TPEx=${universe.TPEx.normalized_count}; ${[...universe.TWSE.errors, ...universe.TPEx.errors].join("; ")}`);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        source: "TWSE official + MOPSFIN/TWSE MIS",
        version: STABLE_MARKET_TOOLS_VERSION,
        source_contract: STABLE_MARKET_SOURCE_CONTRACT,
        ranking,
        retrieved_at: universe.retrieved_at,
        results: markets.map((market) => ({
          market,
          provider: market === "TSE" ? universe.TWSE.provider : universe.TPEx.provider,
          count: marketRows(universe, market).length,
          data: rankingRows(marketRows(universe, market), ranking, top_n),
        })),
        partial_errors: [...universe.TWSE.errors, ...universe.TPEx.errors, ...universe.optional_metadata_errors],
      }, null, 2) }],
    };
  });

  server.registerTool("get_market_regime", {
    description: "穩定版上市櫃全市場廣度、成交值、強弱股與產業強弱；核心路徑不使用 Fugle 全市場快照/排行，也不依賴 FinMind。",
    inputSchema: {
      include_sectors: z.boolean().optional().default(true),
      top_sectors: z.number().int().min(3).max(20).optional().default(10),
    },
  }, async ({ include_sectors, top_sectors }) => {
    const universe = await loadStableMarketUniverse();
    if (!universe.usable) throw new Error(`全市場資料未達完整門檻：TWSE=${universe.TWSE.normalized_count}, TPEx=${universe.TPEx.normalized_count}; ${[...universe.TWSE.errors, ...universe.TPEx.errors].join("; ")}`);
    const listed = aggregateMarket(universe.TWSE.rows);
    const otc = aggregateMarket(universe.TPEx.rows);
    const combined = aggregateMarket(universe.rows);
    const regime = regimeFromAggregate(combined);
    const payload = {
      source: "TWSE official + MOPSFIN/TWSE MIS",
      version: STABLE_MARKET_TOOLS_VERSION,
      source_contract: STABLE_MARKET_SOURCE_CONTRACT,
      retrieved_at: universe.retrieved_at,
      regime,
      interpretation: regime === "risk_on"
        ? "市場廣度偏多，做多環境較有利，但仍須避免追高。"
        : regime === "risk_off"
          ? "市場廣度偏空，應降低多單曝險並提高停損紀律。"
          : "多空分歧，宜重視個股與族群選擇。",
      coverage: {
        usable: universe.usable,
        listed: { provider: universe.TWSE.provider, rows: universe.TWSE.normalized_count },
        otc: { provider: universe.TPEx.provider, rows: universe.TPEx.normalized_count },
      },
      listed,
      otc,
      combined,
      sectors: include_sectors ? sectorAggregation(universe.rows, top_sectors) : null,
      required_dependency_policy: {
        fugle_market_rankings: false,
        fugle_full_market_snapshot: false,
        finmind: false,
        direct_tpex_openapi_quotes: false,
      },
      partial_errors: [...universe.TWSE.errors, ...universe.TPEx.errors, ...universe.optional_metadata_errors],
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
  });

  server.registerTool("get_macro_risk_dashboard", {
    description: "央行美元兌台幣 + 穩定版上市櫃全市場廣度；市場廣度不依賴 Fugle 排行/快照或 FinMind。",
    inputSchema: {},
  }, async () => {
    const [fxResult, universeResult] = await Promise.allSettled([
      fetchJson(CBC_FX_DAILY, { headers: { Accept: "application/json" } }, "CBC"),
      loadStableMarketUniverse(),
    ]);
    const errors: string[] = [];
    if (fxResult.status === "rejected") errors.push(errorText(fxResult.reason));
    if (universeResult.status === "rejected") errors.push(errorText(universeResult.reason));
    const universe = universeResult.status === "fulfilled" ? universeResult.value : null;
    if (universe && !universe.usable) errors.push(...universe.TWSE.errors, ...universe.TPEx.errors);
    const breadth = universe ? aggregateMarket(universe.rows) : null;
    const fxRows = fxResult.status === "fulfilled" ? arr(fxResult.value.body) : [];
    const payload = {
      source: "CBC + TWSE official + MOPSFIN/TWSE MIS",
      version: STABLE_MARKET_TOOLS_VERSION,
      source_contract: STABLE_MARKET_SOURCE_CONTRACT,
      retrieved_at: new Date().toISOString(),
      usd_twd_latest: fxRows.at(-1) ?? null,
      market: breadth,
      market_regime: breadth ? regimeFromAggregate(breadth) : "unavailable",
      full_market_usable: universe?.usable === true,
      partial_errors: errors,
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
  });

  server.registerTool("get_data_health", {
    description: "檢查凍結後的核心資料路徑：GitHub、Fugle單股、TWSE全市場、TPEx MOPSFIN+MIS、央行；FinMind為非必要舊補充，不再拖累全市場健康狀態。",
    inputSchema: { test_symbol: z.string().trim().min(1).max(20).regex(/^[0-9A-Za-z._-]+$/).optional().default("2330") },
  }, async ({ test_symbol }) => {
    const payload = await healthData(env, test_symbol);
    return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
  });
}
