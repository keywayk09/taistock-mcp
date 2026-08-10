import {
  concurrencyMap,
  finmind,
  fugle,
  normalizeDailyBars,
  normalizeQuote,
  num,
  rec,
  round,
  taipeiDate,
  technicalSummary,
  type DailyBar,
  type Obj,
} from "../v6/common";

export const FAMILY_STOCK_SELECTION_VERSION = "family-stock-selection/production-v1.3.0";

const TWSE_QUOTES_URL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";
const TPEX_QUOTES_URL = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes";
const TWSE_MIS_URL = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp";
const USER_AGENT = "taistock-mcp-family-selector/1.3 (+https://github.com/keywayk09/taistock-mcp)";
const MIS_BATCH_SIZE = 100;

type FamilyMode = "stable" | "balanced" | "aggressive";
type Market = "TWSE" | "TPEx";
type Provider = "TWSE_OPENAPI" | "TPEX_OPENAPI" | "FUGLE_TSE" | "FUGLE_OTC" | "FUGLE_TICKERS_MIS_OTC" | "FINMIND_FALLBACK" | "UNAVAILABLE";

type SnapshotRow = {
  market: Market;
  symbol: string;
  name: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  change_pct: number | null;
  volume: number | null;
  value: number;
  source: string;
};

type MarketSnapshot = {
  market: Market;
  provider: Provider;
  rows: SnapshotRow[];
  raw_count: number;
  normalized_count: number;
  sample_keys: string[];
  errors: string[];
};

type CandidateInput = {
  symbol: string;
  name: string;
  market: Market;
  sector: string;
  close: number;
  price_date: string;
  change_percent: number;
  trade_value: number;
  technical_score: number;
  return_20d_percent: number | null;
  return_60d_percent: number | null;
  annualized_volatility_60d_percent: number | null;
  max_drawdown_percent: number | null;
  atr14: number | null;
  distance_to_sma20_atr: number | null;
  distance_to_prior_20d_high_percent: number | null;
  revenue_yoy_percent: number | null;
  foreign_net_lots: number;
  trust_net_lots: number;
  dealer_net_lots: number;
};

const MODE_CONFIG: Record<FamilyMode, {
  minTradeValue: number;
  maxDailyGain: number;
  maxReturn20: number;
  maxExtensionAtr: number;
  snapshotShortlist: number;
  technicalShortlist: number;
  weights: { technical: number; growth: number; liquidity: number; risk: number; location: number; chip: number };
}> = {
  stable: {
    minTradeValue: 50_000_000,
    maxDailyGain: 5,
    maxReturn20: 18,
    maxExtensionAtr: 2,
    snapshotShortlist: 36,
    technicalShortlist: 14,
    weights: { technical: 0.30, growth: 0.20, liquidity: 0.10, risk: 0.20, location: 0.10, chip: 0.10 },
  },
  balanced: {
    minTradeValue: 20_000_000,
    maxDailyGain: 7,
    maxReturn20: 25,
    maxExtensionAtr: 2.5,
    snapshotShortlist: 44,
    technicalShortlist: 16,
    weights: { technical: 0.40, growth: 0.15, liquidity: 0.10, risk: 0.10, location: 0.15, chip: 0.10 },
  },
  aggressive: {
    minTradeValue: 10_000_000,
    maxDailyGain: 9,
    maxReturn20: 35,
    maxExtensionAtr: 3,
    snapshotShortlist: 52,
    technicalShortlist: 18,
    weights: { technical: 0.50, growth: 0.10, liquidity: 0.10, risk: 0.05, location: 0.15, chip: 0.10 },
  },
};

const MIN_COVERAGE: Record<Market, number> = { TWSE: 400, TPEx: 250 };

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[\s_()（）%％:：/\\.\-]/g, "");
}

