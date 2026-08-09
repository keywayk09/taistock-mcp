import {
  querySupplyChainSnapshot,
  validateSupplyChainSnapshot,
  type SupplyChainSnapshotInput,
} from "./supply-chain-graph";

export const SUPPLY_CHAIN_DATA_PLANE_VERSION = "diamond-supply-chain-data-plane/v1.0.0";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS supply_chain_snapshot_index (
    dataset_version TEXT PRIMARY KEY,
    dataset_id TEXT NOT NULL,
    as_of TEXT NOT NULL,
    source_dataset TEXT,
    formal_research_eligible INTEGER NOT NULL,
    entity_count INTEGER NOT NULL,
    instrument_count INTEGER NOT NULL,
    evidence_count INTEGER NOT NULL,
    edge_count INTEGER NOT NULL,
    verified_edge_count INTEGER NOT NULL,
    candidate_edge_count INTEGER NOT NULL,
    r2_key TEXT NOT NULL UNIQUE,
    content_sha256 TEXT NOT NULL,
    archived_at TEXT NOT NULL,
    archive_actor TEXT NOT NULL,
    review_note TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supply_chain_snapshot_asof ON supply_chain_snapshot_index(as_of, archived_at)`,
  `CREATE INDEX IF NOT EXISTS idx_supply_chain_snapshot_eligible ON supply_chain_snapshot_index(formal_research_eligible, as_of)`,
  `CREATE TABLE IF NOT EXISTS supply_chain_instrument_index (
    dataset_version TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    instrument_id TEXT NOT NULL,
    market TEXT NOT NULL,
    symbol TEXT NOT NULL,
    exchange TEXT,
    primary_listing INTEGER NOT NULL,
    PRIMARY KEY(dataset_version, instrument_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supply_chain_instrument_symbol ON supply_chain_instrument_index(symbol, market, dataset_version)`,
  `CREATE TABLE IF NOT EXISTS supply_chain_edge_index (
    dataset_version TEXT NOT NULL,
    edge_id TEXT NOT NULL,
    source_entity_id TEXT NOT NULL,
    target_entity_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    verification_status TEXT NOT NULL,
    confidence REAL,
    effective_from TEXT,
    effective_to TEXT,
    PRIMARY KEY(dataset_version, edge_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_supply_chain_edge_source ON supply_chain_edge_index(source_entity_id, dataset_version)`,
  `CREATE INDEX IF NOT EXISTS idx_supply_chain_edge_target ON supply_chain_edge_index(target_entity_id, dataset_version)`,
] as const;

export class SupplyChainDataPlaneError extends Error {
  readonly code: string;
  readonly detail?: Record<string, unknown>;
  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "SupplyChainDataPlaneError";
    this.code = code;
    this.detail = detail;
  }
}

function requiredText(value: unknown, field: string, max = 1000) {
  const text = String(value ?? "").trim();
  if (!text) throw new SupplyChainDataPlaneError("INVALID_INPUT", `${field} is required`);
  if (text.length > max) throw new SupplyChainDataPlaneError("INVALID_INPUT", `${field} is too long`);
  return text;
}

function hashFromVersion(datasetVersion: string) {
  const match = /^sha256:([0-9a-f]{64})$/.exec(datasetVersion);
  if (!match) throw new SupplyChainDataPlaneError("INVALID_DATASET_VERSION", "dataset_version must be sha256:<64 hex>");
  return match[1];
}

export async function ensureSupplyChainDataPlaneSchema(env: Env) {
  if (!env.RESEARCH_DB) throw new SupplyChainDataPlaneError("RESEARCH_DB_UNAVAILABLE", "RESEARCH_DB binding is required");
  if (!env.RESEARCH_BUCKET) throw new SupplyChainDataPlaneError("RESEARCH_BUCKET_UNAVAILABLE", "RESEARCH_BUCKET binding is required");
  await env.RESEARCH_DB.batch(SCHEMA.map((sql) => env.RESEARCH_DB.prepare(sql)));
}

export async function archiveSupplyChainSnapshot(env: Env, input: {
  snapshot: SupplyChainSnapshotInput;
  archive_actor: string;
  review_note?: string;
  human_approved: boolean;
}) {
  if (!input?.human_approved) {
    throw new SupplyChainDataPlaneError("HUMAN_APPROVAL_REQUIRED", "archiving a research supply-chain snapshot requires explicit human approval");
  }
  await ensureSupplyChainDataPlaneSchema(env);
  const actor = requiredText(input.archive_actor, "archive_actor", 200);
  const reviewNote = input.review_note ? requiredText(input.review_note, "review_note", 2000) : null;
  const validated = await validateSupplyChainSnapshot(input.snapshot);
  const hash = hashFromVersion(validated.dataset_version);
  const r2Key = `supply-chain/snapshots/${validated.as_of}/${hash}.json`;
  const payload = JSON.stringify({
    archive_schema: SUPPLY_CHAIN_DATA_PLANE_VERSION,
    snapshot: {
      as_of: validated.as_of,
      source_dataset: validated.source_dataset ?? undefined,
      entities: validated.entities,
      evidence: validated.evidence,
      edges: validated.edges,
    },
    dataset_id: validated.dataset_id,
    dataset_version: validated.dataset_version,
    formal_research_eligible: validated.formal_research_eligible,
  });

  const existing = await env.RESEARCH_DB.prepare(
    `SELECT dataset_id, r2_key, content_sha256 FROM supply_chain_snapshot_index WHERE dataset_version=?`
  ).bind(validated.dataset_version).first<Record<string, unknown>>();
  if (existing) {
    if (String(existing.dataset_id) !== validated.dataset_id || String(existing.r2_key) !== r2Key || String(existing.content_sha256) !== hash) {
      throw new SupplyChainDataPlaneError("ARCHIVE_CONFLICT", "dataset_version already exists with different immutable metadata", { dataset_version: validated.dataset_version });
    }
    return { ok:true as const, idempotent:true as const, dataset_id:validated.dataset_id, dataset_version:validated.dataset_version, r2_key:r2Key, formal_research_eligible:validated.formal_research_eligible };
  }

  const object = await env.RESEARCH_BUCKET.get(r2Key);
  if (object) {
    throw new SupplyChainDataPlaneError("ORPHAN_R2_CONFLICT", "R2 object already exists without matching D1 index; fail closed", { r2_key:r2Key });
  }

  await env.RESEARCH_BUCKET.put(r2Key, payload, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      dataset_version: validated.dataset_version,
      as_of: validated.as_of,
      formal_research_eligible: String(validated.formal_research_eligible),
    },
  });

  const archivedAt = new Date().toISOString();
  try {
    await env.RESEARCH_DB.batch([
      env.RESEARCH_DB.prepare(`INSERT INTO supply_chain_snapshot_index(
        dataset_version,dataset_id,as_of,source_dataset,formal_research_eligible,entity_count,instrument_count,evidence_count,edge_count,verified_edge_count,candidate_edge_count,r2_key,content_sha256,archived_at,archive_actor,review_note
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        validated.dataset_version, validated.dataset_id, validated.as_of, validated.source_dataset ?? null,
        validated.formal_research_eligible ? 1 : 0, validated.entity_count, validated.instrument_count,
        validated.evidence_count, validated.edge_count, validated.verified_or_corroborated_edge_count,
        validated.candidate_edge_count, r2Key, hash, archivedAt, actor, reviewNote,
      ),
      ...validated.entities.flatMap((entity) => entity.instruments.map((instrument) => env.RESEARCH_DB.prepare(`INSERT INTO supply_chain_instrument_index(
        dataset_version,entity_id,instrument_id,market,symbol,exchange,primary_listing
      ) VALUES(?,?,?,?,?,?,?)`).bind(validated.dataset_version, entity.entity_id, instrument.instrument_id, instrument.market, instrument.symbol, instrument.exchange ?? null, instrument.primary_listing ? 1 : 0))),
      ...validated.edges.map((edge) => env.RESEARCH_DB.prepare(`INSERT INTO supply_chain_edge_index(
        dataset_version,edge_id,source_entity_id,target_entity_id,relation,verification_status,confidence,effective_from,effective_to
      ) VALUES(?,?,?,?,?,?,?,?,?)`).bind(validated.dataset_version, edge.edge_id, edge.source_entity_id, edge.target_entity_id, edge.relation, edge.verification_status, edge.confidence ?? null, edge.effective_from ?? null, edge.effective_to ?? null)),
    ]);
  } catch (error) {
    await env.RESEARCH_BUCKET.delete(r2Key);
    throw new SupplyChainDataPlaneError("INDEX_WRITE_FAILED", "D1 index write failed; R2 object was rolled back", { error:String(error) });
  }

  return {
    ok:true as const,
    idempotent:false as const,
    dataset_id:validated.dataset_id,
    dataset_version:validated.dataset_version,
    r2_key:r2Key,
    formal_research_eligible:validated.formal_research_eligible,
    archived_at:archivedAt,
  };
}

export async function loadArchivedSupplyChainSnapshot(env: Env, datasetVersion: string) {
  await ensureSupplyChainDataPlaneSchema(env);
  const version = requiredText(datasetVersion, "dataset_version", 80);
  hashFromVersion(version);
  const row = await env.RESEARCH_DB.prepare(`SELECT * FROM supply_chain_snapshot_index WHERE dataset_version=?`).bind(version).first<Record<string, unknown>>();
  if (!row) throw new SupplyChainDataPlaneError("DATASET_NOT_FOUND", "supply-chain dataset_version is not archived", { dataset_version:version });
  const object = await env.RESEARCH_BUCKET.get(String(row.r2_key));
  if (!object) throw new SupplyChainDataPlaneError("ARCHIVE_CORRUPTED", "D1 index exists but R2 snapshot is missing", { dataset_version:version });
  const parsed = JSON.parse(await object.text()) as { snapshot: SupplyChainSnapshotInput; dataset_version:string; dataset_id:string };
  const validated = await validateSupplyChainSnapshot(parsed.snapshot);
  if (validated.dataset_version !== version || validated.dataset_id !== String(row.dataset_id)) {
    throw new SupplyChainDataPlaneError("ARCHIVE_HASH_MISMATCH", "archived payload no longer matches indexed immutable identity", { dataset_version:version });
  }
  return { index:row, snapshot:validated };
}

export async function queryArchivedSupplyChain(env: Env, input: {
  dataset_version: string;
  anchor: string;
  direction?: "UPSTREAM" | "DOWNSTREAM" | "BOTH";
  max_depth?: number;
  include_candidates?: boolean;
}) {
  const loaded = await loadArchivedSupplyChainSnapshot(env, input.dataset_version);
  return querySupplyChainSnapshot({
    as_of: loaded.snapshot.as_of,
    source_dataset: loaded.snapshot.source_dataset ?? undefined,
    entities: loaded.snapshot.entities,
    evidence: loaded.snapshot.evidence,
    edges: loaded.snapshot.edges,
    anchor: input.anchor,
    direction: input.direction,
    max_depth: input.max_depth,
    include_candidates: input.include_candidates,
  });
}

export async function findSupplyChainDatasets(env: Env, input: { symbol?:string; market?:string; as_of_lte?:string; formal_only?:boolean; limit?:number }) {
  await ensureSupplyChainDataPlaneSchema(env);
  const limit = Math.max(1, Math.min(100, Math.floor(Number(input.limit ?? 20))));
  const clauses:string[] = [];
  const args:unknown[] = [];
  if (input.as_of_lte) { clauses.push("s.as_of<=?"); args.push(requiredText(input.as_of_lte,"as_of_lte",10)); }
  if (input.formal_only) clauses.push("s.formal_research_eligible=1");
  if (input.symbol) { clauses.push("i.symbol=?"); args.push(requiredText(input.symbol,"symbol",40).toUpperCase()); }
  if (input.market) { clauses.push("i.market=?"); args.push(requiredText(input.market,"market",40).toUpperCase()); }
  const join = input.symbol || input.market ? "JOIN supply_chain_instrument_index i ON i.dataset_version=s.dataset_version" : "";
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await env.RESEARCH_DB.prepare(`SELECT DISTINCT s.* FROM supply_chain_snapshot_index s ${join} ${where} ORDER BY s.as_of DESC, s.archived_at DESC LIMIT ?`).bind(...args, limit).all();
  return { ok:true as const, count:result.results.length, datasets:result.results };
}
