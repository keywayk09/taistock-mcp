import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

declare global {
  interface Env {
    FUGLE_API_KEY: string;
    FINMIND_TOKEN: string;
  }
}

type Obj = Record<string, any>;
type Market = "listed" | "otc";
type FugleMarket = "TSE" | "OTC";

const FUGLE = "https://api.fugle.tw/marketdata/v1.0/stock";
const FINMIND = "https://api.finmindtrade.com/api/v4/data";
const BROKER = "https://api.finmindtrade.com/api/v4/taiwan_stock_trading_daily_report";
const TWSE = "https://openapi.twse.com.tw/v1";
const TPEX = "https://www.tpex.org.tw/openapi/v1";
const TWSE_EVENTS = `${TWSE}/opendata/t187ap04_L`;
const TPEX_EVENTS = `${TPEX}/mopsfin_t187ap04_O`;
const TDCC = "https://openapi.tdcc.com.tw/v1/opendata";
const TAIFEX = "https://openapi.taifex.com.tw";

const stockSymbol = z.string().trim().min(1).max(20).regex(/^[0-9A-Za-z._-]+$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const marketChoice = z.enum(["auto", "listed", "otc"]);

const ok = (x: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(x, null, 2) }],
});
const fail = (e: unknown) => ({
  isError: true,
  content: [{
    type: "text" as const,
    text: `查詢失敗：${e instanceof Error ? e.message : String(e)}`,
  }],
});
const rec = (x: unknown): Obj => x && typeof x === "object" ? x as Obj : {};
const num = (x: unknown) => Number.isFinite(Number(x)) ? Number(x) : 0;
const arr = (x: unknown): any[] => Array.isArray(x) ? x : Array.isArray(rec(x).data) ? rec(x).data : [];
const recent = (x: any[], n: number) => x.length <= n ? x : x.slice(-n);
const pct = (value: number, base: number) => base === 0 ? null : Number((((value - base) / Math.abs(base)) * 100).toFixed(2));
const round = (x: number, digits = 2) => Number(x.toFixed(digits));

function twDate(daysAgo = 0) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() - daysAgo * 86_400_000));
}

async function json(url: string | URL, init: RequestInit, source: string): Promise<any> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: any = text;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const o = rec(body);
    throw new Error(`${source} HTTP ${response.status}: ${String(o.message ?? o.msg ?? o.error ?? text.slice(0, 300))}`);
  }
  return body;
}

async function fugle(env: Env, path: string, query: Obj = {}) {
  if (!env.FUGLE_API_KEY) throw new Error("FUGLE_API_KEY 尚未設定");
  const url = new URL(FUGLE + path);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });
  return json(url, {
    headers: { Accept: "application/json", "X-API-KEY": env.FUGLE_API_KEY },
  }, "富果");
}

async function finmind(env: Env, dataset: string, params: Obj) {
  if (!env.FINMIND_TOKEN) throw new Error("FINMIND_TOKEN 尚未設定");
  const url = new URL(FINMIND);
  url.searchParams.set("dataset", dataset);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  });
  const body = await json(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${env.FINMIND_TOKEN}` },
  }, "FinMind");
  if (!Array.isArray(body.data)) {
    throw new Error(`FinMind 回傳缺少 data：${String(body.msg ?? body.message ?? "unknown")}`);
  }
  return body;
}

async function broker(env: Env, stock: string, day: string) {
  if (!env.FINMIND_TOKEN) throw new Error("FINMIND_TOKEN 尚未設定");
  const url = new URL(BROKER);
  url.searchParams.set("data_id", stock);
  url.searchParams.set("date", day);
  const body = await json(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${env.FINMIND_TOKEN}` },
  }, "FinMind 分點");
  if (!Array.isArray(body.data)) throw new Error("FinMind 分點回傳缺少 data");
  return body.data as any[];
}

const pick = (o: Obj, keys: string[]) => {
  for (const key of keys) {
    if (o[key] != null && String(o[key]).trim()) return String(o[key]).trim();
  }
  return "";
};

function normalizeEvent(x: unknown, market: Market) {
  const o = rec(x);
  return {
    market,
    company_code: pick(o, ["公司代號", "公司代碼", "SecuritiesCompanyCode", "stock_id"]),
    company_name: pick(o, ["公司名稱", "CompanyName", "stock_name"]),
    report_date: pick(o, ["出表日期", "資料日期", "date"]),
    publish_date: pick(o, ["發言日期", "申報日期", "publish_date"]),
    publish_time: pick(o, ["發言時間", "申報時間", "publish_time"]),
    subject: pick(o, ["主旨", "Subject", "title"]),
    clause: pick(o, ["符合條款", "條款", "clause"]),
    event_date: pick(o, ["事實發生日", "event_date"]),
    description: pick(o, ["說明", "Description", "content"]),
    raw: o,
  };
}

async function events(market: Market) {
  const url = market === "listed" ? TWSE_EVENTS : TPEX_EVENTS;
  const rows = arr(await json(url, { headers: { Accept: "application/json" } }, market === "listed" ? "證交所重大訊息" : "櫃買重大訊息"));
  return rows.map((x) => normalizeEvent(x, market));
}

async function eventsFor(stock: string, market: "auto" | Market, limit = 30) {
  const markets: Market[] = market === "auto" ? ["listed", "otc"] : [market];
  const settled = await Promise.allSettled(markets.map(events));
  const rows: any[] = [];
  const errors: string[] = [];
  settled.forEach((result) => result.status === "fulfilled"
    ? rows.push(...result.value)
    : errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason)));
  return { markets, errors, rows: rows.filter((x) => x.company_code === stock).slice(0, limit) };
}

function rowCode(o: Obj) {
  return pick(o, [
    "證券代號", "證券代碼", "股票代號", "股票代碼", "公司代號", "公司代碼",
    "SecuritiesCompanyCode", "Code", "stock_id", "symbol",
  ]).replace(/\s/g, "");
}

const restrictionSources = [
  { market: "listed", kind: "attention", url: `${TWSE}/announcement/notice`, label: "上市注意股" },
  { market: "listed", kind: "disposition", url: `${TWSE}/announcement/punish`, label: "上市處置股" },
  { market: "listed", kind: "suspended", url: `${TWSE}/exchangeReport/TWTAWU`, label: "上市暫停交易" },
  { market: "listed", kind: "daytrade_short_suspended", url: `${TWSE}/exchangeReport/TWTBAU1`, label: "上市暫停先賣後買當沖" },
  { market: "otc", kind: "attention", url: `${TPEX}/tpex_trading_warning_information`, label: "上櫃注意股" },
  { market: "otc", kind: "disposition", url: `${TPEX}/tpex_disposal_information`, label: "上櫃處置股" },
  { market: "otc", kind: "suspended", url: `${TPEX}/tpex_spendi_today`, label: "上櫃暫停交易" },
  { market: "otc", kind: "trading_method", url: `${TPEX}/tpex_cmode`, label: "上櫃變更/分盤/停止交易" },
  { market: "otc", kind: "margin_adjustment", url: `${TPEX}/tpex_margin_trading_adjust`, label: "上櫃融資融券成數調整" },
] as const;

