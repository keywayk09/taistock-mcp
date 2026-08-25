import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { finmind } from "./common";

export const STABLE_MARKET_TOOLS_VERSION = "stable-market-tools/v1.1.0";
export const STABLE_MARKET_SOURCE_CONTRACT = "tw-full-market-source-contract/v1.0.0";

const TWSE = "https://openapi.twse.com.tw/v1";
const TWSE_MIS = "https://mis.twse.com.tw";
const MOPSFIN = "https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv";
const TPEX_COMPANY = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O";

const STOCK_ID_RE = /^\d{4}$/;
const SNAPSHOT_TIMEOUT_MS = 10_000;
const METADATA_TIMEOUT_MS = 4_000;

const symbolSchema = z.string().trim().regex(/^\d{4,6}$/);

type Rec = Record<string, any>;
type Market = "TSE" | "OTC";

type NormalizedMarketRow = {
  symbol: string;
  name: string;
  market: Market;
  close: number | null;
  change: number | null;
  change_percent: number | null;
  trade_volume: number;
  trade_value: number;
  open: number | null;
  high: number | null;
  low: number | null;
  reference_price: number | null;
  date: string | null;
  time: string | null;
  industry_code: string | null;
  sector: string | null;
  source: string;
};

type MarketSourceResult = {
  market: Market;
  provider: string;
  url: string;
  raw_count: number;
  normalized_count: number;
  rows: NormalizedMarketRow[];
  errors: string[];
};

type MarketUniverseResult = {
  contract: typeof STABLE_MARKET_SOURCE_CONTRACT;
  version: typeof STABLE_MARKET_TOOLS_VERSION;
  retrieved_at: string;
  usable: boolean;
  TWSE: MarketSourceResult;
  TPEx: MarketSourceResult;
  optional_metadata_errors: string[];
};

function rec(value: unknown): Rec {
  return value !== null && typeof value === "object" ? value as Rec : {};
}

