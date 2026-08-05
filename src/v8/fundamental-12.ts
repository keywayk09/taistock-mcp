import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  arr,
  fail,
  fetchJson,
  finmind,
  fugle,
  normalizeDailyBars,
  normalizeQuote,
  num,
  ok,
  rec,
  returnPct,
  round,
  stockSchema,
  taipeiDate,
  technicalSummary,
  type Obj,
} from "../v6/common";
import { ensureGlobalIndustrySchema } from "../v7/global-map";

const TWSE_EVENTS = "https://openapi.twse.com.tw/v1/opendata/t187ap04_L";
const TPEX_EVENTS = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O";
const TEMPLATE_VERSION = "TW_STOCK_ANALYSIS_12_V1";

export const TAIWAN_STOCK_ANALYSIS_TEMPLATE_12 = [
  { id: 1, title: "公司在做什麼｜商業模式與賺錢結構", focus: ["主要產品、服務與客戶", "收入來源", "哪塊最賺", "哪塊成長最快", "營收大但低毛利的業務"] },
  { id: 2, title: "產業位置｜市場地位與競爭優勢", focus: ["上游／中游／下游位置", "市占率", "技術門檻", "客戶黏著度", "議價能力", "同業優勢與劣勢"] },
  { id: 3, title: "財務體質｜獲利品質、FCF、負債比", focus: ["營收、毛利率、營益率、EPS趨勢", "自由現金流", "負債比", "現金水位與利息負擔", "本業與一次性業外"] },
  { id: 4, title: "成長動能｜未來1–2年業績驅動因子", focus: ["新產品放量", "新客戶導入", "新產能開出", "報價變化", "產業循環", "短催化與中期主升浪邏輯分流"] },
  { id: 5, title: "全球產能佈局與地緣政治配置｜China+1比重", focus: ["各國產能", "中國產能占比", "China+1與在地化", "關稅、制裁與地緣風險", "同族群配置優劣"] },
  { id: 6, title: "客戶與訂單能見度｜訂單來源與持續性", focus: ["前幾大客戶", "客戶集中度", "短單或長約", "訂單能見度", "design-in或一次性急單"] },
  { id: 7, title: "催化劑與風險｜時間點要具體", focus: ["法說會、季報、新機發表、量產、擴產、除息、標案", "客戶砍單", "報價下滑", "毛利率與利用率壓力", "匯率、原料與政策風險"] },
  { id: 8, title: "籌碼風向｜400／1000張大戶＋法人籌碼", focus: ["近4週400張大戶持股比率", "近4週1000張大戶持股比率", "外資、投信、自營商", "投信作帳／結帳慣性", "籌碼集中或發散"] },
  { id: 9, title: "同族群／最像同業名單", focus: ["最像的直接同業", "次產業相近同業", "估值比較對象", "景氣觀察對象", "應用延伸與未來方向"] },
  { id: 10, title: "估值與目標價｜PE×EPS三情境／同業分位數／安全邊際／操作點", focus: ["保守、中性、樂觀EPS", "合理PE區間", "同業交易分位", "安全邊際", "便宜價、合理價、偏熱價", "追價、回檔接或觀察"] },
  { id: 11, title: "技術面與節奏｜現在是主升、整理、還是轉弱", focus: ["趨勢方向", "關鍵支撐與壓力", "爆量有效性", "低位轉強、波段中段或高位整理", "左側、右側、突破或拉回"] },
  { id: 12, title: "多空結論與KPI追蹤表｜最後給判斷", focus: ["偏多／中立／偏空", "核心理由3點", "失敗條件2–3點", "營收、毛利率、利用率、新客戶、法人與大戶KPI"] },
] as const;

const sectionIdSchema = z.number().int().min(1).max(12);
const scenarioSchema = z.object({
  eps: z.number().optional(),
  pe_low: z.number().positive().optional(),
  pe_high: z.number().positive().optional(),
  note: z.string().trim().max(1000).optional().default(""),
});

let analysisSchemaReady = false;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function queryAll(db: D1Database, sql: string, values: unknown[] = []) {
  return (await db.prepare(sql).bind(...values).all<Obj>()).results ?? [];
}

async function queryFirst(db: D1Database, sql: string, values: unknown[] = []) {
  return await db.prepare(sql).bind(...values).first<Obj>();
}