async function tradingRestrictions(stock: string, market: "auto" | Market) {
  const allowed = restrictionSources.filter((s) => market === "auto" || s.market === market);
  const settled = await Promise.allSettled(allowed.map(async (source) => {
    const body = await json(source.url, { headers: { Accept: "application/json" } }, source.label);
    const matches = arr(body).filter((row) => {
      const code = rowCode(rec(row));
      return code === stock || code.startsWith(`${stock}-`) || code.startsWith(`${stock} `);
    });
    return { ...source, matches };
  }));
  const matches: any[] = [];
  const errors: string[] = [];
  settled.forEach((result) => {
    if (result.status === "fulfilled") {
      for (const row of result.value.matches) {
        matches.push({
          market: result.value.market,
          kind: result.value.kind,
          label: result.value.label,
          raw: row,
        });
      }
    } else {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  });
  return {
    symbol: stock,
    flags: {
      attention: matches.some((x) => x.kind === "attention"),
      disposition: matches.some((x) => x.kind === "disposition"),
      suspended: matches.some((x) => x.kind === "suspended" || x.kind === "trading_method"),
      daytrade_short_suspended: matches.some((x) => x.kind === "daytrade_short_suspended"),
      margin_adjustment: matches.some((x) => x.kind === "margin_adjustment"),
    },
    matches,
    partial_errors: errors,
  };
}

function normalizeSnapshot(x: unknown) {
  const o = rec(x);
  return {
    symbol: String(o.symbol ?? ""),
    name: String(o.name ?? ""),
    type: String(o.type ?? ""),
    open: num(o.openPrice),
    high: num(o.highPrice),
    low: num(o.lowPrice),
    close: num(o.closePrice),
    change: num(o.change),
    change_percent: num(o.changePercent),
    trade_volume: num(o.tradeVolume),
    trade_value: num(o.tradeValue),
    last_updated: o.lastUpdated ?? null,
  };
}

function normalizeQuote(raw: unknown, requestedSymbol: string) {
  const root = rec(raw);
  const d = rec(root.data ?? raw);
  const total = rec(d.total);
  const lastTrade = rec(d.lastTrade);
  const open = num(d.openPrice ?? d.open);
  const high = num(d.highPrice ?? d.high);
  const low = num(d.lowPrice ?? d.low);
  const close = num(d.closePrice ?? d.lastPrice ?? lastTrade.price ?? d.price);
  const previousClose = num(d.previousClose ?? d.referencePrice ?? d.previousClosePrice);
  const change = num(d.change ?? (close && previousClose ? close - previousClose : 0));
  const changePercent = Number.isFinite(Number(d.changePercent))
    ? num(d.changePercent)
    : previousClose ? round((change / previousClose) * 100) : 0;
  const dayRange = high > low ? high - low : 0;
  return {
    symbol: String(d.symbol ?? root.symbol ?? requestedSymbol),
    name: String(d.name ?? root.name ?? ""),
    open,
    high,
    low,
    close,
    previous_close: previousClose,
    change,
    change_percent: changePercent,
    trade_volume: num(d.tradeVolume ?? total.tradeVolume ?? total.volume),
    trade_value: num(d.tradeValue ?? total.tradeValue ?? total.value),
    intraday_position: dayRange > 0 ? round((close - low) / dayRange * 100) : null,
    raw,
  };
}

function revenueSummary(rows: any[]) {
  const data = rows.map((x) => ({
    ...x,
    revenue: num(x.revenue),
    revenue_year: Number(x.revenue_year),
    revenue_month: Number(x.revenue_month),
  })).sort((a, b) => (a.revenue_year * 100 + a.revenue_month) - (b.revenue_year * 100 + b.revenue_month));
  const latest = data.at(-1);
  if (!latest) return { latest: null, history: [] };
  const previous = data.at(-2);
  const lastYear = data.find((x) => x.revenue_year === latest.revenue_year - 1 && x.revenue_month === latest.revenue_month);
  const maxRevenue = Math.max(...data.map((x) => x.revenue));
  let positiveYoYStreak = 0;
  for (let i = data.length - 1; i >= 0; i--) {
    const row = data[i];
    const base = data.find((x) => x.revenue_year === row.revenue_year - 1 && x.revenue_month === row.revenue_month);
    if (base && row.revenue > base.revenue) positiveYoYStreak += 1;
    else break;
  }
  const mom = previous ? pct(latest.revenue, previous.revenue) : null;
  const yoy = lastYear ? pct(latest.revenue, lastYear.revenue) : null;
  const flags: string[] = [];
  if (latest.revenue >= maxRevenue) flags.push("近查詢區間營收新高");
  if (yoy != null && yoy >= 20) flags.push("年增率大於等於20%");
  if (yoy != null && yoy <= -20) flags.push("年減率大於等於20%");
  if (mom != null && Math.abs(mom) >= 20) flags.push("月增減幅超過20%");
  if (positiveYoYStreak >= 3) flags.push(`連續${positiveYoYStreak}個月年增`);
  return {
    latest: { ...latest, mom_percent: mom, yoy_percent: yoy },
    previous,
    same_month_last_year: lastYear ?? null,
    positive_yoy_streak_months: positiveYoYStreak,
    anomaly_flags: flags,
    history: recent(data, 36),
  };
}

function metricName(row: Obj) {
  return `${String(row.type ?? "")} ${String(row.origin_name ?? "")}`.toLowerCase();
}

function selectMetric(rows: any[], aliases: string[]) {
  const lowered = aliases.map((x) => x.toLowerCase());
  const row = rows.find((x) => lowered.some((alias) => metricName(rec(x)).includes(alias)));
  return row ? num(row.value) : null;
}

function periods(rows: any[]) {
  return [...new Set(rows.map((x) => String(x.date ?? "")))].filter(Boolean).sort();
}

function financialSummary(income: any[], balance: any[], cash: any[]) {
  const allDates = [...new Set([...periods(income), ...periods(balance), ...periods(cash)])].sort();
  const selectedDates = allDates.slice(-5);
  const summaries = selectedDates.map((date) => {
    const inc = income.filter((x) => String(x.date) === date);
    const bal = balance.filter((x) => String(x.date) === date);
    const cf = cash.filter((x) => String(x.date) === date);
    const revenue = selectMetric(inc, ["operatingrevenue", "revenue", "營業收入"]);
    const grossProfit = selectMetric(inc, ["grossprofit", "營業毛利"]);
    const operatingIncome = selectMetric(inc, ["operatingincome", "profitlossfromoperating", "營業利益"]);
    const netIncome = selectMetric(inc, ["incomeaftertaxes", "netincome", "本期淨利", "本期稅後淨利"]);
    const eps = selectMetric(inc, [" eps", "eps ", "每股盈餘"]);
    const assets = selectMetric(bal, ["totalassets", "資產總額"]);
    const liabilities = selectMetric(bal, ["totalliabilities", "負債總額"]);
    const inventory = selectMetric(bal, ["inventory", "存貨"]);
    const receivables = selectMetric(bal, ["accountsreceivable", "應收帳款"]);
    const operatingCashFlow = selectMetric(cf, ["cashflowsfromoperatingactivities", "netcashflowsfromusedinoperatingactivities", "營業活動之淨現金流入", "營業活動之淨現金流出"]);
    const capex = selectMetric(cf, ["purchaseofpropertyplantandequipment", "acquisitionofpropertyplantandequipment", "取得不動產、廠房及設備"]);
    return {
      date,
      revenue,
      gross_profit: grossProfit,
      gross_margin_percent: revenue && grossProfit != null ? round(grossProfit / revenue * 100) : null,
      operating_income: operatingIncome,
      operating_margin_percent: revenue && operatingIncome != null ? round(operatingIncome / revenue * 100) : null,
      net_income: netIncome,
      net_margin_percent: revenue && netIncome != null ? round(netIncome / revenue * 100) : null,
      eps,
      total_assets: assets,
      total_liabilities: liabilities,
      debt_ratio_percent: assets && liabilities != null ? round(liabilities / assets * 100) : null,
      inventory,
      accounts_receivable: receivables,
      operating_cash_flow: operatingCashFlow,
      capex,
      free_cash_flow_estimate: operatingCashFlow != null && capex != null ? operatingCashFlow + capex : null,
    };
  });
  const latest = summaries.at(-1) ?? null;
  const previous = summaries.at(-2) ?? null;
  const flags: string[] = [];
  if (latest && previous) {
    const fields: [keyof typeof latest, string][] = [
      ["revenue", "營收"], ["gross_margin_percent", "毛利率"], ["operating_margin_percent", "營益率"],
      ["net_income", "淨利"], ["eps", "EPS"], ["inventory", "存貨"], ["accounts_receivable", "應收帳款"],
      ["operating_cash_flow", "營業現金流"],
    ];
    for (const [field, label] of fields) {
      const a = latest[field] as number | null;
      const b = previous[field] as number | null;
      if (a == null || b == null) continue;
      const change = pct(a, b);
      if (change != null && Math.abs(change) >= 20) flags.push(`${label}較前期變動${change}%`);
    }
    if (latest.operating_cash_flow != null && latest.operating_cash_flow < 0) flags.push("最新一期營業現金流為負");
    if (latest.net_income != null && latest.net_income < 0) flags.push("最新一期淨利為負");
    if (latest.debt_ratio_percent != null && latest.debt_ratio_percent >= 70) flags.push("負債比高於70%");
  }
  return { latest, previous, anomaly_flags: flags, periods: summaries };
}

function holdingLowerBound(level: string) {
  const normalized = level.replace(/,/g, "");
  const numbers = normalized.match(/\d+/g)?.map(Number) ?? [];
  if (/以上|more|over|up/i.test(normalized)) return numbers[0] ?? 0;
  return numbers[0] ?? 0;
}

function holdingSnapshot(rows: any[], targetDate: string) {
  const selected = rows.filter((x) => String(x.date) === targetDate);
  const sumPercent = (threshold: number) => round(selected
    .filter((x) => holdingLowerBound(String(x.HoldingSharesLevel ?? "")) >= threshold)
    .reduce((total, x) => total + num(x.percent), 0), 4);
  return {
    date: targetDate,
    holders: selected.reduce((total, x) => total + num(x.people), 0),
    percent_400k_shares_or_more: sumPercent(400_001),
    percent_1m_shares_or_more: sumPercent(1_000_001),
    distribution: selected,
  };
}

async function marketSnapshot(env: Env, market: FugleMarket) {
  const body = rec(await fugle(env, `/snapshot/quotes/${market}`, { type: "COMMONSTOCK" }));
  return {
    market,
    date: body.date ?? null,
    time: body.time ?? null,
    rows: arr(body.data).map(normalizeSnapshot),
  };
}

function aggregateMarket(rows: ReturnType<typeof normalizeSnapshot>[]) {
  const tradable = rows.filter((x) => x.close > 0 && x.trade_volume > 0);
  const sortedChange = [...tradable].sort((a, b) => a.change_percent - b.change_percent);
  const median = sortedChange.length ? sortedChange[Math.floor(sortedChange.length / 2)].change_percent : 0;
  const advancers = tradable.filter((x) => x.change_percent > 0).length;
  const decliners = tradable.filter((x) => x.change_percent < 0).length;
  const unchanged = tradable.length - advancers - decliners;
  const totalValue = tradable.reduce((sum, x) => sum + x.trade_value, 0);
  return {
    stocks: tradable.length,
    advancers,
    decliners,
    unchanged,
    advance_decline_ratio: decliners ? round(advancers / decliners, 3) : null,
    median_change_percent: median,
    total_trade_value: totalValue,
    top_gainers: [...tradable].sort((a, b) => b.change_percent - a.change_percent).slice(0, 10),
    top_losers: [...tradable].sort((a, b) => a.change_percent - b.change_percent).slice(0, 10),
    top_value: [...tradable].sort((a, b) => b.trade_value - a.trade_value).slice(0, 10),
  };
}

function sectorAggregation(rows: ReturnType<typeof normalizeSnapshot>[], infoRows: any[], topN: number) {
  const info = new Map(infoRows.map((x) => [String(x.stock_id), rec(x)]));
  const groups = new Map<string, ReturnType<typeof normalizeSnapshot>[]>();
  for (const row of rows) {
    const meta = info.get(row.symbol);
    const sector = String(meta?.industry_category ?? "未分類");
    if (["ETF", "大盤", "Index", "所有證券", "未分類"].includes(sector)) continue;
    const list = groups.get(sector) ?? [];
    list.push(row);
    groups.set(sector, list);
  }
  const sectors = [...groups.entries()].map(([sector, stocks]) => {
    const liquid = stocks.filter((x) => x.trade_volume > 0);
    const avg = liquid.length ? liquid.reduce((sum, x) => sum + x.change_percent, 0) / liquid.length : 0;
    const weightedDen = liquid.reduce((sum, x) => sum + x.trade_value, 0);
    const weighted = weightedDen
      ? liquid.reduce((sum, x) => sum + x.change_percent * x.trade_value, 0) / weightedDen
      : avg;
    return {
      sector,
      stock_count: liquid.length,
      average_change_percent: round(avg),
      value_weighted_change_percent: round(weighted),
      advancers: liquid.filter((x) => x.change_percent > 0).length,
      decliners: liquid.filter((x) => x.change_percent < 0).length,
      trade_value: weightedDen,
      leaders: [...liquid].sort((a, b) => b.change_percent - a.change_percent).slice(0, 5),
    };
  }).filter((x) => x.stock_count >= 2);
  return {
    strongest: [...sectors].sort((a, b) => b.value_weighted_change_percent - a.value_weighted_change_percent).slice(0, topN),
    weakest: [...sectors].sort((a, b) => a.value_weighted_change_percent - b.value_weighted_change_percent).slice(0, topN),
  };
}

type PublicSource = { label: string; url: string; kind?: string; market?: Market };

async function publicRows(url: string, label: string) {
  return arr(await json(url, { headers: { Accept: "application/json" } }, label));
}

async function collectPublicSources(sources: PublicSource[], symbol?: string) {
  const settled = await Promise.allSettled(sources.map(async (source) => {
    const rows = await publicRows(source.url, source.label);
    const filtered = symbol ? rows.filter((x) => rowCode(rec(x)) === symbol) : rows;
    return { ...source, rows: filtered };
  }));
  const datasets: any[] = [];
  const errors: string[] = [];
  settled.forEach((result) => result.status === "fulfilled"
    ? datasets.push(result.value)
    : errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason)));
  return { datasets, errors };
}

