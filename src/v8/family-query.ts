import {
  arr,
  fetchJson,
  finmind,
  fugle,
  normalizeDailyBars,
  normalizeQuote,
  num,
  rec,
  returnPct,
  round,
  taipeiDate,
  technicalSummary,
  type Obj,
} from "../v6/common";
import { TAIWAN_STOCK_ANALYSIS_TEMPLATE_12 } from "./fundamental-12";

const TWSE_EVENTS = "https://openapi.twse.com.tw/v1/opendata/t187ap04_L";
const TPEX_EVENTS = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O";

export type FamilyQueryInput = {
  query: string;
  mode?: "auto";
  as_of_date?: string;
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function requireReadOnlyDb(env: Env) {
  if (!env.DB) throw new Error("D1 DB binding is unavailable");
  return env.DB;
}

async function queryAll(db: D1Database, sql: string, values: unknown[] = []) {
  try {
    return (await db.prepare(sql).bind(...values).all<Obj>()).results ?? [];
  } catch {
    return [];
  }
}

async function queryFirst(db: D1Database, sql: string, values: unknown[] = []) {
  try {
    return await db.prepare(sql).bind(...values).first<Obj>();
  } catch {
    return null;
  }
}

function metricName(row: Obj) {
  return `${String(row.type ?? "")} ${String(row.origin_name ?? "")} ${String(row.name ?? "")}`.toLowerCase();
}

function selectMetric(rows: any[], aliases: string[]) {
  const lowered = aliases.map((alias) => alias.toLowerCase());
  const row = rows.find((item) => lowered.some((alias) => metricName(rec(item)).includes(alias)));
  return row ? num(row.value) : null;
}

function normalizeRevenue(rows: any[]) {
  return rows.map((row) => {
    const root = rec(row);
    const year = num(root.revenue_year);
    const month = num(root.revenue_month);
    const date = String(root.date ?? (year && month ? `${year}-${String(month).padStart(2, "0")}` : ""));
    return { date, year, month, revenue: num(root.revenue) };
  }).filter((row) => row.date && row.revenue).sort((a, b) => a.date.localeCompare(b.date));
}

function summarizeRevenue(rows: any[]) {
  const normalized = normalizeRevenue(rows);
  const latest = normalized.at(-1);
  if (!latest) return { latest: null, history: [], trend: "資料不足" };
  const previous = normalized.at(-2);
  const lastYear = normalized.find((row) => row.year === latest.year - 1 && row.month === latest.month);
  const recent = normalized.slice(-6).map((row, index, all) => {
    const priorYear = normalized.find((candidate) => candidate.year === row.year - 1 && candidate.month === row.month);
    const priorMonth = index > 0 ? all[index - 1] : undefined;
    return {
      ...row,
      yoy_percent: priorYear ? returnPct(row.revenue, priorYear.revenue) : null,
      mom_percent: priorMonth ? returnPct(row.revenue, priorMonth.revenue) : null,
    };
  });
  const yoy = lastYear ? returnPct(latest.revenue, lastYear.revenue) : null;
  const mom = previous ? returnPct(latest.revenue, previous.revenue) : null;
  return {
    latest: { ...latest, yoy_percent: yoy, mom_percent: mom },
    history: recent,
    trend: yoy == null ? "缺少去年同期" : yoy > 20 ? "高速成長" : yoy > 0 ? "正成長" : yoy < -20 ? "明顯衰退" : "小幅衰退",
    positive_yoy_months_in_recent_6: recent.filter((row) => (row.yoy_percent ?? -Infinity) > 0).length,
  };
}

function summarizeFinancials(income: any[], balance: any[], cashFlow: any[]) {
  const dates = [...new Set([...income, ...balance, ...cashFlow].map((row) => String(row.date ?? "")))].filter(Boolean).sort().slice(-6);
  const periods = dates.map((date) => {
    const inc = income.filter((row) => String(row.date ?? "") === date);
    const bal = balance.filter((row) => String(row.date ?? "") === date);
    const cf = cashFlow.filter((row) => String(row.date ?? "") === date);
    const revenue = selectMetric(inc, ["operatingrevenue", "revenue", "營業收入"]);
    const gross = selectMetric(inc, ["grossprofit", "營業毛利"]);
    const operating = selectMetric(inc, ["operatingincome", "profitlossfromoperating", "營業利益"]);
    const netIncome = selectMetric(inc, ["incomeaftertaxes", "netincome", "本期淨利", "本期稅後淨利"]);
    const nonOperating = selectMetric(inc, ["nonoperatingincome", "營業外收入", "營業外收支"]);
    const eps = selectMetric(inc, ["earningspershare", "basic earnings per share", "基本每股盈餘", "每股盈餘"]);
    const assets = selectMetric(bal, ["totalassets", "資產總額"]);
    const liabilities = selectMetric(bal, ["totalliabilities", "負債總額"]);
    const cash = selectMetric(bal, ["cashandcashequivalents", "現金及約當現金"]);
    const inventory = selectMetric(bal, ["inventory", "存貨"]);
    const receivables = selectMetric(bal, ["accountsreceivable", "應收帳款"]);
    const operatingCashFlow = selectMetric(cf, ["cashflowsfromoperatingactivities", "netcashflowsfromusedinoperatingactivities", "營業活動之淨現金流"]);
    const capex = selectMetric(cf, ["purchaseofpropertyplantandequipment", "取得不動產、廠房及設備"]);
    return {
      date,
      revenue,
      gross_profit: gross,
      operating_income: operating,
      net_income: netIncome,
      non_operating_income: nonOperating,
      eps,
      gross_margin_percent: revenue && gross != null ? round(gross / revenue * 100) : null,
      operating_margin_percent: revenue && operating != null ? round(operating / revenue * 100) : null,
      net_margin_percent: revenue && netIncome != null ? round(netIncome / revenue * 100) : null,
      total_assets: assets,
      total_liabilities: liabilities,
      debt_ratio_percent: assets && liabilities != null ? round(liabilities / assets * 100) : null,
      cash,
      inventory,
      accounts_receivable: receivables,
      operating_cash_flow: operatingCashFlow,
      capex,
      free_cash_flow_estimate: operatingCashFlow != null && capex != null ? operatingCashFlow + capex : null,
    };
  });
  const latest = periods.at(-1) ?? null;
  const previous = periods.at(-2) ?? null;
  const flags: string[] = [];
  if (latest && previous) {
    const revenueGrowth = latest.revenue != null && previous.revenue ? returnPct(latest.revenue, previous.revenue) : null;
    const receivableGrowth = latest.accounts_receivable != null && previous.accounts_receivable ? returnPct(latest.accounts_receivable, previous.accounts_receivable) : null;
    const inventoryGrowth = latest.inventory != null && previous.inventory ? returnPct(latest.inventory, previous.inventory) : null;
    if (revenueGrowth != null && revenueGrowth > 0 && latest.operating_cash_flow != null && previous.operating_cash_flow != null && latest.operating_cash_flow < previous.operating_cash_flow) flags.push("營收成長但營業現金流惡化");
    if (receivableGrowth != null && revenueGrowth != null && receivableGrowth > revenueGrowth + 15) flags.push("應收帳款增速明顯高於營收");
    if (inventoryGrowth != null && revenueGrowth != null && inventoryGrowth > revenueGrowth + 20) flags.push("存貨增速明顯高於營收");
    if (latest.gross_margin_percent != null && previous.gross_margin_percent != null && latest.gross_margin_percent < previous.gross_margin_percent - 3) flags.push("毛利率較前期下降超過3個百分點");
  }
  if ((latest?.debt_ratio_percent ?? 0) >= 70) flags.push("負債比高於70%");
  if ((latest?.net_income ?? 0) > 0 && (latest?.free_cash_flow_estimate ?? 0) < 0) flags.push("帳面獲利為正但自由現金流為負");
  if (latest?.non_operating_income != null && latest.net_income && Math.abs(latest.non_operating_income / latest.net_income) >= 0.5) flags.push("營業外收益占淨利比重偏高");
  return { latest, previous, periods, flags };
}

async function fetchOfficialEvents(symbol: string) {
  const settled = await Promise.allSettled([
    fetchJson(TWSE_EVENTS, { headers: { Accept: "application/json" } }, "TWSE重大訊息"),
    fetchJson(TPEX_EVENTS, { headers: { Accept: "application/json" } }, "TPEx重大訊息"),
  ]);
  const data: any[] = [];
  const errors: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      const rows = arr(result.value.body).filter((row) => {
        const root = rec(row);
        const code = String(root["公司代號"] ?? root["公司代碼"] ?? root["證券代號"] ?? root.stock_id ?? "").replace(/\s/g, "");
        return code === symbol;
      });
      data.push(...rows.map((row) => ({ market: index ? "TPEX" : "TWSE", ...rec(row) })));
    } else errors.push(errorText(result.reason));
  });
  return { data: data.slice(0, 50), errors };
}

