import { finmind, rec, round, taipeiDate, type Obj } from "../v6/common";

export const FAMILY_STOCK_SELECTION_VERSION = "family-stock-selection/production-v1.0.0";

type FamilyMode = "stable" | "balanced" | "aggressive";
type Market = "TWSE" | "TPEx";

type DailyRow = {
  market: Market;
  date: string;
  symbol: string;
  name: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  change_pct: number | null;
  volume: number | null;
  value: number | null;
};

type InstitutionalRow = {
  market: Market;
  symbol: string;
  foreign_net_shares: number;
  trust_net_shares: number;
  dealer_net_shares: number;
};

type StockSeries = {
  market: Market;
  symbol: string;
  name: string;
  rows: DailyRow[];
};

const USER_AGENT = "taistock-mcp-family-selector/1.0 (+https://github.com/keywayk09/taistock-mcp)";

const MODE_CONFIG: Record<FamilyMode, {
  minValue: number;
  maxDailyGain: number;
  maxReturn5d: number;
  maxRangePct: number;
}> = {
  stable: { minValue: 100_000_000, maxDailyGain: 5, maxReturn5d: 12, maxRangePct: 6 },
  balanced: { minValue: 50_000_000, maxDailyGain: 7, maxReturn5d: 18, maxRangePct: 8 },
  aggressive: { minValue: 20_000_000, maxDailyGain: 9, maxReturn5d: 25, maxRangePct: 10 },
};

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function compactDate(date: string) {
  return date.replaceAll("-", "");
}

function rocSlashDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return `${year - 1911}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

function numberValue(value: unknown): number | null {
  const normalized = String(value ?? "")
    .replaceAll(",", "")
    .replaceAll("+", "")
    .replaceAll("X", "")
    .replaceAll(" ", "")
    .trim();
  if (!normalized || normalized === "--" || normalized === "-") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function textValue(row: Obj, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function rowsFromTable(body: any): Obj[] {
  if (Array.isArray(body)) return body as Obj[];
  if (Array.isArray(body?.data) && Array.isArray(body?.fields)) {
    return body.data.map((values: unknown[]) => Object.fromEntries(body.fields.map((field: string, index: number) => [String(field).trim(), values[index]])));
  }
  if (Array.isArray(body?.tables)) {
    const table = body.tables.find((item: any) => Array.isArray(item?.data) && Array.isArray(item?.fields) && item.fields.some((field: string) => /證券代號|股票代號|代號/.test(field)));
    if (table) return table.data.map((values: unknown[]) => Object.fromEntries(table.fields.map((field: string, index: number) => [String(field).trim(), values[index]])));
  }
  if (Array.isArray(body?.aaData)) {
    const fields = Array.isArray(body?.fields) ? body.fields : [];
    if (fields.length) return body.aaData.map((values: unknown[]) => Object.fromEntries(fields.map((field: string, index: number) => [String(field).trim(), values[index]])));
    return body.aaData.map((values: unknown[]) => ({
      代號: values[0], 名稱: values[1], 收盤: values[2], 漲跌: values[3], 開盤: values[4], 最高: values[5], 最低: values[6], 成交股數: values[7], 成交金額: values[8], 成交筆數: values[9],
    }));
  }
  return [];
}

async function fetchJson(url: URL) {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url.hostname}${url.pathname} HTTP ${response.status}: ${text.slice(0, 160)}`);
  if (text.trimStart().startsWith("<")) throw new Error(`${url.hostname}${url.pathname} 回傳 HTML`);
  try { return JSON.parse(text); } catch { throw new Error(`${url.hostname}${url.pathname} 回傳無效 JSON`); }
}

function isOrdinaryStock(symbol: string, name: string) {
  if (!/^\d{4}$/.test(symbol.trim())) return false;
  return !/(ETF|ETN|指數|債|正2|反1|槓桿|權證|特別股)/i.test(name);
}

function deriveChangePct(close: number | null, change: number | null) {
  if (close === null || change === null) return null;
  const previous = close - change;
  return previous > 0 ? change / previous * 100 : null;
}