function sourcesByMarket(market: "auto" | Market, listed: PublicSource[], otc: PublicSource[]) {
  return market === "listed" ? listed : market === "otc" ? otc : [...listed, ...otc];
}

function tdccHoldingSnapshot(rows: any[], targetDate: string) {
  const selected = rows.filter((x) => String(x.date) === targetDate && x.level >= 1 && x.level <= 15);
  const sum = (levels: number[]) => round(selected.filter((x) => levels.includes(x.level)).reduce((a, b) => a + b.percent, 0), 4);
  return {
    date: targetDate,
    holders: selected.reduce((a, b) => a + b.people, 0),
    shares: selected.reduce((a, b) => a + b.shares, 0),
    percent_400k_shares_or_more: sum([12, 13, 14, 15]),
    percent_800k_shares_or_more: sum([14, 15]),
    percent_1m_shares_or_more: sum([15]),
    retail_percent_under_10k: sum([1, 2, 3]),
    distribution: selected,
  };
}

async function tdccShareholding(symbol: string) {
  const rows = await publicRows(`${TDCC}/1-5`, "TDCC集保戶股權分散表");
  const normalized = rows.map((x) => {
    const o = rec(x);
    return {
      date: pick(o, ["資料日期", "date"]),
      symbol: pick(o, ["證券代號", "stock_id", "symbol"]),
      level: num(o["持股分級"] ?? o.level),
      people: num(o["人數"] ?? o.people),
      shares: num(o["股數"] ?? o.shares),
      percent: num(o["占集保庫存數比例%"] ?? o.percent),
    };
  }).filter((x) => x.symbol === symbol);
  const dates = [...new Set(normalized.map((x) => x.date))].filter(Boolean).sort();
  const latest = dates.at(-1) ? tdccHoldingSnapshot(normalized, dates.at(-1)!) : null;
  const previous = dates.at(-2) ? tdccHoldingSnapshot(normalized, dates.at(-2)!) : null;
  return {
    latest,
    previous,
    large_holder_1m_change_percentage_points: latest && previous ? round(latest.percent_1m_shares_or_more - previous.percent_1m_shares_or_more, 4) : null,
    large_holder_400k_change_percentage_points: latest && previous ? round(latest.percent_400k_shares_or_more - previous.percent_400k_shares_or_more, 4) : null,
    retail_change_percentage_points: latest && previous ? round(latest.retail_percent_under_10k - previous.retail_percent_under_10k, 4) : null,
  };
}

const revenueOfficialSources: PublicSource[] = [
  { market: "listed", label: "證交所上市月營收", url: `${TWSE}/opendata/t187ap05_L` },
  { market: "otc", label: "櫃買上櫃月營收", url: `${TPEX}/mopsfin_t187ap05_O` },
];

function officialRevenueRow(row: any) {
  const o = rec(row);
  return {
    company_code: rowCode(o),
    company_name: pick(o, ["公司名稱", "CompanyName"]),
    year_month: pick(o, ["資料年月", "年月", "year_month"]),
    current_month_revenue: num(o["營業收入-當月營收"] ?? o["當月營收"] ?? o.revenue),
    previous_month_revenue: num(o["營業收入-上月營收"] ?? o["上月營收"]),
    last_year_month_revenue: num(o["營業收入-去年當月營收"] ?? o["去年當月營收"]),
    mom_percent: num(o["營業收入-上月比較增減(%)"] ?? o["上月比較增減(%)"]),
    yoy_percent: num(o["營業收入-去年同月增減(%)"] ?? o["去年同月增減(%)"]),
    cumulative_revenue: num(o["累計營業收入-當月累計營收"] ?? o["當月累計營收"]),
    cumulative_yoy_percent: num(o["累計營業收入-前期比較增減(%)"] ?? o["前期比較增減(%)"]),
    raw: o,
  };
}

