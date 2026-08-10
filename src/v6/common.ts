import { z } from "zod";

declare global {
  interface Env {
    FUGLE_API_KEY: string;
    FINMIND_TOKEN: string;
    DB: D1Database;
  }
}

export type Obj = Record<string, any>;
export type DailyBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export const stockSchema = z.string().trim().min(1).max(20).regex(/^[0-9A-Za-z._-]+$/);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const watchlistNameSchema = z.string().trim().min(1).max(50);

export const ok = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export const fail = (error: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: `查詢失敗：${error instanceof Error ? error.message : String(error)}` }],
});

export function rec(value: unknown): Obj {
  return value !== null && typeof value === "object" ? value as Obj : {};
}

export function arr(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  const root = rec(value);
  return Array.isArray(root.data) ? root.data : [];
}

export function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

export function taipeiDate(daysAgo = 0): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() - daysAgo * 86_400_000));
}

export async function fetchJson(url: string | URL, init: RequestInit, source: string): Promise<any> {
  const started = Date.now();
  const response = await fetch(url, init);
  const text = await response.text();
  let body: any = text;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const root = rec(body);
    throw new Error(`${source} HTTP ${response.status}: ${String(root.message ?? root.msg ?? root.error ?? text.slice(0, 300))}`);
  }
  return { body, latency_ms: Date.now() - started };
}

const OFFICIAL_USER_AGENT = "taistock-mcp/8.4 (+https://github.com/keywayk09/taistock-mcp)";
const OFFICIAL_FINMIND_DATASETS = new Set([
  "TaiwanStockMonthRevenue",
  "TaiwanStockFinancialStatements",
  "TaiwanStockBalanceSheet",
  "TaiwanStockInstitutionalInvestorsBuySell",
  "TaiwanStockCashFlowsStatement",
  "TaiwanStockPrice",
]);
const FINANCIAL_SUFFIXES = ["ci", "mim", "basi", "fh", "ins", "bd"] as const;

function officialKey(value: string) {
  return value.toLowerCase().replace(/[\s_()（）%％:：/\\.\-]/g, "");
}

function officialPick(row: Obj, aliases: string[]) {
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const target = officialKey(alias);
    const exact = keys.find((key) => officialKey(key) === target);
    if (exact) return row[exact];
  }
  for (const alias of aliases) {
    const target = officialKey(alias);
    const fuzzy = keys.find((key) => officialKey(key).includes(target));
    if (fuzzy) return row[fuzzy];
  }
  return null;
}