function normalizeDailyRow(market: Market, date: string, raw: Obj): DailyRow | null {
  const symbol = textValue(raw, ["證券代號", "股票代號", "代號"]);
  const name = textValue(raw, ["證券名稱", "股票名稱", "名稱"]);
  if (!isOrdinaryStock(symbol, name)) return null;
  const close = numberValue(raw["收盤價"] ?? raw["收盤"] ?? raw["收市價"]);
  const change = numberValue(raw["漲跌價差"] ?? raw["漲跌"] ?? raw["漲跌價"]);
  const explicitPct = numberValue(raw["漲跌幅"] ?? raw["漲跌幅(%)"] ?? raw["漲跌幅％"]);
  return {
    market,
    date,
    symbol,
    name,
    open: numberValue(raw["開盤價"] ?? raw["開盤"]),
    high: numberValue(raw["最高價"] ?? raw["最高"]),
    low: numberValue(raw["最低價"] ?? raw["最低"]),
    close,
    change_pct: explicitPct ?? deriveChangePct(close, change),
    volume: numberValue(raw["成交股數"] ?? raw["成交量"] ?? raw["成交仟股"]),
    value: numberValue(raw["成交金額"] ?? raw["成交值"]),
  };
}

async function fetchTwseDaily(date: string) {
  const url = new URL("https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX");
  url.searchParams.set("response", "json");
  url.searchParams.set("date", compactDate(date));
  url.searchParams.set("type", "ALLBUT0999");
  const body = await fetchJson(url);
  if (body?.stat !== "OK") return [];
  return rowsFromTable(body).map((row) => normalizeDailyRow("TWSE", date, row)).filter((row): row is DailyRow => Boolean(row?.close));
}

async function fetchTpexDaily(date: string) {
  const url = new URL("https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php");
  url.searchParams.set("l", "zh-tw");
  url.searchParams.set("o", "json");
  url.searchParams.set("d", rocSlashDate(date));
  url.searchParams.set("s", "0,asc");
  const body = await fetchJson(url);
  return rowsFromTable(body).map((row) => normalizeDailyRow("TPEx", date, row)).filter((row): row is DailyRow => Boolean(row?.close));
}

function findKey(row: Obj, terms: string[], excludes: string[] = []) {
  return Object.keys(row).find((key) => terms.every((term) => key.includes(term)) && excludes.every((term) => !key.includes(term)));
}

function numberByTerms(row: Obj, alternatives: string[][], excludes: string[] = []) {
  for (const terms of alternatives) {
    const key = findKey(row, terms, excludes);
    if (key) return numberValue(row[key]) ?? 0;
  }
  return 0;
}

async function fetchInstitutional(date: string): Promise<InstitutionalRow[]> {
  const twseUrl = new URL("https://www.twse.com.tw/rwd/zh/fund/T86");
  twseUrl.searchParams.set("response", "json");
  twseUrl.searchParams.set("date", compactDate(date));
  twseUrl.searchParams.set("selectType", "ALLBUT0999");
  const tpexUrl = new URL("https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php");
  tpexUrl.searchParams.set("l", "zh-tw");
  tpexUrl.searchParams.set("o", "json");
  tpexUrl.searchParams.set("d", rocSlashDate(date));
  tpexUrl.searchParams.set("s", "0,asc");
  const [twseResult, tpexResult] = await Promise.allSettled([fetchJson(twseUrl), fetchJson(tpexUrl)]);
  const output: InstitutionalRow[] = [];
  if (twseResult.status === "fulfilled" && twseResult.value?.stat === "OK") {
    for (const raw of rowsFromTable(twseResult.value)) {
      const symbol = textValue(raw, ["證券代號", "代號"]);
      const name = textValue(raw, ["證券名稱", "名稱"]);
      if (!isOrdinaryStock(symbol, name)) continue;
      output.push({
        market: "TWSE", symbol,
        foreign_net_shares: numberByTerms(raw, [["外資及陸資", "買賣超"], ["外資", "買賣超"]], ["自營商"]),
        trust_net_shares: numberByTerms(raw, [["投信", "買賣超"]]),
        dealer_net_shares: numberByTerms(raw, [["自營商", "買賣超"]], ["自行買賣", "避險"]),
      });
    }
  }
  if (tpexResult.status === "fulfilled") {
    for (const raw of rowsFromTable(tpexResult.value)) {
      const symbol = textValue(raw, ["代號", "證券代號"]);
      const name = textValue(raw, ["名稱", "證券名稱"]);
      if (!isOrdinaryStock(symbol, name)) continue;
      output.push({
        market: "TPEx", symbol,
        foreign_net_shares: numberByTerms(raw, [["外資及陸資", "買賣超"], ["外資", "買賣超"]], ["自營商"]),
        trust_net_shares: numberByTerms(raw, [["投信", "買賣超"]]),
        dealer_net_shares: numberByTerms(raw, [["自營商", "買賣超"]], ["自行買賣", "避險"]),
      });
    }
  }
  return output;
}

