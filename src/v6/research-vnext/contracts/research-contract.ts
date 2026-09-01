export const RESEARCH_VNEXT_CONTRACT_VERSION = "RESEARCH_VNEXT_CONTRACT_V1" as const;
export const RESEARCH_VNEXT_EVIDENCE_VERSION = "RESEARCH_VNEXT_EVIDENCE_V1" as const;

const RESEARCH_VNEXT_OPERATIONS = [
  "EVIDENCE_QUERY",
  "DETERMINISTIC_COMPUTE",
  "REPLAY",
  "MEMORY_QUERY",
  "MEMORY_APPEND",
] as const;

export type ResearchVNextOperation = (typeof RESEARCH_VNEXT_OPERATIONS)[number];

export const RESEARCH_VNEXT_AUTHORITY = Object.freeze({
  reasoning_owner: "GPT" as const,
  backend_authority: Object.freeze([
    "DATA",
    "DETERMINISTIC_COMPUTE",
    "REPLAY",
    "EVIDENCE",
    "MEMORY",
  ] as const),
  direct_market_provider_access: false as const,
  ohlc_write: false as const,
  automatic_strategy_promotion: false as const,
  production_registration: "DISABLED_UNTIL_SHADOW_PASS" as const,
});

export type ResearchVNextRequest = {
  schema: typeof RESEARCH_VNEXT_CONTRACT_VERSION;
  request_id: string;
  operation: ResearchVNextOperation;
  payload: Record<string, unknown>;
};

export type ResearchEvidenceEnvelope = {
  schema: typeof RESEARCH_VNEXT_EVIDENCE_VERSION;
  request_id: string;
  dataset_identity: string;
  reasoning_owner: "GPT";
  backend_role: "EVIDENCE_ONLY";
  evidence: Record<string, unknown>;
};

const OPERATION_SET = new Set<string>(RESEARCH_VNEXT_OPERATIONS);
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_DATASET_IDENTITY_LENGTH = 256;
const MAX_PAYLOAD_JSON_CHARS = 262_144;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireBoundedString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  if (value.length > maxLength) {
    throw new Error(`${field} exceeds max length ${maxLength}`);
  }
  return value;
}

function assertSerializableWithinLimit(value: unknown, field: string, maxChars: number): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${field} must be JSON serializable`);
  }
  if (serialized === undefined) {
    throw new Error(`${field} must be JSON serializable`);
  }
  if (serialized.length > maxChars) {
    throw new Error(`${field} exceeds max serialized size ${maxChars}`);
  }
}

export function parseResearchVNextRequest(value: unknown): ResearchVNextRequest {
  if (!isRecord(value)) {
    throw new Error("request must be an object");
  }

  if (value.schema !== RESEARCH_VNEXT_CONTRACT_VERSION) {
    throw new Error(`schema must equal ${RESEARCH_VNEXT_CONTRACT_VERSION}`);
  }

  const requestId = requireBoundedString(value.request_id, "request_id", MAX_REQUEST_ID_LENGTH);

  if (typeof value.operation !== "string" || !OPERATION_SET.has(value.operation)) {
    throw new Error(`operation must be one of ${RESEARCH_VNEXT_OPERATIONS.join(", ")}`);
  }

  if (!isRecord(value.payload)) {
    throw new Error("payload must be an object");
  }
  assertSerializableWithinLimit(value.payload, "payload", MAX_PAYLOAD_JSON_CHARS);

  return Object.freeze({
    schema: RESEARCH_VNEXT_CONTRACT_VERSION,
    request_id: requestId,
    operation: value.operation as ResearchVNextOperation,
    payload: Object.freeze({ ...value.payload }),
  });
}

export function createResearchEvidenceEnvelope(input: {
  request_id: string;
  dataset_identity: string;
  evidence: Record<string, unknown>;
}): ResearchEvidenceEnvelope {
  const requestId = requireBoundedString(input.request_id, "request_id", MAX_REQUEST_ID_LENGTH);
  const datasetIdentity = requireBoundedString(
    input.dataset_identity,
    "dataset_identity",
    MAX_DATASET_IDENTITY_LENGTH,
  );

  if (!isRecord(input.evidence)) {
    throw new Error("evidence must be an object");
  }
  assertSerializableWithinLimit(input.evidence, "evidence", MAX_PAYLOAD_JSON_CHARS);

  return Object.freeze({
    schema: RESEARCH_VNEXT_EVIDENCE_VERSION,
    request_id: requestId,
    dataset_identity: datasetIdentity,
    reasoning_owner: "GPT" as const,
    backend_role: "EVIDENCE_ONLY" as const,
    evidence: Object.freeze({ ...input.evidence }),
  });
}
