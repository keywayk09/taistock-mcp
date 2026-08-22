import { arr, fetchJson, rec, round, type Obj } from "./common";

const TWSE_VALUATION = "https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL";
const TPEX_VALUATION = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis";

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().replaceAll(",", "").replace(/%$/, "");
  if (!raw || raw === "-" || raw === "--" || raw.toLowerCase() === "nan") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function pct(current: number | null, base: number | null) {
  return current !== null && base !== null && base !== 0 ? round((current / base - 1) * 100, 2) : null;
}

function metricName(row: Obj) {
  return `${String(row.type ?? "")} ${String(row.origin_name ?? "")} ${String(row.name ?? "")}`.toLowerCase();
}

function selectMetric(rows: unknown[], aliases: string[]) {
  const lowered = aliases.map((x) => x.toLowerCase());
  const row = rows.find((item) => lowered.some((alias) => metricName(rec(item)).includes(alias)));
  return row ? nullableNumber(rec(row).value) : null;
}

function periodRows(rows: unknown[], date: string) {
  return rows.filter((item) => String(rec(item).date ?? "") === date);
}

export function summarizeFamilyRevenue(rows: unknown[]) {
  const normalized = rows.map((item) => {
    const row = rec(item);
    return {
      ...row,
      revenue: nullableNumber(row.revenue),
      revenue_year: nullableNumber(row.revenue_year),
      revenue_month: nullableNumber(row.revenue_month),
    };
  }).filter((row) => row.revenue !== null && row.revenue_year !== null && row.revenue_month !== null)
    .sort((a, b) => Number(a.revenue_year) * 100 + Number(a.revenue_month) - (Number(b.revenue_year) * 100 + Number(b.revenue_month)));

  const latest = normalized.at(-1) ?? null;
  if (!latest) return { status: "UNAVAILABLE", latest: null, recent: [] };
  const previous = normalized.at(-2) ?? null;
  const lastYear = normalized.find((row) => Number(row.revenue_year) === Number(latest.revenue_year) - 1 && Number(row.revenue_month) === Number(latest.revenue_month)) ?? null;
  return {
    status: "READY",
    latest: {
      year: latest.revenue_year,
      month: latest.revenue_month,
      revenue: latest.revenue,
      mom_percent: pct(latest.revenue, previous?.revenue ?? null),
      yoy_percent: pct(latest.revenue, lastYear?.revenue ?? null),
    },
    recent: normalized.slice(-18).map((row) => ({
      year: row.revenue_year,
      month: row.revenue_month,
      revenue: row.revenue,
    })),
  };
}

