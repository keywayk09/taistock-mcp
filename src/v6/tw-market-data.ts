export type TwMarket = "listed" | "otc";
export type TwMarketDataKind = "institutional" | "margin";

export type InstitutionalRow = {
  trade_date: string;
  symbol: string;
  name: string;
  market: TwMarket;
  foreign_net_shares: number;
  trust_net_shares: number;
  dealer_net_shares: number;
  total_net_shares: number;
  source: string;
  source_priority: "OFFICIAL" | "FALLBACK";
};

export type MarginRow = {
  trade_date: string;
  symbol: string;
  name: string;
  market: TwMarket;
  margin_previous_balance_lots: number | null;
  margin_balance_lots: number | null;
  margin_balance_change_lots: number | null;
  short_previous_balance_lots: number | null;
  short_balance_lots: number | null;
  short_balance_change_lots: number | null;
  source: string;
  source_priority: "OFFICIAL" | "FALLBACK";
};

function rec(value: unknown): Record<string, any> {
  return value !== null && typeof value === "object" ? value as Record<string, any> : {};
}

export function marketNumber(value: unknown): number {
  const text = String(value ?? "").replace(/<[^>]*>/g, "").replace(/,/g, "").replace(/\+/g, "").trim();
  if (!text || ["--", "---", "N/A", "null", "undefined"].includes(text)) return 0;
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

function nullableMarketNumber(value: unknown): number | null {
  const text = String(value ?? "").replace(/<[^>]*>/g, "").replace(/,/g, "").replace(/\+/g, "").trim();
  if (!text || ["--", "---", "N/A", "null", "undefined"].includes(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function pad2(value: string | number) { return String(value).padStart(2, "0"); }

export function normalizeTradeDate(value: unknown): string | null {
  const raw = String(value ?? "").replace(/<[^>]*>/g, "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const rocCompact = raw.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (rocCompact) return `${Number(rocCompact[1]) + 1911}-${rocCompact[2]}-${rocCompact[3]}`;
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
  const parts = raw.match(/^(\d{2,4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
  if (parts) {
    let year = Number(parts[1]);
    if (year < 1911) year += 1911;
    if (year >= 1900 && year <= 2200) return `${year}-${pad2(parts[2])}-${pad2(parts[3])}`;
  }
  return null;
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/<[^>]*>/g, "").replace(/[\s_()（）%％/\\.,:：;；\-]/g, "");
}

function findValue(row: Record<string, any>, aliases: string[]): unknown {
  const map = new Map(Object.entries(row).map(([key, value]) => [normalizeKey(key), value]));
  for (const alias of aliases) {
    const key = normalizeKey(alias);
    if (map.has(key)) return map.get(key);
  }
  for (const [key, value] of map) {
    if (aliases.some((alias) => key.includes(normalizeKey(alias)))) return value;
  }
  return undefined;
}

function rowSymbol(row: Record<string, any>) {
  return String(findValue(row, ["證券代號", "證券代碼", "股票代號", "公司代號", "SecuritiesCompanyCode", "Code", "stock_id", "symbol"]) ?? "").trim().replace(/\s/g, "");
}

function rowName(row: Record<string, any>) {
  return String(findValue(row, ["證券名稱", "股票名稱", "公司名稱", "CompanyName", "SecuritiesCompanyName", "Name", "stock_name"]) ?? "").trim();
}

function objectsFromFields(fields: unknown, data: unknown): Record<string, any>[] {
  if (!Array.isArray(fields) || !Array.isArray(data)) return [];
  return data.filter(Array.isArray).map((values: any[]) => Object.fromEntries((fields as any[]).map((field, index) => [String(field), values[index]])));
}

function responseRows(body: unknown): Record<string, any>[] {
  if (Array.isArray(body)) return body.map(rec);
  const root = rec(body);
  if (Array.isArray(root.data) && Array.isArray(root.fields)) return objectsFromFields(root.fields, root.data);
  if (Array.isArray(root.data)) return root.data.map(rec);
  return [];
}

export function normalizeTwseInstitutional(body: unknown, requestedDate: string): InstitutionalRow[] {
  const root = rec(body);
  return responseRows(body).map((row): InstitutionalRow | null => {
    const symbol = rowSymbol(row);
    if (!/^\d{4,6}$/.test(symbol)) return null;
    return {
      trade_date: normalizeTradeDate(root.date) ?? requestedDate,
      symbol,
      name: rowName(row),
      market: "listed",
      foreign_net_shares: marketNumber(findValue(row, ["外陸資買賣超股數(不含外資自營商)", "外陸資買賣超股數", "外資及陸資買賣超股數"])),
      trust_net_shares: marketNumber(findValue(row, ["投信買賣超股數"])),
      dealer_net_shares: marketNumber(findValue(row, ["自營商買賣超股數"])),
      total_net_shares: marketNumber(findValue(row, ["三大法人買賣超股數", "合計買賣超股數"])),
      source: "TWSE_T86",
      source_priority: "OFFICIAL",
    };
  }).filter((x): x is InstitutionalRow => Boolean(x));
}

export function normalizeTpexInstitutional(body: unknown, requestedDate: string): InstitutionalRow[] {
  return responseRows(body).map((row): InstitutionalRow | null => {
    const symbol = rowSymbol(row);
    if (!/^\d{4,6}$/.test(symbol)) return null;
    const tradeDate = normalizeTradeDate(findValue(row, ["Date", "日期", "資料日期", "TradeDate"])) ?? requestedDate;
    const foreign = marketNumber(findValue(row, [
      "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference",
      "ForeignInvestorsincludeMainlandAreaInvestorsForeignDealersexcludedDifference",
      "ForeignInvestorsInclude MainlandAreaInvestors-Difference",
      "外資及陸資買賣超股數", "外陸資買賣超股數",
    ]));
    const trust = marketNumber(findValue(row, ["Securities Investment Trust Companies-Difference", "SecuritiesInvestmentTrustCompaniesDifference", "投信買賣超股數"]));
    const dealer = marketNumber(findValue(row, ["Dealers-Difference", "DealersDifference", "自營商買賣超股數"]));
    const totalRaw = findValue(row, ["Total Difference", "TotalDifference", "三大法人買賣超股數", "合計買賣超股數"]);
    return {
      trade_date: tradeDate,
      symbol,
      name: rowName(row),
      market: "otc",
      foreign_net_shares: foreign,
      trust_net_shares: trust,
      dealer_net_shares: dealer,
      total_net_shares: totalRaw === undefined ? foreign + trust + dealer : marketNumber(totalRaw),
      source: "TPEX_3INSTI_DAILY_TRADING",
      source_priority: "OFFICIAL",
    };
  }).filter((x): x is InstitutionalRow => Boolean(x));
}

function findTwseMarginTable(body: unknown): Record<string, any>[] {
  const root = rec(body);
  if (Array.isArray(root.tables)) {
    for (const tableValue of root.tables) {
      const table = rec(tableValue);
      const title = String(table.title ?? "");
      if (/融資融券彙總|信用交易/.test(title) && Array.isArray(table.fields) && Array.isArray(table.data)) {
        const rows = objectsFromFields(table.fields, table.data);
        if (rows.some((row) => /^\d{4,6}$/.test(rowSymbol(row)))) return rows;
      }
    }
  }
  return responseRows(body);
}

function normalizeMarginRow(row: Record<string, any>, market: TwMarket, tradeDate: string, source: string): MarginRow | null {
  const symbol = rowSymbol(row);
  if (!/^\d{4,6}$/.test(symbol)) return null;
  const marginPrev = nullableMarketNumber(findValue(row, ["融資前日餘額", "融資前日餘額張數", "MarginPurchaseYesterdayBalance", "MarginPurchasePreviousBalance", "MarginPurchaseBalancePreviousDay"]));
  const marginNow = nullableMarketNumber(findValue(row, ["融資今日餘額", "融資今日餘額張數", "MarginPurchaseTodayBalance", "MarginPurchaseBalance"]));
  const marginChangeRaw = nullableMarketNumber(findValue(row, ["融資增減", "融資餘額增減", "MarginPurchaseChange", "MarginPurchaseBalanceChange"]));
  const shortPrev = nullableMarketNumber(findValue(row, ["融券前日餘額", "融券前日餘額張數", "ShortSaleYesterdayBalance", "ShortSalePreviousBalance", "ShortSaleBalancePreviousDay"]));
  const shortNow = nullableMarketNumber(findValue(row, ["融券今日餘額", "融券今日餘額張數", "ShortSaleTodayBalance", "ShortSaleBalance"]));
  const shortChangeRaw = nullableMarketNumber(findValue(row, ["融券增減", "融券餘額增減", "ShortSaleChange", "ShortSaleBalanceChange"]));
  return {
    trade_date: tradeDate,
    symbol,
    name: rowName(row),
    market,
    margin_previous_balance_lots: marginPrev,
    margin_balance_lots: marginNow,
    margin_balance_change_lots: marginChangeRaw ?? (marginNow !== null && marginPrev !== null ? marginNow - marginPrev : null),
    short_previous_balance_lots: shortPrev,
    short_balance_lots: shortNow,
    short_balance_change_lots: shortChangeRaw ?? (shortNow !== null && shortPrev !== null ? shortNow - shortPrev : null),
    source,
    source_priority: "OFFICIAL",
  };
}

export function normalizeTwseMargin(body: unknown, requestedDate: string): MarginRow[] {
  const root = rec(body);
  const rows = findTwseMarginTable(body);
  const tradeDate = normalizeTradeDate(root.date) ?? requestedDate;
  return rows.map((row) => normalizeMarginRow(row, "listed", tradeDate, "TWSE_MI_MARGN")).filter((x): x is MarginRow => Boolean(x));
}

export function normalizeTpexMargin(body: unknown, requestedDate: string): MarginRow[] {
  return responseRows(body).map((row) => {
    const tradeDate = normalizeTradeDate(findValue(row, ["Date", "日期", "資料日期", "TradeDate"])) ?? requestedDate;
    return normalizeMarginRow(row, "otc", tradeDate, "TPEX_MAINBOARD_MARGIN_BALANCE");
  }).filter((x): x is MarginRow => Boolean(x));
}

const WINDOWS = [1,3,5,10,20] as const;

export function institutionalWindows(rows: InstitutionalRow[]) {
  const sorted = [...rows].sort((a,b)=>a.trade_date.localeCompare(b.trade_date));
  const sums = (n:number) => {
    const slice = sorted.slice(-n);
    return {
      days:slice.length,
      foreign_net_shares:slice.reduce((s,x)=>s+x.foreign_net_shares,0),
      trust_net_shares:slice.reduce((s,x)=>s+x.trust_net_shares,0),
      dealer_net_shares:slice.reduce((s,x)=>s+x.dealer_net_shares,0),
      total_net_shares:slice.reduce((s,x)=>s+x.total_net_shares,0),
    };
  };
  return Object.fromEntries(WINDOWS.map((n)=>[`${n}d`,sums(n)]));
}

export function marginWindows(rows: MarginRow[]) {
  const sorted = [...rows].sort((a,b)=>a.trade_date.localeCompare(b.trade_date));
  const latest = sorted.at(-1) ?? null;
  const sums = (n:number) => {
    const slice = sorted.slice(-n);
    return {
      days:slice.length,
      margin_balance_change_lots:slice.reduce((s,x)=>s+(x.margin_balance_change_lots ?? 0),0),
      short_balance_change_lots:slice.reduce((s,x)=>s+(x.short_balance_change_lots ?? 0),0),
    };
  };
  return { latest, windows:Object.fromEntries(WINDOWS.map((n)=>[`${n}d`,sums(n)])) };
}