async function resolveLatestCompleteDate(requestedDate: string, fallbackDays = 10) {
  const diagnostics: string[] = [];
  for (let offset = 0; offset <= fallbackDays; offset++) {
    const candidate = shiftDate(requestedDate, -offset);
    const settled = await Promise.allSettled([fetchTwseDaily(candidate), fetchTpexDaily(candidate)]);
    const twse = settled[0].status === "fulfilled" ? settled[0].value : [];
    const tpex = settled[1].status === "fulfilled" ? settled[1].value : [];
    if (twse.length > 500 && tpex.length > 300) return { date: candidate, rows: [...twse, ...tpex], diagnostics };
    diagnostics.push(`${candidate}: TWSE=${twse.length}, TPEx=${tpex.length}`);
  }
  throw new Error(`無法取得完整上市櫃日行情；${diagnostics.slice(-5).join("；")}`);
}

async function fetchHistory(endDate: string, sessions = 12) {
  const dates = Array.from({ length: 32 }, (_, index) => shiftDate(endDate, -index));
  const snapshots: Array<{ date: string; rows: DailyRow[] }> = [];
  const diagnostics: string[] = [];
  for (let start = 0; start < dates.length && snapshots.length < sessions; start += 4) {
    const batch = dates.slice(start, start + 4);
    const settled = await Promise.allSettled(batch.map(async (date) => {
      const [twse, tpex] = await Promise.all([fetchTwseDaily(date), fetchTpexDaily(date)]);
      return { date, rows: [...twse, ...tpex], twse: twse.length, tpex: tpex.length };
    }));
    for (const result of settled) {
      if (result.status === "fulfilled" && result.value.twse > 500 && result.value.tpex > 300) snapshots.push({ date: result.value.date, rows: result.value.rows });
      else if (result.status === "rejected") diagnostics.push(String(result.reason));
    }
  }
  snapshots.sort((a, b) => b.date.localeCompare(a.date));
  return { snapshots: snapshots.slice(0, sessions), diagnostics };
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function percentChange(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return null;
  return (current / previous - 1) * 100;
}

function buildSeries(snapshots: Array<{ date: string; rows: DailyRow[] }>) {
  const map = new Map<string, StockSeries>();
  for (const snapshot of snapshots) {
    for (const row of snapshot.rows) {
      const key = `${row.market}:${row.symbol}`;
      const existing = map.get(key) ?? { market: row.market, symbol: row.symbol, name: row.name, rows: [] };
      existing.rows.push(row);
      map.set(key, existing);
    }
  }
  for (const series of map.values()) series.rows.sort((a, b) => b.date.localeCompare(a.date));
  return [...map.values()];
}

function baseMetrics(series: StockSeries, institutional?: InstitutionalRow) {
  const rows = series.rows;
  const current = rows[0];
  const closes = rows.map((row) => row.close).filter((value): value is number => value !== null);
  const volumes = rows.map((row) => row.volume).filter((value): value is number => value !== null);
  const priorHighs = rows.slice(1, 11).map((row) => row.high).filter((value): value is number => value !== null);
  const high10 = priorHighs.length ? Math.max(...priorHighs) : null;
  const avgVolume10 = mean(volumes.slice(1, 11));
  const volumeRatio = current.volume !== null && avgVolume10 ? current.volume / avgVolume10 : null;
  const return5 = closes.length >= 6 ? percentChange(closes[0], closes[5]) : null;
  const return10 = closes.length >= 11 ? percentChange(closes[0], closes[10]) : null;
  const distanceHigh = current.close !== null && high10 ? (current.close / high10 - 1) * 100 : null;
  const closePosition = current.high !== null && current.low !== null && current.close !== null && current.high > current.low
    ? (current.close - current.low) / (current.high - current.low) : null;
  const intradayRange = current.high !== null && current.low !== null && current.close !== null && current.close > 0
    ? (current.high - current.low) / current.close * 100 : null;
  return {
    market: series.market,
    symbol: series.symbol,
    name: series.name,
    date: current.date,
    close: current.close,
    change_pct: current.change_pct,
    value: current.value,
    volume_ratio_10d: volumeRatio,
    return_5d_pct: return5,
    return_10d_pct: return10,
    distance_to_10d_high_pct: distanceHigh,
    close_position: closePosition,
    intraday_range_pct: intradayRange,
    foreign_net_lots: Math.round((institutional?.foreign_net_shares ?? 0) / 1000),
    trust_net_lots: Math.round((institutional?.trust_net_shares ?? 0) / 1000),
    dealer_net_lots: Math.round((institutional?.dealer_net_shares ?? 0) / 1000),
  };
}

function latestRevenueYoy(rows: any[]) {
  const normalized = rows.map((row) => ({
    year: Number(row.revenue_year ?? 0),
    month: Number(row.revenue_month ?? 0),
    revenue: Number(row.revenue ?? 0),
    officialYoy: Number(row.yoy_percent_official),
  })).filter((row) => row.year && row.month && row.revenue > 0).sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month));
  const latest = normalized.at(-1);
  if (!latest) return null;
  if (Number.isFinite(latest.officialYoy)) return round(latest.officialYoy, 2);
  const prior = normalized.find((row) => row.year === latest.year - 1 && row.month === latest.month);
  return prior?.revenue ? round((latest.revenue / prior.revenue - 1) * 100, 2) : null;
}