function aggregateInstitutional(rows: any[]) {
  const grouped = new Map<string, { name: string; buy: number; sell: number; net: number; rows: number }>();
  for (const row of rows) {
    const root = rec(row);
    const name = String(root.name ?? root.Institutional_Investors ?? root.institutional_investors ?? root.type ?? "unknown");
    const buy = num(root.buy ?? root.buy_amount ?? root.buy_volume);
    const sell = num(root.sell ?? root.sell_amount ?? root.sell_volume);
    const net = num(root.buy_sell ?? root.net ?? root.net_buy_sell ?? (buy - sell));
    const current = grouped.get(name) ?? { name, buy: 0, sell: 0, net: 0, rows: 0 };
    current.buy += buy;
    current.sell += sell;
    current.net += net;
    current.rows += 1;
    grouped.set(name, current);
  }
  return [...grouped.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}

function parsePayload(value: unknown) {
  try { return rec(JSON.parse(String(value ?? "{}"))); } catch { return {}; }
}

async function buildStockBundle(env: Env, db: D1Database, symbol: string, asOfDate: string) {
  const start3y = taipeiDate(1_150);
  const start18m = taipeiDate(550);
  const start120d = taipeiDate(180);
  const [company, contexts, kpis, revenueResult, incomeResult, balanceResult, cashResult, quoteResult, priceResult, institutionalResult, eventsResult] = await Promise.all([
    queryFirst(db, "SELECT * FROM global_companies WHERE country = 'TW' AND ticker = ? AND status = 'active' ORDER BY exchange = 'TWSE' DESC LIMIT 1", [symbol]),
    queryAll(db, `SELECT c.* FROM stock_analysis_section_context c
      JOIN (SELECT section_id, MAX(as_of_date) latest_date FROM stock_analysis_section_context WHERE symbol = ? AND as_of_date <= ? GROUP BY section_id) x
      ON x.section_id = c.section_id AND x.latest_date = c.as_of_date
      WHERE c.symbol = ? ORDER BY c.section_id`, [symbol, asOfDate, symbol]),
    queryAll(db, "SELECT * FROM stock_analysis_kpis WHERE symbol = ? ORDER BY kpi_name", [symbol]),
    finmind(env, "TaiwanStockMonthRevenue", { data_id: symbol, start_date: start18m, end_date: asOfDate }).then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error: errorText(error) })),
    finmind(env, "TaiwanStockFinancialStatements", { data_id: symbol, start_date: start3y, end_date: asOfDate }).then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error: errorText(error) })),
    finmind(env, "TaiwanStockBalanceSheet", { data_id: symbol, start_date: start3y, end_date: asOfDate }).then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error: errorText(error) })),
    finmind(env, "TaiwanStockCashFlowsStatement", { data_id: symbol, start_date: start3y, end_date: asOfDate }).then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error: errorText(error) })),
    fugle(env, `/intraday/quote/${encodeURIComponent(symbol)}`).then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error: errorText(error) })),
    finmind(env, "TaiwanStockPrice", { data_id: symbol, start_date: start120d, end_date: asOfDate }).then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error: errorText(error) })),
    finmind(env, "TaiwanStockInstitutionalInvestorsBuySell", { data_id: symbol, start_date: taipeiDate(35), end_date: asOfDate }).then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error: errorText(error) })),
    fetchOfficialEvents(symbol).then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error: errorText(error) })),
  ]);

  const manual = new Map<number, Obj>();
  for (const row of contexts) manual.set(num(row.section_id), parsePayload(row.payload_json));

  const memberships = company ? await queryAll(db, `SELECT m.*, t.name_zh theme_name, t.name_en theme_name_en, t.theme_type
    FROM company_theme_memberships m JOIN industry_themes t ON t.theme_id = m.theme_id
    WHERE m.company_id = ? AND m.status = 'active' ORDER BY m.relevance_score DESC`, [company.company_id]) : [];
  const edges = company ? await queryAll(db, `SELECT e.*, s.company_name source_name, s.ticker source_ticker, s.country source_country,
    d.company_name target_name, d.ticker target_ticker, d.country target_country
    FROM supply_chain_edges e
    LEFT JOIN global_companies s ON s.company_id = e.source_company_id
    LEFT JOIN global_companies d ON d.company_id = e.target_company_id
    WHERE (e.source_company_id = ? OR e.target_company_id = ?) AND e.status = 'active'
    ORDER BY e.confidence DESC LIMIT 100`, [company.company_id, company.company_id]) : [];
  const evidence = company ? await queryAll(db, `SELECT * FROM industry_evidence
    WHERE (entity_type = 'company' AND entity_id = ?) OR entity_id IN (SELECT theme_id FROM company_theme_memberships WHERE company_id = ?)
    ORDER BY published_at DESC, created_at DESC LIMIT 100`, [company.company_id, company.company_id]) : [];
  const peers = company && memberships.length ? await queryAll(db, `SELECT DISTINCT c.company_id, c.country, c.exchange, c.ticker, c.company_name,
      m.role, m.relevance_score, t.name_zh theme_name
    FROM company_theme_memberships self
    JOIN company_theme_memberships m ON m.theme_id = self.theme_id AND m.company_id <> self.company_id AND m.status = 'active'
    JOIN global_companies c ON c.company_id = m.company_id AND c.status = 'active'
    JOIN industry_themes t ON t.theme_id = m.theme_id
    WHERE self.company_id = ? AND self.status = 'active'
    ORDER BY c.country = 'TW' DESC, m.relevance_score DESC LIMIT 50`, [company.company_id]) : [];

  const revenue = summarizeRevenue(revenueResult.ok ? revenueResult.value : []);
  const financials = summarizeFinancials(incomeResult.ok ? incomeResult.value : [], balanceResult.ok ? balanceResult.value : [], cashResult.ok ? cashResult.value : []);
  const quote = quoteResult.ok ? normalizeQuote(quoteResult.value, symbol) : null;
  const bars = priceResult.ok ? normalizeDailyBars(priceResult.value) : [];
  const technical = bars.length ? technicalSummary(bars) : null;
  const institutional = institutionalResult.ok ? aggregateInstitutional(institutionalResult.value) : [];
  const officialEvents = eventsResult.ok ? eventsResult.value : { data: [], errors: [eventsResult.error] };

  const sectionData: Record<number, unknown> = {
    1: { company, official_industry: company?.official_industry ?? null, themes: memberships, evidence: evidence.slice(0, 20) },
    2: { themes: memberships, supply_chain: edges, peer_count: peers.length },
    3: { monthly_revenue: revenue, financials },
    4: { monthly_revenue: revenue, growth_evidence: evidence.filter((row) => /新產品|量產|擴產|產能|新客戶|成長|訂單/i.test(String(row.evidence_text ?? ""))).slice(0, 30) },
    5: { capacity_and_geopolitics_evidence: evidence.filter((row) => /產能|廠區|中國|越南|泰國|墨西哥|美國|日本|印度|China\+1|關稅|制裁/i.test(String(row.evidence_text ?? ""))).slice(0, 30) },
    6: { supply_chain: edges, customer_order_evidence: evidence.filter((row) => /客戶|訂單|長約|design-in|出貨|能見度/i.test(String(row.evidence_text ?? ""))).slice(0, 30) },
    7: { official_events: officialEvents.data, evidence: evidence.slice(0, 30), financial_risk_flags: financials.flags },
    8: { institutional_35d: institutional, major_holder_400_1000: manual.get(8)?.major_holder_400_1000 ?? null },
    9: { direct_and_related_peers: peers },
    10: { quote, latest_reported_eps: financials.latest?.eps ?? null, note: "估值倍數與預估EPS需由GPT依可追溯資料另行推導，不得視為保證。" },
    11: { quote, technical },
    12: { kpis, financial_risk_flags: financials.flags, revenue_trend: revenue.trend, technical_score: technical?.score ?? null },
  };

  const sections = TAIWAN_STOCK_ANALYSIS_TEMPLATE_12.map((definition) => ({
    ...definition,
    auto_data: sectionData[definition.id],
    verified_context: manual.get(definition.id) ?? null,
    rule: "verified_context優先；auto_data只呈現可追溯資料；缺少資料時不得推測客戶、訂單、產能比重或目標價。",
  }));

  const partialErrors = [
    !revenueResult.ok ? `月營收：${revenueResult.error}` : null,
    !incomeResult.ok ? `損益表：${incomeResult.error}` : null,
    !balanceResult.ok ? `資產負債表：${balanceResult.error}` : null,
    !cashResult.ok ? `現金流量表：${cashResult.error}` : null,
    !quoteResult.ok ? `即時報價：${quoteResult.error}` : null,
    !priceResult.ok ? `歷史股價：${priceResult.error}` : null,
    !institutionalResult.ok ? `法人籌碼：${institutionalResult.error}` : null,
    ...officialEvents.errors.map((message: string) => `重大訊息：${message}`),
  ].filter(Boolean);

  return {
    symbol,
    as_of_date: asOfDate,
    generated_at: new Date().toISOString(),
    company_found: Boolean(company),
    sections,
    partial_errors: partialErrors,
  };
}

