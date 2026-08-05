import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fail, ok, taipeiDate, type Obj } from "../v6/common";

const USER_AGENT = "taistock-mcp/8.6 (+https://github.com/keywayk09/taistock-mcp)";
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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
  change: number | null;
  change_pct: number | null;
  volume_shares: number | null;
  value: number | null;
  trades: number | null;
};

type InstitutionalRow = {
  market: Market;
  symbol: string;
  foreign_net_shares: number;
  trust_net_shares: number;
  dealer_net_shares: number;
};

type StockSeries = {
  symbol: string;
  name: string;
  market: Market;
  rows: DailyRow[];
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
    change,
    change_pct: explicitPct ?? deriveChangePct(close, change),
    volume_shares: numberValue(raw["成交股數"] ?? raw["成交量"] ?? raw["成交仟股"]),
    value: numberValue(raw["成交金額"] ?? raw["成交值"]),
    trades: numberValue(raw["成交筆數"] ?? raw["成交筆數(筆)"]),
  };
}

async function fetchTwseDaily(date: string): Promise<DailyRow[]> {
  const url = new URL("https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX");
  url.searchParams.set("response", "json");
  url.searchParams.set("date", compactDate(date));
  url.searchParams.set("type", "ALLBUT0999");
  const body = await fetchJson(url);
  if (body?.stat !== "OK") return [];
  return rowsFromTable(body).map((row) => normalizeDailyRow("TWSE", date, row)).filter((row): row is DailyRow => Boolean(row?.close));
}

async function fetchTpexDaily(date: string): Promise<DailyRow[]> {
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
      output.push({ market: "TWSE", symbol,
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
      output.push({ market: "TPEx", symbol,
        foreign_net_shares: numberByTerms(raw, [["外資及陸資", "買賣超"], ["外資", "買賣超"]], ["自營商"]),
        trust_net_shares: numberByTerms(raw, [["投信", "買賣超"]]),
        dealer_net_shares: numberByTerms(raw, [["自營商", "買賣超"]], ["自行買賣", "避險"]),
      });
    }
  }
  return output;
}

async function resolveDailyDate(requestedDate: string, fallbackDays: number) {
  const errors: string[] = [];
  for (let offset = 0; offset <= fallbackDays; offset++) {
    const candidate = shiftDate(requestedDate, -offset);
    const settled = await Promise.allSettled([fetchTwseDaily(candidate), fetchTpexDaily(candidate)]);
    const twse = settled[0].status === "fulfilled" ? settled[0].value : [];
    const tpex = settled[1].status === "fulfilled" ? settled[1].value : [];
    if (settled[0].status === "rejected") errors.push(`${candidate} TWSE: ${String(settled[0].reason)}`);
    if (settled[1].status === "rejected") errors.push(`${candidate} TPEx: ${String(settled[1].reason)}`);
    if (twse.length > 500 && tpex.length > 300) return { resolvedDate: candidate, rows: [...twse, ...tpex], errors };
    errors.push(`${candidate}: TWSE=${twse.length}，TPEx=${tpex.length}`);
  }
  throw new Error(`未取得雙市場完整日行情。${errors.slice(-6).join("；")}`);
}

