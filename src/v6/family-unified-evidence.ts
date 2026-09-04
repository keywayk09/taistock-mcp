import {
  summarizeFamilyForeignShareholding,
  summarizeFamilyHoldingDistribution,
} from "./family-eleven-point.ts";

export const FAMILY_UNIFIED_EVIDENCE_VERSION = "family-evidence/v1.2.0";

export type FamilyEvidenceClass =
  | "FORMAL_TRUTH"
  | "GOVERNED_CONTEXT"
  | "DISPLAY_FALLBACK"
  | "WEB_EVIDENCE";

export type FamilyEvidenceStatus = "READY" | "DEGRADED" | "PENDING" | "UNAVAILABLE";

type AnyRecord = Record<string, any>;

type FamilyUnifiedEvidenceInput = {
  symbol: string;
  as_of_date: string;
  request_intent?: string | null;
  analysis: AnyRecord;
  intelligence: AnyRecord;
  holding_distribution_rows?: any[];
  foreign_shareholding_rows?: any[];
};

type EvidenceNodeInput = {
  id: string;
  evidence_class: FamilyEvidenceClass;
  status: FamilyEvidenceStatus;
  source: string;
  as_of?: string | null;
  verification_level: string;
  formal_research_eligible: boolean;
  dataset_version?: string | null;
  provenance?: unknown;
  data?: unknown;
  error?: string | null;
  notes?: string[];
};

function rec(value: unknown): AnyRecord {
  return value !== null && typeof value === "object" ? value as AnyRecord : {};
}

function normalizeStatus(value: unknown): FamilyEvidenceStatus {
  const status = String(value ?? "").toUpperCase();
  if (status === "READY" || status === "READY_EMPTY") return "READY";
  if (status === "DEGRADED" || status === "READY_OR_DEGRADED" || status === "PARTIAL") return "DEGRADED";
  if (status === "PENDING") return "PENDING";
  return "UNAVAILABLE";
}

function evidenceNode(input: EvidenceNodeInput) {
  return {
    id: input.id,
    evidence_class: input.evidence_class,
    status: input.status,
    as_of: input.as_of ?? null,
    source: input.source,
    verification_level: input.verification_level,
    formal_research_eligible: input.formal_research_eligible,
    dataset_version: input.dataset_version ?? null,
    provenance: input.provenance ?? null,
    data: input.data ?? null,
    error: input.error ?? null,
    notes: input.notes ?? [],
  } as const;
}

function compactPublishedLayer(value: unknown) {
  const layer = rec(value);
  const rows = Array.isArray(layer.rows) ? layer.rows : [];
  const { rows: _rows, ...rest } = layer;
  return {
    ...rest,
    latest: layer.latest ?? rows.at(-1) ?? null,
    recent_rows: rows.slice(-5),
    row_count: rows.length,
  };
}

function compactPublishedChip(chip: AnyRecord, historyAsOf: string | null) {
  const layers = rec(chip.layers);
  return {
    status: rec(chip.legacy_archive_context).status ?? chip.status ?? "UNAVAILABLE",
    symbol: chip.symbol ?? null,
    requested_as_of: chip.requested_as_of ?? null,
    data_as_of: historyAsOf,
    calendar_days: chip.calendar_days ?? null,
    publication: chip.publication ?? null,
    data_quality: chip.data_quality ?? null,
    institutional: compactPublishedLayer(layers.institutional),
    margin: compactPublishedLayer(layers.margin),
    securities_lending: compactPublishedLayer(layers.securities_lending),
    sbl_short_sale: compactPublishedLayer(layers.sbl_short_sale),
  };
}

function countReady(values: unknown[]) {
  return values.filter((value) => normalizeStatus(rec(value).status) === "READY").length;
}

function governedContextNode(
  id: string,
  source: string,
  raw: unknown,
  notes: string[],
) {
  const value = rec(raw);
  const status = normalizeStatus(value.status);
  return evidenceNode({
    id,
    evidence_class: "GOVERNED_CONTEXT",
    status,
    source: status === "UNAVAILABLE" ? "UNAVAILABLE" : source,
    as_of: value.as_of ?? value.data_as_of ?? value.source_date ?? value.date ?? null,
    verification_level: status === "UNAVAILABLE" ? "NOT_ATTACHED" : String(value.verification_level ?? "GOVERNED_READ_ONLY"),
    formal_research_eligible: false,
    dataset_version: value.dataset_version ?? value.version ?? null,
    provenance: value.provenance ?? null,
    data: status === "UNAVAILABLE" ? null : value,
    error: value.error ?? value.reason ?? null,
    notes,
  });
}