const listedIncomeSources = ["ci", "basi", "bd", "fh", "ins", "mim"].map((x) => ({ market: "listed" as const, label: `證交所上市綜合損益表-${x}`, url: `${TWSE}/opendata/t187ap06_L_${x}`, kind: "income" }));
const listedBalanceSources = ["ci", "basi", "bd", "fh", "ins", "mim"].map((x) => ({ market: "listed" as const, label: `證交所上市資產負債表-${x}`, url: `${TWSE}/opendata/t187ap07_L_${x}`, kind: "balance" }));
const otcIncomeSources = ["ci", "basi", "bd", "fh", "ins", "mim"].map((x) => ({ market: "otc" as const, label: `櫃買上櫃綜合損益表-${x}`, url: `${TPEX}/mopsfin_t187ap06_O_${x}`, kind: "income" }));
const otcBalanceSources = ["ci", "basi", "bd", "fh", "ins", "mim"].map((x) => ({ market: "otc" as const, label: `櫃買上櫃資產負債表-${x}`, url: `${TPEX}/mopsfin_t187ap07_O_${x}`, kind: "balance" }));

function genericNumber(o: Obj, keys: string[]) {
  for (const key of keys) if (o[key] != null && String(o[key]).trim() !== "") return num(String(o[key]).replace(/,/g, ""));
  return null;
}

function summarizeOfficialFinancial(rows: any[]) {
  const row = rows[0] ? rec(rows[0]) : null;
  if (!row) return null;
  const revenue = genericNumber(row, ["營業收入", "營業收入合計", "收益", "收入"]);
  const gross = genericNumber(row, ["營業毛利（毛損）", "營業毛利(毛損)", "營業毛利"]);
  const op = genericNumber(row, ["營業利益（損失）", "營業利益(損失)", "營業利益"]);
  const net = genericNumber(row, ["本期淨利（淨損）", "本期淨利(淨損)", "本期淨利"]);
  const assets = genericNumber(row, ["資產總計", "資產總額"]);
  const liabilities = genericNumber(row, ["負債總計", "負債總額"]);
  return {
    report_date: pick(row, ["出表日期", "年度", "季別", "資料日期"]),
    revenue,
    gross_profit: gross,
    gross_margin_percent: revenue && gross != null ? round(gross / revenue * 100) : null,
    operating_income: op,
    operating_margin_percent: revenue && op != null ? round(op / revenue * 100) : null,
    net_income: net,
    net_margin_percent: revenue && net != null ? round(net / revenue * 100) : null,
    eps: genericNumber(row, ["基本每股盈餘（元）", "基本每股盈餘(元)", "每股盈餘"]),
    total_assets: assets,
    total_liabilities: liabilities,
    debt_ratio_percent: assets && liabilities != null ? round(liabilities / assets * 100) : null,
    inventory: genericNumber(row, ["存貨"]),
    accounts_receivable: genericNumber(row, ["應收帳款淨額", "應收帳款"]),
  };
}

const listedInsiderSources: PublicSource[] = [
  ["large_shareholders", "上市持股逾10%大股東", "t187ap02_L"], ["holding_insufficient", "上市董監持股不足", "t187ap08_L"],
  ["pledge", "上市董監事質押", "t187ap09_L"], ["director_holdings", "上市董監事持股", "t187ap11_L"],
  ["transfer", "上市內部人持股轉讓", "t187ap12_L"], ["uncompleted_transfer", "上市內部人持股未轉讓", "t187ap13_L"],
  ["violation", "上市資訊申報違規", "t187ap23_L"], ["control_change", "上市經營權異動", "t187ap24_L"],
].map(([kind, label, path]) => ({ market: "listed", kind, label, url: `${TWSE}/opendata/${path}` }));
const otcInsiderSources: PublicSource[] = [
  ["large_shareholders", "上櫃持股逾10%大股東", "mopsfin_t187ap02_O"], ["holding_insufficient", "上櫃董監持股不足", "mopsfin_t187ap08_O"],
  ["pledge", "上櫃董監事質押", "mopsfin_t187ap09_O"], ["director_holdings", "上櫃董監事持股", "mopsfin_t187ap11_O"],
  ["transfer", "上櫃內部人持股轉讓", "mopsfin_t187ap12_O"], ["uncompleted_transfer", "上櫃內部人持股未轉讓", "mopsfin_t187ap13_O"],
  ["violation", "上櫃資訊申報違規", "mopsfin_t187ap23_O"], ["control_change", "上櫃經營權異動", "mopsfin_t187ap24_O"],
].map(([kind, label, path]) => ({ market: "otc", kind, label, url: `${TPEX}/${path}` }));

function insiderRisk(datasets: any[]) {
  const kinds = new Set(datasets.filter((x) => x.rows.length).map((x) => x.kind));
  let pledge = 0;
  for (const data of datasets.filter((x) => x.kind === "pledge")) for (const row of data.rows) {
    const o = rec(row);
    for (const [key, value] of Object.entries(o)) if (/質押|質權/.test(key) && /比率|比例|%/.test(key)) pledge = Math.max(pledge, num(String(value).replace(/,/g, "")));
  }
  let score = 0;
  if (kinds.has("transfer")) score += 2;
  if (kinds.has("holding_insufficient")) score += 2;
  if (kinds.has("control_change")) score += 2;
  if (kinds.has("violation")) score += 1;
  if (pledge >= 50) score += 3; else if (pledge >= 30) score += 2; else if (pledge > 0) score += 1;
  return { risk_score: score, risk_level: score >= 6 ? "high" : score >= 3 ? "medium" : "low", max_pledge_ratio_percent: pledge || null, flags: [...kinds] };
}

const valuationSources = {
  listed: { label: "證交所估值", url: `${TWSE}/exchangeReport/BWIBBU_ALL` },
  otc: { label: "櫃買估值", url: `${TPEX}/tpex_mainboard_peratio_analysis` },
};
function valuationRow(row: any) {
  const o = rec(row);
  return {
    symbol: rowCode(o), name: pick(o, ["證券名稱", "股票名稱", "Name"]),
    pe_ratio: genericNumber(o, ["本益比", "PEratio", "P/E"]),
    dividend_yield_percent: genericNumber(o, ["殖利率(%)", "殖利率％", "DividendYield"]),
    pb_ratio: genericNumber(o, ["股價淨值比", "PBratio", "P/B"]),
    raw: o,
  };
}

const listedCalendarSources: PublicSource[] = [
  { market: "listed", kind: "dividend", label: "上市股利分派", url: `${TWSE}/opendata/t187ap45_L` },
  { market: "listed", kind: "shareholder_meeting", label: "上市股東會公告", url: `${TWSE}/opendata/t187ap38_L` },
  { market: "listed", kind: "shareholder_meeting_detail", label: "上市股東會日期地點", url: `${TWSE}/opendata/t187ap41_L` },
  { market: "listed", kind: "ex_rights", label: "上市除權除息預告", url: `${TWSE}/exchangeReport/TWT48U_ALL` },
];
const otcCalendarSources: PublicSource[] = [
  { market: "otc", kind: "dividend", label: "上櫃股利分派", url: `${TPEX}/mopsfin_t187ap45_O` },
  { market: "otc", kind: "shareholder_meeting", label: "上櫃股東會公告", url: `${TPEX}/mopsfin_t187ap38_O` },
  { market: "otc", kind: "shareholder_meeting_detail", label: "上櫃股東會日期地點", url: `${TPEX}/mopsfin_t187ap41_O` },
  { market: "otc", kind: "ex_rights", label: "上櫃除權息資訊", url: `${TPEX}/tpex_exright_daily` },
];

