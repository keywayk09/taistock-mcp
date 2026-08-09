export const SUPPLY_CHAIN_GRAPH_VERSION = "diamond-supply-chain/v1.0.0";
export const SUPPLY_CHAIN_SNAPSHOT_SCHEMA_VERSION = "diamond-supply-chain-snapshot/v1";

export type SupplyChainMarket =
  | "TW_STOCK"
  | "US_STOCK"
  | "US_ETF"
  | "HK_STOCK"
  | "CN_STOCK"
  | "JP_STOCK"
  | "KR_STOCK"
  | "PRIVATE"
  | "OTHER";

export type SupplyChainRelation =
  | "SUPPLIES_TO"
  | "MATERIAL_SUPPLIER_TO"
  | "COMPONENT_SUPPLIER_TO"
  | "EQUIPMENT_SUPPLIER_TO"
  | "FOUNDRY_FOR"
  | "OEM_FOR"
  | "ODM_FOR"
  | "ASSEMBLES_FOR"
  | "DISTRIBUTES_FOR"
  | "LOGISTICS_FOR"
  | "CLOUD_PLATFORM_FOR"
  | "MANUFACTURING_PARTNER_FOR";

export type SupplyChainEvidenceSource =
  | "COMPANY_FILING"
  | "EXCHANGE_FILING"
  | "COMPANY_IR"
  | "GOVERNMENT_DISCLOSURE"
  | "LICENSED_PROVIDER"
  | "REPUTABLE_NEWS"
  | "MANUAL_REVIEWED"
  | "LLM_SUGGESTION";

export type SupplyChainVerificationStatus =
  | "VERIFIED"
  | "CORROBORATED"
  | "CANDIDATE"
  | "REJECTED";

export type SupplyChainInstrument = {
  instrument_id: string;
  market: SupplyChainMarket;
  symbol: string;
  exchange?: string;
  currency?: string;
  primary_listing: boolean;
};

export type SupplyChainEntity = {
  entity_id: string;
  legal_name: string;
  display_name?: string;
  country?: string;
  industry?: string;
  instruments: SupplyChainInstrument[];
};

export type SupplyChainEvidence = {
  evidence_id: string;
  source_type: SupplyChainEvidenceSource;
  source_ref: string;
  title?: string;
  published_at: string;
  observed_at: string;
  evidence_sha256: string;
  note?: string;
};

export type SupplyChainEdge = {
  edge_id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation: SupplyChainRelation;
  product_or_service?: string;
  revenue_exposure_pct?: number;
  dependency_exposure_pct?: number;
  geography?: string[];
  effective_from?: string;
  effective_to?: string;
  verification_status: SupplyChainVerificationStatus;
  confidence: number;
  evidence_ids: string[];
};

export type SupplyChainSnapshotInput = {
  as_of: string;
  source_dataset?: string;
  entities: SupplyChainEntity[];
  evidence: SupplyChainEvidence[];
  edges: SupplyChainEdge[];
};

export class SupplyChainGraphError extends Error {
  readonly code: string;
  readonly detail?: Record<string, unknown>;
  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "SupplyChainGraphError";
    this.code = code;
    this.detail = detail;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHA256 = /^(?:sha256:)?[0-9a-f]{64}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,159}$/;

function requireText(value: unknown, field: string, max = 500): string {
  const out = String(value ?? "").trim();
  if (!out || out.length > max) throw new SupplyChainGraphError("INVALID_INPUT", `${field} is required and must be <= ${max} chars`);
  return out;
}

function requireId(value: unknown, field: string): string {
  const out = requireText(value, field, 160);
  if (!ID.test(out)) throw new SupplyChainGraphError("INVALID_ID", `${field} has invalid characters`, { value: out });
  return out;
}

function requireDate(value: unknown, field: string): string {
  const out = requireText(value, field, 10);
  if (!ISO_DATE.test(out) || Number.isNaN(Date.parse(`${out}T00:00:00Z`))) {
    throw new SupplyChainGraphError("INVALID_DATE", `${field} must be YYYY-MM-DD`, { value: out });
  }
  return out;
}

function requireTimestamp(value: unknown, field: string): string {
  const out = requireText(value, field, 64);
  if (Number.isNaN(Date.parse(out))) throw new SupplyChainGraphError("INVALID_TIMESTAMP", `${field} must be parseable ISO time`, { value: out });
  return new Date(out).toISOString();
}

