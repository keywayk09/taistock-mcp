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
  runFamilyStockSelection as runPreviousFamilyStockSelection,
} from "./family-stock-selection-v17";
import {
  inferFamilySelectionIntent,
  scoreFamilyIntentFit,
  type FamilyMode,
  type FamilySelectionIntent,
} from "./family-selection-intent";

export { isFamilyStockSelectionQuery, inferFamilySelectionIntent };
export const FAMILY_STOCK_SELECTION_VERSION = "family-stock-selection/production-v1.8.0";

const TWSE_QUOTES_URL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";
const MOPSFIN_TPEX_COMPANIES_CSV = "https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv";
const TWSE_MIS_URL = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp";
const USER_AGENT = "taistock-mcp-family-selector/1.8 (+https://github.com/keywayk09/taistock-mcp)";
const MIS_BATCH_SIZE = 100;
const MIN_COVERAGE = { TWSE: 400, TPEx: 250 } as const;

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
  return_5d_percent: number | null;
  return_20d_percent: number | null;
  return_60d_percent: number | null;
  annualized_volatility_60d_percent: number | null;
  max_drawdown_percent: number | null;
  atr14: number | null;
  distance_to_sma20_atr: number | null;
  distance_to_prior_20d_high_percent: number | null;
  distance_to_prior_60d_high_percent: number | null;
  range_position_120d_percent: number | null;
  sma20_slope_5d_percent: number | null;
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
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field.trim()); field = ""; }
    else if (ch === "\n") {
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

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function loadTwseOfficial(): Promise<MarketSnapshot> {
  try {
    const response = await fetchWithTimeout(TWSE_QUOTES_URL, {
      redirect: "manual",
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`TWSE OpenAPI HTTP ${response.status}: ${text.slice(0, 180)}`);
    const raw = rowsFromBody(JSON.parse(text));
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
  const rows = [...new Map(universe.map((item) => [item.symbol, item])).values()];
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

function averageClose(bars: DailyBar[]) {
  return bars.length ? bars.reduce((sum, bar) => sum + bar.close, 0) / bars.length : null;
}

function returnPercent(bars: DailyBar[], periods: number) {
  if (bars.length <= periods) return null;
  const latest = bars.at(-1)?.close ?? 0;
  const previous = bars.at(-(periods + 1))?.close ?? 0;
  return latest > 0 && previous > 0 ? round((latest / previous - 1) * 100, 2) : null;
}

function technicalCandidate(quote: SnapshotRow, bars: DailyBar[]): TechnicalCandidate {
  const tech = technicalSummary(bars) as any;
  const latest = bars.at(-1);
  if (!latest) throw new Error(`${quote.symbol} has no latest daily bar`);
  const prior20 = bars.slice(-21, -1);
  const prior60 = bars.slice(-61, -1);
  const range120 = bars.slice(-120);
  const prior20High = prior20.length ? Math.max(...prior20.map((bar) => bar.high)) : null;
  const prior60High = prior60.length ? Math.max(...prior60.map((bar) => bar.high)) : null;
  const rangeHigh = range120.length ? Math.max(...range120.map((bar) => bar.high)) : null;
  const rangeLow = range120.length ? Math.min(...range120.map((bar) => bar.low)) : null;
  const atr = num(tech.atr14);
  const sma20 = num(tech.sma20);
  const sma20Now = averageClose(bars.slice(-20));
  const sma20FiveDaysAgo = averageClose(bars.slice(-25, -5));
  const rangePosition = rangeHigh != null && rangeLow != null && rangeHigh > rangeLow
    ? round(((latest.close - rangeLow) / (rangeHigh - rangeLow)) * 100, 2)
    : null;
  const smaSlope = sma20Now != null && sma20FiveDaysAgo != null && sma20FiveDaysAgo > 0
    ? round((sma20Now / sma20FiveDaysAgo - 1) * 100, 3)
    : null;
  return {
    ...quote,
    close: latest.close,
    price_date: String(latest.date),
    history_provider: "FUGLE_HISTORICAL",
    technical_score: num(tech.score),
    return_5d_percent: returnPercent(bars, 5),
    return_20d_percent: tech.return_20d_percent ?? returnPercent(bars, 20),
    return_60d_percent: tech.return_60d_percent ?? returnPercent(bars, 60),
    annualized_volatility_60d_percent: tech.annualized_volatility_60d_percent ?? null,
    max_drawdown_percent: tech.max_drawdown_percent ?? null,
    atr14: tech.atr14 ?? null,
    distance_to_sma20_atr: atr > 0 ? round((latest.close - sma20) / atr, 3) : null,
    distance_to_prior_20d_high_percent: prior20High ? round((latest.close / prior20High - 1) * 100, 2) : null,
    distance_to_prior_60d_high_percent: prior60High ? round((latest.close / prior60High - 1) * 100, 2) : null,
    range_position_120d_percent: rangePosition,
    sma20_slope_5d_percent: smaSlope,
  };
}

function baseScore(row: TechnicalCandidate, mode: FamilyMode) {
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
  return round(
    technical * cfg.weights.technical +
    liquidity * cfg.weights.liquidity +
    risk * cfg.weights.risk +
    clamp(location) * cfg.weights.location,
    1,
  );
}

function positionGuidance(intent: FamilySelectionIntent, bucket: string, row: TechnicalCandidate) {
  if (bucket === "RED_SKIP") return "不符合這次指定條件，本輪略過";
  if (bucket === "YELLOW_WAIT") return "條件部分符合，但位置或風險仍不夠漂亮，先等";
  switch (intent.objective) {
    case "low_position_turning_up": return "低位階已有轉強跡象，等量價續強或支撐確認；不要因第一根長紅追價";
    case "pullback_entry": return "原趨勢仍在，等回踩止穩或支撐承接確認";
    case "breakout_confirmed": return "等突破確認或突破後第一次健康回踩，不預先追高";
    case "steady_trend": return "以沿均線整理、風險可控的位置分批觀察";
    case "aggressive_momentum": return "動能強但風險高，只觀察確認後的強勢續航，不追失控乖離";
    default: {
      const d20 = row.distance_to_prior_20d_high_percent;
      return d20 != null && d20 >= -5
        ? "優先觀察突破確認或突破後回踩，不追長紅"
        : "列入優先研究，等待整理或靠近支撐";
    }
  }
}

function scoreCandidate(row: TechnicalCandidate, intent: FamilySelectionIntent) {
  const cfg = MODE_CONFIG[intent.family_mode];
  const base = baseScore(row, intent.family_mode);
  const fit = scoreFamilyIntentFit(row, intent);
  const weight = intent.objective === "balanced" ? 0.20 : 0.48;
  const score = round(base * (1 - weight) + fit.fit_score * weight, 1);
  const stricterReturn20 = intent.avoid_chasing ? Math.min(cfg.maxReturn20, 22) : cfg.maxReturn20;
  const stricterExtension = intent.avoid_chasing ? Math.min(cfg.maxExtensionAtr, 2.2) : cfg.maxExtensionAtr;
  const chaseRisk = (row.change_pct ?? 0) > cfg.maxDailyGain
    || (row.return_20d_percent ?? 0) > stricterReturn20
    || (row.distance_to_sma20_atr ?? 0) > stricterExtension;

  const greenThreshold = intent.objective === "balanced" ? 72 : 67;
  const fitThreshold = intent.objective === "balanced" ? 0 : 62;
  const bucket = fit.hard_mismatch
    ? "RED_SKIP"
    : chaseRisk
      ? "YELLOW_WAIT"
      : score >= greenThreshold && fit.fit_score >= fitThreshold
        ? "GREEN_RESEARCH"
        : score >= 58
          ? "YELLOW_WAIT"
          : "RED_SKIP";

  const reasons: string[] = [...fit.reasons];
  const cautions: string[] = [...fit.cautions];
  if (row.technical_score >= 70) reasons.push("日線趨勢與中期動能偏強");
  if (row.value >= cfg.minTradeValue * 3) reasons.push("成交值與流動性充足");
  if ((row.change_pct ?? 0) > cfg.maxDailyGain) cautions.push("最新交易日漲幅偏大，家用模式避免追價");
  if ((row.return_20d_percent ?? 0) > stricterReturn20) cautions.push("近20日漲幅超過這次意圖允許的追價上限");
  if ((row.distance_to_sma20_atr ?? 0) > stricterExtension) cautions.push("價格離20日均線過遠，短線乖離偏高");
  if ((row.annualized_volatility_60d_percent ?? 0) > 65) cautions.push("近60日波動偏高");
  cautions.push("本資料路徑未使用失效的 FinMind Token；月營收與法人資料本輪不加分、不捏造");

  return {
    score,
    bucket,
    intent_fit_score: fit.fit_score,
    intent_hard_mismatch: fit.hard_mismatch,
    position_band: fit.position_band,
    reasons: [...new Set(reasons)].slice(0, 6),
    cautions: [...new Set(cautions)].slice(0, 6),
    position: positionGuidance(intent, bucket, row),
  };
}

async function runSmartFamilySelection(env: Env, input: { query: string; as_of_date?: string }) {
  const query = String(input.query ?? "").trim();
  const requestedDate = input.as_of_date && /^\d{4}-\d{2}-\d{2}$/.test(input.as_of_date) ? input.as_of_date : taipeiDate();
  const intent = inferFamilySelectionIntent(query);
  const cfg = MODE_CONFIG[intent.family_mode];
  const universe = await loadRobustUniverse();
  if (!universe.usable) {
    throw new Error(`MOPSFIN+MIS 完整市場資料不足：TWSE=${universe.TWSE.normalized_count}, TPEx=${universe.TPEx.normalized_count}; TWSE=${universe.TWSE.errors.join(" | ")}; TPEx=${universe.TPEx.errors.join(" | ")}`);
  }

  const liquid = universe.rows
    .filter((row) => row.value >= cfg.minTradeValue)
    .filter((row) => (row.change_pct ?? 0) > -9.5 && (row.change_pct ?? 0) < 9.8)
    .sort((a, b) => b.value - a.value)
    .slice(0, cfg.snapshotShortlist);
  if (!liquid.length) throw new Error("完整市場可用，但流動性初篩為空");

  const historySettled = await concurrencyMap(liquid, 6, async (quote) => {
    const bars = await loadFugleDailyBars(env, quote.symbol, shiftDate(requestedDate, -340), requestedDate);
    if (bars.length < 80) throw new Error(`${quote.symbol} Fugle daily history only ${bars.length} bars`);
    return technicalCandidate(quote, bars);
  });
  const technicalErrors: Array<{ symbol: string; error: string }> = [];
  const allTechnicalRows = historySettled.flatMap((result, index) => {
    if (result.status === "fulfilled") return [result.value];
    technicalErrors.push({ symbol: liquid[index]?.symbol ?? "", error: errorText(result.reason) });
    return [];
  }).sort((a, b) => b.technical_score - a.technical_score);
  if (!allTechnicalRows.length) {
    throw new Error(`Fugle 日K無法形成候選：${technicalErrors.slice(0, 5).map((item) => `${item.symbol}:${item.error}`).join("; ")}`);
  }

  // Entry-location requests must not be forced through the old "top technical score only" funnel.
  // We already paid for history on the whole liquidity shortlist, so score all of it without extra subrequests.
  const broadLocationIntent = intent.objective === "low_position_turning_up" || intent.objective === "pullback_entry";
  const technicalRows = broadLocationIntent ? allTechnicalRows : allTechnicalRows.slice(0, cfg.technicalShortlist);

  const ranked = technicalRows.map((row) => {
    const judged = scoreCandidate(row, intent);
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
      return_5d_percent: row.return_5d_percent,
      return_20d_percent: row.return_20d_percent,
      return_60d_percent: row.return_60d_percent,
      annualized_volatility_60d_percent: row.annualized_volatility_60d_percent,
      max_drawdown_percent: row.max_drawdown_percent,
      atr14: row.atr14,
      distance_to_sma20_atr: row.distance_to_sma20_atr,
      distance_to_prior_20d_high_percent: row.distance_to_prior_20d_high_percent,
      distance_to_prior_60d_high_percent: row.distance_to_prior_60d_high_percent,
      range_position_120d_percent: row.range_position_120d_percent,
      sma20_slope_5d_percent: row.sma20_slope_5d_percent,
      history_provider: row.history_provider,
      snapshot_provider: row.source,
      family_score: judged.score,
      family_bucket: judged.bucket,
      intent_fit_score: judged.intent_fit_score,
      intent_hard_mismatch: judged.intent_hard_mismatch,
      position_band: judged.position_band,
      why_matches_intent: judged.reasons,
      reasons: judged.reasons,
      cautions: judged.cautions,
      position_guidance: judged.position,
      revenue_yoy_percent: null,
      foreign_net_lots: 0,
      trust_net_lots: 0,
      dealer_net_lots: 0,
      revenue_data_partial_error: "FinMind token unavailable; not used in smart selector",
      institutional_data_partial_error: "FinMind token unavailable; not used in smart selector",
    };
  }).sort((a, b) => b.family_score - a.family_score || b.intent_fit_score - a.intent_fit_score);

  const green = ranked.filter((row) => row.family_bucket === "GREEN_RESEARCH");
  const yellow = ranked.filter((row) => row.family_bucket === "YELLOW_WAIT");
  const red = ranked.filter((row) => row.family_bucket === "RED_SKIP");
  const candidates = [...green, ...yellow].slice(0, intent.top_n).map((row, index) => ({ rank: index + 1, ...row }));
  const priceDates = candidates.map((row) => row.price_date).filter(Boolean).sort();

  return {
    service: "Taiwan Stock AI Family Read-Only API",
    route: "family_stock_selection",
    version: FAMILY_STOCK_SELECTION_VERSION,
    read_only: true,
    research_only: true,
    horizon: "1-8 weeks",
    family_mode: intent.family_mode,
    selection_objective: intent.objective,
    interpreted_intent: intent,
    requested_top_n: intent.top_n,
    requested_date: requestedDate,
    latest_candidate_price_date: priceDates.at(-1) ?? null,
    screening_strategy: broadLocationIntent
      ? "FULL_LIQUIDITY_SHORTLIST_INTENT_RANKING"
      : "TECHNICAL_SHORTLIST_INTENT_RANKING",
    universe: {
      source: "TWSE OpenAPI + MOPSFIN TPEx company master + TWSE MIS OTC quotes",
      twse_provider: universe.TWSE.provider,
      tpex_provider: universe.TPEx.provider,
      twse_count: universe.TWSE.normalized_count,
      tpex_count: universe.TPEx.normalized_count,
      full_market_count: universe.rows.length,
      liquid_count: liquid.length,
      technical_history_ok_count: allTechnicalRows.length,
      intent_scanned_count: technicalRows.length,
      deep_scanned_count: ranked.length,
    },
    candidates,
    waitlist: yellow.slice(0, Math.min(5, intent.top_n)),
    skipped_examples: red.slice(0, 5),
    data_diagnostics: {
      fallback_path: "MOPSFIN_COMPANY_MASTER_MIS_OTC",
      twse_errors: universe.TWSE.errors,
      tpex_errors: universe.TPEx.errors,
      technical_errors: technicalErrors.slice(0, 8),
      revenue_partial_failures: ranked.length,
      institutional_partial_failures: ranked.length,
    },
    hard_rules: [
      "先理解使用者這一輪真正要找的型態，再選股；不可把所有追問都重新套用固定 balanced Top 5。",
      "低位階不等於便宜，也不等於跌很多；必須同時檢查區間位置、均線斜率、乖離與轉強證據。",
      "好公司不等於現在就是好買點；家用波段選股以不追高為硬原則。",
      "缺少月營收或法人資料時不加分、不扣分、不捏造。",
      "不提供自動下單、不保證報酬。",
    ],
    response_instructions: [
      "請以繁體中文先說你如何理解這次要求，並直接回答符合這個要求的候選股。",
      "必須遵守 interpreted_intent / selection_objective，不得把『低位階』『回檔』『突破』等追問又改回固定平衡型名單。",
      "若符合特定意圖的 candidates 少於要求數量，明確說明不足，不要拿不符合條件的熱門股硬湊。",
      "每檔用家人看得懂的方式說：為什麼符合這次條件、現在位置、等待什麼確認、最大風險。",
      "GREEN_RESEARCH = 優先研究；YELLOW_WAIT = 等待位置；RED_SKIP 不列為推薦。",
      "價格是 price_date 的收盤參考，不得描述成即時成交價。",
    ],
  };
}

export async function diagnoseFamilySelectionData(_env: Env) {
  const universe = await loadRobustUniverse();
  return {
    selector_version: FAMILY_STOCK_SELECTION_VERSION,
    intent_engine: "family-selection-intent/v1",
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
  const intent = inferFamilySelectionIntent(input.query);
  try {
    return await runSmartFamilySelection(env, input);
  } catch (smartError) {
    // A fixed-ranking fallback is only safe for the truly generic balanced request.
    // For low-position/pullback/breakout/etc. we fail closed so the runtime can use
    // an intent-matched LKG cache instead of silently returning the wrong objective.
    if (intent.objective !== "balanced") {
      throw new Error(`family selector v1.8 intent-specific path failed (${intent.signature}); ${errorText(smartError)}`);
    }
    try {
      const previous = await runPreviousFamilyStockSelection(env, input);
      return {
        ...previous,
        version: FAMILY_STOCK_SELECTION_VERSION,
        selection_objective: intent.objective,
        interpreted_intent: intent,
        data_diagnostics: {
          ...rec((previous as any).data_diagnostics),
          smart_primary_error: errorText(smartError),
          fallback_path: "PREVIOUS_V17_GENERIC_BALANCED_ONLY",
        },
      };
    } catch (previousError) {
      throw new Error(`family selector v1.8 failed; smart=${errorText(smartError)}; previous=${errorText(previousError)}`);
    }
  }
}