const listedShortSources: PublicSource[] = [
  { market: "listed", kind: "margin", label: "上市融資融券", url: `${TWSE}/exchangeReport/MI_MARGN` },
  { market: "listed", kind: "daytrade", label: "上市當沖統計", url: `${TWSE}/exchangeReport/TWTB4U` },
  { market: "listed", kind: "borrowable", label: "上市櫃可借券賣出", url: `${TWSE}/SBL/TWT96U` },
  { market: "listed", kind: "margin_halt", label: "上市停資停券", url: `${TWSE}/exchangeReport/BFI84U` },
];
const otcShortSources: PublicSource[] = [
  { market: "otc", kind: "margin_lending", label: "上櫃融資融券借券", url: `${TPEX}/tpex_margin_sbl` },
  { market: "otc", kind: "daytrade", label: "上櫃當沖統計", url: `${TPEX}/tpex_intraday_trading_statistics` },
  { market: "otc", kind: "margin_terms", label: "上櫃停資停券與融資券條件", url: `${TPEX}/tpex_margin_trading_term` },
  { market: "otc", kind: "margin_adjustment", label: "上櫃融資券成數調整", url: `${TPEX}/tpex_margin_trading_adjust` },
];

async function derivativesSentiment() {
  const sources: PublicSource[] = [
    { kind: "put_call_ratio", label: "期交所Put/Call Ratio", url: `${TAIFEX}/PutCallRatio` },
    { kind: "institutional_general", label: "期交所三大法人總表", url: `${TAIFEX}/MarketDataOfMajorInstitutionalTradersGeneralBytheDate` },
    { kind: "futures_positions", label: "期交所法人期貨契約", url: `${TAIFEX}/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate` },
    { kind: "calls_puts", label: "期交所法人選擇權買賣權", url: `${TAIFEX}/MarketDataOfMajorInstitutionalTradersDetailsOfCallsAndPutsBytheDate` },
    { kind: "large_traders", label: "期交所大額交易人期貨未平倉", url: `${TAIFEX}/OpenInterestOfLargeTradersFutures` },
  ];
  const result = await collectPublicSources(sources);
  return { datasets: result.datasets.map((x) => ({ kind: x.kind, label: x.label, data: recent(x.rows, 60) })), partial_errors: result.errors };
}

function technicalSwingSummary(prices: any[]) {
  const rows = prices.map((x) => ({ ...x, close: num(x.close), max: num(x.max), min: num(x.min), volume: num(x.Trading_Volume ?? x.volume) })).filter((x) => x.close > 0);
  const latest = rows.at(-1);
  if (!latest) return { score: 0, latest: null };
  const avg = (n: number) => { const xs = rows.slice(-n); return xs.length ? xs.reduce((a, b) => a + b.close, 0) / xs.length : latest.close; };
  const ma20 = avg(20), ma60 = avg(60), ma120 = avg(120);
  const high60 = Math.max(...rows.slice(-60).map((x) => x.max || x.close));
  let score = 50;
  if (latest.close > ma20) score += 8; else score -= 8;
  if (ma20 > ma60) score += 10; else score -= 10;
  if (ma60 > ma120) score += 10; else score -= 10;
  if (latest.close >= high60 * 0.98) score += 8;
  return { score: Math.max(0, Math.min(100, score)), latest_close: latest.close, ma20: round(ma20), ma60: round(ma60), ma120: round(ma120), high_60d: high60 };
}

export class MyMCP extends McpAgent<Env> {
  server = new McpServer({ name: "Taiwan Stock AI", version: "5.0.0" });

