import type {
  SupplyChainEdge,
  SupplyChainEvidence,
  SupplyChainVerificationStatus,
} from "./supply-chain-graph";

export const SUPPLY_CHAIN_CROSS_VERIFY_VERSION = "diamond-supply-chain-cross-verify/v1.0.0";

const PRIMARY = new Set(["COMPANY_FILING","EXCHANGE_FILING","COMPANY_IR","GOVERNMENT_DISCLOSURE"]);
const SECONDARY = new Set(["LICENSED_PROVIDER","REPUTABLE_NEWS","MANUAL_REVIEWED"]);

export class SupplyChainCrossVerifyError extends Error {
  readonly code:string;
  readonly detail?:Record<string, unknown>;
  constructor(code:string, message:string, detail?:Record<string, unknown>) {
    super(message);
    this.name = "SupplyChainCrossVerifyError";
    this.code = code;
    this.detail = detail;
  }
}

function sourceIdentity(ref:string) {
  const raw = String(ref ?? "").trim();
  try {
    const url = new URL(raw);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return raw.toLowerCase().replace(/[#?].*$/, "").slice(0,240);
  }
}

function evidenceRank(item:SupplyChainEvidence) {
  if (PRIMARY.has(item.source_type)) return 3;
  if (SECONDARY.has(item.source_type)) return 2;
  if (item.source_type === "LLM_SUGGESTION") return 0;
  return 1;
}

export function crossVerifySupplyChainEdge(input:{
  edge:SupplyChainEdge;
  evidence:SupplyChainEvidence[];
  as_of:string;
}) {
  const evidenceMap = new Map(input.evidence.map((item) => [item.evidence_id, item]));
  const linked = input.edge.evidence_ids.map((id) => {
    const item = evidenceMap.get(id);
    if (!item) throw new SupplyChainCrossVerifyError("MISSING_EVIDENCE", "edge references missing evidence", { edge_id:input.edge.edge_id, evidence_id:id });
    if (item.published_at.slice(0,10) > input.as_of) throw new SupplyChainCrossVerifyError("LOOKAHEAD_EVIDENCE", "future evidence is forbidden", { evidence_id:id, as_of:input.as_of });
    return item;
  });
  if (!linked.length) {
    return {
      verification_status:"CANDIDATE" as const,
      confidence_cap:0.25,
      primary_count:0,
      secondary_count:0,
      independent_source_count:0,
      reasons:["NO_EVIDENCE"],
    };
  }

  const nonLlm = linked.filter((item) => item.source_type !== "LLM_SUGGESTION");
  const primary = nonLlm.filter((item) => PRIMARY.has(item.source_type));
  const secondary = nonLlm.filter((item) => SECONDARY.has(item.source_type));
  const sourceIds = new Set(nonLlm.map((item) => sourceIdentity(item.source_ref)));
  const primarySourceIds = new Set(primary.map((item) => sourceIdentity(item.source_ref)));
  let status:SupplyChainVerificationStatus = "CANDIDATE";
  let cap = 0.55;
  const reasons:string[] = [];

  if (primary.length >= 2 && primarySourceIds.size >= 2) {
    status = "VERIFIED";
    cap = 0.98;
    reasons.push("TWO_INDEPENDENT_PRIMARY_SOURCES");
  } else if (primary.length >= 1 && sourceIds.size >= 2 && secondary.length >= 1) {
    status = "CORROBORATED";
    cap = 0.90;
    reasons.push("PRIMARY_PLUS_INDEPENDENT_CORROBORATION");
  } else if (primary.length >= 1) {
    status = "CORROBORATED";
    cap = 0.80;
    reasons.push("SINGLE_PRIMARY_SOURCE");
  } else if (secondary.length >= 2 && sourceIds.size >= 2) {
    status = "CANDIDATE";
    cap = 0.65;
    reasons.push("MULTIPLE_SECONDARY_SOURCES_WITHOUT_PRIMARY");
  } else if (secondary.length >= 1) {
    status = "CANDIDATE";
    cap = 0.50;
    reasons.push("SECONDARY_ONLY");
  } else {
    status = "CANDIDATE";
    cap = 0.25;
    reasons.push("LLM_OR_UNRANKED_ONLY");
  }

  return {
    verification_status:status,
    confidence_cap:cap,
    primary_count:primary.length,
    secondary_count:secondary.length,
    llm_count:linked.filter((item) => item.source_type === "LLM_SUGGESTION").length,
    independent_source_count:sourceIds.size,
    strongest_evidence_rank:Math.max(...linked.map(evidenceRank)),
    reasons,
  };
}

export function applyCrossVerification(input:{
  edges:SupplyChainEdge[];
  evidence:SupplyChainEvidence[];
  as_of:string;
}) {
  const edges = input.edges.map((edge) => {
    const result = crossVerifySupplyChainEdge({ edge, evidence:input.evidence, as_of:input.as_of });
    return {
      ...edge,
      verification_status:result.verification_status,
      confidence:Math.min(edge.confidence, result.confidence_cap),
      cross_verification:result,
    };
  });
  return {
    ok:true as const,
    engine_version:SUPPLY_CHAIN_CROSS_VERIFY_VERSION,
    as_of:input.as_of,
    edge_count:edges.length,
    verified_count:edges.filter((x) => x.verification_status === "VERIFIED").length,
    corroborated_count:edges.filter((x) => x.verification_status === "CORROBORATED").length,
    candidate_count:edges.filter((x) => x.verification_status === "CANDIDATE").length,
    edges,
  };
}