async function fetchHistory(endDate: string, sessions: number) {
  const calendarDays = Math.min(45, Math.max(sessions * 2 + 4, 18));
  const dates = Array.from({ length: calendarDays }, (_, index) => shiftDate(endDate, -index));
  const snapshots: Array<{ date: string; rows: DailyRow[] }> = [];
  const batchSize = 5;
  for (let start = 0; start < dates.length && snapshots.length < sessions; start += batchSize) {
    const batch = dates.slice(start, start + batchSize);
    const results = await Promise.allSettled(batch.map(async (date) => {
      const [twse, tpex] = await Promise.all([fetchTwseDaily(date), fetchTpexDaily(date)]);
      return { date, rows: [...twse, ...tpex] };
    }));
    for (const result of results) {
      if (result.status === "fulfilled" && result.value.rows.length > 800) snapshots.push(result.value);
    }
  }
  snapshots.sort((a, b) => b.date.localeCompare(a.date));
  return snapshots.slice(0, sessions);
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function percentChange(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return null;
  return (current / previous - 1) * 100;
}

function round(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function buildSeries(snapshots: Array<{ date: string; rows: DailyRow[] }>) {
  const map = new Map<string, StockSeries>();
  for (const snapshot of snapshots) {
    for (const row of snapshot.rows) {
      const key = `${row.market}:${row.symbol}`;
      const existing = map.get(key) ?? { symbol: row.symbol, name: row.name, market: row.market, rows: [] };
      existing.rows.push(row);
      map.set(key, existing);
    }
  }
  for (const series of map.values()) series.rows.sort((a, b) => b.date.localeCompare(a.date));
  return [...map.values()];
}

function stockMetrics(series: StockSeries, institutional?: InstitutionalRow) {
  const rows = series.rows;
  const current = rows[0];
  const closes = rows.map((row) => row.close).filter((value): value is number => value !== null);
  const volumes = rows.map((row) => row.volume_shares).filter((value): value is number => value !== null);
  const priorHighs = rows.slice(1).map((row) => row.high).filter((value): value is number => value !== null);
  const high10 = priorHighs.length ? Math.max(...priorHighs.slice(0, 10)) : null;
  const avgVolume = mean(volumes.slice(1, 11));
  const volumeRatio = current.volume_shares !== null && avgVolume ? current.volume_shares / avgVolume : null;
  const return5 = closes.length >= 6 ? percentChange(closes[0], closes[5]) : null;
  const return10 = closes.length >= 11 ? percentChange(closes[0], closes[10]) : null;
  const breakoutPct = current.close !== null && high10 ? (current.close / high10 - 1) * 100 : null;
  const closePosition = current.high !== null && current.low !== null && current.close !== null && current.high > current.low
    ? (current.close - current.low) / (current.high - current.low) : null;
  const intradayRange = current.high !== null && current.low !== null && current.close !== null && current.close > 0
    ? (current.high - current.low) / current.close * 100 : null;
  const openPattern = current.open !== null && current.close !== null
    ? current.close > current.open * 1.01 ? "開低走高／收強" : current.close < current.open * 0.99 ? "開高走低／收弱" : "開收接近"
    : "資料不足";

  let score = 50;
  const reasons: string[] = [];
  const risks: string[] = [];
  if ((current.change_pct ?? 0) > 0) { score += 5; reasons.push("當日收紅"); } else { score -= 4; }
  if ((volumeRatio ?? 0) >= 1.5) { score += 12; reasons.push("量能明顯擴張"); }
  else if ((volumeRatio ?? 0) >= 1.15) { score += 6; reasons.push("量能溫和增加"); }
  else if ((volumeRatio ?? 9) < 0.75) risks.push("量能不足");
  if ((breakoutPct ?? -99) >= 0) { score += 14; reasons.push("突破近10日高點"); }
  else if ((breakoutPct ?? -99) >= -3) { score += 7; reasons.push("接近近10日壓力"); }
  if ((return5 ?? 0) > 0 && (return5 ?? 0) <= 12) { score += 8; reasons.push("近5日趨勢向上且未過熱"); }
  if ((return5 ?? 0) > 18) { score -= 12; risks.push("短線漲幅偏大"); }
  if ((return10 ?? 0) < -15) { score -= 8; risks.push("中短期趨勢仍弱"); }
  if ((closePosition ?? 0) >= 0.75) { score += 6; reasons.push("收盤靠近當日高點"); }
  if ((closePosition ?? 1) <= 0.25) { score -= 7; risks.push("收盤靠近當日低點"); }
  if ((intradayRange ?? 0) >= 8) { score -= 4; risks.push("振幅偏大"); }
  if ((institutional?.foreign_net_shares ?? 0) > 0) { score += 5; reasons.push("外資買超"); }
  if ((institutional?.trust_net_shares ?? 0) > 0) { score += 8; reasons.push("投信買超"); }
  if ((institutional?.foreign_net_shares ?? 0) < 0 && (institutional?.trust_net_shares ?? 0) < 0) { score -= 10; risks.push("外資與投信同步賣超"); }
  score = Math.max(0, Math.min(100, score));

  const stage = score >= 78 ? "波段啟動／強勢延續候選" : score >= 65 ? "轉強觀察" : score >= 52 ? "中性整理" : score >= 38 ? "偏弱" : "高風險";
  return {
    market: series.market,
    symbol: series.symbol,
    name: series.name,
    date: current.date,
    close: current.close,
    change_pct: round(current.change_pct),
    volume_shares: current.volume_shares,
    value: current.value,
    volume_ratio_10d: round(volumeRatio),
    return_5d_pct: round(return5),
    return_10d_pct: round(return10),
    distance_to_10d_high_pct: round(breakoutPct),
    close_position: round(closePosition),
    intraday_range_pct: round(intradayRange),
    open_pattern: openPattern,
    foreign_net_lots: Math.round((institutional?.foreign_net_shares ?? 0) / 1000),
    trust_net_lots: Math.round((institutional?.trust_net_shares ?? 0) / 1000),
    dealer_net_lots: Math.round((institutional?.dealer_net_shares ?? 0) / 1000),
    swing_score: score,
    stage,
    reasons,
    risks,
  };
}

function marketSentiment(metrics: ReturnType<typeof stockMetrics>[]) {
  const valid = metrics.filter((row) => row.change_pct !== null);
  const advancing = valid.filter((row) => (row.change_pct ?? 0) > 0).length;
  const declining = valid.filter((row) => (row.change_pct ?? 0) < 0).length;
  const limitUp = valid.filter((row) => (row.change_pct ?? 0) >= 9.5).length;
  const limitDown = valid.filter((row) => (row.change_pct ?? 0) <= -9.5).length;
  const strongClose = valid.filter((row) => (row.close_position ?? 0) >= 0.75).length;
  const weakClose = valid.filter((row) => (row.close_position ?? 1) <= 0.25).length;
  const volumeExpansionUp = valid.filter((row) => (row.volume_ratio_10d ?? 0) >= 1.3 && (row.change_pct ?? 0) > 0).length;
  const volumeExpansionDown = valid.filter((row) => (row.volume_ratio_10d ?? 0) >= 1.3 && (row.change_pct ?? 0) < 0).length;
  const breadth = valid.length ? (advancing - declining) / valid.length : 0;
  let score = 50 + breadth * 35;
  score += Math.min(12, (limitUp - limitDown) * 0.8);
  score += Math.max(-10, Math.min(10, (strongClose - weakClose) / Math.max(1, valid.length) * 40));
  score += Math.max(-8, Math.min(8, (volumeExpansionUp - volumeExpansionDown) / Math.max(1, valid.length) * 35));
  score = Math.round(Math.max(0, Math.min(100, score)));
  const regime = score >= 75 ? "強勢擴散" : score >= 62 ? "偏多輪動" : score >= 45 ? "中性震盪" : score >= 30 ? "籌碼轉弱" : "恐慌／冰點區";
  return {
    score,
    regime,
    total: valid.length,
    advancing,
    declining,
    unchanged: valid.length - advancing - declining,
    advance_decline_ratio: declining ? round(advancing / declining) : null,
    approximate_limit_up: limitUp,
    approximate_limit_down: limitDown,
    strong_close_count: strongClose,
    weak_close_count: weakClose,
    volume_expansion_up_count: volumeExpansionUp,
    volume_expansion_down_count: volumeExpansionDown,
    interpretation: score >= 62
      ? "多數個股與量價結構偏正向，適合從轉強與回踩候選中挑選，不代表可以追高。"
      : score >= 45
        ? "市場缺乏一致方向，宜降低部位並重視個股相對強弱。"
        : "市場廣度偏弱，先以風險排除與等待止跌確認為主。",
  };
}

export function registerSwingMarketRadarTools(server: McpServer) {
  server.registerTool("scan_swing_candidates", {
    description: "使用TWSE、TPEx官方日行情與同日法人資料，從全市場篩選波段啟動、轉強、量價共振或風險候選。適合找股票，不侷限每日報告。盤中大單、分時買力等無官方逐筆來源的項目不會假裝提供。",
    inputSchema: {
      date: dateSchema.optional().default(taipeiDate()),
      lookback_sessions: z.number().int().min(6).max(20).optional().default(12),
      fallback_days: z.number().int().min(0).max(10).optional().default(5),
      top_n: z.number().int().min(5).max(50).optional().default(20),
      min_value: z.number().min(0).optional().default(50_000_000),
      mode: z.enum(["swing", "breakout", "early_turn", "risk"]).optional().default("swing"),
    },
  }, async ({ date, lookback_sessions, fallback_days, top_n, min_value, mode }) => {
    try {
      const resolved = await resolveDailyDate(date, fallback_days);
      const history = await fetchHistory(resolved.resolvedDate, lookback_sessions);
      if (history.length < 6) throw new Error(`僅取得${history.length}個交易日，至少需要6日`);
      const institutions = await fetchInstitutional(resolved.resolvedDate);
      const institutionalMap = new Map(institutions.map((row) => [`${row.market}:${row.symbol}`, row]));
      const all = buildSeries(history).filter((series) => series.rows.length >= 6).map((series) => stockMetrics(series, institutionalMap.get(`${series.market}:${series.symbol}`)));
      const liquid = all.filter((row) => (row.value ?? 0) >= min_value);
      const sorted = [...liquid].sort((a, b) => {
        if (mode === "risk") return a.swing_score - b.swing_score;
        if (mode === "breakout") return (b.distance_to_10d_high_pct ?? -999) - (a.distance_to_10d_high_pct ?? -999) || b.swing_score - a.swing_score;
        if (mode === "early_turn") {
          const aEarly = a.swing_score - Math.max(0, (a.return_5d_pct ?? 0) - 8) * 2;
          const bEarly = b.swing_score - Math.max(0, (b.return_5d_pct ?? 0) - 8) * 2;
          return bEarly - aEarly;
        }
        return b.swing_score - a.swing_score;
      });
      return ok({
        service: "swing_market_radar",
        read_only: true,
        requested_date: date,
        resolved_date: resolved.resolvedDate,
        history_dates: history.map((item) => item.date),
        mode,
        filters: { min_value, lookback_sessions, ordinary_stocks_only: true },
        candidates: sorted.slice(0, top_n),
        market_sentiment: marketSentiment(all),
        supported_daily_rankings: ["漲幅", "跌幅", "成交量", "成交值", "量增", "高價", "低價", "開盤強弱", "開高走低", "開低走高", "大幅震盪", "法人買賣超", "波段啟動", "風險排行"],
        unavailable_without_realtime_ticks: ["瞬間拉抬", "瞬間殺盤", "即將漲停", "即將跌停", "分時買力", "分時賣力", "連續買單", "連續賣單", "大單流入", "大單流出", "單量排行", "預估量"],
        note: "分數是官方日資料模型，用於縮小觀察名單；正式進場仍需確認最新價格、支撐壓力與風險報酬。",
      });
    } catch (error) { return fail(error); }
  });

  server.registerTool("analyze_market_sentiment", {
    description: "以TWSE與TPEx全市場官方日行情計算漲跌廣度、強弱收盤、量增上漲／下跌與近似漲跌停家數，判斷市場屬於強勢擴散、偏多輪動、中性震盪、籌碼轉弱或恐慌區。",
    inputSchema: {
      date: dateSchema.optional().default(taipeiDate()),
      lookback_sessions: z.number().int().min(6).max(15).optional().default(10),
      fallback_days: z.number().int().min(0).max(10).optional().default(5),
    },
  }, async ({ date, lookback_sessions, fallback_days }) => {
    try {
      const resolved = await resolveDailyDate(date, fallback_days);
      const history = await fetchHistory(resolved.resolvedDate, lookback_sessions);
      const institutions = await fetchInstitutional(resolved.resolvedDate);
      const institutionalMap = new Map(institutions.map((row) => [`${row.market}:${row.symbol}`, row]));
      const metrics = buildSeries(history).filter((series) => series.rows.length >= 6).map((series) => stockMetrics(series, institutionalMap.get(`${series.market}:${series.symbol}`)));
      return ok({
        service: "market_sentiment",
        requested_date: date,
        resolved_date: resolved.resolvedDate,
        sentiment: marketSentiment(metrics),
        strongest: [...metrics].sort((a, b) => b.swing_score - a.swing_score).slice(0, 10),
        weakest: [...metrics].sort((a, b) => a.swing_score - b.swing_score).slice(0, 10),
        limitations: "本工具是日資料市場情緒；盤中委託、大單與分時買賣力需另接即時逐筆行情。",
      });
    } catch (error) { return fail(error); }
  });
}