  async init() {
    this.server.registerTool("get_quote", {
      description: "富果台股即時報價、量與五檔。",
      inputSchema: { symbol: stockSymbol, type: z.enum(["normal", "oddlot"]).optional().default("normal") },
    }, async ({ symbol, type }) => {
      try {
        return ok({ source: "Fugle", retrieved_at: new Date().toISOString(), data: await fugle(this.env, `/intraday/quote/${encodeURIComponent(symbol)}`, { type: type === "oddlot" ? "oddlot" : undefined }) });
      } catch (e) { return fail(e); }
    });

    this.server.registerTool("get_intraday_candles", {
      description: "富果台股當日日內分K。",
      inputSchema: {
        symbol: stockSymbol,
        timeframe: z.enum(["1", "3", "5", "10", "15", "30", "60"]).optional().default("5"),
        sort: z.enum(["asc", "desc"]).optional().default("asc"),
        type: z.enum(["normal", "oddlot"]).optional().default("normal"),
        last_n: z.number().int().min(1).max(500).optional().default(100),
      },
    }, async ({ symbol, timeframe, sort, type, last_n }) => {
      try {
        const raw = rec(await fugle(this.env, `/intraday/candles/${encodeURIComponent(symbol)}`, { timeframe, sort, type: type === "oddlot" ? "oddlot" : undefined }));
        const data = Array.isArray(raw.data) ? raw.data : [];
        return ok({ source: "Fugle", ...raw, data: sort === "desc" ? data.slice(0, last_n) : data.slice(-last_n) });
      } catch (e) { return fail(e); }
    });

    this.server.registerTool("get_daily_price", {
      description: "FinMind台股日K，適合波段趨勢與支撐壓力分析。",
      inputSchema: { symbol: stockSymbol, start_date: isoDate.optional(), end_date: isoDate.optional(), limit: z.number().int().min(1).max(500).optional().default(120) },
    }, async ({ symbol, start_date, end_date, limit }) => {
      try {
        const start = start_date ?? twDate(365);
        const end = end_date ?? twDate();
        if (start > end) throw new Error("start_date 不可晚於 end_date");
        const result = await finmind(this.env, "TaiwanStockPrice", { data_id: symbol, start_date: start, end_date: end });
        return ok({ source: "FinMind", dataset: "TaiwanStockPrice", symbol, start_date: start, end_date: end, data: recent(result.data, limit) });
      } catch (e) { return fail(e); }
    });

    this.server.registerTool("get_institutional", {
      description: "FinMind個股三大法人買賣。",
      inputSchema: { symbol: stockSymbol, start_date: isoDate.optional(), end_date: isoDate.optional(), limit_days: z.number().int().min(1).max(120).optional().default(20) },
    }, async ({ symbol, start_date, end_date, limit_days }) => {
      try {
        const start = start_date ?? twDate(60);
        const end = end_date ?? twDate();
        const result = await finmind(this.env, "TaiwanStockInstitutionalInvestorsBuySell", { data_id: symbol, start_date: start, end_date: end });
        const rows = result.data.map((x: any) => ({ ...x, net: num(x.buy) - num(x.sell) }));
        const dates = [...new Set(rows.map((x: any) => String(x.date ?? "")))].filter(Boolean).sort().slice(-limit_days);
        return ok({ source: "FinMind", symbol, data: rows.filter((x: any) => dates.includes(String(x.date ?? ""))) });
      } catch (e) { return fail(e); }
    });

    this.server.registerTool("get_margin", {
      description: "FinMind融資融券。",
      inputSchema: { symbol: stockSymbol, start_date: isoDate.optional(), end_date: isoDate.optional(), limit: z.number().int().min(1).max(250).optional().default(30) },
    }, async ({ symbol, start_date, end_date, limit }) => {
      try {
        const start = start_date ?? twDate(90);
        const end = end_date ?? twDate();
        const result = await finmind(this.env, "TaiwanStockMarginPurchaseShortSale", { data_id: symbol, start_date: start, end_date: end });
        const rows = result.data.map((x: any) => ({
          ...x,
          margin_balance_change: num(x.MarginPurchaseTodayBalance) - num(x.MarginPurchaseYesterdayBalance),
          short_balance_change: num(x.ShortSaleTodayBalance) - num(x.ShortSaleYesterdayBalance),
        }));
        return ok({ source: "FinMind", symbol, data: recent(rows, limit) });
      } catch (e) { return fail(e); }
    });

    this.server.registerTool("get_broker_chips", {
      description: "FinMind單日券商分點淨買賣；需要對應會員權限。",
      inputSchema: { symbol: stockSymbol, date: isoDate, top_n: z.number().int().min(1).max(50).optional().default(20) },
    }, async ({ symbol, date, top_n }) => {
      try {
        const rows = await broker(this.env, symbol, date);
        const map = new Map<string, any>();
        for (const x of rows) {
          const id = String(x.securities_trader_id ?? "unknown");
          const name = String(x.securities_trader ?? id);
          const key = `${id}|${name}`;
          const value = map.get(key) ?? { id, name, buy: 0, sell: 0, buyValue: 0, sellValue: 0 };
          const price = num(x.price), buy = num(x.buy), sell = num(x.sell);
          value.buy += buy; value.sell += sell; value.buyValue += price * buy; value.sellValue += price * sell;
          map.set(key, value);
        }
        const summary = [...map.values()].map((x) => ({
          securities_trader_id: x.id,
          securities_trader: x.name,
          buy_shares: x.buy,
          sell_shares: x.sell,
          net_shares: x.buy - x.sell,
          net_lots: round((x.buy - x.sell) / 1000),
          avg_buy_price: x.buy ? round(x.buyValue / x.buy, 4) : null,
          avg_sell_price: x.sell ? round(x.sellValue / x.sell, 4) : null,
        }));
        return ok({
          source: "FinMind", symbol, date,
          top_net_buyers: summary.filter((x) => x.net_shares > 0).sort((a, b) => b.net_shares - a.net_shares).slice(0, top_n),
          top_net_sellers: summary.filter((x) => x.net_shares < 0).sort((a, b) => a.net_shares - b.net_shares).slice(0, top_n),
        });
      } catch (e) { return fail(e); }
    });

    this.server.registerTool("get_stock_news", {
      description: "FinMind指定個股單日新聞。",
      inputSchema: { symbol: stockSymbol, date: isoDate.optional(), limit: z.number().int().min(1).max(100).optional().default(30) },
    }, async ({ symbol, date, limit }) => {
      try {
        const day = date ?? twDate();
        const result = await finmind(this.env, "TaiwanStockNews", { data_id: symbol, start_date: day });
        return ok({ source: "FinMind", dataset: "TaiwanStockNews", symbol, date: day, data: result.data.slice(0, limit).map((x: any) => ({ date: x.date, stock_id: x.stock_id, title: x.title, source: x.source, link: x.link, description: x.description })) });
      } catch (e) { return fail(e); }
    });

    this.server.registerTool("get_material_events", {
      description: "證交所/櫃買中心官方每日重大訊息。",
      inputSchema: { symbol: stockSymbol, market: marketChoice.optional().default("auto"), limit: z.number().int().min(1).max(100).optional().default(30) },
    }, async ({ symbol, market, limit }) => {
      try {
        const result = await eventsFor(symbol, market, limit);
        return ok({ source: "TWSE/TPEx OpenAPI", symbol, markets_checked: result.markets, partial_errors: result.errors, data: result.rows });
      } catch (e) { return fail(e); }
    });

    this.server.registerTool("explain_price_move", {
      description: "彙整即時報價、5分K、日K、新聞與重大訊息，供模型判斷異動原因；不宣稱已證明因果。",
      inputSchema: { symbol: stockSymbol, date: isoDate.optional(), market: marketChoice.optional().default("auto") },
    }, async ({ symbol, date, market }) => {
      try {
        const day = date ?? twDate();
        const [quote, candles, prices, news, material] = await Promise.allSettled([
          fugle(this.env, `/intraday/quote/${encodeURIComponent(symbol)}`),
          fugle(this.env, `/intraday/candles/${encodeURIComponent(symbol)}`, { timeframe: "5", sort: "asc" }),
          finmind(this.env, "TaiwanStockPrice", { data_id: symbol, start_date: twDate(60), end_date: day }),
          finmind(this.env, "TaiwanStockNews", { data_id: symbol, start_date: day }),
          eventsFor(symbol, market, 30),
        ]);
        const errors: string[] = [];
        for (const result of [quote, candles, prices, news, material]) {
          if (result.status === "rejected") errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
        }
        const candleRoot = candles.status === "fulfilled" ? rec(candles.value) : {};
        const eventResult = material.status === "fulfilled" ? material.value : null;
        if (eventResult) errors.push(...eventResult.errors);
        return ok({
          symbol, date: day, retrieved_at: new Date().toISOString(),
          caution: "同時出現不等於已證明因果關係。",
          quote: quote.status === "fulfilled" ? quote.value : null,
          intraday_5m_candles: Array.isArray(candleRoot.data) ? candleRoot.data.slice(-60) : [],
          recent_daily_prices: prices.status === "fulfilled" ? recent(prices.value.data, 30) : [],
          stock_news: news.status === "fulfilled" ? news.value.data.slice(0, 30) : [],
          material_events: eventResult?.rows ?? [],
          partial_errors: errors,
        });
      } catch (e) { return fail(e); }
    });

    this.server.registerTool("get_trading_restrictions", {
      description: "查詢上市櫃注意股、處置股、暫停交易、暫停先賣後買當沖與融資融券成數調整。",
      inputSchema: { symbol: stockSymbol, market: marketChoice.optional().default("auto") },
    }, async ({ symbol, market }) => {
      try { return ok({ source: "TWSE/TPEx OpenAPI", retrieved_at: new Date().toISOString(), ...(await tradingRestrictions(symbol, market)) }); }
      catch (e) { return fail(e); }
    });

    this.server.registerTool("get_market_rankings", {
      description: "富果即時上市/上櫃漲幅、跌幅、成交量或成交值排行；快照約每5秒更新。",
      inputSchema: {
        markets: z.array(z.enum(["TSE", "OTC"])).min(1).max(2).optional().default(["TSE", "OTC"]),
        ranking: z.enum(["gainers", "losers", "volume", "value"]).optional().default("gainers"),
        top_n: z.number().int().min(1).max(100).optional().default(20),
      },
    }, async ({ markets, ranking, top_n }) => {
      try {
        const results = await Promise.all(markets.map(async (market) => {
          const path = ranking === "gainers" || ranking === "losers"
            ? `/snapshot/movers/${market}`
            : `/snapshot/actives/${market}`;
          const query = ranking === "gainers" ? { direction: "up", change: "percent", type: "COMMONSTOCK" }
            : ranking === "losers" ? { direction: "down", change: "percent", type: "COMMONSTOCK" }
            : { trade: ranking, type: "COMMONSTOCK" };
          const body = rec(await fugle(this.env, path, query));
          return { market, date: body.date ?? null, time: body.time ?? null, data: arr(body.data).map(normalizeSnapshot).slice(0, top_n) };
        }));
        return ok({ source: "Fugle", ranking, retrieved_at: new Date().toISOString(), results });
      } catch (e) { return fail(e); }
    });

    this.server.registerTool("scan_watchlist", {
      description: "批次掃描自選股即時強弱，依漲跌幅、成交量、成交值或日內位置排序。",
      inputSchema: {
        symbols: z.array(stockSymbol).min(1).max(50),
        rank_by: z.enum(["change_percent", "trade_volume", "trade_value", "intraday_position"]).optional().default("change_percent"),
        direction: z.enum(["desc", "asc"]).optional().default("desc"),
        top_n: z.number().int().min(1).max(50).optional().default(20),
      },
    }, async ({ symbols, rank_by, direction, top_n }) => {
      try {
        const unique = [...new Set(symbols as string[])] as string[];
        const settled = await Promise.allSettled(unique.map(async (code) => normalizeQuote(await fugle(this.env, `/intraday/quote/${encodeURIComponent(code)}`), code)));
        const data: any[] = [];
        const errors: any[] = [];
        settled.forEach((result, index) => result.status === "fulfilled" ? data.push(result.value) : errors.push({ symbol: unique[index], error: result.reason instanceof Error ? result.reason.message : String(result.reason) }));
        data.sort((a, b) => (num(a[rank_by]) - num(b[rank_by])) * (direction === "asc" ? 1 : -1));
        return ok({ source: "Fugle", rank_by, direction, requested: unique.length, succeeded: data.length, data: data.slice(0, top_n), partial_errors: errors });
      } catch (e) { return fail(e); }
    });

    this.server.registerTool("get_monthly_revenue", {
      description: "官方證交所/櫃買月營收優先，FinMind補歷史；計算月增、年增與營收異常。",
      inputSchema: { symbol: stockSymbol, months: z.number().int().min(13).max(120).optional().default(36) },
    }, async ({ symbol, months }) => {
      try {
        const [official, history] = await Promise.allSettled([
          collectPublicSources(revenueOfficialSources, symbol),
          finmind(this.env, "TaiwanStockMonthRevenue", { data_id: symbol, start_date: twDate(months * 32) }),
        ]);
        const errors: string[] = [];
        if (official.status === "rejected") errors.push(official.reason instanceof Error ? official.reason.message : String(official.reason));
        if (history.status === "rejected") errors.push(history.reason instanceof Error ? history.reason.message : String(history.reason));
        const officialRows = official.status === "fulfilled" ? official.value.datasets.flatMap((x) => x.rows.map(officialRevenueRow)) : [];
        if (official.status === "fulfilled") errors.push(...official.value.errors);
        return ok({ source_priority: ["TWSE/TPEx OpenAPI", "FinMind fallback/history"], symbol, official_latest: officialRows, historical_analysis: history.status === "fulfilled" ? revenueSummary(history.value.data) : null, partial_errors: errors });
      } catch (e) { return fail(e); }
    });

    this.server.registerTool("get_financial_anomalies", {
      description: "官方上市櫃損益表與資產負債表優先，FinMind補現金流與歷史比較。",
      inputSchema: { symbol: stockSymbol, market: marketChoice.optional().default("auto"), start_date: isoDate.optional() },
    }, async ({ symbol, market, start_date }) => {
      try {
        const officialSources = sourcesByMarket(market, [...listedIncomeSources, ...listedBalanceSources], [...otcIncomeSources, ...otcBalanceSources]);
        const start = start_date ?? twDate(1_100);
        const [official, income, balance, cash] = await Promise.allSettled([
          collectPublicSources(officialSources, symbol),
          finmind(this.env, "TaiwanStockFinancialStatements", { data_id: symbol, start_date: start }),
          finmind(this.env, "TaiwanStockBalanceSheet", { data_id: symbol, start_date: start }),
          finmind(this.env, "TaiwanStockCashFlowsStatement", { data_id: symbol, start_date: start }),
        ]);
        const errors: string[] = [];
        for (const r of [official, income, balance, cash]) if (r.status === "rejected") errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
        const officialData = official.status === "fulfilled" ? official.value.datasets.filter((x) => x.rows.length) : [];
        if (official.status === "fulfilled") errors.push(...official.value.errors);
        return ok({ source_priority: ["TWSE/TPEx OpenAPI", "FinMind fallback/history"], symbol, official_summary: summarizeOfficialFinancial(officialData.flatMap((x) => x.rows)), official_datasets: officialData, historical_analysis: financialSummary(income.status === "fulfilled" ? income.value.data : [], balance.status === "fulfilled" ? balance.value.data : [], cash.status === "fulfilled" ? cash.value.data : []), partial_errors: errors });
      } catch (e) { return fail(e); }
    });

    this.server.registerTool("get_shareholding_structure", {
      description: "TDCC官方免費集保股權分散為主，搭配FinMind外資持股與借券。",
      inputSchema: { symbol: stockSymbol, start_date: isoDate.optional(), end_date: isoDate.optional() },
    }, async ({ symbol, start_date, end_date }) => {
      try {
        const start = start_date ?? twDate(180), end = end_date ?? twDate();
        const [tdcc, foreign, lending] = await Promise.allSettled([
          tdccShareholding(symbol),
          finmind(this.env, "TaiwanStockShareholding", { data_id: symbol, start_date: start, end_date: end }),
          finmind(this.env, "TaiwanStockSecuritiesLending", { data_id: symbol, start_date: start, end_date: end }),
        ]);
        const errors: string[] = [];
        for (const r of [tdcc, foreign, lending]) if (r.status === "rejected") errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
        const f = foreign.status === "fulfilled" ? foreign.value.data : [];
        return ok({ source_priority: ["TDCC OpenAPI", "FinMind supplementary"], symbol, tdcc_holding_distribution: tdcc.status === "fulfilled" ? tdcc.value : null, foreign_shareholding: { latest: f.at(-1) ?? null, previous: f.at(-2) ?? null }, securities_lending: lending.status === "fulfilled" ? recent(lending.value.data, 30) : [], partial_errors: errors });
      } catch (e) { return fail(e); }
    });

    this.server.registerTool("get_market_regime", {
      description: "彙整上市櫃即時市場廣度、成交值、強弱股與產業族群強弱，兼顧當沖與波段環境。富果快照功能需相應方案權限。",
      inputSchema: { include_sectors: z.boolean().optional().default(true), top_sectors: z.number().int().min(3).max(20).optional().default(10) },
    }, async ({ include_sectors, top_sectors }) => {
      try {
        const [tse, otc, stockInfo] = await Promise.allSettled([
          marketSnapshot(this.env, "TSE"),
          marketSnapshot(this.env, "OTC"),
          include_sectors ? finmind(this.env, "TaiwanStockInfo", {}) : Promise.resolve({ data: [] }),
        ]);
        const errors: string[] = [];
        for (const result of [tse, otc, stockInfo]) if (result.status === "rejected") errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
        const tseRows = tse.status === "fulfilled" ? tse.value.rows : [];
        const otcRows = otc.status === "fulfilled" ? otc.value.rows : [];
        const allRows = [...tseRows, ...otcRows];
        const total = aggregateMarket(allRows);
        const adRatio = total.advance_decline_ratio ?? 0;
        const regime = adRatio >= 1.5 && total.median_change_percent > 0.5 ? "risk_on"
          : adRatio <= 0.67 && total.median_change_percent < -0.5 ? "risk_off"
          : "mixed";
        return ok({
          source: "Fugle + FinMind",
          retrieved_at: new Date().toISOString(),
          regime,
          interpretation: regime === "risk_on" ? "市場廣度偏多，做多環境較有利，但仍須避免追高。" : regime === "risk_off" ? "市場廣度偏空，應降低多單曝險並提高停損紀律。" : "多空分歧，宜重視個股與族群選擇。",
          listed: aggregateMarket(tseRows),
          otc: aggregateMarket(otcRows),
          combined: total,
          sectors: include_sectors && stockInfo.status === "fulfilled" ? sectorAggregation(allRows, stockInfo.value.data, top_sectors) : null,
          partial_errors: errors,
        });
      } catch (e) { return fail(e); }
    });

    this.server.registerTool("get_insider_risk", {
      description: "查詢內部人轉讓、董監質押、持股不足、經營權異動與資訊申報違規。",
      inputSchema: { symbol: stockSymbol, market: marketChoice.optional().default("auto") },
    }, async ({ symbol, market }) => {
      try {
        const result = await collectPublicSources(sourcesByMarket(market, listedInsiderSources, otcInsiderSources), symbol);
        return ok({ source: "TWSE/TPEx OpenAPI", symbol, ...insiderRisk(result.datasets), datasets: result.datasets.filter((x) => x.rows.length), partial_errors: result.errors });
      } catch (e) { return fail(e); }
    });

    this.server.registerTool("get_valuation", {
      description: "查詢官方本益比、殖利率與股價淨值比。",
      inputSchema: { symbol: stockSymbol, market: marketChoice.optional().default("auto") },
    }, async ({ symbol, market }) => {
      try {
        const sources = market === "listed" ? [valuationSources.listed] : market === "otc" ? [valuationSources.otc] : [valuationSources.listed, valuationSources.otc];
        const result = await collectPublicSources(sources, symbol);
        return ok({ source: "TWSE/TPEx OpenAPI", symbol, data: result.datasets.flatMap((x) => x.rows.map(valuationRow)), partial_errors: result.errors });
      } catch (e) { return fail(e); }
    });

    this.server.registerTool("get_corporate_action_calendar", {
      description: "整合股利、除權息、股東會、暫停交易與重大訊息公司事件日曆。",
      inputSchema: { symbol: stockSymbol, market: marketChoice.optional().default("auto"), limit: z.number().int().min(1).max(100).optional().default(50) },
    }, async ({ symbol, market, limit }) => {
      try {
        const [calendar, restrictions, material] = await Promise.allSettled([
          collectPublicSources(sourcesByMarket(market, listedCalendarSources, otcCalendarSources), symbol),
          tradingRestrictions(symbol, market),
          eventsFor(symbol, market, limit),
        ]);
        const errors: string[] = [];
        for (const r of [calendar, restrictions, material]) if (r.status === "rejected") errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
        if (calendar.status === "fulfilled") errors.push(...calendar.value.errors);
        if (material.status === "fulfilled") errors.push(...material.value.errors);
        return ok({ source: "TWSE/TPEx OpenAPI", symbol, corporate_actions: calendar.status === "fulfilled" ? calendar.value.datasets.filter((x) => x.rows.length) : [], trading_restrictions: restrictions.status === "fulfilled" ? restrictions.value : null, material_events: material.status === "fulfilled" ? material.value.rows : [], partial_errors: errors });
      } catch (e) { return fail(e); }
    });

    this.server.registerTool("get_short_pressure", {
      description: "整合官方融資融券、借券、當沖、停資停券，搭配FinMind歷史資料判斷空方與籌碼壓力。",
      inputSchema: { symbol: stockSymbol, market: marketChoice.optional().default("auto"), days: z.number().int().min(5).max(120).optional().default(30) },
    }, async ({ symbol, market, days }) => {
      try {
        const [official, margin, lending] = await Promise.allSettled([
          collectPublicSources(sourcesByMarket(market, listedShortSources, otcShortSources), symbol),
          finmind(this.env, "TaiwanStockMarginPurchaseShortSale", { data_id: symbol, start_date: twDate(days * 2), end_date: twDate() }),
          finmind(this.env, "TaiwanStockSecuritiesLending", { data_id: symbol, start_date: twDate(days * 2), end_date: twDate() }),
        ]);
        const errors: string[] = [];
        for (const r of [official, margin, lending]) if (r.status === "rejected") errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
        if (official.status === "fulfilled") errors.push(...official.value.errors);
        const marginRows = margin.status === "fulfilled" ? recent(margin.value.data, days) : [];
        const latest = marginRows.at(-1) ?? null;
        const prev = marginRows.at(-2) ?? null;
        return ok({ source_priority: ["TWSE/TPEx OpenAPI", "FinMind history"], symbol, official_current: official.status === "fulfilled" ? official.value.datasets.filter((x) => x.rows.length) : [], margin_history: marginRows, securities_lending: lending.status === "fulfilled" ? recent(lending.value.data, days) : [], summary: { margin_balance_change: latest && prev ? num(latest.MarginPurchaseTodayBalance) - num(prev.MarginPurchaseTodayBalance) : null, short_balance_change: latest && prev ? num(latest.ShortSaleTodayBalance) - num(prev.ShortSaleTodayBalance) : null }, partial_errors: errors });
      } catch (e) { return fail(e); }
    });

    this.server.registerTool("get_derivatives_sentiment", {
      description: "查詢期交所Put/Call Ratio、三大法人期貨選擇權與大額交易人未平倉，適合盤後大盤情緒。",
      inputSchema: {},
    }, async () => {
      try { return ok({ source: "TAIFEX OpenAPI", retrieved_at: new Date().toISOString(), ...(await derivativesSentiment()) }); }
      catch (e) { return fail(e); }
    });

    this.server.registerTool("analyze_swing_candidate", {
      description: "整合趨勢、營收、財報、TDCC大戶、法人、融資借券、估值、內部人、事件與大盤環境，提供波段候選評估。",
      inputSchema: { symbol: stockSymbol, market: marketChoice.optional().default("auto") },
    }, async ({ symbol, market }) => {
      try {
        const results = await Promise.allSettled([
          finmind(this.env, "TaiwanStockPrice", { data_id: symbol, start_date: twDate(550), end_date: twDate() }),
          finmind(this.env, "TaiwanStockMonthRevenue", { data_id: symbol, start_date: twDate(1_200) }),
          tdccShareholding(symbol),
          finmind(this.env, "TaiwanStockInstitutionalInvestorsBuySell", { data_id: symbol, start_date: twDate(90), end_date: twDate() }),
          finmind(this.env, "TaiwanStockMarginPurchaseShortSale", { data_id: symbol, start_date: twDate(90), end_date: twDate() }),
          collectPublicSources(market === "listed" ? [valuationSources.listed] : market === "otc" ? [valuationSources.otc] : [valuationSources.listed, valuationSources.otc], symbol),
          collectPublicSources(sourcesByMarket(market, listedInsiderSources, otcInsiderSources), symbol),
          eventsFor(symbol, market, 30),
          Promise.allSettled([marketSnapshot(this.env, "TSE"), marketSnapshot(this.env, "OTC")]),
        ]);
        const errors: string[] = [];
        results.forEach((r) => { if (r.status === "rejected") errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason)); });
        const prices = results[0].status === "fulfilled" ? results[0].value.data : [];
        const tech = technicalSwingSummary(prices);
        const revenue = results[1].status === "fulfilled" ? revenueSummary(results[1].value.data) : null;
        const tdcc = results[2].status === "fulfilled" ? results[2].value : null;
        const institutional = results[3].status === "fulfilled" ? results[3].value.data : [];
        const margin = results[4].status === "fulfilled" ? results[4].value.data : [];
        const valuation = results[5].status === "fulfilled" ? results[5].value.datasets.flatMap((x) => x.rows.map(valuationRow)) : [];
        const insider = results[6].status === "fulfilled" ? insiderRisk(results[6].value.datasets) : null;
        const eventsData = results[7].status === "fulfilled" ? results[7].value.rows : [];
        const marketSettled = results[8].status === "fulfilled" ? results[8].value : [];
        const marketRows = marketSettled.flatMap((r: any) => r.status === "fulfilled" ? r.value.rows : []);
        const regimeAgg = aggregateMarket(marketRows);
        const marketRegime = (regimeAgg.advance_decline_ratio ?? 0) >= 1.5 ? "risk_on" : (regimeAgg.advance_decline_ratio ?? 1) <= 0.67 ? "risk_off" : "mixed";
        let fundamentalScore = 50;
        if (revenue?.latest?.yoy_percent >= 20) fundamentalScore += 20; else if (revenue?.latest?.yoy_percent < 0) fundamentalScore -= 15;
        if ((revenue?.positive_yoy_streak_months ?? 0) >= 3) fundamentalScore += 10;
        let chipScore = 50;
        if ((tdcc?.large_holder_1m_change_percentage_points ?? 0) > 0) chipScore += 15; else if ((tdcc?.large_holder_1m_change_percentage_points ?? 0) < 0) chipScore -= 15;
        const instRecent = recent(institutional, 15).reduce((sum: number, x: any) => sum + num(x.buy) - num(x.sell), 0);
        if (instRecent > 0) chipScore += 10; else if (instRecent < 0) chipScore -= 10;
        const latestMargin = margin.at(-1), previousMargin = margin.at(-2);
        if (latestMargin && previousMargin && num(latestMargin.MarginPurchaseTodayBalance) > num(previousMargin.MarginPurchaseTodayBalance) * 1.15) chipScore -= 8;
        let riskPenalty = insider?.risk_level === "high" ? 20 : insider?.risk_level === "medium" ? 10 : 0;
        if (eventsData.length) riskPenalty += 3;
        const environmentScore = marketRegime === "risk_on" ? 75 : marketRegime === "risk_off" ? 30 : 50;
        const total = round(tech.score * 0.35 + Math.max(0, Math.min(100, fundamentalScore)) * 0.25 + Math.max(0, Math.min(100, chipScore)) * 0.25 + environmentScore * 0.15 - riskPenalty);
        return ok({ symbol, retrieved_at: new Date().toISOString(), scores: { trend: tech.score, fundamental: Math.max(0, Math.min(100, fundamentalScore)), chips: Math.max(0, Math.min(100, chipScore)), environment: environmentScore, risk_penalty: riskPenalty, total: Math.max(0, Math.min(100, total)) }, rating: total >= 80 ? "A" : total >= 70 ? "B+" : total >= 60 ? "B" : total >= 50 ? "C" : "D", stance: total >= 75 ? "可列入波段候選，等待合理進場點" : total >= 60 ? "條件中等，需等待技術與籌碼確認" : "目前不宜積極建立波段部位", technical: tech, revenue, tdcc_shareholding: tdcc, institutional_recent: recent(institutional, 30), margin_recent: recent(margin, 30), valuation, insider_risk: insider, material_events: eventsData, market_regime: { regime: marketRegime, breadth: regimeAgg }, partial_errors: errors, caution: "評分是資料整理與風險排序，不是獲利保證或自動下單訊號。" });
      } catch (e) { return fail(e); }
    });
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") return MyMCP.serve("/mcp").fetch(request, env, ctx);
    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json({
        service: "Taiwan Stock AI MCP",
        status: "ok",
        version: "5.0.0",
        mcp_endpoint: "/mcp",
        tools: 22,
      });
    }
    return new Response("Not found", { status: 404 });
  },
};