function finitePct(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw new SupplyChainGraphError("INVALID_PERCENT", `${field} must be 0..100`, { value });
  }
  return Math.round(number * 1e6) / 1e6;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = stableValue(source[key]);
    return out;
  }
  if (value === undefined) return null;
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function canonicalInstrument(value: SupplyChainInstrument, entityIndex: number, index: number): SupplyChainInstrument {
  const market = requireText(value?.market, `entities[${entityIndex}].instruments[${index}].market`, 32) as SupplyChainMarket;
  const allowed: SupplyChainMarket[] = ["TW_STOCK","US_STOCK","US_ETF","HK_STOCK","CN_STOCK","JP_STOCK","KR_STOCK","PRIVATE","OTHER"];
  if (!allowed.includes(market)) throw new SupplyChainGraphError("INVALID_MARKET", "unsupported supply-chain market", { market });
  const symbol = requireText(value?.symbol, `entities[${entityIndex}].instruments[${index}].symbol`, 48).toUpperCase();
  return {
    instrument_id: requireId(value?.instrument_id, `entities[${entityIndex}].instruments[${index}].instrument_id`),
    market,
    symbol,
    exchange: value?.exchange ? requireText(value.exchange, "exchange", 32).toUpperCase() : undefined,
    currency: value?.currency ? requireText(value.currency, "currency", 8).toUpperCase() : undefined,
    primary_listing: Boolean(value?.primary_listing),
  };
}

function canonicalEntity(value: SupplyChainEntity, index: number): SupplyChainEntity {
  const instruments = (value?.instruments ?? []).map((item, instrumentIndex) => canonicalInstrument(item, index, instrumentIndex));
  const instrumentIds = new Set<string>();
  for (const instrument of instruments) {
    if (instrumentIds.has(instrument.instrument_id)) throw new SupplyChainGraphError("DUPLICATE_INSTRUMENT", "instrument_id must be unique within entity", { instrument_id: instrument.instrument_id });
    instrumentIds.add(instrument.instrument_id);
  }
  return {
    entity_id: requireId(value?.entity_id, `entities[${index}].entity_id`),
    legal_name: requireText(value?.legal_name, `entities[${index}].legal_name`, 240),
    display_name: value?.display_name ? requireText(value.display_name, "display_name", 160) : undefined,
    country: value?.country ? requireText(value.country, "country", 80) : undefined,
    industry: value?.industry ? requireText(value.industry, "industry", 160) : undefined,
    instruments,
  };
}

function canonicalEvidence(value: SupplyChainEvidence, index: number): SupplyChainEvidence {
  const sourceType = requireText(value?.source_type, `evidence[${index}].source_type`, 40) as SupplyChainEvidenceSource;
  const allowed: SupplyChainEvidenceSource[] = ["COMPANY_FILING","EXCHANGE_FILING","COMPANY_IR","GOVERNMENT_DISCLOSURE","LICENSED_PROVIDER","REPUTABLE_NEWS","MANUAL_REVIEWED","LLM_SUGGESTION"];
  if (!allowed.includes(sourceType)) throw new SupplyChainGraphError("INVALID_EVIDENCE_SOURCE", "unsupported evidence source", { source_type: sourceType });
  const hash = requireText(value?.evidence_sha256, `evidence[${index}].evidence_sha256`, 80).toLowerCase();
  if (!SHA256.test(hash)) throw new SupplyChainGraphError("INVALID_EVIDENCE_HASH", "evidence_sha256 must be SHA-256 hex", { value: hash });
  return {
    evidence_id: requireId(value?.evidence_id, `evidence[${index}].evidence_id`),
    source_type: sourceType,
    source_ref: requireText(value?.source_ref, `evidence[${index}].source_ref`, 1000),
    title: value?.title ? requireText(value.title, "title", 300) : undefined,
    published_at: requireTimestamp(value?.published_at, `evidence[${index}].published_at`),
    observed_at: requireTimestamp(value?.observed_at, `evidence[${index}].observed_at`),
    evidence_sha256: hash.startsWith("sha256:") ? hash.slice(7) : hash,
    note: value?.note ? requireText(value.note, "note", 800) : undefined,
  };
}