function pick(row: Obj, aliases: string[]) {
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

function deriveChangePct(close: number | null, change: number | null) {
  if (close == null || change == null) return null;
  const previous = close - change;
  return previous > 0 ? (change / previous) * 100 : null;
}

function rowsFromBody(body: unknown): Obj[] {
  if (Array.isArray(body)) return body.map(rec);
  const root = rec(body);
  if (Array.isArray(root.data)) return root.data.map(rec);
  const nested = rec(root.data);
  if (Array.isArray(nested.data)) return nested.data.map(rec);
  if (Array.isArray(nested.quotes)) return nested.quotes.map(rec);
  if (Array.isArray(root.quotes)) return root.quotes.map(rec);
  if (Array.isArray(root.aaData)) return root.aaData.map(rec);
  return [];
}

async function fetchOfficialRows(url: string, source: string) {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${source} HTTP ${response.status}: ${text.slice(0, 180)}`);
  if (text.trimStart().startsWith("<")) throw new Error(`${source} 回傳 HTML，不是 JSON`);
  let body: unknown;
  try { body = JSON.parse(text); }
  catch { throw new Error(`${source} 回傳無效 JSON`); }
  return rowsFromBody(body);
}

function normalizeOfficialRow(market: Market, raw: Obj): SnapshotRow | null {
  const symbol = String(pick(raw, [
    "Code", "SecuritiesCompanyCode", "SecuritiesCompanyID", "證券代號", "股票代號", "代號",
  ]) ?? "").replace(/\s/g, "");
  const name = String(pick(raw, [
    "Name", "CompanyName", "SecuritiesCompanyName", "證券名稱", "股票名稱", "名稱",
  ]) ?? "").trim();
  if (!isOrdinaryStock(symbol, name)) return null;

  const close = numberValue(pick(raw, ["ClosingPrice", "Close", "ClosePrice", "收盤價", "收盤"]));
  if (close == null || close <= 0) return null;
  const change = numberValue(pick(raw, ["Change", "ChangeAmount", "漲跌價差", "漲跌", "漲跌價"]));
  const explicitPct = numberValue(pick(raw, ["ChangePercent", "ChangePercentage", "漲跌幅", "漲跌幅(%)", "漲跌幅％"]));
  const value = numberValue(pick(raw, [
    "TradeValue", "TradingValue", "TradingAmount", "TransactionAmount", "成交金額", "成交值",
  ])) ?? 0;

  return {
    market,
    symbol,
    name,
    open: numberValue(pick(raw, ["OpeningPrice", "Open", "OpenPrice", "開盤價", "開盤"])),
    high: numberValue(pick(raw, ["HighestPrice", "High", "HighPrice", "最高價", "最高"])),
    low: numberValue(pick(raw, ["LowestPrice", "Low", "LowPrice", "最低價", "最低"])),
    close,
    change_pct: explicitPct ?? deriveChangePct(close, change),
    volume: numberValue(pick(raw, ["TradeVolume", "TradingShares", "TradingVolume", "成交股數", "成交量"])),
    value,
    source: market === "TWSE" ? "TWSE OpenAPI" : "TPEx OpenAPI",
  };
}

async function tryOfficialMarket(market: Market): Promise<MarketSnapshot> {
  const url = market === "TWSE" ? TWSE_QUOTES_URL : TPEX_QUOTES_URL;
  const provider: Provider = market === "TWSE" ? "TWSE_OPENAPI" : "TPEX_OPENAPI";
  try {
    const raw = await fetchOfficialRows(url, `${market} OpenAPI`);
    const rows = raw.map((row) => normalizeOfficialRow(market, row)).filter((row): row is SnapshotRow => Boolean(row));
    return {
      market, provider, rows,
      raw_count: raw.length,
      normalized_count: rows.length,
      sample_keys: Object.keys(raw[0] ?? {}).slice(0, 24),
      errors: rows.length ? [] : ["官方端點有回傳，但欄位正規化後為 0 筆"],
    };
  } catch (error) {
    return {
      market, provider: "UNAVAILABLE", rows: [], raw_count: 0, normalized_count: 0, sample_keys: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function chunked<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function fetchMisOtcBatch(symbols: string[]) {
  const url = new URL(TWSE_MIS_URL);
  url.searchParams.set("ex_ch", symbols.map((symbol) => `otc_${symbol}.tw`).join("|"));
  url.searchParams.set("json", "1");
  url.searchParams.set("delay", "0");
  url.searchParams.set("_", String(Date.now()));
  const response = await fetch(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
      Referer: "https://mis.twse.com.tw/stock/index.jsp",
      "User-Agent": USER_AGENT,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`TWSE MIS OTC HTTP ${response.status}: ${text.slice(0, 180)}`);
  let body: any = null;
  try { body = JSON.parse(text); }
  catch { throw new Error("TWSE MIS OTC 回傳無效 JSON"); }
  if (String(body?.rtcode ?? "0000") !== "0000") throw new Error(`TWSE MIS OTC rtcode=${String(body?.rtcode)} ${String(body?.rtmessage ?? "")}`);
  return Array.isArray(body?.msgArray) ? body.msgArray.map(rec) : [];
}

function normalizeMisOtcRow(raw: Obj, fallbackName: string): SnapshotRow | null {
  const symbol = String(raw.c ?? "").trim();
  const name = String(raw.n ?? raw.nf ?? fallbackName ?? "").trim();
  if (!isOrdinaryStock(symbol, name)) return null;
  const close = numberValue(raw.z) ?? numberValue(raw.pz);
  const previous = numberValue(raw.y);
  if (close == null || close <= 0) return null;
  const volumeLots = numberValue(raw.v);
  const tradeValue = volumeLots != null && volumeLots > 0 ? close * volumeLots * 1000 : 0;
  return {
    market: "TPEx",
    symbol,
    name,
    open: numberValue(raw.o),
    high: numberValue(raw.h),
    low: numberValue(raw.l),
    close,
    change_pct: previous != null && previous > 0 ? round((close / previous - 1) * 100, 2) : null,
    volume: volumeLots != null ? volumeLots * 1000 : null,
    value: tradeValue,
    source: "Fugle TPEx ticker universe + TWSE MIS OTC quotes",
  };
}

async function tryFugleTickersMisOtc(env: Env): Promise<MarketSnapshot> {
  try {
    const tickerBody = await fugle(env, "/intraday/tickers", {
      type: "EQUITY",
      exchange: "TPEx",
      market: "OTC",
    });
    const tickerRows = rowsFromBody(tickerBody);
    const tickers = tickerRows.map((row) => ({
      symbol: String(row.symbol ?? "").trim(),
      name: String(row.name ?? "").trim(),
    })).filter((row) => isOrdinaryStock(row.symbol, row.name));
    if (tickers.length < MIN_COVERAGE.TPEx) {
      throw new Error(`Fugle /intraday/tickers TPEx OTC 僅 ${tickers.length} 筆`);
    }

    const nameBySymbol = new Map(tickers.map((row) => [row.symbol, row.name]));
    const batches = chunked(tickers.map((row) => row.symbol), MIS_BATCH_SIZE);
    const settled = await concurrencyMap(batches, 4, async (batch) => fetchMisOtcBatch(batch));
    const errors: string[] = [];
    const raw: Obj[] = [];
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") raw.push(...result.value);
      else errors.push(`TWSE MIS batch ${index + 1}/${batches.length}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    });
    const deduped = new Map<string, SnapshotRow>();
    for (const item of raw) {
      const symbol = String(item.c ?? "").trim();
      const row = normalizeMisOtcRow(item, nameBySymbol.get(symbol) ?? "");
      if (row) deduped.set(row.symbol, row);
    }
    const rows = [...deduped.values()];
    return {
      market: "TPEx",
      provider: rows.length ? "FUGLE_TICKERS_MIS_OTC" : "UNAVAILABLE",
      rows,
      raw_count: raw.length,
      normalized_count: rows.length,
      sample_keys: Object.keys(raw[0] ?? {}).slice(0, 24),
      errors: rows.length ? errors : [...errors, "Fugle ticker universe 可用，但 TWSE MIS OTC 正規化後為 0 筆"],
    };
  } catch (error) {
    return {
      market: "TPEx", provider: "UNAVAILABLE", rows: [], raw_count: 0, normalized_count: 0, sample_keys: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

async function tryFugleMarket(env: Env, market: Market): Promise<MarketSnapshot> {
  const fugleMarket = market === "TWSE" ? "TSE" : "OTC";
  const provider: Provider = market === "TWSE" ? "FUGLE_TSE" : "FUGLE_OTC";
  try {
    const body = await fugle(env, `/snapshot/quotes/${fugleMarket}`, { type: "COMMONSTOCK" });
    const raw = rowsFromBody(body);
    const rows = raw.map((item) => {
      const q = normalizeQuote(item, String(rec(item).symbol ?? ""));
      if (!isOrdinaryStock(q.symbol, q.name) || q.close <= 0) return null;
      return {
        market,
        symbol: q.symbol,
        name: q.name,
        open: q.open || null,
        high: q.high || null,
        low: q.low || null,
        close: q.close,
        change_pct: Number.isFinite(q.change_percent) ? q.change_percent : null,
        volume: q.trade_volume || null,
        value: q.trade_value || 0,
        source: `Fugle ${fugleMarket} COMMONSTOCK`,
      } satisfies SnapshotRow;
    }).filter((row): row is SnapshotRow => Boolean(row));
    return {
      market, provider, rows,
      raw_count: raw.length,
      normalized_count: rows.length,
      sample_keys: Object.keys(raw[0] ?? {}).slice(0, 24),
      errors: rows.length ? [] : [`Fugle ${fugleMarket} snapshot 回傳 0 筆普通股`],
    };
  } catch (error) {
    return {
      market, provider: "UNAVAILABLE", rows: [], raw_count: 0, normalized_count: 0, sample_keys: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function normalizeFinMindSnapshot(priceRows: any[], infoRows: any[]) {
  const infoMap = new Map<string, any>();
  for (const row of infoRows) {
    const symbol = String(row.stock_id ?? row.symbol ?? "").trim();
    if (symbol) infoMap.set(symbol, row);
  }
  const grouped = new Map<string, any[]>();
  for (const row of priceRows) {
    const symbol = String(row.stock_id ?? row.symbol ?? "").trim();
    if (!symbol) continue;
    const bucket = grouped.get(symbol) ?? [];
    bucket.push(row);
    grouped.set(symbol, bucket);
  }
  const byMarket: Record<Market, SnapshotRow[]> = { TWSE: [], TPEx: [] };
  for (const [symbol, rows] of grouped) {
    rows.sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
    const latest = rows.at(-1);
    if (!latest) continue;
    const info = infoMap.get(symbol) ?? {};
    const name = String(info.stock_name ?? latest.stock_name ?? "");
    if (!isOrdinaryStock(symbol, name)) continue;
    const close = num(latest.close);
    if (close <= 0) continue;
    const previous = rows.length >= 2 ? num(rows.at(-2)?.close) : close - num(latest.spread);
    const marketText = String(info.type ?? info.market ?? latest.type ?? "").toUpperCase();
    const market: Market = marketText.includes("OTC") || marketText.includes("TPEX") ? "TPEx" : "TWSE";
    byMarket[market].push({
      market, symbol, name,
      open: num(latest.open) || null,
      high: num(latest.max ?? latest.high) || null,
      low: num(latest.min ?? latest.low) || null,
      close,
      change_pct: previous > 0 ? round((close / previous - 1) * 100, 2) : null,
      volume: num(latest.Trading_Volume ?? latest.volume) || null,
      value: num(latest.Trading_money ?? latest.Trading_Value ?? latest.trade_value),
      source: "FinMind full-market fallback",
    });
  }
  return byMarket;
}

async function tryFinMindAllMarket(env: Env, requestedDate: string) {
  try {
    const [priceRows, infoRows] = await Promise.all([
      finmind(env, "TaiwanStockPrice", { start_date: shiftDate(requestedDate, -10), end_date: requestedDate }),
      finmind(env, "TaiwanStockInfo", {}),
    ]);
    return {
      byMarket: normalizeFinMindSnapshot(priceRows, infoRows),
      price_row_count: priceRows.length,
      info_row_count: infoRows.length,
      error: null as string | null,
    };
  } catch (error) {
    return {
      byMarket: { TWSE: [] as SnapshotRow[], TPEx: [] as SnapshotRow[] },
      price_row_count: 0,
      info_row_count: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function loadMarketUniverse(env: Env, requestedDate: string) {
  const official = await Promise.all([tryOfficialMarket("TWSE"), tryOfficialMarket("TPEx")]);
  const chosen: Record<Market, MarketSnapshot> = { TWSE: official[0], TPEx: official[1] };
  const diagnostics: Record<Market, { attempts: any[] }> = { TWSE: { attempts: [] }, TPEx: { attempts: [] } };
  diagnostics.TWSE.attempts.push({ provider: official[0].provider, count: official[0].normalized_count, errors: official[0].errors });
  diagnostics.TPEx.attempts.push({ provider: official[1].provider, count: official[1].normalized_count, errors: official[1].errors });

  const deficient = (market: Market) => chosen[market].normalized_count < MIN_COVERAGE[market];

  if (deficient("TPEx")) {
    const misFallback = await tryFugleTickersMisOtc(env);
    diagnostics.TPEx.attempts.push({ provider: misFallback.provider, count: misFallback.normalized_count, errors: misFallback.errors });
    if (misFallback.normalized_count >= MIN_COVERAGE.TPEx) chosen.TPEx = misFallback;
  }

  const fugleMarkets = (["TWSE", "TPEx"] as Market[]).filter(deficient);
  if (fugleMarkets.length) {
    const fugleResults = await Promise.all(fugleMarkets.map((market) => tryFugleMarket(env, market)));
    fugleResults.forEach((result, index) => {
      const market = fugleMarkets[index];
      diagnostics[market].attempts.push({ provider: result.provider, count: result.normalized_count, errors: result.errors });
      if (result.normalized_count >= MIN_COVERAGE[market]) chosen[market] = result;
    });
  }

  const stillDeficient = (["TWSE", "TPEx"] as Market[]).filter(deficient);
  let finmindStatus: any = null;
  if (stillDeficient.length) {
    const fallback = await tryFinMindAllMarket(env, requestedDate);
    finmindStatus = {
      attempted: true,
      configured: Boolean(env.FINMIND_TOKEN),
      price_row_count: fallback.price_row_count,
      info_row_count: fallback.info_row_count,
      error: fallback.error,
    };
    for (const market of stillDeficient) {
      const rows = fallback.byMarket[market];
      diagnostics[market].attempts.push({ provider: "FINMIND_FALLBACK", count: rows.length, errors: fallback.error ? [fallback.error] : [] });
      if (rows.length >= MIN_COVERAGE[market]) {
        chosen[market] = {
          market, provider: "FINMIND_FALLBACK", rows,
          raw_count: rows.length, normalized_count: rows.length, sample_keys: [], errors: [],
        };
      }
    }
  }

  const rows = [...chosen.TWSE.rows, ...chosen.TPEx.rows];
  return {
    TWSE: chosen.TWSE,
    TPEx: chosen.TPEx,
    rows,
    usable: chosen.TWSE.normalized_count >= MIN_COVERAGE.TWSE && chosen.TPEx.normalized_count >= MIN_COVERAGE.TPEx,
    diagnostics,
    provider_configuration: {
      fugle_configured: Boolean(env.FUGLE_API_KEY),
      finmind_configured: Boolean(env.FINMIND_TOKEN),
      finmind_fallback: finmindStatus,
    },
  };
}

export async function diagnoseFamilySelectionData(env: Env) {
  const snapshot = await loadMarketUniverse(env, taipeiDate());
  return {
    selector_version: FAMILY_STOCK_SELECTION_VERSION,
    checked_at: new Date().toISOString(),
    minimum_coverage: MIN_COVERAGE,
    twse: {
      provider: snapshot.TWSE.provider,
      normalized_count: snapshot.TWSE.normalized_count,
      errors: snapshot.TWSE.errors,
      attempts: snapshot.diagnostics.TWSE.attempts,
    },
    tpex: {
      provider: snapshot.TPEx.provider,
      normalized_count: snapshot.TPEx.normalized_count,
      errors: snapshot.TPEx.errors,
      attempts: snapshot.diagnostics.TPEx.attempts,
    },
    combined_count: snapshot.rows.length,
    provider_configuration: snapshot.provider_configuration,
    usable: snapshot.usable,
  };
}

async function loadDailyBars(env: Env, symbol: string, startDate: string, endDate: string) {
  const errors: string[] = [];
  try {
    const bars = normalizeDailyBars(await finmind(env, "TaiwanStockPrice", {
      data_id: symbol,
      start_date: startDate,
      end_date: endDate,
    }));
    if (bars.length >= 80) return { bars, provider: "FINMIND_OR_OFFICIAL", errors };
    errors.push(`FinMind/official 日K樣本不足：${bars.length}`);
  } catch (error) {
    errors.push(`FinMind/official 日K：${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const body = await fugle(env, `/historical/candles/${symbol}`, {
      from: startDate,
      to: endDate,
      timeframe: "D",
      adjusted: "false",
      fields: "open,high,low,close,volume",
      sort: "asc",
    });
    const bars = normalizeDailyBars(rowsFromBody(body));
    if (bars.length >= 80) return { bars, provider: "FUGLE_HISTORICAL", errors };
    errors.push(`Fugle 日K樣本不足：${bars.length}`);
  } catch (error) {
    errors.push(`Fugle 日K：${error instanceof Error ? error.message : String(error)}`);
  }
  return { bars: [] as DailyBar[], provider: "UNAVAILABLE", errors };
}

function dailyContext(bars: DailyBar[]) {
  const tech = technicalSummary(bars);
  const latest = bars.at(-1);
  const prior20 = bars.slice(-21, -1);
  const prior20High = prior20.length ? Math.max(...prior20.map((bar) => bar.high)) : null;
  const atr = num((tech as any).atr14);
  const sma20 = num((tech as any).sma20);
  return {
    technical: tech,
    latest,
    distance_to_sma20_atr: latest && atr > 0 ? round((latest.close - sma20) / atr, 3) : null,
    distance_to_prior_20d_high_percent: latest && prior20High ? round((latest.close / prior20High - 1) * 100, 2) : null,
  };
}

function latestRevenueGrowth(rows: any[]): number | null {
  const normalized = rows.map((row) => ({
    revenue: num(row.revenue),
    year: num(row.revenue_year),
    month: num(row.revenue_month),
    officialYoy: Number(row.yoy_percent_official),
  })).filter((row) => row.revenue > 0 && row.year > 0 && row.month > 0)
    .sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month));
  const latest = normalized.at(-1);
  if (!latest) return null;
  if (Number.isFinite(latest.officialYoy)) return round(latest.officialYoy, 2);
  const lastYear = normalized.find((row) => row.year === latest.year - 1 && row.month === latest.month);
  return lastYear?.revenue ? round((latest.revenue / lastYear.revenue - 1) * 100, 2) : null;
}

function institutionalContext(rows: any[]) {
  if (!rows.length) return { foreign_net_lots: 0, trust_net_lots: 0, dealer_net_lots: 0 };
  const latestDate = rows.map((row) => String(row.date ?? "")).filter(Boolean).sort().at(-1) ?? null;
  const current = latestDate ? rows.filter((row) => String(row.date ?? "") === latestDate) : rows;
  let foreign = 0, trust = 0, dealer = 0;
  for (const row of current) {
    const name = String(row.name ?? row.type ?? "");
    const net = num(row.buy_sell ?? row.net ?? row.net_buy_sell);
    if (/外資|陸資/.test(name)) foreign += net;
    else if (/投信/.test(name)) trust += net;
    else if (/自營商/.test(name)) dealer += net;
  }
  return {
    foreign_net_lots: Math.round(foreign / 1000),
    trust_net_lots: Math.round(trust / 1000),
    dealer_net_lots: Math.round(dealer / 1000),
  };
}

function classifyMode(query: string): FamilyMode {
  if (/穩健|保守|比較穩|低風險|穩一點/.test(query)) return "stable";
  if (/積極|進攻|強勢|突破型|可以冒險/.test(query)) return "aggressive";
  return "balanced";
}

function requestedTopN(query: string) {
  const match = query.match(/(?:top\s*|前\s*)(\d{1,2})/i);
  return match ? Math.max(1, Math.min(10, Number(match[1]) || 5)) : 5;
}

export function isFamilyStockSelectionQuery(query: string) {
  if (/(?<!\d)\d{4,6}(?!\d)/.test(query)) return false;
  return /選股|選股票|找股票|波段(?:股|選股|候選)?|推薦(?:幾檔|股票)|有哪些股票|什麼股票可以看|值得注意的股票|top\s*\d+/i.test(query);
}

function scoreCandidate(input: CandidateInput, mode: FamilyMode) {
  const cfg = MODE_CONFIG[mode];
  const w = cfg.weights;
  const technical = clamp(input.technical_score);
  const growth = input.revenue_yoy_percent == null ? 50 : clamp(50 + input.revenue_yoy_percent * 1.5);
  const liquidity = input.trade_value > 0 ? clamp(55 + Math.log10(Math.max(1, input.trade_value / cfg.minTradeValue)) * 22) : 0;
  const volatility = Math.max(0, input.annualized_volatility_60d_percent ?? 60);
  const drawdown = Math.abs(Math.min(0, input.max_drawdown_percent ?? -30));
  const risk = mode === "stable"
    ? clamp(100 - volatility * 0.75 - drawdown * 0.65)
    : mode === "balanced"
      ? clamp(100 - volatility * 0.50 - drawdown * 0.45)
      : clamp(100 - volatility * 0.30 - drawdown * 0.25);

  let location = 60;
  const d20 = input.distance_to_prior_20d_high_percent;
  const extension = input.distance_to_sma20_atr;
  if (d20 != null && d20 >= -5 && d20 <= 2.5) location += 20;
  else if (d20 != null && d20 < -12) location -= 15;
  else if (d20 != null && d20 > 5) location -= 20;
  if (extension != null && extension >= 0 && extension <= 1.8) location += 10;
  if (extension != null && extension > cfg.maxExtensionAtr) location -= 25;
  location = clamp(location);

  let chip = 50;
  if (input.foreign_net_lots > 0) chip += 12;
  if (input.trust_net_lots > 0) chip += 20;
  if (input.foreign_net_lots < 0 && input.trust_net_lots < 0) chip -= 25;
  chip = clamp(chip);

  const score = round(
    technical * w.technical + growth * w.growth + liquidity * w.liquidity +
    risk * w.risk + location * w.location + chip * w.chip,
    1,
  );

  const chaseRisk = input.change_percent > cfg.maxDailyGain ||
    (input.return_20d_percent ?? 0) > cfg.maxReturn20 ||
    (input.distance_to_sma20_atr ?? 0) > cfg.maxExtensionAtr;
  const bucket = chaseRisk ? "YELLOW_WAIT" : score >= 72 ? "GREEN_RESEARCH" : score >= 60 ? "YELLOW_WAIT" : "RED_SKIP";

  const reasons: string[] = [];
  const cautions: string[] = [];
  if (technical >= 70) reasons.push("日線趨勢與中期動能偏強");
  if ((input.return_60d_percent ?? 0) > 8) reasons.push(`近60日維持相對強勢（${input.return_60d_percent}%）`);
  if (input.revenue_yoy_percent != null && input.revenue_yoy_percent >= 10) reasons.push(`最新月營收年增 ${input.revenue_yoy_percent}%`);
  if (d20 != null && d20 >= -5 && d20 <= 2.5) reasons.push("位於20日關鍵高點附近，可等突破或回踩確認");
  if (input.trust_net_lots > 0) reasons.push("投信最新資料為買超");
  else if (input.foreign_net_lots > 0) reasons.push("外資最新資料為買超");
  if (input.trade_value >= cfg.minTradeValue * 3) reasons.push("成交值與流動性充足");

  if (input.revenue_yoy_percent == null) cautions.push("最新月營收年增資料不足，基本面不額外加分");
  else if (input.revenue_yoy_percent < 0) cautions.push(`最新月營收年減 ${Math.abs(input.revenue_yoy_percent)}%`);
  if (input.change_percent > cfg.maxDailyGain) cautions.push("最新交易日漲幅偏大，家用模式避免追價");
  if ((input.return_20d_percent ?? 0) > cfg.maxReturn20) cautions.push("近20日已明顯上漲，等待整理或回測");
  if ((input.distance_to_sma20_atr ?? 0) > cfg.maxExtensionAtr) cautions.push("價格離20日均線過遠，短線乖離偏高");
  if (input.foreign_net_lots < 0 && input.trust_net_lots < 0) cautions.push("外資與投信同步賣超");
  if (volatility > 65) cautions.push("近60日波動偏高");

  const position = bucket === "GREEN_RESEARCH"
    ? (d20 != null && d20 >= -5 ? "優先觀察突破確認或突破後回踩，不追長紅" : "列入優先研究，等待整理或靠近支撐")
    : bucket === "YELLOW_WAIT" ? "先等更好的價格位置，不追價" : "本輪略過";
  return { score, bucket, reasons: reasons.slice(0, 5), cautions: cautions.slice(0, 5), position };
}

async function lookupIndustries(env: Env, symbols: string[]) {
  const map = new Map<string, string>();
  if (!env.DB || !symbols.length) return map;
  try {
    const placeholders = symbols.map(() => "?").join(",");
    const result = await env.DB.prepare(`SELECT ticker, official_industry FROM global_companies WHERE country = 'TW' AND ticker IN (${placeholders}) AND status = 'active'`)
      .bind(...symbols).all<{ ticker: string; official_industry: string }>();
    for (const row of result.results ?? []) map.set(String(row.ticker), String(row.official_industry ?? ""));
  } catch {}
  return map;
}

export async function runFamilyStockSelection(env: Env, input: { query: string; as_of_date?: string }) {
  const query = String(input.query ?? "").trim();
  const requestedDate = input.as_of_date && /^\d{4}-\d{2}-\d{2}$/.test(input.as_of_date) ? input.as_of_date : taipeiDate();
  const mode = classifyMode(query);
  const topN = requestedTopN(query);
  const cfg = MODE_CONFIG[mode];

  const snapshot = await loadMarketUniverse(env, requestedDate);
  if (!snapshot.usable) {
    throw new Error(`全市場資料覆蓋不足：TWSE=${snapshot.TWSE.normalized_count}(${snapshot.TWSE.provider}), TPEx=${snapshot.TPEx.normalized_count}(${snapshot.TPEx.provider})；請看 /health/family-selection-data`);
  }

  const liquid = snapshot.rows
    .filter((row) => row.value >= cfg.minTradeValue)
    .filter((row) => (row.change_pct ?? 0) > -9.5 && (row.change_pct ?? 0) < 9.8)
    .sort((a, b) => b.value - a.value)
    .slice(0, cfg.snapshotShortlist);
  if (!liquid.length) throw new Error("全市場有資料，但流動性快篩後為 0 筆");

  const technicalSettled = await concurrencyMap(liquid, 5, async (quote) => {
    const history = await loadDailyBars(env, quote.symbol, shiftDate(requestedDate, -340), requestedDate);
    if (history.bars.length < 80) throw new Error(`${quote.symbol} 日K不可用；${history.errors.join("；")}`);
    return { ...quote, bars: history.bars, history_provider: history.provider, ...dailyContext(history.bars) };
  });

  const technicalRows = technicalSettled
    .flatMap((result) => result.status === "fulfilled" ? [result.value] : [])
    .sort((a: any, b: any) => num(b.technical?.score) - num(a.technical?.score))
    .slice(0, cfg.technicalShortlist);
  if (!technicalRows.length) {
    const errors = technicalSettled.flatMap((result, index) => result.status === "rejected"
      ? [`${liquid[index]?.symbol}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
      : []);
    throw new Error(`日K技術資料無法形成候選；${errors.slice(0, 5).join("；")}`);
  }

  const deepSettled = await concurrencyMap(technicalRows, 4, async (row: any) => {
    const priceDate = String(row.latest?.date ?? requestedDate);
    const [revenueResult, institutionalResult] = await Promise.allSettled([
      finmind(env, "TaiwanStockMonthRevenue", { data_id: row.symbol, start_date: shiftDate(priceDate, -500), end_date: priceDate }),
      finmind(env, "TaiwanStockInstitutionalInvestorsBuySell", { data_id: row.symbol, start_date: shiftDate(priceDate, -10), end_date: priceDate }),
    ]);
    const revenue = revenueResult.status === "fulfilled" ? latestRevenueGrowth(revenueResult.value) : null;
    const institutional = institutionalResult.status === "fulfilled" ? institutionalContext(institutionalResult.value) : institutionalContext([]);
    return {
      ...row,
      revenue_yoy_percent: revenue,
      revenue_error: revenueResult.status === "rejected" ? String(revenueResult.reason) : null,
      institutional_error: institutionalResult.status === "rejected" ? String(institutionalResult.reason) : null,
      ...institutional,
    };
  });

  const enriched = deepSettled.flatMap((result, index) => result.status === "fulfilled"
    ? [result.value]
    : [{
        ...technicalRows[index],
        revenue_yoy_percent: null,
        foreign_net_lots: 0,
        trust_net_lots: 0,
        dealer_net_lots: 0,
        revenue_error: String(result.reason),
        institutional_error: String(result.reason),
      }]);
  const industries = await lookupIndustries(env, enriched.map((row: any) => row.symbol));

  const ranked = enriched.map((row: any) => {
    const tech = row.technical ?? {};
    const inputRow: CandidateInput = {
      symbol: row.symbol,
      name: row.name,
      market: row.market,
      sector: industries.get(row.symbol) ?? "",
      close: num(row.latest?.close || row.close),
      price_date: String(row.latest?.date ?? requestedDate),
      change_percent: num(row.change_pct),
      trade_value: num(row.value),
      technical_score: num(tech.score),
      return_20d_percent: tech.return_20d_percent ?? null,
      return_60d_percent: tech.return_60d_percent ?? null,
      annualized_volatility_60d_percent: tech.annualized_volatility_60d_percent ?? null,
      max_drawdown_percent: tech.max_drawdown_percent ?? null,
      atr14: tech.atr14 ?? null,
      distance_to_sma20_atr: row.distance_to_sma20_atr ?? null,
      distance_to_prior_20d_high_percent: row.distance_to_prior_20d_high_percent ?? null,
      revenue_yoy_percent: row.revenue_yoy_percent ?? null,
      foreign_net_lots: num(row.foreign_net_lots),
      trust_net_lots: num(row.trust_net_lots),
      dealer_net_lots: num(row.dealer_net_lots),
    };
    const judged = scoreCandidate(inputRow, mode);
    return {
      ...inputRow,
      history_provider: row.history_provider,
      family_score: judged.score,
      family_bucket: judged.bucket,
      reasons: judged.reasons,
      cautions: judged.cautions,
      position_guidance: judged.position,
      revenue_data_partial_error: row.revenue_error ?? null,
      institutional_data_partial_error: row.institutional_error ?? null,
    };
  }).sort((a, b) => b.family_score - a.family_score);

  const green = ranked.filter((row) => row.family_bucket === "GREEN_RESEARCH");
  const yellow = ranked.filter((row) => row.family_bucket === "YELLOW_WAIT");
  const red = ranked.filter((row) => row.family_bucket === "RED_SKIP");
  const candidates = [...green, ...yellow].slice(0, topN).map((row, index) => ({ rank: index + 1, ...row }));

  const priceDates = candidates.map((row) => row.price_date).filter(Boolean).sort();
  return {
    service: "Taiwan Stock AI Family Read-Only API",
    route: "family_stock_selection",
    version: FAMILY_STOCK_SELECTION_VERSION,
    read_only: true,
    research_only: true,
    horizon: "1-8 weeks",
    family_mode: mode,
    requested_top_n: topN,
    requested_date: requestedDate,
    latest_candidate_price_date: priceDates.at(-1) ?? null,
    universe: {
      source: "TWSE/TPEx official OpenAPI with controlled Fugle ticker + TWSE MIS / Fugle snapshot / FinMind fallbacks",
      twse_provider: snapshot.TWSE.provider,
      tpex_provider: snapshot.TPEx.provider,
      twse_count: snapshot.TWSE.normalized_count,
      tpex_count: snapshot.TPEx.normalized_count,
      full_market_count: snapshot.rows.length,
      liquid_count: liquid.length,
      technical_scanned_count: technicalRows.length,
      deep_scanned_count: ranked.length,
    },
    candidates,
    waitlist: yellow.slice(0, Math.min(5, topN)),
    skipped_examples: red.slice(0, 3),
    data_diagnostics: {
      market_attempts: snapshot.diagnostics,
      provider_configuration: snapshot.provider_configuration,
      technical_errors: technicalSettled.flatMap((result, index) => result.status === "rejected"
        ? [{ symbol: liquid[index]?.symbol, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }]
        : []).slice(0, 8),
      revenue_partial_failures: ranked.filter((row) => row.revenue_data_partial_error).length,
      institutional_partial_failures: ranked.filter((row) => row.institutional_data_partial_error).length,
    },
    hard_rules: [
      "好公司不等於現在就是好買點。",
      "家用波段選股以不追高為硬原則；YELLOW_WAIT 不是立即買進訊號。",
      "全市場候選優先使用 TWSE/TPEx 官方資料；TPEx 官方全市場端點不可用時，可用 Fugle 股票清單建立上櫃 universe，再由 TWSE MIS 取得批次行情；仍不可用新聞或熱門股名單硬湊。",
      "歷史技術資料、月營收或法人資料缺失時要明示，不捏造數字。",
      "不提供自動下單、不保證報酬。",
    ],
    response_instructions: [
      "請以繁體中文先給結論。",
      "若 candidates 少於要求數量，不要硬湊滿。",
      "每檔只需用家人看得懂的方式說：為什麼入選、現在應觀察突破還是回踩、主要風險。",
      "GREEN_RESEARCH = 優先研究；YELLOW_WAIT = 等待位置；RED_SKIP 不列為推薦。",
      "價格是 price_date 的收盤參考，不得描述成即時成交價。",
    ],
  };
}