async function ensureAnalysisSchema(env: Env) {
  const db = await ensureGlobalIndustrySchema(env);
  if (analysisSchemaReady) return db;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS stock_analysis_section_context (
      symbol TEXT NOT NULL,
      section_id INTEGER NOT NULL,
      as_of_date TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL DEFAULT 'manual',
      source_url TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (symbol, section_id, as_of_date)
    );
    CREATE INDEX IF NOT EXISTS idx_stock_analysis_context_symbol ON stock_analysis_section_context(symbol, section_id, as_of_date DESC);

    CREATE TABLE IF NOT EXISTS stock_analysis_kpis (
      symbol TEXT NOT NULL,
      kpi_key TEXT NOT NULL,
      kpi_name TEXT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'quarterly',
      target_text TEXT NOT NULL DEFAULT '',
      warning_condition TEXT NOT NULL DEFAULT '',
      latest_value TEXT NOT NULL DEFAULT '',
      latest_period TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'watch',
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (symbol, kpi_key)
    );

    CREATE TABLE IF NOT EXISTS stock_analysis_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      as_of_date TEXT NOT NULL,
      template_version TEXT NOT NULL,
      completeness_percent REAL NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stock_analysis_snapshot_symbol ON stock_analysis_snapshots(symbol, as_of_date DESC, created_at DESC);
  `);
  analysisSchemaReady = true;
  return db;
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
  const positiveYoy = recent.filter((row) => (row.yoy_percent ?? -Infinity) > 0).length;
  return {
    latest: { ...latest, yoy_percent: yoy, mom_percent: mom },
    history: recent,
    trend: yoy == null ? "缺少去年同期" : yoy > 20 ? "高速成長" : yoy > 0 ? "正成長" : yoy < -20 ? "明顯衰退" : "小幅衰退",
    positive_yoy_months_in_recent_6: positiveYoy,
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
    const interestExpense = selectMetric(inc, ["interestexpense", "利息費用"]);
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
      interest_expense: interestExpense,
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

function buildValuationScenarios(currentPrice: number, scenarios: Record<string, { eps?: number; pe_low?: number; pe_high?: number; note?: string }>) {
  return Object.entries(scenarios).map(([name, scenario]) => ({
    scenario: name,
    eps: scenario.eps ?? null,
    pe_low: scenario.pe_low ?? null,
    pe_high: scenario.pe_high ?? null,
    fair_value_low: scenario.eps != null && scenario.pe_low != null ? round(scenario.eps * scenario.pe_low) : null,
    fair_value_high: scenario.eps != null && scenario.pe_high != null ? round(scenario.eps * scenario.pe_high) : null,
    current_price: currentPrice || null,
    note: scenario.note ?? "",
  }));
}

function sectionStatus(data: unknown, manual: Obj | null) {
  const hasManual = manual && Object.keys(manual).length > 0;
  const hasData = Array.isArray(data) ? data.length > 0 : data != null && (typeof data !== "object" || Object.keys(rec(data)).length > 0);
  return hasManual && hasData ? "complete" : hasManual || hasData ? "partial" : "missing";
}

export function registerTaiwanStockAnalysis12Tools(server: McpServer, env: Env) {
  server.registerTool("get_taiwan_stock_analysis_template_12", {
    description: "取得正式版台股個股分析1–12模板、每段目的與必要檢查項目。",
    inputSchema: {},
  }, async () => ok({ template_version: TEMPLATE_VERSION, section_count: 12, sections: TAIWAN_STOCK_ANALYSIS_TEMPLATE_12 }));

  server.registerTool("set_taiwan_stock_analysis_context", {
    description: "保存公司產品、產能、客戶、訂單、催化劑等人工核實資料，依1–12段落歸檔並保留日期與來源。",
    inputSchema: {
      symbol: stockSchema,
      section_id: sectionIdSchema,
      payload: z.record(z.string(), z.any()),
      as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      source: z.string().trim().max(200).optional().default("manual_verified"),
      source_url: z.string().url().optional().or(z.literal("")),
    },
  }, async ({ symbol, section_id, payload, as_of_date, source, source_url }) => {
    try {
      const db = await ensureAnalysisSchema(env);
      const date = as_of_date ?? taipeiDate();
      await db.prepare(`INSERT INTO stock_analysis_section_context
        (symbol, section_id, as_of_date, payload_json, source, source_url, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol, section_id, as_of_date) DO UPDATE SET
          payload_json=excluded.payload_json, source=excluded.source, source_url=excluded.source_url, updated_at=excluded.updated_at`)
        .bind(symbol, section_id, date, JSON.stringify(payload), source, source_url ?? "", new Date().toISOString()).run();
      return ok({ symbol, section_id, as_of_date: date, saved: true });
    } catch (error) { return fail(error); }
  });

  server.registerTool("upsert_taiwan_stock_analysis_kpi", {
    description: "新增或更新第12段KPI追蹤項目，例如營收YoY、毛利率、產能利用率、新客戶、法人與大戶持股。",
    inputSchema: {
      symbol: stockSchema,
      kpi_key: z.string().trim().min(1).max(100),
      kpi_name: z.string().trim().min(1).max(200),
      frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "annual", "event_driven"]).optional().default("quarterly"),
      target_text: z.string().trim().max(1000).optional().default(""),
      warning_condition: z.string().trim().max(1000).optional().default(""),
      latest_value: z.string().trim().max(500).optional().default(""),
      latest_period: z.string().trim().max(100).optional().default(""),
      status: z.enum(["positive", "watch", "warning", "failed"]).optional().default("watch"),
      note: z.string().trim().max(2000).optional().default(""),
    },
  }, async (input) => {
    try {
      const db = await ensureAnalysisSchema(env);
      await db.prepare(`INSERT INTO stock_analysis_kpis
        (symbol, kpi_key, kpi_name, frequency, target_text, warning_condition, latest_value, latest_period, status, note, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol, kpi_key) DO UPDATE SET
          kpi_name=excluded.kpi_name, frequency=excluded.frequency, target_text=excluded.target_text,
          warning_condition=excluded.warning_condition, latest_value=excluded.latest_value,
          latest_period=excluded.latest_period, status=excluded.status, note=excluded.note, updated_at=excluded.updated_at`)
        .bind(input.symbol, input.kpi_key, input.kpi_name, input.frequency, input.target_text,
          input.warning_condition, input.latest_value, input.latest_period, input.status, input.note, new Date().toISOString()).run();
      return ok({ symbol: input.symbol, kpi_key: input.kpi_key, saved: true });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_taiwan_stock_analysis_kpis", {
    description: "取得指定台股的KPI追蹤表。",
    inputSchema: { symbol: stockSchema },
  }, async ({ symbol }) => {
    try {
      const db = await ensureAnalysisSchema(env);
      const data = await queryAll(db, "SELECT * FROM stock_analysis_kpis WHERE symbol = ? ORDER BY status DESC, kpi_name", [symbol]);
      return ok({ symbol, data });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_taiwan_stock_analysis_12", {
    description: "依正式1–12模板產生台股個股完整分析資料包；只呈現已取得或人工核實資料，缺漏會明確標示，不會自行捏造客戶、訂單或目標價。",
    inputSchema: {
      symbol: stockSchema,
      as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      conservative: scenarioSchema.optional(),
      neutral: scenarioSchema.optional(),
      optimistic: scenarioSchema.optional(),
      save_snapshot: z.boolean().optional().default(true),
    },
  }, async ({ symbol, as_of_date, conservative, neutral, optimistic, save_snapshot }) => {
    try {
      const date = as_of_date ?? taipeiDate();
      const db = await ensureAnalysisSchema(env);
      const start3y = taipeiDate(1_150);
      const start18m = taipeiDate(550);
      const start120d = taipeiDate(180);

      const [company, contexts, kpis, revenueResult, incomeResult, balanceResult, cashResult, quoteResult, priceResult, institutionalResult, eventsResult] = await Promise.all([
        queryFirst(db, "SELECT * FROM global_companies WHERE country = 'TW' AND ticker = ? ORDER BY exchange = 'TWSE' DESC LIMIT 1", [symbol]),
        queryAll(db, `SELECT c.* FROM stock_analysis_section_context c
          JOIN (SELECT section_id, MAX(as_of_date) latest_date FROM stock_analysis_section_context WHERE symbol = ? AND as_of_date <= ? GROUP BY section_id) x
          ON x.section_id = c.section_id AND x.latest_date = c.as_of_date
          WHERE c.symbol = ? ORDER BY c.section_id`, [symbol, date, symbol]),
        queryAll(db, "SELECT * FROM stock_analysis_kpis WHERE symbol = ? ORDER BY kpi_name", [symbol]),
        finmind(env, "TaiwanStockMonthRevenue", { data_id: symbol, start_date: start18m, end_date: date }).then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error: errorText(error) })),
        finmind(env, "TaiwanStockFinancialStatements", { data_id: symbol, start_date: start3y, end_date: date }).then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error: errorText(error) })),
        finmind(env, "TaiwanStockBalanceSheet", { data_id: symbol, start_date: start3y, end_date: date }).then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error: errorText(error) })),
        finmind(env, "TaiwanStockCashFlowsStatement", { data_id: symbol, start_date: start3y, end_date: date }).then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error: errorText(error) })),
        fugle(env, `/intraday/quote/${encodeURIComponent(symbol)}`).then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error: errorText(error) })),
        finmind(env, "TaiwanStockPrice", { data_id: symbol, start_date: start120d, end_date: date }).then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error: errorText(error) })),
        finmind(env, "TaiwanStockInstitutionalInvestorsBuySell", { data_id: symbol, start_date: taipeiDate(35), end_date: date }).then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error: errorText(error) })),
        fetchOfficialEvents(symbol).then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error: errorText(error) })),
      ]);

      const manual = new Map<number, Obj>();
      for (const row of contexts) {
        try { manual.set(num(row.section_id), rec(JSON.parse(String(row.payload_json ?? "{}")))); } catch {}
      }

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
      const valuationScenarios = buildValuationScenarios(quote?.close ?? 0, {
        conservative: conservative ?? {},
        neutral: neutral ?? {},
        optimistic: optimistic ?? {},
      });

      const sectionPayloads: Record<number, unknown> = {
        1: { company, official_industry: company?.official_industry ?? null, themes: memberships, evidence: evidence.slice(0, 20) },
        2: { themes: memberships, supply_chain: edges, peer_count: peers.length },
        3: { monthly_revenue: revenue, financials },
        4: { monthly_revenue: revenue, growth_evidence: evidence.filter((row) => /新產品|量產|擴產|產能|新客戶|成長|訂單/i.test(String(row.evidence_text ?? ""))).slice(0, 30) },
        5: { capacity_and_geopolitics_evidence: evidence.filter((row) => /產能|廠區|中國|越南|泰國|墨西哥|美國|日本|印度|China\+1|關稅|制裁/i.test(String(row.evidence_text ?? ""))).slice(0, 30) },
        6: { supply_chain: edges, customer_order_evidence: evidence.filter((row) => /客戶|訂單|長約|design-in|出貨|能見度/i.test(String(row.evidence_text ?? ""))).slice(0, 30) },
        7: { official_events: officialEvents.data, evidence: evidence.slice(0, 30), financial_risk_flags: financials.flags },
        8: { institutional_35d: institutional, major_holder_400_1000: manual.get(8)?.major_holder_400_1000 ?? null },
        9: { direct_and_related_peers: peers },
        10: { quote, latest_reported_eps: financials.latest?.eps ?? null, scenarios: valuationScenarios },
        11: { quote, technical },
        12: { kpis, financial_risk_flags: financials.flags, revenue_trend: revenue.trend, technical_score: technical?.score ?? null },
      };

      const sections = TAIWAN_STOCK_ANALYSIS_TEMPLATE_12.map((definition) => {
        const manualPayload = manual.get(definition.id) ?? null;
        const autoData = sectionPayloads[definition.id];
        return {
          ...definition,
          status: sectionStatus(autoData, manualPayload),
          auto_data: autoData,
          verified_context: manualPayload,
          rule: "verified_context優先；auto_data只呈現可追溯資料；缺少資料時不得推測客戶、訂單、產能比重或目標價。",
        };
      });
      const completeEquivalent = sections.reduce((sum, section) => sum + (section.status === "complete" ? 1 : section.status === "partial" ? 0.5 : 0), 0);
      const completeness = round(completeEquivalent / sections.length * 100, 2);
      const errors = [
        !revenueResult.ok ? `月營收：${revenueResult.error}` : null,
        !incomeResult.ok ? `損益表：${incomeResult.error}` : null,
        !balanceResult.ok ? `資產負債表：${balanceResult.error}` : null,
        !cashResult.ok ? `現金流量表：${cashResult.error}` : null,
        !quoteResult.ok ? `即時報價：${quoteResult.error}` : null,
        !priceResult.ok ? `歷史股價：${priceResult.error}` : null,
        !institutionalResult.ok ? `法人籌碼：${institutionalResult.error}` : null,
        ...officialEvents.errors.map((message: string) => `重大訊息：${message}`),
      ].filter(Boolean);

      const result = {
        template_version: TEMPLATE_VERSION,
        symbol,
        as_of_date: date,
        generated_at: new Date().toISOString(),
        company_found_in_global_map: Boolean(company),
        completeness_percent: completeness,
        sections,
        partial_errors: errors,
        interpretation_boundary: "本工具是1–12分析資料包，不把缺資料視為零分，也不以未驗證推測補齊內容。多空結論仍須根據當時公開資料與使用者風險承受度形成。",
      };

      if (save_snapshot) {
        await db.prepare(`INSERT INTO stock_analysis_snapshots
          (snapshot_id, symbol, as_of_date, template_version, completeness_percent, payload_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), symbol, date, TEMPLATE_VERSION, completeness, JSON.stringify(result), new Date().toISOString()).run();
      }
      return ok(result);
    } catch (error) { return fail(error); }
  });
}