function canonicalEdge(value: SupplyChainEdge, index: number): SupplyChainEdge {
  const relation = requireText(value?.relation, `edges[${index}].relation`, 48) as SupplyChainRelation;
  const relations: SupplyChainRelation[] = ["SUPPLIES_TO","MATERIAL_SUPPLIER_TO","COMPONENT_SUPPLIER_TO","EQUIPMENT_SUPPLIER_TO","FOUNDRY_FOR","OEM_FOR","ODM_FOR","ASSEMBLES_FOR","DISTRIBUTES_FOR","LOGISTICS_FOR","CLOUD_PLATFORM_FOR","MANUFACTURING_PARTNER_FOR"];
  if (!relations.includes(relation)) throw new SupplyChainGraphError("INVALID_RELATION", "unsupported supply-chain relation", { relation });
  const verification = requireText(value?.verification_status, `edges[${index}].verification_status`, 24) as SupplyChainVerificationStatus;
  const statuses: SupplyChainVerificationStatus[] = ["VERIFIED","CORROBORATED","CANDIDATE","REJECTED"];
  if (!statuses.includes(verification)) throw new SupplyChainGraphError("INVALID_VERIFICATION", "unsupported verification_status", { verification });
  const confidence = Number(value?.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new SupplyChainGraphError("INVALID_CONFIDENCE", "confidence must be 0..1");
  const evidenceIds = Array.from(new Set((value?.evidence_ids ?? []).map((item) => requireId(item, `edges[${index}].evidence_ids`)))).sort();
  return {
    edge_id: requireId(value?.edge_id, `edges[${index}].edge_id`),
    source_entity_id: requireId(value?.source_entity_id, `edges[${index}].source_entity_id`),
    target_entity_id: requireId(value?.target_entity_id, `edges[${index}].target_entity_id`),
    relation,
    product_or_service: value?.product_or_service ? requireText(value.product_or_service, "product_or_service", 240) : undefined,
    revenue_exposure_pct: finitePct(value?.revenue_exposure_pct, `edges[${index}].revenue_exposure_pct`),
    dependency_exposure_pct: finitePct(value?.dependency_exposure_pct, `edges[${index}].dependency_exposure_pct`),
    geography: Array.from(new Set((value?.geography ?? []).map((item) => requireText(item, "geography", 80)))).sort(),
    effective_from: value?.effective_from ? requireDate(value.effective_from, `edges[${index}].effective_from`) : undefined,
    effective_to: value?.effective_to ? requireDate(value.effective_to, `edges[${index}].effective_to`) : undefined,
    verification_status: verification,
    confidence: Math.round(confidence * 1e6) / 1e6,
    evidence_ids: evidenceIds,
  };
}

function activeAt(edge: SupplyChainEdge, asOf: string): boolean {
  return (!edge.effective_from || edge.effective_from <= asOf) && (!edge.effective_to || edge.effective_to >= asOf);
}

export function getSupplyChainContract() {
  return {
    version: SUPPLY_CHAIN_GRAPH_VERSION,
    graph_level: "LEGAL_ENTITY_WITH_INSTRUMENT_MAPPING",
    direction_semantics: "source_entity supplies/provides to target_entity",
    supported_markets: ["TW_STOCK","US_STOCK","US_ETF","HK_STOCK","CN_STOCK","JP_STOCK","KR_STOCK","PRIVATE","OTHER"],
    relation_types: ["SUPPLIES_TO","MATERIAL_SUPPLIER_TO","COMPONENT_SUPPLIER_TO","EQUIPMENT_SUPPLIER_TO","FOUNDRY_FOR","OEM_FOR","ODM_FOR","ASSEMBLES_FOR","DISTRIBUTES_FOR","LOGISTICS_FOR","CLOUD_PLATFORM_FOR","MANUFACTURING_PARTNER_FOR"],
    evidence_policy: {
      primary_sources: ["COMPANY_FILING","EXCHANGE_FILING","COMPANY_IR","GOVERNMENT_DISCLOSURE"],
      secondary_sources: ["LICENSED_PROVIDER","REPUTABLE_NEWS","MANUAL_REVIEWED"],
      llm_suggestion: "candidate discovery only; cannot make an edge formal-research eligible",
    },
    time_safety: "published_at must be <= snapshot as_of; future knowledge is rejected",
    production_write: false,
    strategy_promotion: false,
  };
}

export async function validateSupplyChainSnapshot(input: SupplyChainSnapshotInput) {
  const asOf = requireDate(input?.as_of, "as_of");
  const entities = (input?.entities ?? []).map(canonicalEntity).sort((a,b) => a.entity_id.localeCompare(b.entity_id));
  const evidence = (input?.evidence ?? []).map(canonicalEvidence).sort((a,b) => a.evidence_id.localeCompare(b.evidence_id));
  const edges = (input?.edges ?? []).map(canonicalEdge).sort((a,b) => a.edge_id.localeCompare(b.edge_id));
  const entityIds = new Set<string>();
  const globalInstrumentIds = new Set<string>();
  for (const entity of entities) {
    if (entityIds.has(entity.entity_id)) throw new SupplyChainGraphError("DUPLICATE_ENTITY", "entity_id must be unique", { entity_id: entity.entity_id });
    entityIds.add(entity.entity_id);
    for (const instrument of entity.instruments) {
      if (globalInstrumentIds.has(instrument.instrument_id)) throw new SupplyChainGraphError("DUPLICATE_INSTRUMENT", "instrument_id must be globally unique", { instrument_id: instrument.instrument_id });
      globalInstrumentIds.add(instrument.instrument_id);
    }
  }
  const evidenceMap = new Map<string, SupplyChainEvidence>();
  for (const item of evidence) {
    if (evidenceMap.has(item.evidence_id)) throw new SupplyChainGraphError("DUPLICATE_EVIDENCE", "evidence_id must be unique", { evidence_id: item.evidence_id });
    if (item.published_at.slice(0,10) > asOf) throw new SupplyChainGraphError("LOOKAHEAD_EVIDENCE", "evidence published after snapshot as_of is forbidden", { evidence_id:item.evidence_id, published_at:item.published_at, as_of:asOf });
    evidenceMap.set(item.evidence_id, item);
  }
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (edgeIds.has(edge.edge_id)) throw new SupplyChainGraphError("DUPLICATE_EDGE", "edge_id must be unique", { edge_id: edge.edge_id });
    edgeIds.add(edge.edge_id);
    if (!entityIds.has(edge.source_entity_id) || !entityIds.has(edge.target_entity_id)) throw new SupplyChainGraphError("MISSING_ENTITY", "edge references unknown entity", { edge_id:edge.edge_id });
    if (edge.source_entity_id === edge.target_entity_id) throw new SupplyChainGraphError("SELF_EDGE", "supply-chain self-edge is forbidden", { edge_id:edge.edge_id });
    if (edge.effective_from && edge.effective_to && edge.effective_from > edge.effective_to) throw new SupplyChainGraphError("INVALID_EFFECTIVE_RANGE", "effective_from must be <= effective_to", { edge_id:edge.edge_id });
    if (edge.verification_status !== "REJECTED" && edge.evidence_ids.length === 0) throw new SupplyChainGraphError("EVIDENCE_REQUIRED", "non-rejected edge requires evidence", { edge_id:edge.edge_id });
    const linked = edge.evidence_ids.map((id) => {
      const item = evidenceMap.get(id);
      if (!item) throw new SupplyChainGraphError("MISSING_EVIDENCE", "edge references unknown evidence", { edge_id:edge.edge_id, evidence_id:id });
      return item;
    });
    if ((edge.verification_status === "VERIFIED" || edge.verification_status === "CORROBORATED") && linked.some((item) => item.source_type === "LLM_SUGGESTION")) {
      throw new SupplyChainGraphError("LLM_EVIDENCE_FORBIDDEN", "LLM suggestion cannot support a verified/corroborated edge", { edge_id:edge.edge_id });
    }
  }
  const activeEdges = edges.filter((edge) => edge.verification_status !== "REJECTED" && activeAt(edge, asOf));
  const formalEdges = activeEdges.filter((edge) => edge.verification_status === "VERIFIED" || edge.verification_status === "CORROBORATED");
  const primaryTypes = new Set<SupplyChainEvidenceSource>(["COMPANY_FILING","EXCHANGE_FILING","COMPANY_IR","GOVERNMENT_DISCLOSURE"]);
  const formalResearchEligible = formalEdges.length === activeEdges.length && formalEdges.every((edge) => edge.evidence_ids.some((id) => primaryTypes.has(evidenceMap.get(id)!.source_type)));
  const fingerprint = {
    schema_version: SUPPLY_CHAIN_SNAPSHOT_SCHEMA_VERSION,
    engine_version: SUPPLY_CHAIN_GRAPH_VERSION,
    as_of: asOf,
    source_dataset: input?.source_dataset ? requireText(input.source_dataset, "source_dataset", 240) : null,
    entities,
    evidence,
    edges,
  };
  const hash = await sha256Hex(stableJson(fingerprint));
  return {
    ok: true as const,
    schema_version: SUPPLY_CHAIN_SNAPSHOT_SCHEMA_VERSION,
    engine_version: SUPPLY_CHAIN_GRAPH_VERSION,
    dataset_id: `supply-chain:${hash}`,
    dataset_version: `sha256:${hash}`,
    as_of: asOf,
    source_dataset: input?.source_dataset ? requireText(input.source_dataset, "source_dataset", 240) : null,
    entity_count: entities.length,
    instrument_count: entities.reduce((sum, entity) => sum + entity.instruments.length, 0),
    evidence_count: evidence.length,
    edge_count: edges.length,
    active_edge_count: activeEdges.length,
    verified_or_corroborated_edge_count: formalEdges.length,
    candidate_edge_count: activeEdges.filter((edge) => edge.verification_status === "CANDIDATE").length,
    formal_research_eligible: formalResearchEligible,
    production_write: "FORBIDDEN" as const,
    entities,
    evidence,
    edges,
  };
}

