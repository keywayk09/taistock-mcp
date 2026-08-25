import { readGitHubJson, sha256Hex, stableJson } from "./github-data-store.ts";
import {
  getSelectionEvidence,
  listSelectionRuns,
  recordSelectionAuditDelta,
  type SelectionEvidenceRef,
} from "./selection-journal.ts";

export const SELECTION_AUDIT_ENGINE_VERSION = "diamond-selection-audit/v1.0.0";

type Layer = {
  kind?: string;
  market?: string;
  status?: string;
  snapshot_path?: string | null;
  dataset_version?: string | null;
  content_sha256?: string | null;
  row_count?: number | null;
};
type Manifest = {
  trade_date?: string;
  day_status?: string;
  terminal?: boolean;
  layers?: Layer[];
  updated_at?: string;
};

function manifestPath(date: string) {
  const [year, month, day] = date.split("-");
  return `data/market-data/daily/${year}/${month}/${day}/manifest.json`;
}

function layerKey(kind: unknown, market: unknown) {
  return `${String(kind ?? "")}:${String(market ?? "")}`;
}

export async function runSelectionAuditDelta(env: Env, input: { source_trade_date: string; now?: Date }) {
  const evidence = await getSelectionEvidence(env, input.source_trade_date, "FULL_2230");
  if (!evidence) return { status: "PENDING" as const, code: "ORIGINAL_FULL_2230_EVIDENCE_MISSING" };

  const read = await readGitHubJson<Manifest>(env, manifestPath(input.source_trade_date));
  const manifest = read.value;
  if (!manifest || manifest.day_status !== "COMPLETE" || manifest.terminal !== true) {
    return { status: "PENDING" as const, code: "AUDITED_MANIFEST_NOT_COMPLETE", detail: { exists: Boolean(manifest), day_status: manifest?.day_status ?? null, terminal: manifest?.terminal ?? false } };
  }

  const currentRefs = (manifest.layers ?? [])
    .filter((layer) => layer.status === "READY" && layer.snapshot_path)
    .map((layer) => ({
      key: layerKey(layer.kind, layer.market),
      path: String(layer.snapshot_path),
      dataset_version: layer.dataset_version ?? null,
      content_sha256: layer.content_sha256 ?? null,
      row_count: layer.row_count ?? null,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  if (currentRefs.length < 8) return { status: "PENDING" as const, code: "AUDITED_MANIFEST_LAYERS_INCOMPLETE", detail: { ready_refs: currentRefs.length } };

  const originalRefs = evidence.source_refs.map((ref) => ({
    key: layerKey(ref.kind, ref.market),
    path: ref.path,
    dataset_version: ref.dataset_version,
    content_sha256: ref.content_sha256,
    row_count: ref.row_count,
  })).sort((a, b) => a.key.localeCompare(b.key));

  const originalByKey = new Map(originalRefs.map((ref) => [ref.key, ref]));
  const currentByKey = new Map(currentRefs.map((ref) => [ref.key, ref]));
  const keys = Array.from(new Set([...originalByKey.keys(), ...currentByKey.keys()])).sort();
  const deltas = keys.flatMap((key) => {
    const before = originalByKey.get(key) ?? null;
    const after = currentByKey.get(key) ?? null;
    if (stableJson(before) === stableJson(after)) return [];
    return [{ layer: key, before, after }];
  });

  const [swingRuns, nextDayRuns, reviewRuns] = await Promise.all([
    listSelectionRuns(env, { selection_type: "SWING", source_trade_date: input.source_trade_date, limit: 20 }),
    listSelectionRuns(env, { selection_type: "NEXT_DAY_INTRADAY", source_trade_date: input.source_trade_date, limit: 20 }),
    listSelectionRuns(env, { selection_type: "INTRADAY_REVIEW", source_trade_date: input.source_trade_date, limit: 20 }),
  ]);
  const selectionIds = [...swingRuns, ...nextDayRuns, ...reviewRuns].map((run) => run.selection_id).sort();
  const evidenceRef: SelectionEvidenceRef = {
    evidence_id: evidence.evidence_id,
    evidence_version: evidence.schema_version,
    source_trade_date: evidence.source_trade_date,
    slot: evidence.slot,
    content_hash: evidence.content_hash,
  };
  const auditedProjectionHash = await sha256Hex(stableJson({ source_trade_date: input.source_trade_date, manifest_sha: read.sha, refs: currentRefs }));
  const auditId = `selection-audit:${input.source_trade_date}:${auditedProjectionHash.slice(0, 16)}`;
  const now = input.now ?? new Date();
  const record = await recordSelectionAuditDelta(env, {
    audit_id: auditId,
    source_trade_date: input.source_trade_date,
    audited_at: now.toISOString(),
    original_selection_ids: selectionIds,
    original_evidence_refs: [evidenceRef],
    audited_source_manifest_sha: read.sha,
    changed: deltas.length > 0,
    deltas,
  });
  return {
    status: "FINAL" as const,
    audit: record,
    changed: record.changed,
    delta_count: record.deltas.length,
    policy: "AUDIT_ONLY_NEVER_REWRITE_SELECTION" as const,
  };
}