function tokensFromQuery(query: string) {
  const stop = new Set(["請問", "幫我", "分析", "比較", "股票", "公司", "台股", "怎麼", "如何", "現在", "完整", "一下", "有哪些", "是否", "可以", "這檔", "題材"]);
  return [...new Set(query
    .replace(/[，。！？、：；,.!?;:()（）\[\]{}]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !stop.has(token) && !/^\d{4,6}$/.test(token))
  )].slice(0, 8);
}

function extractSymbols(query: string) {
  const matches = query.match(/(?<!\d)\d{4,6}(?!\d)/g) ?? [];
  return [...new Set(matches)].slice(0, 5);
}

async function resolveCompanies(db: D1Database, query: string, explicitSymbols: string[]) {
  const rows: Obj[] = [];
  for (const symbol of explicitSymbols) {
    const row = await queryFirst(db, "SELECT * FROM global_companies WHERE country = 'TW' AND ticker = ? AND status = 'active' ORDER BY exchange = 'TWSE' DESC LIMIT 1", [symbol]);
    if (row) rows.push(row);
  }
  for (const token of tokensFromQuery(query)) {
    const like = `%${token}%`;
    const found = await queryAll(db, `SELECT * FROM global_companies
      WHERE status = 'active' AND (company_name LIKE ? OR company_name_en LIKE ? OR aliases_json LIKE ? OR official_industry LIKE ? OR sub_industry LIKE ?)
      ORDER BY country = 'TW' DESC, exchange = 'TWSE' DESC LIMIT 10`, [like, like, like, like, like]);
    rows.push(...found);
  }
  const unique = new Map<string, Obj>();
  for (const row of rows) unique.set(String(row.company_id), row);
  return [...unique.values()].slice(0, 20);
}