export function summarizeFamilyAccounting(income: unknown[], balance: unknown[], cash: unknown[]) {
  const dates = [...new Set([...income, ...balance, ...cash].map((item) => String(rec(item).date ?? "")))]
    .filter(Boolean)
    .sort()
    .slice(-6);

  const periods = dates.map((date) => {
    const inc = periodRows(income, date);
    const bal = periodRows(balance, date);
    const cf = periodRows(cash, date);
    const revenue = selectMetric(inc, ["operatingrevenue", "revenue", "營業收入"]);
    const gross = selectMetric(inc, ["grossprofit", "營業毛利"]);
    const operating = selectMetric(inc, ["operatingincome", "profitlossfromoperating", "營業利益"]);
    const net = selectMetric(inc, ["incomeaftertaxes", "netincome", "本期淨利", "本期稅後淨利"]);
    const eps = selectMetric(inc, ["basicearningspershare", "basic earnings per share", "基本每股盈餘", "每股盈餘", "eps"]);
    const nonOperating = selectMetric(inc, ["nonoperatingincome", "營業外收入", "營業外收支"]);
    const assets = selectMetric(bal, ["totalassets", "資產總額"]);
    const liabilities = selectMetric(bal, ["totalliabilities", "負債總額"]);
    const equity = selectMetric(bal, ["totalequity", "total equity", "權益總額", "權益"]);
    const inventory = selectMetric(bal, ["inventory", "存貨"]);
    const receivables = selectMetric(bal, ["accountsreceivable", "accounts receivable", "應收帳款"]);
    const operatingCashFlow = selectMetric(cf, ["cashflowsfromoperatingactivities", "netcashflowsfromusedinoperatingactivities", "營業活動之淨現金流"]);
    const capex = selectMetric(cf, ["purchaseofpropertyplantandequipment", "取得不動產、廠房及設備"]);
    return {
      date,
      revenue,
      gross_profit: gross,
      operating_income: operating,
      net_income: net,
      eps,
      non_operating_income: nonOperating,
      gross_margin_percent: revenue && gross !== null ? round(gross / revenue * 100) : null,
      operating_margin_percent: revenue && operating !== null ? round(operating / revenue * 100) : null,
      net_margin_percent: revenue && net !== null ? round(net / revenue * 100) : null,
      total_assets: assets,
      total_liabilities: liabilities,
      total_equity: equity,
      debt_ratio_percent: assets && liabilities !== null ? round(liabilities / assets * 100) : null,
      roe_period_estimate_percent: equity && net !== null ? round(net / equity * 100) : null,
      inventory,
      accounts_receivable: receivables,
      operating_cash_flow: operatingCashFlow,
      capex,
      free_cash_flow_estimate: operatingCashFlow !== null && capex !== null ? operatingCashFlow + capex : null,
    };
  });

  const latest = periods.at(-1) ?? null;
  const previous = periods.at(-2) ?? null;
  const flags: { severity: "medium" | "high"; message: string }[] = [];
  if (latest && previous) {
    const revenueGrowth = pct(latest.revenue, previous.revenue);
    const receivableGrowth = pct(latest.accounts_receivable, previous.accounts_receivable);
    const inventoryGrowth = pct(latest.inventory, previous.inventory);
    if (revenueGrowth !== null && revenueGrowth > 0 && latest.operating_cash_flow !== null && previous.operating_cash_flow !== null && latest.operating_cash_flow < previous.operating_cash_flow) flags.push({ severity: "high", message: "營收成長但營業現金流惡化" });
    if (receivableGrowth !== null && revenueGrowth !== null && receivableGrowth > revenueGrowth + 15) flags.push({ severity: "high", message: "應收帳款增速明顯高於營收" });
    if (inventoryGrowth !== null && revenueGrowth !== null && inventoryGrowth > revenueGrowth + 20) flags.push({ severity: "high", message: "存貨增速明顯高於營收" });
    if (latest.net_income !== null && latest.net_income > 0 && (latest.free_cash_flow_estimate ?? 0) < 0) flags.push({ severity: "high", message: "帳面獲利為正但自由現金流為負" });
    if (latest.gross_margin_percent !== null && previous.gross_margin_percent !== null && latest.gross_margin_percent < previous.gross_margin_percent - 3) flags.push({ severity: "medium", message: "毛利率較前期下降超過3個百分點" });
    if (latest.non_operating_income !== null && latest.net_income && Math.abs(latest.non_operating_income / latest.net_income) >= 0.5) flags.push({ severity: "medium", message: "營業外收益占淨利比重偏高" });
  }
  if ((latest?.debt_ratio_percent ?? 0) >= 70) flags.push({ severity: "high", message: "負債比高於70%" });
  if ((latest?.operating_cash_flow ?? 0) < 0) flags.push({ severity: "medium", message: "最新一期營業現金流為負" });

  const riskScore = Math.min(100, flags.reduce((sum, item) => sum + (item.severity === "high" ? 25 : 12), 0));
  return {
    status: latest ? "READY" : "UNAVAILABLE",
    latest,
    previous,
    periods,
    flags,
    risk_score: riskScore,
    quality: !latest ? "unavailable" : riskScore >= 60 ? "weak" : riskScore >= 30 ? "mixed" : "healthy",
    semantics: {
      roe_period_estimate_percent: "period net income / period-end equity; not annualized ROE",
      free_cash_flow_estimate: "operating cash flow + reported capex field; sign follows source dataset",
      missing_values: "null; never guessed",
    },
  };
}

function pick(row: Obj, aliases: string[]) {
  for (const key of aliases) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim()) return row[key];
  }
  return null;
}

function valuationSymbol(row: Obj) {
  return String(pick(row, ["Code", "證券代號", "股票代號", "SecuritiesCompanyCode", "SecuritiesCompanyCode "]) ?? "").trim();
}

function normalizeValuationRow(row: Obj, market: "listed" | "otc") {
  return {
    market,
    symbol: valuationSymbol(row),
    name: String(pick(row, ["Name", "證券名稱", "股票名稱", "CompanyName"]) ?? ""),
    pe_ratio: nullableNumber(pick(row, ["PEratio", "P/E", "本益比", "PriceEarningRatio"])),
    dividend_yield_percent: nullableNumber(pick(row, ["DividendYield", "殖利率(%)", "殖利率％", "DividendYieldRatio"])),
    pb_ratio: nullableNumber(pick(row, ["PBratio", "P/B", "股價淨值比", "PriceBookRatio"])),
  };
}

export async function fetchFamilyOfficialValuation(symbol: string) {
  const sources = [
    { market: "listed" as const, label: "TWSE BWIBBU_ALL", url: TWSE_VALUATION },
    { market: "otc" as const, label: "TPEx tpex_mainboard_peratio_analysis", url: TPEX_VALUATION },
  ];
  const settled = await Promise.allSettled(sources.map(async (source) => {
    const response = await fetchJson(source.url, { headers: { Accept: "application/json" } }, source.label);
    const row = arr(response.body).map((item) => rec(item)).find((item) => valuationSymbol(item) === symbol);
    return row ? normalizeValuationRow(row, source.market) : null;
  }));
  const data = settled.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
  const errors = settled.flatMap((result, index) => result.status === "rejected" ? [`${sources[index].label}:${result.reason instanceof Error ? result.reason.message : String(result.reason)}`] : []);
  return {
    status: data.length ? "READY" : "UNAVAILABLE",
    source: "TWSE/TPEx OpenAPI",
    data,
    partial_errors: errors,
    note: "官方本益比、殖利率、股價淨值比僅在交易所/櫃買有可計算值時回傳；缺值保持 null。",
  };
}