function officialNumber(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!text || text === "-" || text === "--" || text === "N/A") return null;
  const negative = /^\(.*\)$/.test(text);
  const parsed = Number(text.replace(/,/g, "").replace(/%$/, "").replace(/[()]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

function officialSymbol(row: Obj) {
  return String(officialPick(row, [
    "公司代號", "公司代碼", "證券代號", "股票代號", "SecuritiesCompanyCode", "SecuritiesCompanyID",
    "Code", "stock_id", "symbol",
  ]) ?? "").replace(/\s/g, "");
}

function officialRocYear(value: number) {
  return value > 0 && value < 1911 ? value + 1911 : value;
}

function officialYearMonth(row: Obj) {
  const raw = String(officialPick(row, ["資料年月", "年月", "RevenueYearMonth"]) ?? "").replace(/[^0-9]/g, "");
  if (raw.length >= 5) {
    const month = Number(raw.slice(-2));
    const year = officialRocYear(Number(raw.slice(0, -2)));
    if (year && month >= 1 && month <= 12) return { year, month };
  }
  const yearRaw = officialNumber(officialPick(row, ["資料年度", "年度", "RevenueYear"]));
  const month = officialNumber(officialPick(row, ["資料月份", "月份", "RevenueMonth"]));
  return yearRaw && month && month >= 1 && month <= 12 ? { year: officialRocYear(yearRaw), month } : null;
}

function officialReportDate(row: Obj) {
  const yearRaw = officialNumber(officialPick(row, ["年度", "資料年度", "Year", "FiscalYear"]));
  const quarter = officialNumber(officialPick(row, ["季別", "季度", "Season", "Quarter"]));
  const year = yearRaw == null ? null : officialRocYear(yearRaw);
  if (year && quarter) {
    const month = Math.min(12, Math.max(1, quarter * 3));
    return `${year}-${String(month).padStart(2, "0")}-01`;
  }
  return year ? `${year}-12-31` : taipeiDate();
}

async function officialRows(url: string, source: string) {
  const { body } = await fetchJson(url, { headers: { Accept: "application/json", "User-Agent": OFFICIAL_USER_AGENT } }, source);
  if (Array.isArray(body)) return body.map(rec);
  return arr(body).map(rec);
}

async function officialCompanyMarket(env: Env, symbol: string): Promise<"TWSE" | "TPEX" | "ESB" | null> {
  try {
    const row = await env.DB.prepare("SELECT exchange FROM global_companies WHERE country = 'TW' AND ticker = ? AND status = 'active' ORDER BY exchange = 'TWSE' DESC LIMIT 1")
      .bind(symbol).first<{ exchange: string }>();
    const exchange = String(row?.exchange ?? "").toUpperCase();
    if (exchange === "TWSE" || exchange === "TPEX" || exchange === "ESB") return exchange;
  } catch {}
  return null;
}

async function officialFindRow(url: string, source: string, symbol: string) {
  return (await officialRows(url, source)).find((row) => officialSymbol(row) === symbol) ?? null;
}

async function officialMonthRevenue(env: Env, symbol: string) {
  const market = await officialCompanyMarket(env, symbol);
  const candidates = market === "TWSE"
    ? [{ url: "https://openapi.twse.com.tw/v1/opendata/t187ap05_L", source: "TWSE/MOPS 月營收" }]
    : market === "TPEX" || market === "ESB"
      ? [{ url: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O", source: "TPEx/MOPS 月營收" }]
      : [
          { url: "https://openapi.twse.com.tw/v1/opendata/t187ap05_L", source: "TWSE/MOPS 月營收" },
          { url: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O", source: "TPEx/MOPS 月營收" },
        ];
  for (const candidate of candidates) {
    const row = await officialFindRow(candidate.url, candidate.source, symbol);
    if (!row) continue;
    const ym = officialYearMonth(row);
    if (!ym) return [];
    const revenue = officialNumber(officialPick(row, ["營業收入-當月營收", "當月營收", "本月營業收入", "營業收入", "CurrentMonthRevenue"]));
    const previous = officialNumber(officialPick(row, ["營業收入-上月營收", "上月營收", "PreviousMonthRevenue"]));
    const lastYear = officialNumber(officialPick(row, ["營業收入-去年當月營收", "去年當月營收", "LastYearMonthRevenue"]));
    const currentDate = `${ym.year}-${String(ym.month).padStart(2, "0")}-01`;
    const previousDateObject = new Date(`${currentDate}T00:00:00Z`);
    previousDateObject.setUTCMonth(previousDateObject.getUTCMonth() - 1);
    const previousDate = previousDateObject.toISOString().slice(0, 10);
    const lastYearDate = `${ym.year - 1}-${String(ym.month).padStart(2, "0")}-01`;
    return [
      ...(lastYear != null ? [{
        date: lastYearDate,
        stock_id: symbol,
        revenue_year: ym.year - 1,
        revenue_month: ym.month,
        revenue: lastYear,
        _source: candidate.source,
        _source_url: candidate.url,
      }] : []),
      ...(previous != null ? [{
        date: previousDate,
        stock_id: symbol,
        revenue_year: Number(previousDate.slice(0, 4)),
        revenue_month: Number(previousDate.slice(5, 7)),
        revenue: previous,
        _source: candidate.source,
        _source_url: candidate.url,
      }] : []),
      ...(revenue != null ? [{
        date: currentDate,
        stock_id: symbol,
        revenue_year: ym.year,
        revenue_month: ym.month,
        revenue,
        yoy_percent_official: officialNumber(officialPick(row, ["營業收入-去年同月增減(%)", "去年同月增減百分比", "YoY"])),
        mom_percent_official: officialNumber(officialPick(row, ["營業收入-上月比較增減(%)", "上月比較增減百分比", "MoM"])),
        _source: candidate.source,
        _source_url: candidate.url,
        _raw: row,
      }] : []),
    ];
  }
  return [];
}

function officialFinancialUrls(market: "TWSE" | "TPEX" | "ESB" | null, statement: "income" | "balance") {
  const code = statement === "income" ? "06" : "07";
  const listed = FINANCIAL_SUFFIXES.map((suffix) => ({
    url: `https://openapi.twse.com.tw/v1/opendata/t187ap${code}_L_${suffix}`,
    source: `TWSE/MOPS ${statement === "income" ? "綜合損益表" : "資產負債表"}`,
  }));
  const tpexMarket = market === "ESB" ? "U" : "O";
  const otc = FINANCIAL_SUFFIXES.map((suffix) => ({
    url: `https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap${code}_${tpexMarket}_${suffix}`,
    source: `TPEx/MOPS ${statement === "income" ? "綜合損益表" : "資產負債表"}`,
  }));
  return market === "TWSE" ? listed : market === "TPEX" || market === "ESB" ? otc : [...listed, ...otc];
}

async function officialFinancialRow(env: Env, symbol: string, statement: "income" | "balance") {
  const market = await officialCompanyMarket(env, symbol);
  for (const candidate of officialFinancialUrls(market, statement)) {
    try {
      const row = await officialFindRow(candidate.url, candidate.source, symbol);
      if (row) return { ...candidate, row };
    } catch {}
  }
  return null;
}

function finmindMetric(date: string, symbol: string, type: string, value: number | null, source: string, sourceUrl: string, raw?: Obj) {
  return value == null ? null : {
    date,
    stock_id: symbol,
    type,
    origin_name: type,
    name: type,
    value,
    _source: source,
    _source_url: sourceUrl,
    ...(raw ? { _raw: raw } : {}),
  };
}

async function officialIncomeStatement(env: Env, symbol: string) {
  const found = await officialFinancialRow(env, symbol, "income");
  if (!found) return [];
  const row = found.row;
  const date = officialReportDate(row);
  return [
    finmindMetric(date, symbol, "OperatingRevenue", officialNumber(officialPick(row, ["營業收入", "營業收入合計", "收益", "OperatingRevenue", "Revenue"])), found.source, found.url, row),
    finmindMetric(date, symbol, "GrossProfit", officialNumber(officialPick(row, ["營業毛利（毛損）", "營業毛利(毛損)", "營業毛利", "GrossProfitLoss", "GrossProfit"])), found.source, found.url),
    finmindMetric(date, symbol, "OperatingIncome", officialNumber(officialPick(row, ["營業利益（損失）", "營業利益(損失)", "營業利益", "ProfitLossFromOperatingActivities", "OperatingIncome"])), found.source, found.url),
    finmindMetric(date, symbol, "NonOperatingIncome", officialNumber(officialPick(row, ["營業外收入及支出", "營業外收入及支出合計", "NonoperatingIncomeAndExpenses"])), found.source, found.url),
    finmindMetric(date, symbol, "NetIncome", officialNumber(officialPick(row, ["本期淨利（淨損）", "本期淨利(淨損)", "本期淨利", "本期稅後淨利", "歸屬於母公司業主之淨利（損）", "ProfitLoss", "NetIncome"])), found.source, found.url),
    finmindMetric(date, symbol, "BasicEarningsPerShare", officialNumber(officialPick(row, ["基本每股盈餘（元）", "基本每股盈餘(元)", "基本每股盈餘", "每股盈餘", "BasicEarningsLossPerShare"])), found.source, found.url),
    finmindMetric(date, symbol, "InterestExpense", officialNumber(officialPick(row, ["利息費用", "InterestExpense"])), found.source, found.url),
  ].filter(Boolean);
}

async function officialBalanceSheet(env: Env, symbol: string) {
  const found = await officialFinancialRow(env, symbol, "balance");
  if (!found) return [];
  const row = found.row;
  const date = officialReportDate(row);
  return [
    finmindMetric(date, symbol, "TotalAssets", officialNumber(officialPick(row, ["資產總額", "資產合計", "TotalAssets"])), found.source, found.url, row),
    finmindMetric(date, symbol, "TotalLiabilities", officialNumber(officialPick(row, ["負債總額", "負債合計", "TotalLiabilities"])), found.source, found.url),
    finmindMetric(date, symbol, "TotalEquity", officialNumber(officialPick(row, ["權益總額", "權益合計", "TotalEquity"])), found.source, found.url),
    finmindMetric(date, symbol, "CurrentAssets", officialNumber(officialPick(row, ["流動資產", "流動資產合計", "CurrentAssets"])), found.source, found.url),
    finmindMetric(date, symbol, "CurrentLiabilities", officialNumber(officialPick(row, ["流動負債", "流動負債合計", "CurrentLiabilities"])), found.source, found.url),
    finmindMetric(date, symbol, "CashAndCashEquivalents", officialNumber(officialPick(row, ["現金及約當現金", "CashAndCashEquivalents"])), found.source, found.url),
    finmindMetric(date, symbol, "Inventory", officialNumber(officialPick(row, ["存貨", "存貨淨額", "Inventory"])), found.source, found.url),
    finmindMetric(date, symbol, "AccountsReceivable", officialNumber(officialPick(row, ["應收帳款淨額", "應收帳款", "AccountsReceivableNet"])), found.source, found.url),
  ].filter(Boolean);
}

function officialJsonTable(table: unknown): Obj[] {
  const root = rec(table);
  const fields = Array.isArray(root.fields) ? root.fields.map((value: unknown) => String(value).trim()) : [];
  const data = Array.isArray(root.data) ? root.data : [];
  return data.map((raw: unknown) => {
    const values = Array.isArray(raw) ? raw : [];
    return Object.fromEntries(fields.map((field: string, index: number) => [field, values[index] ?? null]));
  });
}

function officialCompactDate(date: string) {
  return date.replaceAll("-", "");
}

function officialShiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function institutionalRowsFromRaw(symbol: string, date: string, row: Obj, source: string, sourceUrl: string) {
  const metric = (name: string, buyAliases: string[], sellAliases: string[], netAliases: string[]) => {
    const buy = officialNumber(officialPick(row, buyAliases)) ?? 0;
    const sell = officialNumber(officialPick(row, sellAliases)) ?? 0;
    const net = officialNumber(officialPick(row, netAliases)) ?? buy - sell;
    return { date, stock_id: symbol, name, buy, sell, buy_sell: net, _source: source, _source_url: sourceUrl, _raw: row };
  };
  return [
    metric("外資及陸資", ["外陸資買進股數(不含外資自營商)", "外資及陸資買進股數", "ForeignInvestorBuy"], ["外陸資賣出股數(不含外資自營商)", "外資及陸資賣出股數", "ForeignInvestorSell"], ["外陸資買賣超股數(不含外資自營商)", "外資及陸資買賣超股數", "ForeignInvestorNetBuySell"]),
    metric("投信", ["投信買進股數", "InvestmentTrustBuy"], ["投信賣出股數", "InvestmentTrustSell"], ["投信買賣超股數", "InvestmentTrustNetBuySell"]),
    metric("自營商", ["自營商買進股數", "DealerBuy"], ["自營商賣出股數", "DealerSell"], ["自營商買賣超股數", "DealerNetBuySell"]),
  ];
}

function tdccLevel(row: Obj) {
  const raw = String(officialPick(row, ["持股分級", "持股/單位數分級", "HoldingSharesLevel", "持股級距", "Level"]) ?? "").trim();
  const numeric = Number(raw.match(/^\d+/)?.[0] ?? NaN);
  const numbers = raw.replace(/,/g, "").match(/\d+/g)?.map(Number) ?? [];
  return {
    numeric: Number.isFinite(numeric) ? numeric : null,
    minimumShares: numbers.length >= 2 ? numbers[0] : raw.includes("以上") && numbers.length ? numbers[0] : null,
  };
}

async function officialTdccRows(symbol: string) {
  const url = "https://openapi.tdcc.com.tw/v1/opendata/1-5";
  try {
    const rows = (await officialRows(url, "TDCC 集保戶股權分散表")).filter((row) => officialSymbol(row) === symbol);
    if (!rows.length) return [];
    const date = String(officialPick(rows[0], ["資料日期", "DataDate", "Date"]) ?? taipeiDate());
    const normalized = rows.map((row) => {
      const level = tdccLevel(row);
      return {
        level,
        holders: officialNumber(officialPick(row, ["人數", "持有人數", "NumberOfHolders", "Holders"])) ?? 0,
        shares: officialNumber(officialPick(row, ["股數", "持有股數", "Shares", "NumberOfShares"])) ?? 0,
        ratio: officialNumber(officialPick(row, ["占集保庫存數比例%", "占集保庫存數比例", "占集保庫存比例", "Percent", "Ratio"])) ?? 0,
      };
    });
    const over400 = normalized.filter((item) => (item.level.numeric != null && item.level.numeric >= 12 && item.level.numeric <= 15) || (item.level.minimumShares != null && item.level.minimumShares >= 400_000));
    const over1000 = normalized.filter((item) => (item.level.numeric != null && item.level.numeric === 15) || (item.level.minimumShares != null && item.level.minimumShares >= 1_000_000));
    const ratio = (items: typeof normalized) => round(items.reduce((sum, item) => sum + item.ratio, 0), 4);
    return [
      { date, stock_id: symbol, name: "TDCC 400張以上持股比率(%)", buy: 0, sell: 0, buy_sell: ratio(over400), metric_type: "holder_distribution", _source: "TDCC", _source_url: url },
      { date, stock_id: symbol, name: "TDCC 1000張以上持股比率(%)", buy: 0, sell: 0, buy_sell: ratio(over1000), metric_type: "holder_distribution", _source: "TDCC", _source_url: url },
    ];
  } catch {
    return [];
  }
}

async function officialInstitutional(env: Env, symbol: string, endDate: string) {
  const market = await officialCompanyMarket(env, symbol);
  if (market === "TWSE" || market === null) {
    for (let offset = 0; offset <= 10; offset++) {
      const date = officialShiftDate(endDate, -offset);
      const url = new URL("https://www.twse.com.tw/rwd/zh/fund/T86");
      url.searchParams.set("response", "json");
      url.searchParams.set("date", officialCompactDate(date));
      url.searchParams.set("selectType", "ALLBUT0999");
      try {
        const { body } = await fetchJson(url, { headers: { Accept: "application/json", "User-Agent": OFFICIAL_USER_AGENT } }, "TWSE 個股三大法人");
        if (rec(body).stat !== "OK") continue;
        const row = officialJsonTable(body).find((item) => officialSymbol(item) === symbol);
        if (row) return [...institutionalRowsFromRaw(symbol, date, row, "TWSE", url.toString()), ...await officialTdccRows(symbol)];
      } catch {}
    }
  }
  if (market === "TPEX" || market === "ESB" || market === null) {
    const sourceUrl = "https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading";
    try {
      const row = await officialFindRow(sourceUrl, "TPEx 個股三大法人", symbol);
      if (row) {
        const date = String(officialPick(row, ["Date", "日期", "資料日期"]) ?? endDate);
        return [...institutionalRowsFromRaw(symbol, date, row, "TPEx", sourceUrl), ...await officialTdccRows(symbol)];
      }
    } catch {}
  }
  return await officialTdccRows(symbol);
}

async function officialFinmindDataset(env: Env, dataset: string, params: Obj): Promise<{ handled: boolean; data: any[] }> {
  const symbol = String(params.data_id ?? params.stock_id ?? "").trim();
  if (!symbol || !OFFICIAL_FINMIND_DATASETS.has(dataset)) return { handled: false, data: [] };
  if (dataset === "TaiwanStockMonthRevenue") return { handled: true, data: await officialMonthRevenue(env, symbol) };
  if (dataset === "TaiwanStockFinancialStatements") return { handled: true, data: await officialIncomeStatement(env, symbol) };
  if (dataset === "TaiwanStockBalanceSheet") return { handled: true, data: await officialBalanceSheet(env, symbol) };
  if (dataset === "TaiwanStockInstitutionalInvestorsBuySell") return { handled: true, data: await officialInstitutional(env, symbol, String(params.end_date ?? taipeiDate())) };
  // TWSE/TPEx目前免費OpenAPI沒有與既有格式等價的完整現金流量表及120日個股價量序列。
  // 這兩項保留FinMind作選用備援；備援不可用時回傳空陣列，避免把授權錯誤當成分析結論。
  if (dataset === "TaiwanStockCashFlowsStatement" || dataset === "TaiwanStockPrice") return { handled: true, data: [] };
  return { handled: false, data: [] };
}

async function callFinMind(env: Env, dataset: string, params: Obj): Promise<any[]> {
  if (!env.FINMIND_TOKEN) throw new Error("FINMIND_TOKEN 尚未設定");
  const url = new URL("https://api.finmindtrade.com/api/v4/data");
  url.searchParams.set("dataset", dataset);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  const { body } = await fetchJson(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${env.FINMIND_TOKEN}` },
  }, `FinMind ${dataset}`);
  if (!Array.isArray(body?.data)) throw new Error(`FinMind ${dataset} 回傳缺少 data`);
  return body.data;
}

export async function finmind(env: Env, dataset: string, params: Obj): Promise<any[]> {
  let official: { handled: boolean; data: any[] } = { handled: false, data: [] };
  try { official = await officialFinmindDataset(env, dataset, params); } catch (error) {
    console.warn(`Official-first adapter ${dataset} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (official.handled && official.data.length) return official.data;
  try {
    const fallback = await callFinMind(env, dataset, params);
    if (fallback.length) return fallback;
  } catch (error) {
    if (!official.handled) throw error;
    console.warn(`FinMind optional fallback ${dataset} unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return official.handled ? official.data : [];
}

export async function fugle(env: Env, path: string, query: Obj = {}): Promise<any> {
  if (!env.FUGLE_API_KEY) throw new Error("FUGLE_API_KEY 尚未設定");
  const url = new URL(`https://api.fugle.tw/marketdata/v1.0/stock${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  const { body } = await fetchJson(url, {
    headers: { Accept: "application/json", "X-API-KEY": env.FUGLE_API_KEY },
  }, "Fugle");
  return body;
}

export function normalizeQuote(raw: unknown, requestedSymbol: string) {
  const root = rec(raw);
  const data = rec(root.data ?? raw);
  const total = rec(data.total);
  const lastTrade = rec(data.lastTrade);
  const open = num(data.openPrice ?? data.open);
  const high = num(data.highPrice ?? data.high);
  const low = num(data.lowPrice ?? data.low);
  const close = num(data.closePrice ?? data.lastPrice ?? lastTrade.price ?? data.price);
  const previousClose = num(data.previousClose ?? data.referencePrice ?? data.previousClosePrice);
  const change = num(data.change ?? (close && previousClose ? close - previousClose : 0));
  const changePercent = Number.isFinite(Number(data.changePercent))
    ? num(data.changePercent)
    : previousClose ? round(change / previousClose * 100) : 0;
  return {
    symbol: String(data.symbol ?? root.symbol ?? requestedSymbol),
    name: String(data.name ?? root.name ?? ""),
    open,
    high,
    low,
    close,
    previous_close: previousClose,
    change,
    change_percent: changePercent,
    trade_volume: num(data.tradeVolume ?? total.tradeVolume ?? total.volume),
    trade_value: num(data.tradeValue ?? total.tradeValue ?? total.value),
    intraday_position: high > low ? round((close - low) / (high - low) * 100) : null,
    last_updated: data.lastUpdated ?? root.lastUpdated ?? null,
  };
}

export function normalizeDailyBars(rows: any[]): DailyBar[] {
  return rows.map((row) => ({
    date: String(row.date ?? row.Date ?? ""),
    open: num(row.open ?? row.Open),
    high: num(row.max ?? row.high ?? row.High),
    low: num(row.min ?? row.low ?? row.Low),
    close: num(row.close ?? row.Close),
    volume: num(row.Trading_Volume ?? row.volume ?? row.Volume),
  })).filter((bar) => bar.date && bar.close > 0).sort((a, b) => a.date.localeCompare(b.date));
}

export function returnPct(current: number, base: number): number | null {
  return base ? round((current / base - 1) * 100, 2) : null;
}

export function technicalSummary(bars: DailyBar[]) {
  const latest = bars.at(-1);
  if (!latest) return { latest: null, score: 0 };
  const avg = (n: number) => {
    const sample = bars.slice(-n);
    return sample.length ? sample.reduce((sum, bar) => sum + bar.close, 0) / sample.length : 0;
  };
  const sma20 = avg(20), sma60 = avg(60), sma120 = avg(120);
  const base20 = bars.at(-21)?.close ?? 0;
  const base60 = bars.at(-61)?.close ?? 0;
  const base120 = bars.at(-121)?.close ?? 0;
  const returns = bars.slice(-61).map((bar, i, all) => i ? Math.log(bar.close / all[i - 1].close) : 0).slice(1);
  const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length ? returns.reduce((sum, x) => sum + (x - mean) ** 2, 0) / returns.length : 0;
  const volatility60 = round(Math.sqrt(variance) * Math.sqrt(252) * 100, 2);
  let peak = bars[0]?.close ?? latest.close, maxDrawdown = 0;
  for (const bar of bars) {
    peak = Math.max(peak, bar.close);
    maxDrawdown = Math.min(maxDrawdown, bar.close / peak - 1);
  }
  const trueRanges = bars.slice(-15).map((bar, i, list) => {
    const prevClose = i ? list[i - 1].close : bar.close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose));
  });
  const atr14 = trueRanges.length ? trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length : 0;
  let score = 50;
  if (latest.close > sma20) score += 10; else score -= 10;
  if (sma20 > sma60) score += 10; else score -= 10;
  if (sma60 > sma120) score += 10; else score -= 10;
  const r60 = returnPct(latest.close, base60) ?? 0;
  if (r60 > 10) score += 10; else if (r60 < -10) score -= 10;
  return {
    latest,
    sma20: round(sma20),
    sma60: round(sma60),
    sma120: round(sma120),
    return_20d_percent: returnPct(latest.close, base20),
    return_60d_percent: returnPct(latest.close, base60),
    return_120d_percent: returnPct(latest.close, base120),
    annualized_volatility_60d_percent: volatility60,
    max_drawdown_percent: round(maxDrawdown * 100, 2),
    atr14: round(atr14, 4),
    score: Math.max(0, Math.min(100, score)),
  };
}

let schemaReady = false;
let schemaInit: Promise<void> | null = null;

export function requireDb(env: Env): D1Database {
  if (!env.DB) throw new Error("D1 儲存尚未綁定；等待 Cloudflare 自動建立 DB，或在 Worker Bindings 將 D1 綁定名稱設為 DB");
  return env.DB;
}

export async function ensureSchema(env: Env): Promise<D1Database> {
  const db = requireDb(env);
  if (schemaReady) return db;

  if (!schemaInit) {
    schemaInit = (async () => {
      const statements = [
        `CREATE TABLE IF NOT EXISTS watchlists (
          name TEXT PRIMARY KEY,
          description TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS watchlist_items (
          watchlist_name TEXT NOT NULL,
          symbol TEXT NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          tags_json TEXT NOT NULL DEFAULT '[]',
          target_price REAL,
          stop_price REAL,
          added_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (watchlist_name, symbol)
        )`,
        "CREATE INDEX IF NOT EXISTS idx_watchlist_items_symbol ON watchlist_items(symbol)",
        `CREATE TABLE IF NOT EXISTS watchlist_snapshots (
          watchlist_name TEXT NOT NULL,
          symbol TEXT NOT NULL,
          snapshot_date TEXT NOT NULL,
          close REAL,
          change_percent REAL,
          trade_value REAL,
          score REAL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (watchlist_name, symbol, snapshot_date)
        )`,
        `CREATE TABLE IF NOT EXISTS stock_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          event_type TEXT NOT NULL,
          event_date TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'manual',
          title TEXT NOT NULL DEFAULT '',
          payload_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        )`,
        "CREATE INDEX IF NOT EXISTS idx_stock_events_symbol_date ON stock_events(symbol, event_date)",
        `CREATE TABLE IF NOT EXISTS event_outcomes (
          event_id INTEGER PRIMARY KEY,
          reference_price REAL,
          return_1d REAL,
          return_5d REAL,
          return_20d REAL,
          return_60d REAL,
          mfe_20d REAL,
          mae_20d REAL,
          mfe_60d REAL,
          mae_60d REAL,
          evaluated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS portfolios (
          name TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS portfolio_positions (
          portfolio_name TEXT NOT NULL,
          symbol TEXT NOT NULL,
          quantity REAL NOT NULL,
          avg_price REAL NOT NULL,
          stop_price REAL,
          sector TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL,
          PRIMARY KEY (portfolio_name, symbol)
        )`,
      ];

      await db.batch(statements.map((statement) => db.prepare(statement)));
      schemaReady = true;
    })().catch((error) => {
      schemaInit = null;
      throw error;
    });
  }

  await schemaInit;
  return db;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  try { return typeof value === "string" ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

export async function concurrencyMap<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try { results[index] = { status: "fulfilled", value: await fn(items[index], index) }; }
      catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  });
  await Promise.all(workers);
  return results;
}