async function searchKnowledgeGraph(db: D1Database, query: string, companies: Obj[]) {
  const tokens = tokensFromQuery(query);
  const themes: Obj[] = [];
  const evidence: Obj[] = [];
  for (const token of tokens) {
    const like = `%${token}%`;
    themes.push(...await queryAll(db, `SELECT * FROM industry_themes
      WHERE status = 'active' AND (name_zh LIKE ? OR name_en LIKE ? OR aliases_json LIKE ? OR description LIKE ?)
      ORDER BY theme_type, name_zh LIMIT 30`, [like, like, like, like]));
    evidence.push(...await queryAll(db, `SELECT * FROM industry_evidence
      WHERE source_title LIKE ? OR evidence_text LIKE ?
      ORDER BY published_at DESC, created_at DESC LIMIT 30`, [like, like]));
  }
  const themeMap = new Map<string, Obj>();
  for (const row of themes) themeMap.set(String(row.theme_id), row);
  const evidenceMap = new Map<string, Obj>();
  for (const row of evidence) evidenceMap.set(String(row.evidence_id), row);
  const companyIds = companies.map((row) => String(row.company_id)).filter(Boolean).slice(0, 20);
  const themeIds = [...themeMap.keys()].slice(0, 30);
  const memberships: Obj[] = [];
  for (const companyId of companyIds) memberships.push(...await queryAll(db, `SELECT m.*, t.name_zh theme_name, t.name_en theme_name_en, c.company_name, c.ticker, c.country, c.exchange
    FROM company_theme_memberships m
    JOIN industry_themes t ON t.theme_id = m.theme_id
    JOIN global_companies c ON c.company_id = m.company_id
    WHERE m.company_id = ? AND m.status = 'active' ORDER BY m.relevance_score DESC LIMIT 50`, [companyId]));
  for (const themeId of themeIds) memberships.push(...await queryAll(db, `SELECT m.*, t.name_zh theme_name, t.name_en theme_name_en, c.company_name, c.ticker, c.country, c.exchange
    FROM company_theme_memberships m
    JOIN industry_themes t ON t.theme_id = m.theme_id
    JOIN global_companies c ON c.company_id = m.company_id
    WHERE m.theme_id = ? AND m.status = 'active' ORDER BY m.relevance_score DESC LIMIT 80`, [themeId]));
  const edges: Obj[] = [];
  for (const companyId of companyIds.slice(0, 10)) edges.push(...await queryAll(db, `SELECT e.*, s.company_name source_name, s.ticker source_ticker, s.country source_country,
    d.company_name target_name, d.ticker target_ticker, d.country target_country
    FROM supply_chain_edges e
    LEFT JOIN global_companies s ON s.company_id = e.source_company_id
    LEFT JOIN global_companies d ON d.company_id = e.target_company_id
    WHERE (e.source_company_id = ? OR e.target_company_id = ?) AND e.status = 'active'
    ORDER BY e.confidence DESC LIMIT 80`, [companyId, companyId]));
  return {
    query_tokens: tokens,
    matched_companies: companies,
    matched_themes: [...themeMap.values()].slice(0, 30),
    memberships: memberships.slice(0, 150),
    supply_chain_edges: edges.slice(0, 120),
    evidence: [...evidenceMap.values()].slice(0, 60),
  };
}