export async function querySupplyChainSnapshot(input: SupplyChainSnapshotInput & {
  anchor: string;
  direction?: "UPSTREAM" | "DOWNSTREAM" | "BOTH";
  max_depth?: number;
  include_candidates?: boolean;
}) {
  const snapshot = await validateSupplyChainSnapshot(input);
  const anchorRaw = requireText(input?.anchor, "anchor", 160).toUpperCase();
  const entityById = new Map(snapshot.entities.map((entity) => [entity.entity_id, entity]));
  let anchorEntity = snapshot.entities.find((entity) => entity.entity_id.toUpperCase() === anchorRaw);
  if (!anchorEntity) {
    anchorEntity = snapshot.entities.find((entity) => entity.instruments.some((instrument) => instrument.instrument_id.toUpperCase() === anchorRaw || instrument.symbol.toUpperCase() === anchorRaw));
  }
  if (!anchorEntity) throw new SupplyChainGraphError("ANCHOR_NOT_FOUND", "anchor entity/instrument/symbol was not found in snapshot", { anchor: input.anchor });
  const direction = input?.direction ?? "BOTH";
  const maxDepth = Math.floor(Number(input?.max_depth ?? 2));
  if (!Number.isFinite(maxDepth) || maxDepth < 1 || maxDepth > 4) throw new SupplyChainGraphError("INVALID_DEPTH", "max_depth must be 1..4");
  const includeCandidates = Boolean(input?.include_candidates);
  const usableEdges = snapshot.edges.filter((edge) => edge.verification_status !== "REJECTED" && activeAt(edge, snapshot.as_of) && (includeCandidates || edge.verification_status !== "CANDIDATE"));
  const visited = new Set([anchorEntity.entity_id]);
  const frontier = [anchorEntity.entity_id];
  const matchedEdges: SupplyChainEdge[] = [];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
    const next: string[] = [];
    for (const entityId of frontier) {
      for (const edge of usableEdges) {
        const upstream = edge.target_entity_id === entityId;
        const downstream = edge.source_entity_id === entityId;
        if ((direction === "UPSTREAM" && !upstream) || (direction === "DOWNSTREAM" && !downstream) || (direction === "BOTH" && !upstream && !downstream)) continue;
        const neighbor = upstream ? edge.source_entity_id : edge.target_entity_id;
        if (!matchedEdges.some((item) => item.edge_id === edge.edge_id)) matchedEdges.push(edge);
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier.splice(0, frontier.length, ...next);
  }
  const entities = Array.from(visited).map((id) => entityById.get(id)!).filter(Boolean).sort((a,b) => a.entity_id.localeCompare(b.entity_id));
  const evidenceIds = new Set(matchedEdges.flatMap((edge) => edge.evidence_ids));
  const evidence = snapshot.evidence.filter((item) => evidenceIds.has(item.evidence_id));
  return {
    ok: true as const,
    dataset_id: snapshot.dataset_id,
    dataset_version: snapshot.dataset_version,
    as_of: snapshot.as_of,
    anchor_entity: anchorEntity,
    direction,
    max_depth: maxDepth,
    include_candidates: includeCandidates,
    entity_count: entities.length,
    edge_count: matchedEdges.length,
    formal_research_eligible: snapshot.formal_research_eligible && !includeCandidates,
    entities,
    edges: matchedEdges.sort((a,b) => a.edge_id.localeCompare(b.edge_id)),
    evidence,
  };
}
