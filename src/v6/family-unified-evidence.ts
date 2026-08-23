import {
  summarizeFamilyForeignShareholding,
  summarizeFamilyHoldingDistribution,
} from "./family-eleven-point";

export const FAMILY_UNIFIED_EVIDENCE_VERSION = "family-evidence/v1.0.0";

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
  if (status === "READY") return "READY";
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

function compactPublishedChip(chip: AnyRecord) {
  const layers = rec(chip.layers);
  return {
    status: chip.status ?? "UNAVAILABLE",
    symbol: chip.symbol ?? null,
    requested_as_of: chip.requested_as_of ?? null,
    data_as_of: chip.data_as_of ?? null,
    calendar_days: chip.calendar_days ?? null,
    publication: chip.publication ?? null,
    data_quality: chip.data_quality ?? null,
    institutional: compactPublishedLayer(layers.institutional),
    margin: compactPublishedLayer(layers.margin),
    securities_lending: compactPublishedLayer(layers.securities_lending),
    sbl_short_sale: compactPublishedLayer(layers.sbl_short_sale),
    maintenance_risk: layers.maintenance_risk ?? null,
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
    as_of: value.as_of ?? value.data_as_of ?? value.date ?? null,
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
  const technical = rec(analysis.technical);
  const chip = rec(analysis.chip);
  const monthlyRevenue = rec(intelligence.monthly_revenue);
  const accounting = rec(intelligence.accounting);
  const officialValuation = rec(intelligence.official_valuation);
  const holding = summarizeFamilyHoldingDistribution(input.holding_distribution_rows ?? []);
  const foreign = summarizeFamilyForeignShareholding(input.foreign_shareholding_rows ?? []);

  const realtimeReady = Boolean(rec(market.quote).close || rec(market.latest_daily_bar).close);
  const formalPublishedChip = Boolean(chip.ok) && rec(chip.data_quality).formal_published === true;
  const publishedChipStatus = formalPublishedChip ? normalizeStatus(chip.status) : "UNAVAILABLE";

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
      status: realtimeReady ? "READY" : "UNAVAILABLE",
      source: String(market.source ?? "UNAVAILABLE"),
      as_of: input.as_of_date,
      verification_level: "DISPLAY_OR_REALTIME_CONTEXT",
      formal_research_eligible: false,
      data: realtimeReady ? {
        quote: market.quote ?? null,
        latest_daily_bar_research_fallback: market.latest_daily_bar ?? null,
      } : null,
      notes: [
        "Fugle/FinMind可作盤中顯示與研究輔助。",
        "此層不得升級成正式OHLC。",
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
        "缺正式OHLC時，不得用FinMind/Fugle/Web冒充支撐壓力或精確操作價位。",
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
    published_chip: evidenceNode({
      id: "published_chip",
      evidence_class: "FORMAL_TRUTH",
      status: publishedChipStatus,
      source: formalPublishedChip ? "PUBLISHED_GENERATION" : "UNAVAILABLE",
      as_of: formalPublishedChip ? chip.data_as_of ?? rec(chip.publication).trade_date ?? null : null,
      verification_level: formalPublishedChip ? "GENERATION_FENCED_PUBLISHED" : "NOT_VERIFIED",
      formal_research_eligible: formalPublishedChip,
      dataset_version: formalPublishedChip ? chip.version ?? null : null,
      provenance: formalPublishedChip ? {
        publication: chip.publication ?? null,
        datasets: Array.isArray(chip.datasets) ? chip.datasets : [],
      } : null,
      data: formalPublishedChip ? compactPublishedChip(chip) : null,
      error: formalPublishedChip ? null : chip.reason ?? "published_generation_unavailable",
      notes: [
        "三大法人、融資融券、借券與借券賣出只認Published generation。",
        "Web與即時資料不可覆寫此層。",
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
        "外資持股比是補充證據，不取代Published法人買賣超。",
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
        "官方估值與結構化財報可支援判讀，但不與正式OHLC/Published籌碼混為同一資料身份。",
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
    ["published_chip", evidence.published_chip],
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
      "GOVERNED_CONTEXT可支援判讀，但不能覆寫FORMAL_TRUTH。",
      "DISPLAY_FALLBACK只能作顯示/研究補充。",
      "WEB_EVIDENCE必須保留來源與時間，不能自動升級。",
      "資料不足時回報UNKNOWN/UNAVAILABLE，不猜數字。",
    ],
  } as const;
}