export async function runFamilyQuery(env: Env, input: FamilyQueryInput) {
  const query = String(input.query ?? "").trim();
  if (!query) throw new Error("query is required");
  if (query.length > 2_000) throw new Error("query is too long");
  const asOfDate = input.as_of_date && /^\d{4}-\d{2}-\d{2}$/.test(input.as_of_date) ? input.as_of_date : taipeiDate();
  const db = requireReadOnlyDb(env);
  const explicitSymbols = extractSymbols(query);
  const companies = await resolveCompanies(db, query, explicitSymbols);
  const resolvedSymbols = [...new Set([
    ...explicitSymbols,
    ...companies.filter((row) => String(row.country) === "TW").map((row) => String(row.ticker)),
  ])].filter(Boolean).slice(0, 5);
  const stockAnalyses = await Promise.all(resolvedSymbols.map((symbol) => buildStockBundle(env, db, symbol, asOfDate)));
  const globalSearch = await searchKnowledgeGraph(db, query, companies);
  const route = resolvedSymbols.length > 1 ? "stock_compare" : resolvedSymbols.length === 1 ? "stock_analysis" : "knowledge_search";
  return {
    service: "Taiwan Stock AI Family Read-Only API",
    version: "8.2.0",
    read_only: true,
    route,
    query,
    as_of_date: asOfDate,
    resolved_symbols: resolvedSymbols,
    stock_analyses: stockAnalyses,
    global_search: globalSearch,
    response_instructions: [
      "請以繁體中文先給結論，再解釋理由。",
      "硬資料、推估與傳聞必須分開標示。",
      "缺少資料時明確說明，不得自行捏造客戶、訂單、供應鏈或目標價。",
      "涉及投資判斷時提供風險與失敗條件，不把任何價格或方向描述成保證。",
    ],
  };
}

export function familyOpenApiSchema(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Taiwan Stock AI Family Read-Only API",
      version: "8.2.0",
      description: "單一只讀入口。GPT可把任何台股、財務、籌碼、題材、同業或供應鏈問題送到此API，由後端自動解析並回傳相關資料。",
    },
    servers: [{ url: origin }],
    paths: {
      "/api/family/query": {
        post: {
          operationId: "queryTaiwanStockSystem",
          summary: "智慧查詢整套台股資料系統",
          description: "將使用者原始問題完整送出。適用於個股完整分析、股票比較、基本面、財務、籌碼、題材、同業與全球供應鏈。此端點只能讀取，不能修改資料。",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["query"],
                  properties: {
                    query: { type: "string", minLength: 1, maxLength: 2000, description: "使用者的完整原始問題，不要刪減股票代號、公司名稱、比較條件或分析需求。" },
                    mode: { type: "string", enum: ["auto"], default: "auto" },
                    as_of_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "選填，YYYY-MM-DD。未填使用台北當日。" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "查詢成功" },
            "400": { description: "輸入格式錯誤" },
            "401": { description: "API Key錯誤或缺少" },
            "405": { description: "只允許POST" },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
  };
}
