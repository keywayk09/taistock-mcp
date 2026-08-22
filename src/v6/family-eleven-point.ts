export const FAMILY_ELEVEN_POINT_VERSION = "family-eleven-point/v1.0.0";

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

function rowsLatestDate(rows: any[]) {
  return [...new Set(rows.map((row) => String(rec(row).date ?? "")).filter(Boolean))].sort().at(-1) ?? null;
}

function parseHoldingRange(value: unknown) {
  const raw = String(value ?? "").replaceAll(",", "").replaceAll("股", "").replace(/\s/g, "");
  const numbers = raw.match(/\d+/g)?.map(Number).filter(Number.isFinite) ?? [];
  if (!numbers.length) return { min: null as number | null, max: null as number | null, raw };
  if (/以上|up|over|more/i.test(raw)) return { min: numbers[0], max: null as number | null, raw };
  if (numbers.length >= 2) return { min: Math.min(numbers[0], numbers[1]), max: Math.max(numbers[0], numbers[1]), raw };
  return { min: numbers[0], max: numbers[0], raw };
}

function distributionSnapshot(rows: any[], date: string | null) {
  if (!date) return null;
  const selected = rows.filter((row) => String(rec(row).date ?? "") === date);
  const normalized = selected.map((item) => {
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
  const sumPercent = (predicate: (row: ReturnType<typeof normalized[number]>) => boolean) => round(normalized.filter(predicate).reduce((sum, row) => sum + (row.percent ?? 0), 0), 4);
  const sumPeople = (predicate: (row: ReturnType<typeof normalized[number]>) => boolean) => normalized.filter(predicate).reduce((sum, row) => sum + (row.people ?? 0), 0);
  const ge400 = (row: ReturnType<typeof normalized[number]>) => (row.min_shares ?? -1) >= 400_001;
  const ge1000 = (row: ReturnType<typeof normalized[number]>) => (row.min_shares ?? -1) >= 1_000_001;
  const le10 = (row: ReturnType<typeof normalized[number]>) => (row.max_shares ?? Number.POSITIVE_INFINITY) <= 10_000;
  return {
    date,
    holders_400_lots_plus_proxy: {
      threshold_shares: 400_001,
      percent: sumPercent(ge400),
      people: sumPeople(ge400),
      note: "依集保分級只能用400,001股以上級距代理『400張以上』，400,000股邊界無法單獨拆出。",
    },
    holders_1000_lots_plus_proxy: {
      threshold_shares: 1_000_001,
      percent: sumPercent(ge1000),
      people: sumPeople(ge1000),
      note: "依集保分級使用1,000,001股以上級距代理『1000張以上』。",
    },
    small_holders_10_lots_or_less: {
      max_shares: 10_000,
      percent: sumPercent(le10),
      people: sumPeople(le10),
    },
    levels: normalized,
  };
}

export function summarizeFamilyHoldingDistribution(rows: any[]) {
  const dates = [...new Set(rows.map((row) => String(rec(row).date ?? "")).filter(Boolean))].sort();
  const latestDate = dates.at(-1) ?? null;
  const previousDate = dates.at(-2) ?? null;
  const latest = distributionSnapshot(rows, latestDate);
  const previous = distributionSnapshot(rows, previousDate);
  const delta = latest && previous ? {
    holders_400_lots_plus_percent_change: round((latest.holders_400_lots_plus_proxy.percent ?? 0) - (previous.holders_400_lots_plus_proxy.percent ?? 0), 4),
    holders_1000_lots_plus_percent_change: round((latest.holders_1000_lots_plus_proxy.percent ?? 0) - (previous.holders_1000_lots_plus_proxy.percent ?? 0), 4),
    small_holders_percent_change: round((latest.small_holders_10_lots_or_less.percent ?? 0) - (previous.small_holders_10_lots_or_less.percent ?? 0), 4),
  } : null;
  return {
    status: latest ? "READY" : "UNAVAILABLE",
    source: "FinMind TaiwanStockHoldingSharesPer / TDCC shareholding levels",
    latest,
    previous,
    change: delta,
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
  const ownRows = industryRows.filter((row) => String(rec(row).stock_id ?? "") === symbol);
  const ownKeys = new Set(ownRows.map((row) => `${String(rec(row).industry ?? "")}::${String(rec(row).sub_industry ?? "")}`));
  const peerOverlap = new Map<string, number>();
  for (const item of industryRows) {
    const row = rec(item);
    const peer = String(row.stock_id ?? "");
    if (!peer || peer === symbol) continue;
    const key = `${String(row.industry ?? "")}::${String(row.sub_industry ?? "")}`;
    if (ownKeys.has(key)) peerOverlap.set(peer, (peerOverlap.get(peer) ?? 0) + 1);
  }
  const infoMap = new Map(infoRows.map((item) => [String(rec(item).stock_id ?? ""), rec(item)]));
  let peers = [...peerOverlap.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 15)
    .map(([peer, overlap]) => ({
      symbol: peer,
      name: String(infoMap.get(peer)?.stock_name ?? ""),
      industry_category: String(infoMap.get(peer)?.industry_category ?? ""),
      shared_chain_count: overlap,
      basis: "FinMind TaiwanStockIndustryChain",
    }));

  if (!peers.length) {
    const fallbackIndustry = String(company.industry_category ?? "");
    peers = infoRows
      .map(rec)
      .filter((row) => String(row.stock_id ?? "") !== symbol && fallbackIndustry && String(row.industry_category ?? "") === fallbackIndustry)
      .slice(0, 15)
      .map((row) => ({
        symbol: String(row.stock_id ?? ""),
        name: String(row.stock_name ?? ""),
        industry_category: String(row.industry_category ?? ""),
        shared_chain_count: null,
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
    note: "同業名單是資料分類候選，不等於競爭強弱排名；市場地位仍需最新法說/年報/Web來源驗證。",
  };
}

function trendDirection(values: Array<number | null>) {
  const clean = values.filter((value): value is number => value !== null);
  if (clean.length < 2) return "INSUFFICIENT";
  const first = clean[0], last = clean.at(-1)!;
  if (last > first * 1.05) return "UP";
  if (last < first * 0.95) return "DOWN";
  return "FLAT";
}

function point(id: number, title: string, status: string, evidence: unknown, web_research: string[] = [], guardrails: string[] = []) {
  return { id, title, status, evidence, web_research, guardrails };
}

export function buildFamilyElevenPointAnalysis(input: ElevenPointInput) {
  const analysis = rec(input.analysis);
  const intelligence = rec(input.intelligence);
  const company = rec(analysis.company);
  const accounting = rec(intelligence.accounting);
  const revenue = rec(intelligence.monthly_revenue);
  const valuation = rec(intelligence.official_valuation);
  const marketSnapshot = rec(analysis.market_snapshot);
  const technical = rec(analysis.technical);
  const holding = summarizeFamilyHoldingDistribution(input.holding_distribution_rows ?? []);
  const foreignShareholding = summarizeFamilyForeignShareholding(input.foreign_shareholding_rows ?? []);
  const industry = buildIndustryContext(input.symbol, company, input.industry_chain_rows ?? [], input.all_stock_info_rows ?? []);
  const periods = Array.isArray(accounting.periods) ? accounting.periods.map(rec) : [];
  const epsTrend = trendDirection(periods.slice(-4).map((row) => n(row.eps)));
  const grossMarginTrend = trendDirection(periods.slice(-4).map((row) => n(row.gross_margin_percent)));
  const operatingMarginTrend = trendDirection(periods.slice(-4).map((row) => n(row.operating_margin_percent)));
  const latestValuation = Array.isArray(valuation.data) ? rec(valuation.data[0]) : {};
  const currentPrice = n(rec(marketSnapshot.quote).close) ?? n(rec(marketSnapshot.latest_daily_bar).close);
  const pe = n(latestValuation.pe_ratio);
  const impliedTrailingEps = currentPrice !== null && pe !== null && pe > 0 ? round(currentPrice / pe, 4) : null;
  const chip = rec(analysis.chip);
  const chipReady = Boolean(chip.ok) && ["READY", "DEGRADED"].includes(String(chip.status ?? ""));
  const structuredRisks = Array.isArray(accounting.flags) ? accounting.flags : [];

  const webTasks = {
    company: [`${input.symbol} 公司 主要產品 營收比重 商業模式 年報 法說`],
    industry: [`${input.symbol} 市佔率 競爭對手 產業地位 技術優勢 議價能力`],
    growth: [`${input.symbol} 法說 2026 2027 展望 新產品 擴產 資本支出 成長動能`],
    capacity: [`${input.symbol} 全球產能 海外廠 中國 東南亞 美國 墨西哥 地緣政治 China+1`],
    customers: [`${input.symbol} 客戶 訂單 能見度 backlog 出貨 法說`],
    catalysts: [`${input.symbol} 催化劑 風險 法說 新聞 2026`],
    peers: [`${input.symbol} 同業 競爭對手 同產業 台股`],
    valuation: [`${input.symbol} 外資 投信 目標價 EPS 預估 2026 2027 本益比`],
  };

  const points = [
    point(1, "公司在做什麼｜商業模式與賺錢結構", company.stock_id || company.stock_name ? "PARTIAL_NEEDS_WEB" : "NEEDS_WEB_RESEARCH", {
      stock_id: company.stock_id ?? input.symbol,
      stock_name: company.stock_name ?? "",
      market_type: company.type ?? null,
      industry_category: company.industry_category ?? null,
      structured_limit: "TaiwanStockInfo只提供基本分類，主要產品、營收來源與商業模式需用公司年報/法說補齊。",
    }, webTasks.company),

    point(2, "產業位置｜市場地位與競爭優勢", industry.status === "READY" ? "PARTIAL_NEEDS_WEB" : "NEEDS_WEB_RESEARCH", {
      industry,
      structured_limit: "產業鏈分類不等於市佔率、護城河或議價能力。",
    }, webTasks.industry),

    point(3, "財務體質｜獲利品質、現金流與負債", accounting.status === "READY" ? "READY" : "DEGRADED", {
      latest: accounting.latest ?? null,
      previous: accounting.previous ?? null,
      risk_score: accounting.risk_score ?? null,
      quality: accounting.quality ?? null,
      flags: structuredRisks,
      eps_trend_last_4_periods: epsTrend,
      gross_margin_trend_last_4_periods: grossMarginTrend,
      operating_margin_trend_last_4_periods: operatingMarginTrend,
      semantics: accounting.semantics ?? null,
    }, [], ["ROE期間估算不可冒充年化ROE。", "缺值保持null，不得自行補值。"]),

    point(4, "成長性｜歷史成長與未來1–2年動能", revenue.status === "READY" || accounting.status === "READY" ? "PARTIAL_NEEDS_WEB" : "NEEDS_WEB_RESEARCH", {
      monthly_revenue: revenue,
      eps_trend_last_4_periods: epsTrend,
      gross_margin_trend_last_4_periods: grossMarginTrend,
      operating_margin_trend_last_4_periods: operatingMarginTrend,
      note: "歷史數據由結構化來源提供；未來成長驅動因子必須用最新法說/公司公告/Web驗證。",
    }, webTasks.growth),

    point(5, "全球產能與地緣政治配置｜China+1與供應風險", "NEEDS_WEB_RESEARCH", {
      industry_chain_context: industry.industry_chains,
      structured_status: "NO_VERIFIED_CAPACITY_DATABASE_IN_FAMILY_SURFACE",
    }, webTasks.capacity, ["不得從產業鏈分類推測廠區、產能或國家配置。"]),

    point(6, "客戶與訂單能見度｜訂單來源與持續性", "NEEDS_WEB_RESEARCH", {
      structured_status: "NO_VERIFIED_CUSTOMER_ORDER_DATABASE_IN_FAMILY_SURFACE",
    }, webTasks.customers, ["客戶、訂單、backlog與出貨展望必須標示公司法說/公告/可靠媒體來源。"]),

    point(7, "催化劑與風險｜時間點具體", structuredRisks.length ? "PARTIAL_NEEDS_WEB" : "NEEDS_WEB_RESEARCH", {
      structured_financial_risks: structuredRisks,
      accounting_quality: accounting.quality ?? null,
      accounting_risk_score: accounting.risk_score ?? null,
    }, webTasks.catalysts, ["催化劑需有時間點或事件；新聞不能覆蓋結構化財務風險。"]),

    point(8, "籌碼風向｜400/1000張大戶＋法人籌碼", chipReady || holding.status === "READY" || foreignShareholding.status === "READY" ? "READY_OR_DEGRADED" : "DEGRADED", {
      formal_published_chip: chip,
      holder_distribution: holding,
      foreign_shareholding: foreignShareholding,
      policy: "三大法人/融資融券/借券以Published generation為正式層；股權分級與外資持股為FinMind唯讀補充。",
    }, [], ["股權分級若帳號權限不足，不能用新聞或推測補400/1000張數字。"]),

    point(9, "同產業個股｜同族群與最像同業", industry.peer_candidates?.length ? "PARTIAL_NEEDS_WEB" : "NEEDS_WEB_RESEARCH", {
      peer_candidates: industry.peer_candidates ?? [],
      basis: industry.status,
      note: "候選同業需再用產品重疊、客戶結構與市場定位做Web驗證。",
    }, webTasks.peers),

    point(10, "估值與目標價｜PE×EPS三情境", valuation.status === "READY" ? "PARTIAL_NEEDS_WEB" : "NEEDS_WEB_RESEARCH", {
      official_valuation: valuation,
      current_display_price: currentPrice,
      implied_trailing_eps_from_price_div_pe: impliedTrailingEps,
      published_analyst_targets: {
        status: "WEB_RESEARCH_REQUIRED",
        rule: "外資/投信公開目標價必須保留機構、日期、EPS假設與來源；不得混成引擎估值。",
      },
      engine_fair_value_three_scenarios: {
        status: "NEEDS_FORWARD_EPS_AND_PE_ASSUMPTIONS",
        formula: "fair_value = forward_eps × target_PE",
        conservative: { forward_eps: null, target_pe: null, fair_value: null },
        base: { forward_eps: null, target_pe: null, fair_value: null },
        optimistic: { forward_eps: null, target_pe: null, fair_value: null },
        rule: "未取得有來源的未來EPS與合理PE前，不產生假目標價。",
      },
    }, webTasks.valuation),

    point(11, "技術面與操作節奏｜型態、支撐壓力與追價風險", technical.status === "READY" ? "PARTIAL_NEEDS_OHLC_MCP" : "NEEDS_OHLC_MCP", {
      research_technical_fallback: technical,
      formal_ohlc: false,
      formal_operation_levels: {
        status: "NEEDS_OHLC_MCP",
        required: ["正式日K", "均線", "型態", "支撐", "壓力", "轉弱線", "量價"],
      },
      note: "FinMind日K僅可作研究降級參考；正式進場區/支撐壓力/停損不可冒充OHLC MCP結果。",
    }, [], ["沒有正式OHLC就不給精確進場價、支撐、壓力或停損。"]),
  ];

  const webResearch = points.flatMap((item) => item.web_research.map((query) => ({ point: item.id, query })));
  const structuredReady = points.filter((item) => ["READY", "READY_OR_DEGRADED"].includes(item.status)).length;
  const needsWeb = points.filter((item) => item.status.includes("WEB")).length;
  const needsOhlc = points.filter((item) => item.status.includes("OHLC")).length;

  return {
    version: FAMILY_ELEVEN_POINT_VERSION,
    symbol: input.symbol,
    as_of_date: input.as_of_date,
    contract: "FIXED_1_TO_11_COMPLETE_TEMPLATE",
    points,
    coverage: {
      point_count: 11,
      structured_ready_or_chip_ready: structuredReady,
      points_requiring_web_completion: needsWeb,
      points_requiring_formal_ohlc: needsOhlc,
      enrichment_errors: input.enrichment_errors ?? [],
    },
    web_research_plan: webResearch,
    final_answer_policy: [
      "最終給媽媽/家人的個股回答必須固定輸出1到11，不可省略或合併點位。",
      "Web可以補公司、產業、產能、客戶、訂單、催化劑、同業與機構目標價，但要清楚標示來源。",
      "正式籌碼不可由Web新聞取代；以Published generation為準。",
      "正式OHLC不可由Web或FinMind研究K線冒充；缺OHLC時第11點明示缺口。",
      "第10點公開機構目標價與引擎PE×EPS合理價必須分開。",
      "任何缺值都保持未知/null，不為了湊滿11點而捏造數字。",
    ],
  };
}
