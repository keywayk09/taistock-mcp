import {
  concurrencyMap,
  finmind,
  normalizeDailyBars,
  num,
  rec,
  round,
  taipeiDate,
  technicalSummary,
  type DailyBar,
  type Obj,
} from "../v6/common";

export const FAMILY_STOCK_SELECTION_VERSION = "family-stock-selection/production-v1.1.0";

const TWSE_QUOTES_URL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";
const TPEX_QUOTES_URL = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes";
const USER_AGENT = "taistock-mcp-family-selector/1.1 (+https://github.com/keywayk09/taistock-mcp)";

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
  const sign = text.startsWith("-") ? -1 : 1;
  const parsed = Number(text.replace(/,/g, "").replace(/[+Xx]/g, "").replace(/%$/, ""));
  return Number.isFinite(parsed) ? parsed * (text.startsWith("-") ? 1 : sign) : null;
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

function officialRows(body: unknown): Obj[] {
  if (Array.isArray(body)) return body.map(rec);
  const root = rec(body);
  if (Array.isArray(root.data)) return root.data.map(rec);
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
  return officialRows(body);
}

function normalizeSnapshotRow(market: Market, raw: Obj): SnapshotRow | null {
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
    source: market === "TWSE" ? "TWSE OpenAPI STOCK_DAY_ALL" : "TPEx OpenAPI tpex_mainboard_daily_close_quotes",
  };
}

async function loadOfficialSnapshot() {
  const settled = await Promise.allSettled([
    fetchOfficialRows(TWSE_QUOTES_URL, "TWSE OpenAPI"),
    fetchOfficialRows(TPEX_QUOTES_URL, "TPEx OpenAPI"),
  ]);

  const make = (market: Market, result: PromiseSettledResult<Obj[]>) => {
    if (result.status === "rejected") return {
      market,
      raw_count: 0,
      normalized_count: 0,
      rows: [] as SnapshotRow[],
      sample_keys: [] as string[],
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
    const rows = result.value.map((row) => normalizeSnapshotRow(market, row)).filter((row): row is SnapshotRow => Boolean(row));
    return {
      market,
      raw_count: result.value.length,
      normalized_count: rows.length,
      rows,
      sample_keys: Object.keys(result.value[0] ?? {}).slice(0, 24),
      error: rows.length ? null : "官方端點有回傳，但欄位正規化後為 0 筆",
    };
  };

  const twse = make("TWSE", settled[0]);
  const tpex = make("TPEx", settled[1]);
  return {
    twse,
    tpex,
    rows: [...twse.rows, ...tpex.rows],
    usable: twse.normalized_count >= 400 && tpex.normalized_count >= 250,
  };
}

export async function diagnoseFamilySelectionData() {
  const snapshot = await loadOfficialSnapshot();
  return {
    selector_version: FAMILY_STOCK_SELECTION_VERSION,
    checked_at: new Date().toISOString(),
    endpoints: {
      twse: TWSE_QUOTES_URL,
      tpex: TPEX_QUOTES_URL,
    },
    minimum_coverage: { twse: 400, tpex: 250 },
    twse: {
      raw_count: snapshot.twse.raw_count,
      normalized_count: snapshot.twse.normalized_count,
      sample_keys: snapshot.twse.sample_keys,
      error: snapshot.twse.error,
    },
    tpex: {
      raw_count: snapshot.tpex.raw_count,
      normalized_count: snapshot.tpex.normalized_count,
      sample_keys: snapshot.tpex.sample_keys,
      error: snapshot.tpex.error,
    },
    combined_count: snapshot.rows.length,
    usable: snapshot.usable,
  };
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
  if (!rows.length) return { foreign_net_lots: 0, trust_net_lots: 0, dealer_net_lots: 0, date: null as string | null };
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
    date: latestDate,
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

  const snapshot = await loadOfficialSnapshot();
  if (!snapshot.usable) {
    throw new Error(`官方全市場資料覆蓋不足：TWSE=${snapshot.twse.normalized_count}, TPEx=${snapshot.tpex.normalized_count}；請看 /health/family-selection-data`);
  }

  const liquid = snapshot.rows
    .filter((row) => row.value >= cfg.minTradeValue)
    .filter((row) => (row.change_pct ?? 0) > -9.5 && (row.change_pct ?? 0) < 9.8)
    .sort((a, b) => b.value - a.value)
    .slice(0, cfg.snapshotShortlist);
  if (!liquid.length) throw new Error("全市場有資料，但流動性快篩後為 0 筆");

  const technicalSettled = await concurrencyMap(liquid, 5, async (quote) => {
    const bars = normalizeDailyBars(await finmind(env, "TaiwanStockPrice", {
      data_id: quote.symbol,
      start_date: shiftDate(requestedDate, -340),
      end_date: requestedDate,
    }));
    if (bars.length < 80) throw new Error(`${quote.symbol} 日K樣本不足：${bars.length}`);
    return { ...quote, bars, ...dailyContext(bars) };
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
  const latestPriceDate = priceDates.at(-1) ?? null;
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
    latest_candidate_price_date: latestPriceDate,
    universe: {
      source: "TWSE + TPEx official OpenAPI latest full-market quotes",
      twse_count: snapshot.twse.normalized_count,
      tpex_count: snapshot.tpex.normalized_count,
      official_daily_rows: snapshot.rows.length,
      liquid_count: liquid.length,
      technical_scanned_count: technicalRows.length,
      deep_scanned_count: ranked.length,
    },
    candidates,
    waitlist: yellow.slice(0, Math.min(5, topN)),
    skipped_examples: red.slice(0, 3),
    data_diagnostics: {
      twse_error: snapshot.twse.error,
      tpex_error: snapshot.tpex.error,
      technical_errors: technicalSettled.flatMap((result, index) => result.status === "rejected"
        ? [{ symbol: liquid[index]?.symbol, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }]
        : []).slice(0, 8),
      revenue_partial_failures: ranked.filter((row) => row.revenue_data_partial_error).length,
      institutional_partial_failures: ranked.filter((row) => row.institutional_data_partial_error).length,
    },
    hard_rules: [
      "好公司不等於現在就是好買點。",
      "家用波段選股以不追高為硬原則；YELLOW_WAIT 不是立即買進訊號。",
      "全市場候選只從 TWSE/TPEx 官方 OpenAPI 建立，不用新聞或熱門股名單硬湊。",
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