export function buildFamilyUnifiedEvidence(input: FamilyUnifiedEvidenceInput) {
  const analysis = rec(input.analysis);
  const intelligence = rec(input.intelligence);
  const market = rec(analysis.market_snapshot);
  const stockLive = rec(analysis.stock_live_context ?? intelligence.stock_live_context);
  const technical = rec(analysis.technical);
  const chip = rec(analysis.chip);
  const chipQuality = rec(chip.data_quality);
  const currentChipPayload = rec(chip.on_demand_current);
  const brokerRanked = rec(chip.broker_branch_ranked);
  const warrantActivity = rec(chip.warrant_activity);
  const maintenanceRisk = rec(chip.current_maintenance_risk ?? rec(chip.layers).maintenance_risk);
  const legacyArchive = rec(chip.legacy_archive_context);
  const monthlyRevenue = rec(intelligence.monthly_revenue);
  const accounting = rec(intelligence.accounting);
  const officialValuation = rec(intelligence.official_valuation);
  const holding = summarizeFamilyHoldingDistribution(input.holding_distribution_rows ?? []);
  const foreign = summarizeFamilyForeignShareholding(input.foreign_shareholding_rows ?? []);

  const stockLiveStatus = normalizeStatus(stockLive.status);
  const stockLiveReady = ["READY", "DEGRADED"].includes(stockLiveStatus) && stockLive.display_ready === true;
  const fallbackRealtimeReady = Boolean(rec(market.quote).close || rec(market.latest_daily_bar).close);
  const realtimeStatus: FamilyEvidenceStatus = stockLiveReady
    ? stockLiveStatus
    : fallbackRealtimeReady
      ? "READY"
      : "UNAVAILABLE";

  const currentChipStatus = normalizeStatus(
    chipQuality.current_exact_date_status
      ?? currentChipPayload.status
      ?? (chip.preferred_current_evidence === "on_demand_current" ? chip.status : null),
  );
  const currentChipAttached = Object.keys(currentChipPayload).length > 0;
  const noPreviousDaySubstitution = chipQuality.previous_day_substitution !== true;
  const currentChipFormal = currentChipAttached
    && noPreviousDaySubstitution
    && (currentChipStatus === "READY" || currentChipStatus === "DEGRADED");

  // Compatibility: a direct historical Published object can still be supplied by
  // replay/unit tests, while the modern facade exposes the same archive as
  // legacy_archive_context. Historical evidence remains immutable but is not the
  // critical current-day decision source.
  const directPublished = Boolean(chip.ok) && chipQuality.formal_published === true && !currentChipAttached;
  const legacyHistoryStatus = legacyArchive.status ?? (directPublished ? chip.status : null);
  const formalPublishedChip = directPublished || Boolean(legacyArchive.status && chipQuality.formal_published === true);
  const publishedChipStatus = formalPublishedChip ? normalizeStatus(legacyHistoryStatus) : "UNAVAILABLE";
  const publishedHistoryAsOf = String(
    legacyArchive.data_as_of
      ?? (directPublished ? chip.data_as_of ?? rec(chip.publication).trade_date : "")
      ?? "",
  ) || null;

  const canonicalCandidate = rec(analysis.canonical_ohlc ?? intelligence.canonical_ohlc);
  const canonicalSource = String(canonicalCandidate.source ?? rec(canonicalCandidate.provenance).source ?? "");
  const canonicalFormal = canonicalCandidate.formal_research_eligible === true
    && /OHLC_MCP/i.test(canonicalSource);
  const canonicalStatus = canonicalFormal ? normalizeStatus(canonicalCandidate.status ?? "READY") : "UNAVAILABLE";

  const fundamentalsReadyCount = countReady([monthlyRevenue, accounting, officialValuation]);
  const fundamentalsStatus: FamilyEvidenceStatus = fundamentalsReadyCount >= 2
    ? "READY"
    : fundamentalsReadyCount === 1
      ? "DEGRADED"
      : "UNAVAILABLE";

  const holderStatus: FamilyEvidenceStatus = holding.status === "READY" && foreign.status === "READY"
    ? "READY"
    : holding.status === "READY" || foreign.status === "READY"
      ? "DEGRADED"
      : "UNAVAILABLE";

  const txfContext = rec(analysis.txf_context ?? intelligence.txf_context);
  const globalMarketContext = rec(analysis.global_market_context ?? intelligence.global_market_context);
  const globalFuturesContext = rec(analysis.global_futures_context ?? intelligence.global_futures_context);

  const evidence = {
    realtime_market: evidenceNode({
      id: "realtime_market",
      evidence_class: "DISPLAY_FALLBACK",
      status: realtimeStatus,
      source: stockLiveReady ? String(stockLive.source ?? "OHLC_READ_SERVICE_STOCK_LIVE") : String(market.source ?? "UNAVAILABLE"),
      as_of: input.as_of_date,
      verification_level: stockLiveReady ? "EPHEMERAL_READ_ONLY_LIVE_CONTEXT" : "DISPLAY_OR_REALTIME_CONTEXT",
      formal_research_eligible: false,
      data: stockLiveReady ? {
        stock_live: stockLive,
        last_price: stockLive.last_price ?? null,
        best_bid: stockLive.best_bid ?? null,
        best_ask: stockLive.best_ask ?? null,
        five_level_book: stockLive.book ?? null,
        order_flow: stockLive.order_flow ?? null,
        feed: stockLive.feed ?? null,
        display_fallback_quote: market.quote ?? null,
      } : fallbackRealtimeReady ? {
        quote: market.quote ?? null,
        latest_daily_bar_research_fallback: market.latest_daily_bar ?? null,
      } : null,
      error: realtimeStatus === "UNAVAILABLE" ? String(stockLive.error ?? "realtime_unavailable") : null,
      notes: [
        "StockLiveHub成交、買一到買五、賣一到賣五與Order Flow優先作盤中顯示/研究context。",
        "Stock Live只在記憶體短暫存在，不寫GitHub/OHLC/KV/R2/D1，也不下單。",
        "Fugle REST/FinMind只作顯示或研究fallback；此層永遠不得升級成正式OHLC。",
      ],
    }),
    canonical_ohlc: evidenceNode({
      id: "canonical_ohlc",
      evidence_class: "FORMAL_TRUTH",
      status: canonicalStatus,
      source: canonicalFormal ? canonicalSource : "OHLC_MCP_REQUIRED",
      as_of: canonicalFormal ? canonicalCandidate.as_of ?? canonicalCandidate.data_as_of ?? input.as_of_date : null,
      verification_level: canonicalFormal ? String(canonicalCandidate.verification_level ?? "OHLC_MCP_VERIFIED") : "NOT_ATTACHED",
      formal_research_eligible: canonicalFormal,
      dataset_version: canonicalFormal ? canonicalCandidate.dataset_version ?? canonicalCandidate.version ?? null : null,
      provenance: canonicalFormal ? canonicalCandidate.provenance ?? null : null,
      data: canonicalFormal ? canonicalCandidate : null,
      error: canonicalFormal ? canonicalCandidate.error ?? null : "OHLC_MCP_NOT_ATTACHED_TO_FAMILY_EVIDENCE_V1",
      notes: [
        "只有OHLC MCP已驗證資料可成為正式K線/技術價位。",
        "缺正式OHLC時，不得用Stock Live/FinMind/Fugle/Web冒充支撐壓力或精確操作價位。",
      ],
    }),
    technical_research_fallback: evidenceNode({
      id: "technical_research_fallback",
      evidence_class: "DISPLAY_FALLBACK",
      status: normalizeStatus(technical.status),
      source: String(technical.source ?? "UNAVAILABLE"),
      as_of: input.as_of_date,
      verification_level: "RESEARCH_FALLBACK_ONLY",
      formal_research_eligible: false,
      data: normalizeStatus(technical.status) === "UNAVAILABLE" ? null : technical,
      notes: ["可描述研究型趨勢，不可產生正式操作價位。"],
    }),
    current_chip: evidenceNode({
      id: "current_chip",
      evidence_class: "FORMAL_TRUTH",
      status: currentChipStatus,
      source: currentChipAttached ? "TWSE_TPEX_OFFICIAL_EXACT_DATE_ON_DEMAND" : "UNAVAILABLE",
      as_of: currentChipAttached ? chip.requested_as_of ?? currentChipPayload.requested_as_of ?? input.as_of_date : null,
      verification_level: currentChipFormal
        ? (currentChipStatus === "READY" ? "OFFICIAL_EXACT_DATE_VERIFIED" : "OFFICIAL_EXACT_DATE_DEGRADED")
        : "NOT_VERIFIED",
      formal_research_eligible: currentChipFormal,
      dataset_version: currentChipPayload.version ?? chip.provider_versions?.on_demand ?? null,
      provenance: currentChipAttached ? {
        source_health: currentChipPayload.source_health ?? null,
        previous_day_substitution: chipQuality.previous_day_substitution ?? null,
        persistence: chipQuality.current_normalized_persistence ?? "NONE",
      } : null,
      data: currentChipAttached ? currentChipPayload : null,
      error: currentChipFormal ? null : chip.reason ?? "current_exact_date_chip_unavailable",
      notes: [
        "當期法人、融資融券、借券與借券賣出以TWSE/TPEx exact-date on-demand為準。",
        "PENDING/缺資料不可拿前一交易日冒充。",
        "此Formal Truth不包含MoneyDJ分點或權證方向推論；二者在獨立Governed Context節點。",
      ],
    }),
    broker_branch: governedContextNode(
      "broker_branch",
      "MONEYDJ_BROKER_RANKED_PUBLIC_SECONDARY",
      brokerRanked,
      [
        "分點只代表公開排名頁可見的RANKED_ONLY資料，不是完整分點inventory。",
        "未出現在排名中不得解讀為零交易或沒有參與。",
        "此adapter不依賴FinMind token。",
      ],
    ),
    warrant_activity: governedContextNode(
      "warrant_activity",
      "TWSE_TPEX_WARRANT_ACTIVITY_NON_DIRECTIONAL",
      warrantActivity,
      [
        "權證公開成交量/成交額只代表活動度。",
        "不得由turnover推論aggressor買方、買超或dealer hedge方向。",
      ],
    ),
    maintenance_risk: governedContextNode(
      "maintenance_risk",
      "ESTIMATED_POSITION_MAINTENANCE_PROXY",
      maintenanceRisk,
      ["此為公開資料可計算的部位維持率代理值，不等同券商整戶擔保維持率。"],
    ),
    published_chip: evidenceNode({
      id: "published_chip",
      evidence_class: "FORMAL_TRUTH",
      status: publishedChipStatus,
      source: formalPublishedChip ? "PUBLISHED_GENERATION_HISTORY_CONTEXT" : "UNAVAILABLE",
      as_of: formalPublishedChip ? publishedHistoryAsOf : null,
      verification_level: formalPublishedChip ? "GENERATION_FENCED_PUBLISHED_HISTORY" : "NOT_VERIFIED",
      formal_research_eligible: formalPublishedChip,
      dataset_version: formalPublishedChip ? chip.provider_versions?.legacy_archive ?? chip.version ?? null : null,
      provenance: formalPublishedChip ? {
        role: "HISTORY_CONTEXT_ONLY",
        publication: chip.publication ?? null,
        legacy_archive_context: legacyArchive,
        datasets: Array.isArray(chip.datasets) ? chip.datasets : [],
      } : null,
      data: formalPublishedChip ? compactPublishedChip(chip, publishedHistoryAsOf) : null,
      error: formalPublishedChip ? null : legacyArchive.reason ?? chip.reason ?? "published_history_unavailable",
      notes: [
        "Published generation保留為不可變歷史/replay證據。",
        "它不再覆蓋或取代當期TWSE/TPEx exact-date on-demand資料。",
      ],
    }),
    holder_structure: evidenceNode({
      id: "holder_structure",
      evidence_class: "GOVERNED_CONTEXT",
      status: holderStatus,
      source: "FINMIND_TDCC_READ_ONLY",
      as_of: holding.latest?.date ?? foreign.latest?.date ?? null,
      verification_level: "STRUCTURED_READ_ONLY_SUPPLEMENT",
      formal_research_eligible: false,
      data: holderStatus === "UNAVAILABLE" ? null : {
        holder_distribution: holding,
        foreign_shareholding: foreign,
      },
      notes: [
        "400/1000張大戶為集保級距代理值，保留原始級距語意。",
        "外資持股比是補充證據，不取代當期官方法人買賣超。",
      ],
    }),
    fundamentals: evidenceNode({
      id: "fundamentals",
      evidence_class: "GOVERNED_CONTEXT",
      status: fundamentalsStatus,
      source: "FINMIND_STRUCTURED_PLUS_TWSE_TPEX_OFFICIAL_VALUATION",
      as_of: input.as_of_date,
      verification_level: "STRUCTURED_AND_OFFICIAL_READ_ONLY",
      formal_research_eligible: false,
      data: fundamentalsStatus === "UNAVAILABLE" ? null : {
        monthly_revenue: monthlyRevenue,
        accounting,
        official_valuation: officialValuation,
      },
      notes: [
        "缺值保持null/UNKNOWN。",
        "官方估值與結構化財報可支援判讀，但不與正式OHLC或當期官方籌碼混為同一資料身份。",
      ],
    }),
    txf_context: governedContextNode(
      "txf_context",
      "OHLC_MCP_TXF_READ",
      txfContext,
      ["TXF是Market Regime Context，不是個股Buy/Sell Oracle。"],
    ),
    global_market_context: governedContextNode(
      "global_market_context",
      "GLOBAL_OHLC_READ",
      globalMarketContext,
      ["全球市場可作跨市場背景；不得覆寫台股正式資料身份。"],
    ),
    global_futures_context: governedContextNode(
      "global_futures_context",
      "GLOBAL_FUTURES_READ_ONLY_ADAPTER",
      globalFuturesContext,
      ["只能讀取read-only adapter；不得由Family觸發Global Futures canonical寫入。"],
    ),
    web_evidence: evidenceNode({
      id: "web_evidence",
      evidence_class: "WEB_EVIDENCE",
      status: "PENDING",
      source: "OPEN_WORLD_WEB",
      as_of: input.as_of_date,
      verification_level: "OPEN_WORLD_RESEARCH_REQUIRED",
      formal_research_eligible: false,
      data: null,
      notes: [
        "可補法說、公司公告、新聞、產業、供應鏈與政策事件。",
        "Web證據必須保留來源與時間，且不能升級成FORMAL_TRUTH。",
      ],
    }),
  } as const;

  const criticalLayers = [
    ["canonical_ohlc", evidence.canonical_ohlc],
    ["current_chip", evidence.current_chip],
    ["fundamentals", evidence.fundamentals],
  ] as const;
  const missingCritical = criticalLayers
    .filter(([, node]) => node.status === "UNAVAILABLE")
    .map(([id]) => id);
  const usableContext = Object.entries(evidence)
    .filter(([, node]) => node.status === "READY" || node.status === "DEGRADED")
    .map(([id]) => id);
  const degradedSources = Object.entries(evidence)
    .filter(([, node]) => node.status === "DEGRADED")
    .map(([id]) => id);

  const readinessState = missingCritical.length === 0
    ? "READY"
    : usableContext.length > 0
      ? "DEGRADED"
      : "INSUFFICIENT";

  return {
    version: FAMILY_UNIFIED_EVIDENCE_VERSION,
    contract: "FAMILY_UNIFIED_EVIDENCE",
    symbol: input.symbol,
    as_of: input.as_of_date,
    request_intent: input.request_intent ?? null,
    access: "READ_ONLY",
    identity_policy: "EVIDENCE_CLASS_CANNOT_BE_SELF_PROMOTED",
    evidence,
    decision_readiness: {
      state: readinessState,
      missing_critical: missingCritical,
      degraded_sources: degradedSources,
      usable_context: usableContext,
      formal_truth_ready: Object.values(evidence).filter((node) => node.evidence_class === "FORMAL_TRUTH" && node.status === "READY").map((node) => node.id),
      formal_truth_missing: Object.values(evidence).filter((node) => node.evidence_class === "FORMAL_TRUTH" && node.status === "UNAVAILABLE").map((node) => node.id),
    },
    permission_guardrails: {
      production_writes: false,
      github_writes: false,
      github_branch_or_pr_mutation: false,
      strategy_changes: false,
      canonical_ohlc_writes: false,
      published_market_data_writes: false,
      order_placement: false,
      secret_or_token_read: false,
    },
    evidence_rules: [
      "FORMAL_TRUTH只接受已治理且符合身份契約的資料。",
      "當期官方籌碼與Published歷史是不同時間身份，不能互相覆蓋。",
      "MoneyDJ分點與權證活動屬GOVERNED_CONTEXT，不能自行升級成官方方向性資料。",
      "GOVERNED_CONTEXT可支援判讀，但不能覆寫FORMAL_TRUTH。",
      "DISPLAY_FALLBACK只能作顯示/研究補充。",
      "Stock Live五檔與Order Flow不得持久化或冒充正式OHLC。",
      "WEB_EVIDENCE必須保留來源與時間，不能自動升級。",
      "資料不足時回報UNKNOWN/UNAVAILABLE，不猜數字。",
    ],
  } as const;
}