function classifyMode(query: string): FamilyMode {
  if (/穩健|保守|比較穩|低風險|穩一點/.test(query)) return "stable";
  if (/積極|進攻|強勢|突破型|可以冒險/.test(query)) return "aggressive";
  return "balanced";
}

function requestedTopN(query: string) {
  const match = query.match(/(?:top\s*|前\s*)(\d{1,2})/i);
  if (!match) return 5;
  return Math.max(1, Math.min(10, Number(match[1]) || 5));
}

export function isFamilyStockSelectionQuery(query: string) {
  if (/(?<!\d)\d{4,6}(?!\d)/.test(query)) return false;
  return /選股|選股票|找股票|波段(?:股|選股|候選)?|推薦(?:幾檔|股票)|有哪些股票|什麼股票可以看|值得注意的股票|top\s*\d+/i.test(query);
}

function scoreCandidate(row: ReturnType<typeof baseMetrics> & { revenue_yoy_percent: number | null }, mode: FamilyMode) {
  const cfg = MODE_CONFIG[mode];
  let score = 50;
  const reasons: string[] = [];
  const cautions: string[] = [];

  if ((row.return_5d_pct ?? -99) > 0 && (row.return_5d_pct ?? 99) <= cfg.maxReturn5d) { score += 9; reasons.push("近5日趨勢向上且未過熱"); }
  if ((row.return_10d_pct ?? -99) > 0) { score += 7; reasons.push("10日趨勢維持正向"); }
  if ((row.volume_ratio_10d ?? 0) >= 1.5) { score += 10; reasons.push("成交量明顯高於近10日均量"); }
  else if ((row.volume_ratio_10d ?? 0) >= 1.15) { score += 5; reasons.push("量能溫和增加"); }
  if ((row.distance_to_10d_high_pct ?? -99) >= -3 && (row.distance_to_10d_high_pct ?? 99) <= 1.5) { score += 10; reasons.push("接近10日關鍵高點，適合觀察突破或回踩"); }
  if ((row.close_position ?? 0) >= 0.7) { score += 5; reasons.push("收盤位置偏強"); }
  if (row.foreign_net_lots > 0) { score += 4; reasons.push("外資當日買超"); }
  if (row.trust_net_lots > 0) { score += 7; reasons.push("投信當日買超"); }
  if (row.revenue_yoy_percent != null && row.revenue_yoy_percent >= 10) { score += 6; reasons.push(`最新月營收年增 ${row.revenue_yoy_percent}%`); }
  else if (row.revenue_yoy_percent != null && row.revenue_yoy_percent < 0) { score -= 5; cautions.push(`最新月營收年減 ${Math.abs(row.revenue_yoy_percent)}%`); }

  const chaseRisk =
    (row.change_pct ?? 0) > cfg.maxDailyGain ||
    (row.return_5d_pct ?? 0) > cfg.maxReturn5d ||
    (row.intraday_range_pct ?? 0) > cfg.maxRangePct;
  if ((row.change_pct ?? 0) > cfg.maxDailyGain) cautions.push("當日漲幅偏大，不追價");
  if ((row.return_5d_pct ?? 0) > cfg.maxReturn5d) cautions.push("近5日漲幅偏大，等待整理或回測");
  if ((row.intraday_range_pct ?? 0) > cfg.maxRangePct) cautions.push("當日振幅偏高");
  if (row.foreign_net_lots < 0 && row.trust_net_lots < 0) { score -= 8; cautions.push("外資與投信同步賣超"); }
  if ((row.volume_ratio_10d ?? 0) < 0.7) { score -= 5; cautions.push("量能偏弱"); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const bucket = chaseRisk ? "YELLOW_WAIT" : score >= 72 ? "GREEN_RESEARCH" : score >= 60 ? "YELLOW_WAIT" : "RED_SKIP";
  const position = bucket === "GREEN_RESEARCH"
    ? ((row.distance_to_10d_high_pct ?? -99) >= -3 ? "等待突破確認或突破後回踩，不追長紅" : "列入優先研究，等待靠近支撐或整理完成")
    : bucket === "YELLOW_WAIT" ? "目前先等位置，不追價" : "本輪略過";

  return { score, bucket, reasons: reasons.slice(0, 5), cautions: cautions.slice(0, 5), position };
}

async function lookupIndustries(env: Env, symbols: string[]) {
  const map = new Map<string, string>();
  if (!env.DB || !symbols.length) return map;
  try {
    const placeholders = symbols.map(() => "?").join(",");
    const result = await env.DB.prepare(`SELECT ticker, official_industry FROM global_companies WHERE country = 'TW' AND ticker IN (${placeholders}) AND status = 'active'`).bind(...symbols).all<{ ticker: string; official_industry: string }>();
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
  const resolved = await resolveLatestCompleteDate(requestedDate, 10);
  const historyResult = await fetchHistory(resolved.date, 12);
  if (historyResult.snapshots.length < 6) throw new Error(`完整歷史交易日不足：${historyResult.snapshots.length}`);

  const institutionalRows = await fetchInstitutional(resolved.date).catch(() => [] as InstitutionalRow[]);
  const institutionalMap = new Map(institutionalRows.map((row) => [`${row.market}:${row.symbol}`, row]));
  const series = buildSeries(historyResult.snapshots).filter((item) => item.rows.length >= 6);
  const raw = series
    .map((item) => baseMetrics(item, institutionalMap.get(`${item.market}:${item.symbol}`)))
    .filter((row) => (row.value ?? 0) >= cfg.minValue)
    .filter((row) => (row.change_pct ?? 0) > -9.5)
    .sort((a, b) => {
      const aBase = (a.return_5d_pct ?? -99) + (a.volume_ratio_10d ?? 0) * 4 + (a.trust_net_lots > 0 ? 5 : 0) + (a.foreign_net_lots > 0 ? 3 : 0);
      const bBase = (b.return_5d_pct ?? -99) + (b.volume_ratio_10d ?? 0) * 4 + (b.trust_net_lots > 0 ? 5 : 0) + (b.foreign_net_lots > 0 ? 3 : 0);
      return bBase - aBase;
    })
    .slice(0, Math.max(24, topN * 5));

  const enriched = await Promise.all(raw.map(async (row) => {
    let revenueYoy: number | null = null;
    let revenueError: string | null = null;
    try {
      const rows = await finmind(env, "TaiwanStockMonthRevenue", { data_id: row.symbol, start_date: shiftDate(resolved.date, -420), end_date: resolved.date });
      revenueYoy = latestRevenueYoy(rows);
    } catch (error) {
      revenueError = error instanceof Error ? error.message : String(error);
    }
    return { ...row, revenue_yoy_percent: revenueYoy, revenue_error: revenueError };
  }));

  const industries = await lookupIndustries(env, enriched.map((row) => row.symbol));
  const ranked = enriched.map((row) => {
    const judged = scoreCandidate(row, mode);
    return {
      symbol: row.symbol,
      name: row.name,
      market: row.market,
      industry: industries.get(row.symbol) ?? "",
      family_score: judged.score,
      family_bucket: judged.bucket,
      close_reference: row.close,
      price_date: row.date,
      change_pct: row.change_pct == null ? null : round(row.change_pct, 2),
      return_5d_pct: row.return_5d_pct == null ? null : round(row.return_5d_pct, 2),
      return_10d_pct: row.return_10d_pct == null ? null : round(row.return_10d_pct, 2),
      volume_ratio_10d: row.volume_ratio_10d == null ? null : round(row.volume_ratio_10d, 2),
      distance_to_10d_high_pct: row.distance_to_10d_high_pct == null ? null : round(row.distance_to_10d_high_pct, 2),
      foreign_net_lots: row.foreign_net_lots,
      trust_net_lots: row.trust_net_lots,
      revenue_yoy_percent: row.revenue_yoy_percent,
      reasons: judged.reasons,
      cautions: judged.cautions,
      position_guidance: judged.position,
      revenue_data_partial_error: row.revenue_error,
    };
  }).sort((a, b) => b.family_score - a.family_score);

  const green = ranked.filter((row) => row.family_bucket === "GREEN_RESEARCH");
  const yellow = ranked.filter((row) => row.family_bucket === "YELLOW_WAIT");
  const candidates = [...green, ...yellow].slice(0, topN).map((row, index) => ({ rank: index + 1, ...row }));

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
    resolved_complete_market_date: resolved.date,
    market_session_note: requestedDate !== resolved.date ? `使用最近完整交易日 ${resolved.date}，避免盤中/休市日資料不完整。` : "使用完整收盤市場資料。",
    universe: {
      official_daily_rows: resolved.rows.length,
      history_sessions: historyResult.snapshots.length,
      liquid_shortlist_count: raw.length,
      institutional_rows: institutionalRows.length,
      final_ranked_count: ranked.length,
    },
    candidates,
    waitlist: yellow.slice(0, Math.min(5, topN)),
    data_diagnostics: {
      market_resolution: resolved.diagnostics.slice(-5),
      history_errors: historyResult.diagnostics.slice(-5),
      revenue_partial_failures: enriched.filter((row) => row.revenue_error).length,
    },
    hard_rules: [
      "好公司不等於現在就是好買點。",
      "家用波段選股以不追高為硬原則；YELLOW_WAIT 不是立即買進訊號。",
      "候選來自TWSE/TPEx官方日行情與法人資料；月營收資料失敗時仍保留候選但明確標示，不用新聞硬湊股票。",
      "不提供自動下單、不保證報酬、不捏造即時價格或目標價。",
    ],
    response_instructions: [
      "請以繁體中文先給結論。",
      "若 candidates 少於要求數量，不要硬湊滿。",
      "每檔只需用家人看得懂的方式說：為什麼入選、現在應觀察突破還是回踩、主要風險。",
      "GREEN_RESEARCH = 優先研究；YELLOW_WAIT = 等待位置；RED_SKIP 不列為推薦。",
      "價格是 resolved_complete_market_date 的收盤參考，不得描述成即時成交價。",
    ],
  };
}
