import {
  concurrencyMap,
  fugle,
  normalizeDailyBars,
  num,
  rec,
  round,
  taipeiDate,
  technicalSummary,
  type DailyBar,
  type Obj,
} from "../v6/common";
import {
  isFamilyStockSelectionQuery,
  runFamilyStockSelection as runLegacyFamilyStockSelection,
} from "./family-stock-selection-v15";

export { isFamilyStockSelectionQuery };
export const FAMILY_STOCK_SELECTION_VERSION = "family-stock-selection/production-v1.7.0";

const TWSE_QUOTES_URL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";
const MOPSFIN_TPEX_COMPANIES_CSV = "https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv";
const TWSE_MIS_URL = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp";
const USER_AGENT = "taistock-mcp-family-selector/1.7 (+https://github.com/keywayk09/taistock-mcp)";
const MIS_BATCH_SIZE = 100;
const MIN_COVERAGE = { TWSE: 400, TPEx: 250 } as const;

type FamilyMode = "stable" | "balanced" | "aggressive";
type Market = "TWSE" | "TPEx";

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
  provider: string;
  rows: SnapshotRow[];
  raw_count: number;
  normalized_count: number;
  errors: string[];
};

type TechnicalCandidate = SnapshotRow & {
  price_date: string;
  history_provider: string;
  technical_score: number;
  return_20d_percent: number | null;
  return_60d_percent: number | null;
  annualized_volatility_60d_percent: number | null;
  max_drawdown_percent: number | null;
  atr14: number | null;
  distance_to_sma20_atr: number | null;
  distance_to_prior_20d_high_percent: number | null;
};

