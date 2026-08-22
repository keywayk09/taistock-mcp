export const FAMILY_ELEVEN_POINT_VERSION = "family-eleven-point/v1.1.0";

type AnyRecord = Record<string, any>;

type ElevenPointInput = {
  symbol: string;
  as_of_date: string;
  analysis: AnyRecord;
  intelligence: AnyRecord;
  holding_distribution_rows?: any[];
  foreign_shareholding_rows?: any[];
  industry_chain_rows?: any[];
  all_stock_info_rows?: any[];
  enrichment_errors?: string[];
};

type HoldingLevel = {
  level: string;
  min_shares: number | null;
  max_shares: number | null;
  people: number | null;
  percent: number | null;
  shares: number | null;
};

function rec(value: unknown): AnyRecord {
  return value !== null && typeof value === "object" ? value as AnyRecord : {};
}

function n(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replaceAll(",", "").replace(/%$/, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function parseHoldingRange(value: unknown) {
  const raw = String(value ?? "").replaceAll(",", "").replaceAll("股", "").replace(/\s/g, "");
  const values = raw.match(/\d+/g)?.map(Number).filter(Number.isFinite) ?? [];
  if (!values.length) return { min: null as number | null, max: null as number | null };
  if (/以上|up|over|more/i.test(raw)) return { min: values[0], max: null as number | null };
  if (values.length >= 2) return { min: Math.min(values[0], values[1]), max: Math.max(values[0], values[1]) };
  return { min: values[0], max: values[0] };
}

function holdingSnapshot(rows: any[], date: string | null) {
  if (!date) return null;
  const levels: HoldingLevel[] = rows
    .filter((item) => String(rec(item).date ?? "") === date)
    .map((item) => {
      const row = rec(item);
      const range = parseHoldingRange(row.HoldingSharesLevel);
      return {
        level: String(row.HoldingSharesLevel ?? ""),
        min_shares: range.min,
        max_shares: range.max,
        people: n(row.people),
        percent: n(row.percent),
        shares: n(row.unit),
      };
    });
  const sumPercent = (predicate: (row: HoldingLevel) => boolean) => round(levels.filter(predicate).reduce((sum, row) => sum + (row.percent ?? 0), 0), 4);
  const sumPeople = (predicate: (row: HoldingLevel) => boolean) => levels.filter(predicate).reduce((sum, row) => sum + (row.people ?? 0), 0);
  const over400 = (row: HoldingLevel) => (row.min_shares ?? -1) >= 400_001;
  const over1000 = (row: HoldingLevel) => (row.min_shares ?? -1) >= 1_000_001;
  const small10 = (row: HoldingLevel) => (row.max_shares ?? Number.POSITIVE_INFINITY) <= 10_000;
  return {
    date,
    holders_400_lots_plus_proxy: {
      percent: sumPercent(over400),
      people: sumPeople(over400),
      threshold_shares: 400_001,
      note: "集保分級以400,001股以上級距代理400張以上；400,000股邊界無法單獨拆出。",
    },
    holders_1000_lots_plus_proxy: {
      percent: sumPercent(over1000),
      people: sumPeople(over1000),
      threshold_shares: 1_000_001,
      note: "集保分級以1,000,001股以上級距代理1000張以上。",
    },
    small_holders_10_lots_or_less: {
      percent: sumPercent(small10),
      people: sumPeople(small10),
      max_shares: 10_000,
    },
    levels,
  };
}

export function summarizeFamilyHoldingDistribution(rows: any[]) {
  const dates = [...new Set(rows.map((item) => String(rec(item).date ?? "")).filter(Boolean))].sort();
  const latest = holdingSnapshot(rows, dates.at(-1) ?? null);
  const previous = holdingSnapshot(rows, dates.at(-2) ?? null);
  return {
    status: latest ? "READY" : "UNAVAILABLE",
    source: "FinMind TaiwanStockHoldingSharesPer / TDCC shareholding levels",
    latest,
    previous,
    change: latest && previous ? {
      holders_400_lots_plus_percent_change: round(latest.holders_400_lots_plus_proxy.percent - previous.holders_400_lots_plus_proxy.percent, 4),
      holders_1000_lots_plus_percent_change: round(latest.holders_1000_lots_plus_proxy.percent - previous.holders_1000_lots_plus_proxy.percent, 4),
      small_holders_percent_change: round(latest.small_holders_10_lots_or_less.percent - previous.small_holders_10_lots_or_less.percent, 4),
    } : null,
  };
}

export function summarizeFamilyForeignShareholding(rows: any[]) {
  const sorted = [...rows].sort((a, b) => String(rec(a).date ?? "").localeCompare(String(rec(b).date ?? "")));
  const latest = rec(sorted.at(-1));
  const prior20 = rec(sorted.at(-21));
  const latestRatio = n(latest.ForeignInvestmentSharesRatio);
  const prior20Ratio = n(prior20.ForeignInvestmentSharesRatio);
  return {
    status: sorted.length ? "READY" : "UNAVAILABLE",
    source: "FinMind TaiwanStockShareholding",
    latest: sorted.length ? {
      date: latest.date ?? null,
      foreign_shares: n(latest.ForeignInvestmentShares),
      foreign_share_ratio_percent: latestRatio,
      remaining_ratio_percent: n(latest.ForeignInvestmentRemainRatio),
      upper_limit_ratio_percent: n(latest.ForeignInvestmentUpperLimitRatio),
    } : null,
    approx_20_observation_ratio_change_pct_points: latestRatio !== null && prior20Ratio !== null ? round(latestRatio - prior20Ratio, 4) : null,
  };
}

function buildIndustryContext(symbol: string, company: AnyRecord, industryRows: any[], infoRows: any[]) {
  const ownRows = industryRows.filter((item) => String(rec(item).stock_id ?? "") === symbol);
  const ownKeys = new Set(ownRows.map((item) => `${String(rec(item).industry ?? "")}::${String(rec(item).sub_industry ?? "")}`));
  const overlap = new Map<string, number>();
  for (const item of industryRows) {
    const row = rec(item);
    const peer = String(row.stock_id ?? "");
    if (!peer || peer === symbol) continue;
    const key = `${String(row.industry ?? "")}::${String(row.sub_industry ?? "")}`;
    if (ownKeys.has(key)) overlap.set(peer, (overlap.get(peer) ?? 0) + 1);
  }
  const infoMap = new Map(infoRows.map((item) => [String(rec(item).stock_id ?? ""), rec(item)]));
  let peers = [...overlap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([peer, count]) => ({
    symbol: peer,
    name: String(infoMap.get(peer)?.stock_name ?? ""),
    industry_category: String(infoMap.get(peer)?.industry_category ?? ""),
    shared_chain_count: count,
    basis: "FinMind TaiwanStockIndustryChain",
  }));
  if (!peers.length) {
    const category = String(company.industry_category ?? "");
    peers = infoRows.map(rec)
      .filter((row) => String(row.stock_id ?? "") !== symbol && category && String(row.industry_category ?? "") === category)
      .slice(0, 15)
      .map((row) => ({
        symbol: String(row.stock_id ?? ""),
        name: String(row.stock_name ?? ""),
        industry_category: String(row.industry_category ?? ""),
        shared_chain_count: 0,
        basis: "TaiwanStockInfo industry_category fallback",
      }));
  }
  return {
    status: ownRows.length ? "READY" : peers.length ? "DEGRADED" : "UNAVAILABLE",
    company_industry_category: String(company.industry_category ?? ""),
    industry_chains: ownRows.map((item) => ({
      industry: String(rec(item).industry ?? ""),
      sub_industry: String(rec(item).sub_industry ?? ""),
      date: rec(item).date ?? null,
    })),
    peer_candidates: peers,
    note: "同業名單是資料分類候選；市占率、競爭強弱與真正產品重疊仍需最新公開資料/Web驗證。",
  };
}

function trend(values: Array<number | null>) {
  const clean = values.filter((value): value is number => value !== null);
  if (clean.length < 2) return "INSUFFICIENT";
  const first = clean[0], last = clean.at(-1)!;
  if (last > first * 1.05) return "UP";
  if (last < first * 0.95) return "DOWN";
  return "FLAT";
}

function point(id: number, title: string, status: string, evidence: unknown, webResearch: string[] = [], guardrails: string[] = []) {
  return { id, title, status, evidence, web_research: webResearch, guardrails };
}

export function buildFamilyElevenPointAnalysis(input: ElevenPointInput) {
  const analysis = rec(input.analysis);
  const intelligence = rec(input.intelligence);
  const company = rec(analysis.company);
  const accounting = rec(intelligence.accounting);
  const revenue = rec(intelligence.monthly_revenue);
  const valuation = rec(intelligence.official_valuation);
  const market = rec(analysis.market_snapshot);
  const technical = rec(analysis.technical);
  const chip = rec(analysis.chip);
  const holding = summarizeFamilyHoldingDistribution(input.holding_distribution_rows ?? []);
  const foreign = summarizeFamilyForeignShareholding(input.foreign_shareholding_rows ?? []);
  const industry = buildIndustryContext(input.symbol, company, input.industry_chain_rows ?? [], input.all_stock_info_rows ?? []);
  const periods = Array.isArray(accounting.periods) ? accounting.periods.map(rec) : [];
  const epsTrend = trend(periods.slice(-4).map((row) => n(row.eps)));
  const grossTrend = trend(periods.slice(-4).map((row) => n(row.gross_margin_percent)));
  const opTrend = trend(periods.slice(-4).map((row) => n(row.operating_margin_percent)));
  const valuationRow = Array.isArray(valuation.data) ? rec(valuation.data[0]) : {};
  const price = n(rec(market.quote).close) ?? n(rec(market.latest_daily_bar).close);
  const pe = n(valuationRow.pe_ratio);
  const impliedTrailingEps = price !== null && pe !== null && pe > 0 ? round(price / pe, 4) : null;
  const financialFlags = Array.isArray(accounting.flags) ? accounting.flags : [];
  const chipReady = Boolean(chip.ok) && ["READY", "DEGRADED"].includes(String(chip.status ?? ""));

  const points = [
    point(1, "公司在做什麼｜商業模式與賺錢結構", company.stock_id || company.stock_name ? "PARTIAL_NEEDS_WEB" : "NEEDS_WEB_RESEARCH", {
      stock_id: company.stock_id ?? input.symbol,
      stock_name: company.stock_name ?? "",
      market_type: company.type ?? null,
      industry_category: company.industry_category ?? null,
    }, ["公司主要產品、營收比重、商業模式、年報與法說"]),
    point(2, "產業位置｜市場地位與競爭優勢", industry.status === "READY" ? "PARTIAL_NEEDS_WEB" : "NEEDS_WEB_RESEARCH", { industry }, ["市佔率、競爭對手、技術優勢、議價能力、產業週期"]),
    point(3, "財務體質｜獲利品質、現金流與負債", accounting.status === "READY" ? "READY" : "DEGRADED", {
      latest: accounting.latest ?? null,
      previous: accounting.previous ?? null,
      risk_score: accounting.risk_score ?? null,
      quality: accounting.quality ?? null,
      flags: financialFlags,
      eps_trend_last_4_periods: epsTrend,
      gross_margin_trend_last_4_periods: grossTrend,
      operating_margin_trend_last_4_periods: opTrend,
      semantics: accounting.semantics ?? null,
    }, [], ["ROE期間估算不可冒充年化ROE。", "缺值保持null。"]),
    point(4, "成長性｜歷史成長與未來1–2年動能", revenue.status === "READY" || accounting.status === "READY" ? "PARTIAL_NEEDS_WEB" : "NEEDS_WEB_RESEARCH", {
      monthly_revenue: revenue,
      eps_trend_last_4_periods: epsTrend,
      gross_margin_trend_last_4_periods: grossTrend,
      operating_margin_trend_last_4_periods: opTrend,
    }, ["最新法說、公司展望、新產品、擴產、資本支出、產業需求與未來1–2年成長驅動"]),
    point(5, "全球產能與地緣政治配置｜China+1與供應風險", "NEEDS_WEB_RESEARCH", {
      industry_chain_context: industry.industry_chains,
      structured_status: "NO_VERIFIED_CAPACITY_DATABASE_IN_FAMILY_SURFACE",
    }, ["全球廠區與產能、海外布局、中國/東南亞/美洲、China+1、關稅與地緣政治"]),
    point(6, "客戶與訂單能見度｜訂單來源與持續性", "NEEDS_WEB_RESEARCH", {
      structured_status: "NO_VERIFIED_CUSTOMER_ORDER_DATABASE_IN_FAMILY_SURFACE",
    }, ["主要客戶、訂單、backlog、出貨、客戶資本支出與需求能見度"]),
    point(7, "催化劑與風險｜時間點具體", financialFlags.length ? "PARTIAL_NEEDS_WEB" : "NEEDS_WEB_RESEARCH", {
      structured_financial_risks: financialFlags,
      accounting_quality: accounting.quality ?? null,
      accounting_risk_score: accounting.risk_score ?? null,
    }, ["法說、財報、產品時程、報價、政策、產業事件、近期新聞與反向風險"]),
    point(8, "籌碼風向｜400/1000張大戶＋法人籌碼", chipReady || holding.status === "READY" || foreign.status === "READY" ? "READY_OR_DEGRADED" : "DEGRADED", {
      formal_published_chip: chip,
      holder_distribution: holding,
      foreign_shareholding: foreign,
      policy: "三大法人/融資融券/借券以Published generation為正式層；股權分級與外資持股為FinMind唯讀補充。",
    }, [], ["股權分級資料不足時不可用新聞猜400/1000張數字。"]),
    point(9, "同產業個股｜同族群與最像同業", industry.peer_candidates?.length ? "PARTIAL_NEEDS_WEB" : "NEEDS_WEB_RESEARCH", {
      peer_candidates: industry.peer_candidates ?? [],
      basis: industry.status,
    }, ["產品重疊、客戶結構、市場定位、同業法說與海外競爭者"]),
    point(10, "估值與目標價｜PE×EPS三情境", valuation.status === "READY" ? "PARTIAL_NEEDS_WEB" : "NEEDS_WEB_RESEARCH", {
      official_valuation: valuation,
      current_display_price: price,
      implied_trailing_eps_from_price_div_pe: impliedTrailingEps,
      published_analyst_targets: {
        status: "WEB_RESEARCH_REQUIRED",
        rule: "機構目標價要保留機構、日期、EPS假設與來源，與引擎估值分開。",
      },
      engine_fair_value_three_scenarios: {
        status: "NEEDS_FORWARD_EPS_AND_PE_ASSUMPTIONS",
        formula: "fair_value = forward_eps × target_PE",
        conservative: { forward_eps: null, target_pe: null, fair_value: null },
        base: { forward_eps: null, target_pe: null, fair_value: null },
        optimistic: { forward_eps: null, target_pe: null, fair_value: null },
      },
    }, ["外資/投信公開研究、未來EPS預估、歷史/同業PE區間與市場預期"]),
    point(11, "技術面與操作節奏｜型態、支撐壓力與追價風險", technical.status === "READY" ? "PARTIAL_NEEDS_OHLC_MCP" : "NEEDS_OHLC_MCP", {
      realtime_or_research_context: market,
      research_technical_fallback: technical,
      formal_ohlc: false,
      formal_operation_levels: {
        status: "NEEDS_OHLC_MCP",
        required: ["正式日K", "均線", "型態", "支撐", "壓力", "轉弱線", "量價"],
      },
    }, [], ["沒有正式OHLC就不給精確進場價、支撐、壓力或停損。"]),
  ];

  return {
    version: FAMILY_ELEVEN_POINT_VERSION,
    symbol: input.symbol,
    as_of_date: input.as_of_date,
    contract: "FIXED_1_TO_11_COMPLETE_TEMPLATE",
    points,
    coverage: {
      point_count: points.length,
      points_requiring_web_completion: points.filter((item) => item.status.includes("WEB")).length,
      points_requiring_formal_ohlc: points.filter((item) => item.status.includes("OHLC")).length,
      enrichment_errors: input.enrichment_errors ?? [],
    },
    web_research_plan: points.flatMap((item) => item.web_research.map((topic) => ({ point: item.id, query: topic }))),
    final_answer_policy: [
      "最終個股回答固定輸出1到11，不省略或合併。",
      "Web可補公司、產業、產能、客戶、訂單、供應鏈、同業、催化劑與機構研究，但需標示來源。",
      "正式籌碼不可由Web取代；以Published generation為準。",
      "正式OHLC不可由Web或研究型K線冒充。",
      "第10點公開機構目標價與引擎PE×EPS合理價分開。",
      "缺值保持UNKNOWN/null，不為湊11點捏造數字。",
    ],
  };
}
