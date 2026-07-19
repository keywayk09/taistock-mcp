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

export class MyMCP extends McpAgent<Env> {
  server = new McpServer({ name: "Taiwan Stock AI", version: "4.0.0" });

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
      description: "查詢月營收並計算月增、年增、連續成長與營收異常，適合波段基本面追蹤。",
      inputSchema: { symbol: stockSymbol, months: z.number().int().min(13).max(120).optional().default(36) },
    }, async ({ symbol, months }) => {
      try {
        const result = await finmind(this.env, "TaiwanStockMonthRevenue", { data_id: symbol, start_date: twDate(months * 32) });
        return ok({ source: "FinMind", dataset: "TaiwanStockMonthRevenue", symbol, ...revenueSummary(result.data) });
      } catch (e) { return fail(e); }
    });

    this.server.registerTool("get_financial_anomalies", {
      description: "彙整綜合損益表、資產負債表與現金流量表，標示營收、獲利、存貨、應收與現金流異常。",
      inputSchema: { symbol: stockSymbol, start_date: isoDate.optional() },
    }, async ({ symbol, start_date }) => {
      try {
        const start = start_date ?? twDate(1_100);
        const settled = await Promise.allSettled([
          finmind(this.env, "TaiwanStockFinancialStatements", { data_id: symbol, start_date: start }),
          finmind(this.env, "TaiwanStockBalanceSheet", { data_id: symbol, start_date: start }),
          finmind(this.env, "TaiwanStockCashFlowsStatement", { data_id: symbol, start_date: start }),
        ]);
        const errors: string[] = [];
        settled.forEach((x) => { if (x.status === "rejected") errors.push(x.reason instanceof Error ? x.reason.message : String(x.reason)); });
        const income = settled[0].status === "fulfilled" ? settled[0].value.data : [];
        const balance = settled[1].status === "fulfilled" ? settled[1].value.data : [];
        const cash = settled[2].status === "fulfilled" ? settled[2].value.data : [];
        return ok({ source: "FinMind", symbol, start_date: start, ...financialSummary(income, balance, cash), partial_errors: errors });
      } catch (e) { return fail(e); }
    });

    this.server.registerTool("get_shareholding_structure", {
      description: "查詢外資持股、股權持股分級與借券，觀察大戶集中度與中期籌碼；持股分級可能需要FinMind會員權限。",
      inputSchema: { symbol: stockSymbol, start_date: isoDate.optional(), end_date: isoDate.optional() },
    }, async ({ symbol, start_date, end_date }) => {
      try {
        const start = start_date ?? twDate(180);
        const end = end_date ?? twDate();
        const settled = await Promise.allSettled([
          finmind(this.env, "TaiwanStockShareholding", { data_id: symbol, start_date: start, end_date: end }),
          finmind(this.env, "TaiwanStockHoldingSharesPer", { data_id: symbol, start_date: start, end_date: end }),
          finmind(this.env, "TaiwanStockSecuritiesLending", { data_id: symbol, start_date: start, end_date: end }),
        ]);
        const errors: string[] = [];
        settled.forEach((x) => { if (x.status === "rejected") errors.push(x.reason instanceof Error ? x.reason.message : String(x.reason)); });
        const foreign = settled[0].status === "fulfilled" ? settled[0].value.data : [];
        const holding = settled[1].status === "fulfilled" ? settled[1].value.data : [];
        const lending = settled[2].status === "fulfilled" ? settled[2].value.data : [];
        const foreignLatest = foreign.at(-1) ?? null;
        const foreignPrevious = foreign.at(-2) ?? null;
        const holdingDates = ([...new Set(holding.map((x: any) => String(x.date ?? "")))] as string[]).filter(Boolean).sort();
        const latestHolding = holdingDates.at(-1) ? holdingSnapshot(holding, holdingDates.at(-1)!) : null;
        const previousHolding = holdingDates.at(-2) ? holdingSnapshot(holding, holdingDates.at(-2)!) : null;
        return ok({
          source: "FinMind", symbol, start_date: start, end_date: end,
          foreign_shareholding: {
            latest: foreignLatest,
            previous: foreignPrevious,
            ratio_change_percentage_points: foreignLatest && foreignPrevious ? round(num(foreignLatest.ForeignInvestmentSharesRatio) - num(foreignPrevious.ForeignInvestmentSharesRatio), 4) : null,
          },
          holding_distribution: {
            latest: latestHolding,
            previous: previousHolding,
            large_holder_1m_change_percentage_points: latestHolding && previousHolding ? round(latestHolding.percent_1m_shares_or_more - previousHolding.percent_1m_shares_or_more, 4) : null,
          },
          securities_lending: recent(lending, 30),
          partial_errors: errors,
        });
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
        version: "4.0.0",
        mcp_endpoint: "/mcp",
        tools: 16,
      });
    }
    return new Response("Not found", { status: 404 });
  },
};