function arr(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).replace(/,/g, "").replace(/%/g, "").trim();
  if (!normalized || normalized === "--" || normalized === "---") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits = 4) {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function pick(o: Rec, keys: string[]) {
  for (const key of keys) {
    const value = o[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return null;
}

function firstPresent(o: Rec, keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(o, key)) return o[key];
  }
  return undefined;
}

function codeFrom(value: unknown) {
  const match = String(value ?? "").trim().match(/\d{4,6}/);
  return match ? match[0] : "";
}

function nameFrom(value: unknown) {
  return String(value ?? "").trim().replace(/^\d{4,6}\s*/, "");
}

function withTimeout(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function fetchText(url: string, timeoutMs: number, label: string) {
  const timer = withTimeout(timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/csv,text/plain,application/json;q=0.9,*/*;q=0.5",
        "user-agent": "taistock-mcp/6 stable-market-source-contract",
      },
      signal: timer.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${label}:HTTP_${response.status}:${text.slice(0, 160)}`);
    return text;
  } catch (error) {
    throw new Error(`${label}:${error instanceof Error ? error.message : String(error)}`);
  } finally {
    timer.done();
  }
}

async function fetchJson(url: string, timeoutMs: number, label: string) {
  const text = await fetchText(url, timeoutMs, label);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}:invalid_json`);
  }
}

function parseCsvLine(line: string) {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      fields.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  fields.push(current.trim());
  return fields;
}

function parseCsvObjects(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function normalizeTwse(row: unknown): NormalizedMarketRow | null {
  const o = rec(row);
  const symbol = codeFrom(pick(o, ["Code", "證券代號", "stock_id", "symbol"]));
  if (!STOCK_ID_RE.test(symbol)) return null;
  const name = String(pick(o, ["Name", "證券名稱", "name"]) ?? "").trim();
  const close = num(pick(o, ["ClosingPrice", "收盤價", "close"]));
  const change = num(pick(o, ["Change", "漲跌價差", "change"]));
  const reference = close != null && change != null ? close - change : num(pick(o, ["ReferencePrice", "參考價", "referencePrice"]));
  const changePercent = close != null && reference && reference !== 0
    ? round((close - reference) / reference * 100, 4)
    : null;
  return {
    symbol,
    name,
    market: "TSE",
    close,
    change,
    change_percent: changePercent,
    trade_volume: num(pick(o, ["TradeVolume", "成交股數", "tradeVolume"])) ?? 0,
    trade_value: num(pick(o, ["TradeValue", "成交金額", "tradeValue"])) ?? 0,
    open: num(pick(o, ["OpeningPrice", "開盤價", "open"])),
    high: num(pick(o, ["HighestPrice", "最高價", "high"])),
    low: num(pick(o, ["LowestPrice", "最低價", "low"])),
    reference_price: reference,
    date: String(pick(o, ["Date", "日期", "date"]) ?? "").trim() || null,
    time: String(pick(o, ["Time", "時間", "time"]) ?? "").trim() || null,
    industry_code: String(pick(o, ["industry_code", "產業別"]) ?? "").trim() || null,
    sector: null,
    source: "TWSE_OPENAPI_STOCK_DAY_ALL",
  };
}

function normalizeTpex(row: unknown): NormalizedMarketRow | null {
  const o = rec(row);
  const symbol = codeFrom(firstPresent(o, ["SecuritiesCompanyCode", "Code", "股票代號", "證券代號", "stock_id", "symbol"]));
  if (!STOCK_ID_RE.test(symbol)) return null;
  const name = nameFrom(firstPresent(o, ["CompanyName", "SecuritiesCompanyName", "股票名稱", "證券名稱", "name"]));
  const close = num(firstPresent(o, ["Close", "ClosingPrice", "收盤價", "close"]));
  const change = num(firstPresent(o, ["Change", "漲跌價差", "change"]));
  const reference = close != null && change != null ? close - change : num(firstPresent(o, ["ReferencePrice", "參考價", "referencePrice"]));
  const explicitPercent = num(firstPresent(o, ["ChangePercent", "漲跌幅", "漲跌幅度", "change_percent"]));
  const changePercent = explicitPercent != null
    ? explicitPercent
    : close != null && reference && reference !== 0
      ? round((close - reference) / reference * 100, 4)
      : null;
  return {
    symbol,
    name,
    market: "OTC",
    close,
    change,
    change_percent: changePercent,
    trade_volume: num(firstPresent(o, ["TradeVolume", "成交股數", "成交量", "tradeVolume"])) ?? 0,
    trade_value: num(firstPresent(o, ["TradeValue", "成交金額", "tradeValue"])) ?? 0,
    open: num(firstPresent(o, ["Open", "OpeningPrice", "開盤價", "open"])),
    high: num(firstPresent(o, ["High", "HighestPrice", "最高價", "high"])),
    low: num(firstPresent(o, ["Low", "LowestPrice", "最低價", "low"])),
    reference_price: reference,
    date: String(firstPresent(o, ["Date", "日期", "date"]) ?? "").trim() || null,
    time: String(firstPresent(o, ["Time", "時間", "time"]) ?? "").trim() || null,
    industry_code: String(firstPresent(o, ["IndustryCode", "產業別", "industry_code"]) ?? "").trim() || null,
    sector: null,
    source: "TPEX_MOPSFIN_COMPANY_PLUS_TWSE_MIS",
  };
}

function parseTpexCompanyRows(raw: unknown) {
  const body = rec(raw);
  const rows = Array.isArray(raw) ? raw : arr(body.data ?? body.result);
  return rows.map((row) => {
    const o = rec(row);
    const symbol = codeFrom(firstPresent(o, ["SecuritiesCompanyCode", "Code", "公司代號", "股票代號", "證券代號", "stock_id", "symbol"]));
    if (!STOCK_ID_RE.test(symbol)) return null;
    return {
      symbol,
      name: nameFrom(firstPresent(o, ["CompanyName", "SecuritiesCompanyName", "公司名稱", "股票名稱", "證券名稱", "name"])),
      industry_code: String(firstPresent(o, ["IndustryCode", "產業別", "industry_code"]) ?? "").trim() || null,
    };
  }).filter((row): row is { symbol: string; name: string; industry_code: string | null } => Boolean(row));
}

function parseMisArray(raw: unknown) {
  const body = rec(raw);
  for (const value of [body.msgArray, body.data, body.result]) {
    if (Array.isArray(value)) return value;
  }
  return Array.isArray(raw) ? raw : [];
}

function misRowsToMap(raw: unknown) {
  const map = new Map<string, Rec>();
  for (const item of parseMisArray(raw)) {
    const o = rec(item);
    const symbol = codeFrom(o.c ?? o.ch ?? o.ex_ch ?? o.symbol);
    if (STOCK_ID_RE.test(symbol)) map.set(symbol, o);
  }
  return map;
}

function numberFromMis(o: Rec | undefined, keys: string[]) {
  if (!o) return null;
  return num(firstPresent(o, keys));
}

function normalizeTpexWithMis(company: { symbol: string; name: string; industry_code: string | null }, mis: Rec | undefined) {
  const close = numberFromMis(mis, ["z", "pz", "price"]);
  const reference = numberFromMis(mis, ["y", "referencePrice", "ref"]);
  const change = close != null && reference != null ? close - reference : numberFromMis(mis, ["d", "change"]);
  const explicitPercent = numberFromMis(mis, ["p", "change_percent"]);
  const changePercent = explicitPercent != null
    ? explicitPercent
    : close != null && reference && reference !== 0
      ? round((close - reference) / reference * 100, 4)
      : null;
  return {
    symbol: company.symbol,
    name: company.name,
    market: "OTC" as const,
    close,
    change,
    change_percent: changePercent,
    trade_volume: numberFromMis(mis, ["v", "tv", "tradeVolume"]) ?? 0,
    trade_value: numberFromMis(mis, ["a", "tradeValue"]) ?? 0,
    open: numberFromMis(mis, ["o", "open"]),
    high: numberFromMis(mis, ["h", "high"]),
    low: numberFromMis(mis, ["l", "low"]),
    reference_price: reference,
    date: String(mis?.d ?? mis?.date ?? "").trim() || null,
    time: String(mis?.tlong ?? mis?.t ?? mis?.time ?? "").trim() || null,
    industry_code: company.industry_code,
    sector: null,
    source: "TPEX_MOPSFIN_COMPANY_PLUS_TWSE_MIS",
  } satisfies NormalizedMarketRow;
}

async function fetchTwseMarket(): Promise<MarketSourceResult> {
  const url = `${TWSE}/exchangeReport/STOCK_DAY_ALL`;
  const errors: string[] = [];
  try {
    const raw = await fetchJson(url, SNAPSHOT_TIMEOUT_MS, "TWSE_STOCK_DAY_ALL");
    const rawRows = arr(raw);
    const rows = rawRows.map(normalizeTwse).filter((row): row is NormalizedMarketRow => Boolean(row));
    return { market: "TSE", provider: "TWSE_OPENAPI", url, raw_count: rawRows.length, normalized_count: rows.length, rows, errors };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return { market: "TSE", provider: "TWSE_OPENAPI", url, raw_count: 0, normalized_count: 0, rows: [], errors };
  }
}

async function fetchTpexMarket(): Promise<MarketSourceResult> {
  const errors: string[] = [];
  const rawUrl = TPEX_COMPANY;
  let companies: Array<{ symbol: string; name: string; industry_code: string | null }> = [];
  try {
    companies = parseTpexCompanyRows(await fetchJson(rawUrl, SNAPSHOT_TIMEOUT_MS, "TPEX_COMPANY_MASTER"));
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  if (!companies.length) {
    return { market: "OTC", provider: "TPEX_MOPSFIN_PLUS_TWSE_MIS", url: rawUrl, raw_count: 0, normalized_count: 0, rows: [], errors };
  }

  const rows: NormalizedMarketRow[] = [];
  const chunks: typeof companies[] = [];
  for (let index = 0; index < companies.length; index += 80) chunks.push(companies.slice(index, index + 80));
  for (const chunk of chunks) {
    const exCh = chunk.map((row) => `otc_${row.symbol}.tw`).join("|");
    const url = `${TWSE_MIS}/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0`;
    try {
      const mis = misRowsToMap(await fetchJson(url, SNAPSHOT_TIMEOUT_MS, "TWSE_MIS_OTC_BATCH"));
      for (const company of chunk) rows.push(normalizeTpexWithMis(company, mis.get(company.symbol)));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      for (const company of chunk) rows.push(normalizeTpexWithMis(company, undefined));
    }
  }
  return {
    market: "OTC",
    provider: "TPEX_MOPSFIN_PLUS_TWSE_MIS",
    url: rawUrl,
    raw_count: companies.length,
    normalized_count: rows.length,
    rows,
    errors,
  };
}

async function optionalSectorMetadata() {
  const result = new Map<string, string>();
  const errors: string[] = [];
  try {
    const text = await fetchText(MOPSFIN, METADATA_TIMEOUT_MS, "TWSE_MOPSFIN_SECTOR");
    for (const row of parseCsvObjects(text)) {
      const symbol = codeFrom(firstPresent(row, ["公司代號", "股票代號", "證券代號", "Code"]));
      const sector = String(firstPresent(row, ["產業別", "產業類別", "Industry", "IndustryCode"]) ?? "").trim();
      if (STOCK_ID_RE.test(symbol) && sector) result.set(symbol, sector);
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { map: result, errors };
}

function mergeSector(rows: NormalizedMarketRow[], sectorMap: Map<string, string>) {
  return rows.map((row) => ({ ...row, sector: sectorMap.get(row.symbol) ?? row.sector ?? row.industry_code ?? null }));
}

export async function loadStableMarketUniverse(includeMetadata = true): Promise<MarketUniverseResult> {
  const [twse, tpex, metadata] = await Promise.all([
    fetchTwseMarket(),
    fetchTpexMarket(),
    includeMetadata ? optionalSectorMetadata() : Promise.resolve({ map: new Map<string, string>(), errors: [] as string[] }),
  ]);
  twse.rows = mergeSector(twse.rows, metadata.map);
  tpex.rows = mergeSector(tpex.rows, metadata.map);
  const usable = twse.rows.length > 0 || tpex.rows.length > 0;
  return {
    contract: STABLE_MARKET_SOURCE_CONTRACT,
    version: STABLE_MARKET_TOOLS_VERSION,
    retrieved_at: new Date().toISOString(),
    usable,
    TWSE: twse,
    TPEx: tpex,
    optional_metadata_errors: metadata.errors,
  };
}

function aggregateMarket(rows: NormalizedMarketRow[]) {
  const tradable = rows.filter((row) => row.close != null && row.change_percent != null && row.trade_volume > 0);
  const sorted = [...tradable].sort((a, b) => Number(a.change_percent ?? 0) - Number(b.change_percent ?? 0));
  const advancers = tradable.filter((row) => Number(row.change_percent ?? 0) > 0).length;
  const decliners = tradable.filter((row) => Number(row.change_percent ?? 0) < 0).length;
  const unchanged = tradable.length - advancers - decliners;
  const median = sorted.length ? Number(sorted[Math.floor(sorted.length / 2)].change_percent ?? 0) : 0;
  const totalTradeValue = tradable.reduce((sum, row) => sum + row.trade_value, 0);
  return {
    stocks: tradable.length,
    advancers,
    decliners,
    unchanged,
    advance_decline_ratio: decliners ? round(advancers / decliners, 3) : null,
    median_change_percent: round(median, 4),
    total_trade_value: totalTradeValue,
    top_gainers: [...tradable].sort((a, b) => Number(b.change_percent ?? 0) - Number(a.change_percent ?? 0)).slice(0, 10),
    top_losers: [...tradable].sort((a, b) => Number(a.change_percent ?? 0) - Number(b.change_percent ?? 0)).slice(0, 10),
    top_value: [...tradable].sort((a, b) => b.trade_value - a.trade_value).slice(0, 10),
  };
}

function sectorAggregation(rows: NormalizedMarketRow[], topN: number) {
  const groups = new Map<string, NormalizedMarketRow[]>();
  for (const row of rows) {
    const sector = String(row.sector ?? "").trim();
    if (!sector) continue;
    const values = groups.get(sector) ?? [];
    values.push(row);
    groups.set(sector, values);
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

function ok(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function fail(error: unknown) {
  return ok({ ok: false, error: error instanceof Error ? error.message : String(error) });
}

export async function loadStableFullMarketResearchView(includeSectors = true, topSectors = 10) {
  const universe = await loadStableMarketUniverse(includeSectors);
  const listed = aggregateMarket(universe.TWSE.rows);
  const otc = aggregateMarket(universe.TPEx.rows);
  const combinedRows = [...universe.TWSE.rows, ...universe.TPEx.rows];
  const combined = aggregateMarket(combinedRows);
  const regime = regimeFromAggregate(combined);
  return {
    ok: universe.usable,
    contract: universe.contract,
    version: universe.version,
    source_policy: {
      listed: universe.TWSE.provider,
      otc: universe.TPEx.provider,
      no_fugle_full_market_ranking: true,
      no_finmind_required_for_full_market_scan: true,
      no_direct_tpex_quotes_dependency: true,
      optional_sector_metadata_fail_soft: true,
    },
    retrieved_at: universe.retrieved_at,
    regime,
    interpretation: regime === "risk_on"
      ? "市場廣度偏多；個股仍需結合正式OHLC與風險控管。"
      : regime === "risk_off"
        ? "市場廣度偏空；降低多單曝險並提高停損紀律。"
        : "市場多空分歧；優先看個股與族群相對強弱。",
    listed,
    otc,
    combined,
    sectors: includeSectors ? sectorAggregation(combinedRows, topSectors) : null,
    source_errors: {
      listed: universe.TWSE.errors,
      otc: universe.TPEx.errors,
      optional_metadata: universe.optional_metadata_errors,
    },
    rows: combinedRows,
  };
}

export async function loadStableQuote(symbol: string) {
  const universe = await loadStableMarketUniverse(false);
  const row = [...universe.TWSE.rows, ...universe.TPEx.rows].find((item) => item.symbol === symbol) ?? null;
  return {
    ok: Boolean(row),
    contract: universe.contract,
    version: universe.version,
    retrieved_at: universe.retrieved_at,
    symbol,
    data: row,
    source_errors: {
      listed: universe.TWSE.errors,
      otc: universe.TPEx.errors,
    },
  };
}

async function optionalFinmindDaily(env: Env, symbol: string, days: number) {
  try {
    const end = new Date();
    const start = new Date(end.getTime() - Math.max(days, 120) * 86_400_000);
    const date = (value: Date) => value.toISOString().slice(0, 10);
    const result = await finmind(env, "TaiwanStockPrice", { data_id: symbol, start_date: date(start), end_date: date(end) });
    return { ok: true, source: "FINMIND_RESEARCH_FALLBACK", data: result.data.slice(-days) };
  } catch (error) {
    return { ok: false, source: "FINMIND_RESEARCH_FALLBACK", data: [] as any[], error: error instanceof Error ? error.message : String(error) };
  }
}

export function registerStableMarketTools(server: McpServer, env: Env) {
  server.registerTool("get_market_rankings", {
    description: "全市場正式快照排行。上市固定走TWSE OpenAPI；上櫃固定走TPEx公司名單 + TWSE MIS otc批次。此工具不依賴Fugle全市場排行、不要求FinMind。",
    inputSchema: {
      markets: z.array(z.enum(["TSE", "OTC"])).min(1).max(2).optional().default(["TSE", "OTC"]),
      ranking: z.enum(["gainers", "losers", "volume", "value"]).optional().default("gainers"),
      top_n: z.number().int().min(1).max(100).optional().default(20),
    },
  }, async ({ markets, ranking, top_n }) => {
    try {
      const universe = await loadStableMarketUniverse(false);
      const selected = markets.flatMap((market) => market === "TSE" ? universe.TWSE.rows : universe.TPEx.rows);
      const tradable = selected.filter((row) => row.close != null && row.trade_volume > 0);
      const sorted = [...tradable].sort((a, b) => {
        if (ranking === "gainers") return Number(b.change_percent ?? -999) - Number(a.change_percent ?? -999);
        if (ranking === "losers") return Number(a.change_percent ?? 999) - Number(b.change_percent ?? 999);
        if (ranking === "volume") return b.trade_volume - a.trade_volume;
        return b.trade_value - a.trade_value;
      });
      return ok({
        ok: universe.usable,
        contract: universe.contract,
        version: universe.version,
        source_policy: {
          TSE: universe.TWSE.provider,
          OTC: universe.TPEx.provider,
          fugle_full_market_ranking: false,
          finmind_required: false,
        },
        retrieved_at: universe.retrieved_at,
        ranking,
        data: sorted.slice(0, top_n),
        source_errors: { TSE: universe.TWSE.errors, OTC: universe.TPEx.errors },
      });
    } catch (error) {
      return fail(error);
    }
  });

  server.registerTool("get_market_regime", {
    description: "固定來源的上市櫃市場廣度、成交值、強弱股與族群環境。TWSE + TPEx正式來源為主；產業metadata失敗不阻斷主市場快照。",
    inputSchema: {
      include_sectors: z.boolean().optional().default(true),
      top_sectors: z.number().int().min(3).max(20).optional().default(10),
    },
  }, async ({ include_sectors, top_sectors }) => {
    try {
      const view = await loadStableFullMarketResearchView(include_sectors, top_sectors);
      const { rows: _rows, ...compact } = view;
      return ok(compact);
    } catch (error) {
      return fail(error);
    }
  });

  server.registerTool("get_macro_risk_dashboard", {
    description: "大盤風險摘要。固定使用與全市場排行相同的TWSE/TPEx contract；不再依賴Fugle snapshot排行。",
    inputSchema: {},
  }, async () => {
    try {
      const view = await loadStableFullMarketResearchView(false, 10);
      return ok({
        ok: view.ok,
        contract: view.contract,
        version: view.version,
        retrieved_at: view.retrieved_at,
        regime: view.regime,
        interpretation: view.interpretation,
        combined: view.combined,
        source_policy: view.source_policy,
        source_errors: view.source_errors,
      });
    } catch (error) {
      return fail(error);
    }
  });

  server.registerTool("get_data_health", {
    description: "檢查全市場資料來源可用性；回報TWSE/TPEx行數、provider與optional metadata錯誤。",
    inputSchema: {},
  }, async () => {
    try {
      const universe = await loadStableMarketUniverse(false);
      return ok({
        ok: universe.usable,
        contract: universe.contract,
        version: universe.version,
        retrieved_at: universe.retrieved_at,
        sources: {
          TSE: { provider: universe.TWSE.provider, rows: universe.TWSE.normalized_count, errors: universe.TWSE.errors },
          OTC: { provider: universe.TPEx.provider, rows: universe.TPEx.normalized_count, errors: universe.TPEx.errors },
        },
      });
    } catch (error) {
      return fail(error);
    }
  });
}
