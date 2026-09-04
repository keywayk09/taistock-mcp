export type TwMarket = "listed" | "otc";
export type TwMarketDataKind = "institutional" | "margin" | "securities_lending" | "sbl_short_sale";

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

export type SecuritiesLendingRow = {
  trade_date: string;
  symbol: string;
  name: string;
  market: TwMarket;
  previous_balance_shares: number | null;
  borrowed_shares: number | null;
  returned_shares: number | null;
  balance_shares: number | null;
  close_price: number | null;
  balance_value: number | null;
  source: string;
  source_priority: "OFFICIAL";
};

export type SblShortSaleRow = {
  trade_date: string;
  symbol: string;
  name: string;
  market: TwMarket;
  previous_balance_shares: number | null;
  sold_shares: number | null;
  returned_shares: number | null;
  adjustment_shares: number | null;
  balance_shares: number | null;
  available_shares: number | null;
  sold_volume_shares: number | null;
  sold_amount: number | null;
  source: string;
  source_priority: "OFFICIAL";
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

function twseMarketFromLabel(value: unknown): TwMarket {
  return /櫃|otc/i.test(String(value ?? "")) ? "otc" : "listed";
}

export function normalizeTwseSecuritiesLending(body: unknown, requestedDate: string): SecuritiesLendingRow[] {
  const root = rec(body);
  const tradeDate = normalizeTradeDate(root.date) ?? requestedDate;
  return responseRows(body).map((row): SecuritiesLendingRow | null => {
    const symbol = rowSymbol(row);
    if (!/^\d{4,6}$/.test(symbol)) return null;
    const market = twseMarketFromLabel(findValue(row, ["市場別", "Market"]));
    return {
      trade_date: tradeDate,
      symbol,
      name: rowName(row),
      market,
      previous_balance_shares: nullableMarketNumber(findValue(row, ["前日借券餘額(1)股", "昨日借券餘額", "前日借券餘額"])),
      borrowed_shares: nullableMarketNumber(findValue(row, ["本日異動股借券(2)", "今日新增借券股數", "本日借券"])),
      returned_shares: nullableMarketNumber(findValue(row, ["本日異動股還券(3)", "今日還券了結股數(含其他了結)", "本日還券"])),
      balance_shares: nullableMarketNumber(findValue(row, ["本日借券餘額股(4)=(1)+(2)-(3)", "今日借券餘額(股數)", "本日借券餘額"])),
      close_price: nullableMarketNumber(findValue(row, ["本日收盤價(5)單位：元", "當日收盤價", "本日收盤價"])),
      balance_value: nullableMarketNumber(findValue(row, ["借券餘額市值單位：元(6)=(4)*(5)", "今日借券餘額(總金額)", "借券餘額市值"])),
      source: "TWSE_TWT72U",
      source_priority: "OFFICIAL",
    };
  }).filter((x): x is SecuritiesLendingRow => Boolean(x));
}

function twseTwt93Rows(body: unknown) {
  return responseRows(body);
}

function includesNormalizedField(field: string, parts: string[]) {
  const normalized = normalizeKey(field);
  return parts.every((part) => normalized.includes(normalizeKey(part)));
}

export function assertTwseTwt93uSchema(body: unknown) {
  const root = rec(body);
  const fields = Array.isArray(root.fields) ? root.fields.map(String) : [];
  const data = Array.isArray(root.data) ? root.data : [];
  if (!data.length) return;
  const valid = fields.length >= 14
    && includesNormalizedField(fields[0] ?? "", ["代號"])
    && includesNormalizedField(fields[8] ?? "", ["前日", "餘額"])
    && includesNormalizedField(fields[9] ?? "", ["賣出"])
    && includesNormalizedField(fields[10] ?? "", ["還券"])
    && includesNormalizedField(fields[11] ?? "", ["調整"])
    && includesNormalizedField(fields[12] ?? "", ["餘額"])
    && includesNormalizedField(fields[13] ?? "", ["限額"]);
  if (!valid) throw new Error("twt93u_schema_mismatch");
}

export function normalizeTwseSblShortSale(body: unknown, requestedDate: string): SblShortSaleRow[] {
  const root = rec(body);
  const tradeDate = normalizeTradeDate(root.date) ?? requestedDate;
  const fields = Array.isArray(root.fields) ? root.fields.map(String) : [];
  const rows = Array.isArray(root.data) ? root.data.filter(Array.isArray) as unknown[][] : [];
  assertTwseTwt93uSchema(body);
  // TWT93U contains two groups with duplicate field names. The SBL group is the second
  // set: 前日餘額、當日賣出、當日還券、當日調整、當日餘額、次一營業日可限額.
  if (fields.length >= 14 && rows.length) {
    return rows.map((values): SblShortSaleRow | null => {
      const symbol = String(values[0] ?? "").trim();
      if (!/^\d{4,6}$/.test(symbol)) return null;
      return {
        trade_date: tradeDate,
        symbol,
        name: String(values[1] ?? "").trim(),
        market: "listed",
        previous_balance_shares: nullableMarketNumber(values[8]),
        sold_shares: nullableMarketNumber(values[9]),
        returned_shares: nullableMarketNumber(values[10]),
        adjustment_shares: nullableMarketNumber(values[11]),
        balance_shares: nullableMarketNumber(values[12]),
        available_shares: nullableMarketNumber(values[13]),
        sold_volume_shares: nullableMarketNumber(values[9]),
        sold_amount: null,
        source: "TWSE_TWT93U",
        source_priority: "OFFICIAL",
      };
    }).filter((x): x is SblShortSaleRow => Boolean(x));
  }
  return twseTwt93Rows(body).map((row): SblShortSaleRow | null => {
    const symbol = rowSymbol(row);
    if (!/^\d{4,6}$/.test(symbol)) return null;
    return {
      trade_date: tradeDate, symbol, name: rowName(row), market: "listed",
      previous_balance_shares: null, sold_shares: null, returned_shares: null, adjustment_shares: null,
      balance_shares: null, available_shares: null, sold_volume_shares: null, sold_amount: null,
      source: "TWSE_TWT93U", source_priority: "OFFICIAL",
    };
  }).filter((x): x is SblShortSaleRow => Boolean(x));
}

export function normalizeTpexSblShortSale(balanceBody: unknown, volumeBody: unknown, requestedDate: string): SblShortSaleRow[] {
  const volumeBySymbol = new Map<string, Record<string, any>>();
  for (const row of responseRows(volumeBody)) {
    const symbol = rowSymbol(row);
    if (symbol) volumeBySymbol.set(symbol, row);
  }
  return responseRows(balanceBody).map((row): SblShortSaleRow | null => {
    const symbol = rowSymbol(row);
    if (!/^\d{4,6}$/.test(symbol)) return null;
    const volume = volumeBySymbol.get(symbol) ?? {};
    const tradeDate = normalizeTradeDate(findValue(row, ["Date", "日期"])) ?? requestedDate;
    return {
      trade_date: tradeDate,
      symbol,
      name: rowName(row),
      market: "otc",
      previous_balance_shares: nullableMarketNumber(findValue(row, ["SecuritiesBorrowingBalancePreviousDay"])),
      sold_shares: nullableMarketNumber(findValue(row, ["SecuritiesBorrowingSale"])),
      returned_shares: nullableMarketNumber(findValue(row, ["SecuritiesBorrowingReturn"])),
      adjustment_shares: nullableMarketNumber(findValue(row, ["SecuritiesBorrowingAdjustment"])),
      balance_shares: nullableMarketNumber(findValue(row, ["SecuritiesBorrowingBalanceOfTheMarketDay"])),
      available_shares: nullableMarketNumber(findValue(row, ["AvailableVolumesForSBLShortSale"])),
      sold_volume_shares: (() => {
        const lots = nullableMarketNumber(findValue(volume, ["SBLVolume"]));
        return lots === null ? null : lots * 1000;
      })(),
      sold_amount: nullableMarketNumber(findValue(volume, ["SBLAmount"])),
      source: "TPEX_MARGIN_SBL+TPEX_SHORT_SELL",
      source_priority: "OFFICIAL",
    };
  }).filter((x): x is SblShortSaleRow => Boolean(x));
}

function strictSum<T>(rows: T[], pick: (row: T) => number | null) {
  if (!rows.length) return null;
  let total = 0;
  for (const row of rows) {
    const value = pick(row);
    if (value === null) return null;
    total += value;
  }
  return total;
}

const WINDOWS = [1,3,5,10,20] as const;
const CREDIT_WINDOWS = [1,3,5,10,20,60] as const;

export function securitiesLendingWindows(rows: SecuritiesLendingRow[]) {
  const sorted = [...rows].sort((a,b)=>a.trade_date.localeCompare(b.trade_date));
  const latest = sorted.at(-1) ?? null;
  const sums = (n:number) => {
    const slice = sorted.slice(-n);
    const borrowed = strictSum(slice, (x) => x.borrowed_shares);
    const returned = strictSum(slice, (x) => x.returned_shares);
    const startBalance = slice[0]?.previous_balance_shares ?? null;
    const endBalance = slice.at(-1)?.balance_shares ?? null;
    return {
      days: slice.length,
      requested_days: n,
      complete: slice.length === n && borrowed !== null && returned !== null,
      borrowed_shares: borrowed,
      returned_shares: returned,
      net_borrowed_shares: borrowed !== null && returned !== null ? borrowed - returned : null,
      start_balance_shares: startBalance,
      end_balance_shares: endBalance,
      balance_change_shares: startBalance !== null && endBalance !== null ? endBalance - startBalance : null,
    };
  };
  return { latest, windows:Object.fromEntries(CREDIT_WINDOWS.map((n)=>[`${n}d`,sums(n)])) };
}

export function sblShortSaleWindows(rows: SblShortSaleRow[]) {
  const sorted = [...rows].sort((a,b)=>a.trade_date.localeCompare(b.trade_date));
  const latest = sorted.at(-1) ?? null;
  const sums = (n:number) => {
    const slice = sorted.slice(-n);
    const sold = strictSum(slice, (x) => x.sold_shares);
    const returned = strictSum(slice, (x) => x.returned_shares);
    const adjustment = strictSum(slice, (x) => x.adjustment_shares);
    const soldVolume = strictSum(slice, (x) => x.sold_volume_shares);
    const soldAmount = strictSum(slice, (x) => x.sold_amount);
    const startBalance = slice[0]?.previous_balance_shares ?? null;
    const endBalance = slice.at(-1)?.balance_shares ?? null;
    return {
      days: slice.length,
      requested_days: n,
      complete: slice.length === n && sold !== null && returned !== null && adjustment !== null,
      sold_shares: sold,
      returned_shares: returned,
      adjustment_shares: adjustment,
      sold_volume_shares: soldVolume,
      sold_amount: soldAmount,
      start_balance_shares: startBalance,
      end_balance_shares: endBalance,
      balance_change_shares: startBalance !== null && endBalance !== null ? endBalance - startBalance : null,
    };
  };
  return { latest, windows:Object.fromEntries(CREDIT_WINDOWS.map((n)=>[`${n}d`,sums(n)])) };
}

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
    const marginChange = strictSum(slice, (x) => x.margin_balance_change_lots);
    const shortChange = strictSum(slice, (x) => x.short_balance_change_lots);
    const marginStart = slice[0]?.margin_previous_balance_lots ?? null;
    const marginEnd = slice.at(-1)?.margin_balance_lots ?? null;
    const shortStart = slice[0]?.short_previous_balance_lots ?? null;
    const shortEnd = slice.at(-1)?.short_balance_lots ?? null;
    return {
      days:slice.length,
      requested_days: n,
      complete: slice.length === n && marginChange !== null && shortChange !== null,
      margin_balance_change_lots: marginChange,
      short_balance_change_lots: shortChange,
      margin_start_balance_lots: marginStart,
      margin_end_balance_lots: marginEnd,
      short_start_balance_lots: shortStart,
      short_end_balance_lots: shortEnd,
    };
  };
  return { latest, windows:Object.fromEntries(CREDIT_WINDOWS.map((n)=>[`${n}d`,sums(n)])) };
}