const MODE_CONFIG: Record<FamilyMode, {
  minTradeValue: number;
  maxDailyGain: number;
  maxReturn20: number;
  maxExtensionAtr: number;
  snapshotShortlist: number;
  technicalShortlist: number;
  weights: { technical: number; liquidity: number; risk: number; location: number };
}> = {
  stable: {
    minTradeValue: 50_000_000,
    maxDailyGain: 5,
    maxReturn20: 18,
    maxExtensionAtr: 2,
    snapshotShortlist: 36,
    technicalShortlist: 14,
    weights: { technical: 0.50, liquidity: 0.10, risk: 0.25, location: 0.15 },
  },
  balanced: {
    minTradeValue: 20_000_000,
    maxDailyGain: 7,
    maxReturn20: 25,
    maxExtensionAtr: 2.5,
    snapshotShortlist: 44,
    technicalShortlist: 16,
    weights: { technical: 0.55, liquidity: 0.15, risk: 0.10, location: 0.20 },
  },
  aggressive: {
    minTradeValue: 10_000_000,
    maxDailyGain: 9,
    maxReturn20: 35,
    maxExtensionAtr: 3,
    snapshotShortlist: 52,
    technicalShortlist: 18,
    weights: { technical: 0.65, liquidity: 0.10, risk: 0.05, location: 0.20 },
  },
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

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
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n") {
      row.push(field.trim());
      field = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field.trim());
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  return rows;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function loadTwseOfficial(): Promise<MarketSnapshot> {
  try {
    const response = await fetchWithTimeout(TWSE_QUOTES_URL, {
      redirect: "manual",
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`TWSE OpenAPI HTTP ${response.status}: ${text.slice(0, 180)}`);
    const body = JSON.parse(text);
    const raw = rowsFromBody(body);
    const rows = raw.flatMap((item) => {
      const symbol = String(pick(item, ["Code", "證券代號", "股票代號", "代號"]) ?? "").trim();
      const name = String(pick(item, ["Name", "證券名稱", "股票名稱", "名稱"]) ?? "").trim();
      if (!isOrdinaryStock(symbol, name)) return [];
      const close = numberValue(pick(item, ["ClosingPrice", "Close", "收盤價", "收盤"]));
      if (close == null || close <= 0) return [];
      const change = numberValue(pick(item, ["Change", "ChangeAmount", "漲跌價差", "漲跌"]));
      const previous = change == null ? null : close - change;
      const value = numberValue(pick(item, ["TradeValue", "TradingValue", "TradingAmount", "成交金額", "成交值"])) ?? 0;
      return [{
        market: "TWSE" as const,
        symbol,
        name,
        open: numberValue(pick(item, ["OpeningPrice", "Open", "開盤價"])),
        high: numberValue(pick(item, ["HighestPrice", "High", "最高價"])),
        low: numberValue(pick(item, ["LowestPrice", "Low", "最低價"])),
        close,
        change_pct: previous != null && previous > 0 ? round((close / previous - 1) * 100, 2) : null,
        volume: numberValue(pick(item, ["TradeVolume", "TradingShares", "成交股數", "成交量"])),
        value,
        source: "TWSE OpenAPI STOCK_DAY_ALL",
      } satisfies SnapshotRow];
    });
    return {
      market: "TWSE",
      provider: "TWSE_OPENAPI",
      rows,
      raw_count: raw.length,
      normalized_count: rows.length,
      errors: rows.length >= MIN_COVERAGE.TWSE ? [] : [`TWSE OpenAPI coverage only ${rows.length}`],
    };
  } catch (error) {
    return { market: "TWSE", provider: "UNAVAILABLE", rows: [], raw_count: 0, normalized_count: 0, errors: [errorText(error)] };
  }
}

async function loadTpexCompanyUniverse() {
  const response = await fetchWithTimeout(MOPSFIN_TPEX_COMPANIES_CSV, {
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
    throw new Error(`MOPSFIN TPEx company CSV HTTP ${response.status} redirect blocked${location ? ` -> ${location}` : ""}`);
  }
  if (!response.ok) throw new Error(`MOPSFIN TPEx company CSV HTTP ${response.status}: ${text.slice(0, 180)}`);
  const table = parseCsv(text);
  if (table.length < MIN_COVERAGE.TPEx + 1) throw new Error(`MOPSFIN TPEx company CSV only ${Math.max(0, table.length - 1)} data rows`);
  const header = table[0].map((value) => value.trim());
  const symbolIndex = header.findIndex((value) => value.includes("公司代號"));
  const nameIndex = header.findIndex((value) => value.includes("公司簡稱"));
  const fullNameIndex = header.findIndex((value) => value.includes("公司名稱"));
  const universe = table.slice(1).flatMap((cells) => {
    const symbol = String(cells[symbolIndex >= 0 ? symbolIndex : 1] ?? "").trim();
    const name = String(cells[nameIndex >= 0 ? nameIndex : (fullNameIndex >= 0 ? fullNameIndex : 2)] ?? "").trim();
    if (!isOrdinaryStock(symbol, name)) return [];
    return [{ symbol, name }];
  });
  const deduped = new Map(universe.map((item) => [item.symbol, item]));
  const rows = [...deduped.values()];
  if (rows.length < MIN_COVERAGE.TPEx) throw new Error(`MOPSFIN TPEx ordinary-stock universe only ${rows.length}`);
  return rows;
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

function normalizeMisOtcRow(raw: Obj, fallbackName: string): SnapshotRow | null {
  const symbol = String(raw.c ?? "").trim();
  const name = String(raw.n ?? raw.nf ?? fallbackName ?? "").trim();
  if (!isOrdinaryStock(symbol, name)) return null;
  const last = numberValue(raw.z) ?? numberValue(raw.pz) ?? numberValue(raw.y);
  const previous = numberValue(raw.y);
  if (last == null || last <= 0) return null;
  const volumeLots = numberValue(raw.v);
  return {
    market: "TPEx",
    symbol,
    name,
    open: numberValue(raw.o),
    high: numberValue(raw.h),
    low: numberValue(raw.l),
    close: last,
    change_pct: previous != null && previous > 0 ? round((last / previous - 1) * 100, 2) : null,
    volume: volumeLots != null ? volumeLots * 1000 : null,
    value: volumeLots != null && volumeLots > 0 ? last * volumeLots * 1000 : 0,
    source: "MOPSFIN TPEx company master + TWSE MIS OTC quotes",
  };
}

async function loadTpexMopsMis(): Promise<MarketSnapshot> {
  try {
    const universe = await loadTpexCompanyUniverse();
    const nameBySymbol = new Map(universe.map((item) => [item.symbol, item.name]));
    const batches = chunked(universe.map((item) => item.symbol), MIS_BATCH_SIZE);
    const settled = await concurrencyMap(batches, 4, async (batch) => fetchMisOtcBatch(batch));
    const raw: Obj[] = [];
    const errors: string[] = [];
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") raw.push(...result.value);
      else errors.push(`MIS batch ${index + 1}/${batches.length}: ${errorText(result.reason)}`);
    });
    const deduped = new Map<string, SnapshotRow>();
    for (const item of raw) {
      const symbol = String(item.c ?? "").trim();
      const row = normalizeMisOtcRow(item, nameBySymbol.get(symbol) ?? "");
      if (row) deduped.set(row.symbol, row);
    }
    const rows = [...deduped.values()];
    if (rows.length < MIN_COVERAGE.TPEx) {
      errors.push(`MOPSFIN+MIS normalized TPEx coverage only ${rows.length}/${universe.length}`);
    }
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

async function loadRobustUniverse() {
  const [twse, tpex] = await Promise.all([loadTwseOfficial(), loadTpexMopsMis()]);
  return {
    TWSE: twse,
    TPEx: tpex,
    rows: [...twse.rows, ...tpex.rows],
    usable: twse.normalized_count >= MIN_COVERAGE.TWSE && tpex.normalized_count >= MIN_COVERAGE.TPEx,
  };
}

async function loadFugleDailyBars(env: Env, symbol: string, startDate: string, endDate: string) {
  const body = await fugle(env, `/historical/candles/${symbol}`, {
    from: startDate,
    to: endDate,
    timeframe: "D",
    adjusted: "false",
    fields: "open,high,low,close,volume",
    sort: "asc",
  });
  return normalizeDailyBars(rowsFromBody(body));
}

function technicalCandidate(quote: SnapshotRow, bars: DailyBar[]): TechnicalCandidate {
  const tech = technicalSummary(bars) as any;
  const latest = bars.at(-1);
  if (!latest) throw new Error(`${quote.symbol} has no latest daily bar`);
  const prior20 = bars.slice(-21, -1);
  const prior20High = prior20.length ? Math.max(...prior20.map((bar) => bar.high)) : null;
  const atr = num(tech.atr14);
  const sma20 = num(tech.sma20);
  return {
    ...quote,
    close: latest.close,
    price_date: String(latest.date),
    history_provider: "FUGLE_HISTORICAL",
    technical_score: num(tech.score),
    return_20d_percent: tech.return_20d_percent ?? null,
    return_60d_percent: tech.return_60d_percent ?? null,
    annualized_volatility_60d_percent: tech.annualized_volatility_60d_percent ?? null,
    max_drawdown_percent: tech.max_drawdown_percent ?? null,
    atr14: tech.atr14 ?? null,
    distance_to_sma20_atr: atr > 0 ? round((latest.close - sma20) / atr, 3) : null,
    distance_to_prior_20d_high_percent: prior20High ? round((latest.close / prior20High - 1) * 100, 2) : null,
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

function scoreCandidate(row: TechnicalCandidate, mode: FamilyMode) {
  const cfg = MODE_CONFIG[mode];
  const technical = clamp(row.technical_score);
  const liquidity = row.value > 0 ? clamp(55 + Math.log10(Math.max(1, row.value / cfg.minTradeValue)) * 22) : 0;
  const volatility = Math.max(0, row.annualized_volatility_60d_percent ?? 60);
  const drawdown = Math.abs(Math.min(0, row.max_drawdown_percent ?? -30));
  const risk = mode === "stable"
    ? clamp(100 - volatility * 0.75 - drawdown * 0.65)
    : mode === "balanced"
      ? clamp(100 - volatility * 0.50 - drawdown * 0.45)
      : clamp(100 - volatility * 0.30 - drawdown * 0.25);
  let location = 60;
  const d20 = row.distance_to_prior_20d_high_percent;
  const extension = row.distance_to_sma20_atr;
  if (d20 != null && d20 >= -5 && d20 <= 2.5) location += 20;
  else if (d20 != null && d20 < -12) location -= 15;
  else if (d20 != null && d20 > 5) location -= 20;
  if (extension != null && extension >= 0 && extension <= 1.8) location += 10;
  if (extension != null && extension > cfg.maxExtensionAtr) location -= 25;
  location = clamp(location);
  const score = round(
    technical * cfg.weights.technical +
    liquidity * cfg.weights.liquidity +
    risk * cfg.weights.risk +
    location * cfg.weights.location,
    1,
  );
  const chaseRisk = (row.change_pct ?? 0) > cfg.maxDailyGain ||
    (row.return_20d_percent ?? 0) > cfg.maxReturn20 ||
    (row.distance_to_sma20_atr ?? 0) > cfg.maxExtensionAtr;
  const bucket = chaseRisk ? "YELLOW_WAIT" : score >= 72 ? "GREEN_RESEARCH" : score >= 60 ? "YELLOW_WAIT" : "RED_SKIP";
  const reasons: string[] = [];
  const cautions: string[] = [];
  if (technical >= 70) reasons.push("日線趨勢與中期動能偏強");
  if ((row.return_60d_percent ?? 0) > 8) reasons.push(`近60日維持相對強勢（${row.return_60d_percent}%）`);
  if (d20 != null && d20 >= -5 && d20 <= 2.5) reasons.push("位於20日關鍵高點附近，可等突破或回踩確認");
  if (row.value >= cfg.minTradeValue * 3) reasons.push("成交值與流動性充足");
  if ((row.change_pct ?? 0) > cfg.maxDailyGain) cautions.push("最新交易日漲幅偏大，家用模式避免追價");
  if ((row.return_20d_percent ?? 0) > cfg.maxReturn20) cautions.push("近20日已明顯上漲，等待整理或回測");
  if ((row.distance_to_sma20_atr ?? 0) > cfg.maxExtensionAtr) cautions.push("價格離20日均線過遠，短線乖離偏高");
  if (volatility > 65) cautions.push("近60日波動偏高");
  cautions.push("本備援路徑不使用失效的 FinMind Token；月營收與法人資料本輪不加分、不捏造");
  const position = bucket === "GREEN_RESEARCH"
    ? (d20 != null && d20 >= -5 ? "優先觀察突破確認或突破後回踩，不追長紅" : "列入優先研究，等待整理或靠近支撐")
    : bucket === "YELLOW_WAIT" ? "先等更好的價格位置，不追價" : "本輪略過";
  return { score, bucket, reasons: reasons.slice(0, 5), cautions: cautions.slice(0, 5), position };
}

async function runRobustFamilySelection(env: Env, input: { query: string; as_of_date?: string }, primaryError?: unknown) {
  const query = String(input.query ?? "").trim();
  const requestedDate = input.as_of_date && /^\d{4}-\d{2}-\d{2}$/.test(input.as_of_date) ? input.as_of_date : taipeiDate();
  const mode = classifyMode(query);
  const topN = requestedTopN(query);
  const cfg = MODE_CONFIG[mode];
  const universe = await loadRobustUniverse();
  if (!universe.usable) {
    throw new Error(`MOPSFIN+MIS 完整市場備援不足：TWSE=${universe.TWSE.normalized_count}, TPEx=${universe.TPEx.normalized_count}; TWSE=${universe.TWSE.errors.join(" | ")}; TPEx=${universe.TPEx.errors.join(" | ")}`);
  }

  const liquid = universe.rows
    .filter((row) => row.value >= cfg.minTradeValue)
    .filter((row) => (row.change_pct ?? 0) > -9.5 && (row.change_pct ?? 0) < 9.8)
    .sort((a, b) => b.value - a.value)
    .slice(0, cfg.snapshotShortlist);
  if (!liquid.length) throw new Error("MOPSFIN+MIS full market is available, but liquidity shortlist is empty");

  const historySettled = await concurrencyMap(liquid, 6, async (quote) => {
    const bars = await loadFugleDailyBars(env, quote.symbol, shiftDate(requestedDate, -340), requestedDate);
    if (bars.length < 80) throw new Error(`${quote.symbol} Fugle daily history only ${bars.length} bars`);
    return technicalCandidate(quote, bars);
  });
  const technicalErrors: Array<{ symbol: string; error: string }> = [];
  const technicalRows = historySettled.flatMap((result, index) => {
    if (result.status === "fulfilled") return [result.value];
    technicalErrors.push({ symbol: liquid[index]?.symbol ?? "", error: errorText(result.reason) });
    return [];
  }).sort((a, b) => b.technical_score - a.technical_score)
    .slice(0, cfg.technicalShortlist);
  if (!technicalRows.length) throw new Error(`Fugle daily history could not form technical candidates: ${technicalErrors.slice(0, 5).map((item) => `${item.symbol}:${item.error}`).join("; ")}`);

  const ranked = technicalRows.map((row) => {
    const judged = scoreCandidate(row, mode);
    return {
      symbol: row.symbol,
      name: row.name,
      market: row.market,
      sector: "",
      close: row.close,
      price_date: row.price_date,
      change_percent: row.change_pct ?? 0,
      trade_value: row.value,
      technical_score: row.technical_score,
      return_20d_percent: row.return_20d_percent,
      return_60d_percent: row.return_60d_percent,
      annualized_volatility_60d_percent: row.annualized_volatility_60d_percent,
      max_drawdown_percent: row.max_drawdown_percent,
      atr14: row.atr14,
      distance_to_sma20_atr: row.distance_to_sma20_atr,
      distance_to_prior_20d_high_percent: row.distance_to_prior_20d_high_percent,
      revenue_yoy_percent: null,
      foreign_net_lots: 0,
      trust_net_lots: 0,
      dealer_net_lots: 0,
      history_provider: row.history_provider,
      snapshot_provider: row.source,
      family_score: judged.score,
      family_bucket: judged.bucket,
      reasons: judged.reasons,
      cautions: judged.cautions,
      position_guidance: judged.position,
      revenue_data_partial_error: "FinMind token unavailable; not used in MOPSFIN+MIS fallback",
      institutional_data_partial_error: "FinMind token unavailable; not used in MOPSFIN+MIS fallback",
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
      source: "TWSE OpenAPI + MOPSFIN TPEx company master + TWSE MIS OTC quotes",
      twse_provider: universe.TWSE.provider,
      tpex_provider: universe.TPEx.provider,
      twse_count: universe.TWSE.normalized_count,
      tpex_count: universe.TPEx.normalized_count,
      full_market_count: universe.rows.length,
      liquid_count: liquid.length,
      technical_scanned_count: technicalRows.length,
      deep_scanned_count: ranked.length,
    },
    candidates,
    waitlist: yellow.slice(0, Math.min(5, topN)),
    skipped_examples: red.slice(0, 3),
    data_diagnostics: {
      fallback_path: "MOPSFIN_COMPANY_MASTER_MIS_OTC",
      legacy_primary_error: primaryError ? errorText(primaryError) : null,
      twse_errors: universe.TWSE.errors,
      tpex_errors: universe.TPEx.errors,
      technical_errors: technicalErrors.slice(0, 8),
      revenue_partial_failures: ranked.length,
      institutional_partial_failures: ranked.length,
    },
    hard_rules: [
      "好公司不等於現在就是好買點。",
      "家用波段選股以不追高為硬原則；YELLOW_WAIT 不是立即買進訊號。",
      "上櫃完整市場備援使用政府開放資料的公司母檔建立代號清單，再由 TWSE MIS 取得 OTC 報價。",
      "FinMind Token 失效時不把缺少的月營收或法人資料當成零分證據，也不捏造數字。",
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

export async function diagnoseFamilySelectionData(_env: Env) {
  const universe = await loadRobustUniverse();
  return {
    selector_version: FAMILY_STOCK_SELECTION_VERSION,
    checked_at: new Date().toISOString(),
    minimum_coverage: MIN_COVERAGE,
    twse: {
      provider: universe.TWSE.provider,
      normalized_count: universe.TWSE.normalized_count,
      errors: universe.TWSE.errors,
    },
    tpex: {
      provider: universe.TPEx.provider,
      normalized_count: universe.TPEx.normalized_count,
      errors: universe.TPEx.errors,
    },
    combined_count: universe.rows.length,
    provider_configuration: {
      primary: "TWSE_OPENAPI + MOPSFIN_TPEX_COMPANY_CSV + TWSE_MIS_OTC",
      finmind_required_for_market_coverage: false,
      fugle_required_for_market_coverage: false,
    },
    usable: universe.usable,
  };
}

export async function runFamilyStockSelection(env: Env, input: { query: string; as_of_date?: string }) {
  try {
    return await runRobustFamilySelection(env, input);
  } catch (robustError) {
    try {
      const legacy = await runLegacyFamilyStockSelection(env, input);
      return {
        ...legacy,
        version: FAMILY_STOCK_SELECTION_VERSION,
        data_diagnostics: {
          ...rec((legacy as any).data_diagnostics),
          robust_primary_error: errorText(robustError),
          fallback_path: "LEGACY_V15_PROVIDER_CHAIN",
        },
      };
    } catch (legacyError) {
      throw new Error(`family selector v1.7 failed; robust=${errorText(robustError)}; legacy=${errorText(legacyError)}`);
    }
  }
}
