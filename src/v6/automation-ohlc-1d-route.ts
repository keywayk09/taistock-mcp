import { createCrossAccountReadService, CROSS_ACCOUNT_READ_SERVICE_VERSION } from "./cross-account-read-service.ts";
import { AUTOMATION_RESEARCH_REST_VERSION } from "./automation-research-rest.ts";

const PATH = "/research/automation/ohlc-1d";

type AnyRecord = Record<string, any>;

function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value); }
function validRevision(value: string) { return /^[0-9a-f]{40}$/i.test(value); }
function validSymbol(value: string) { return /^\d{4,6}$/.test(value); }
function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function subtractDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}
function headers() {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, max-age=0",
    "x-robots-tag": "noindex, nofollow, noarchive",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value, null, 2), { status, headers: headers() });
}
function blocked(error: string, extra: AnyRecord = {}) {
  return json({ ok: false, blocked: true, bridge_version: AUTOMATION_RESEARCH_REST_VERSION, error, ...extra });
}
function pinnedEnv(env: Env, revision: string): Env {
  return { ...(env as any), GITHUB_DATA_BRANCH: revision } as Env;
}

/**
 * Read-only 1D presentation contract for the automation bridge.
 *
 * Historical `source=derived_from_1m` stock daily rows were persisted with
 * volume measured in lots. New canonical daily rows and direct Fugle daily rows
 * use shares. Preserve the raw value for auditability while presenting a
 * consistent share-valued `volume` to research. No GitHub file is rewritten.
 */
export function presentAutomationDailyVolume(row: AnyRecord) {
  const raw = Number(row?.volume);
  if (!Number.isFinite(raw)) return { ...row };
  const legacyLots = String(row?.source ?? "") === "derived_from_1m";
  const shares = legacyLots ? raw * 1000 : raw;
  return {
    ...row,
    volume_raw: raw,
    volume_raw_unit: legacyLots ? "lot" : "share",
    volume: shares,
    volume_shares: shares,
    volume_lots: shares / 1000,
    volume_unit: "share",
    volume_presentation: legacyLots ? "LEGACY_DERIVED_1M_LOTS_TO_SHARES" : "SOURCE_ALREADY_SHARES",
  };
}

export async function handleAutomationOhlc1dRoute(request: Request, env: Env, url = new URL(request.url)): Promise<Response | null> {
  if (url.pathname !== PATH) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return json({ ok: false, blocked: true, error: "METHOD_NOT_ALLOWED" }, 405);

  const symbol = String(url.searchParams.get("symbol") ?? "").trim();
  const asOf = String(url.searchParams.get("as_of") ?? "").trim();
  const revision = String(url.searchParams.get("source_revision") ?? "").trim();
  const limit = clampInt(url.searchParams.get("limit"), 220, 20, 420);
  if (!validSymbol(symbol)) return blocked("INVALID_SYMBOL");
  if (!validDate(asOf)) return blocked("INVALID_AS_OF");
  if (!validRevision(revision)) return blocked("INVALID_SOURCE_REVISION");

  try {
    const service = createCrossAccountReadService(pinnedEnv(env, revision));
    const result = await service.readOhlc({ symbol, timeframe: "1d", from: subtractDays(asOf, 560), to: asOf, limit }) as AnyRecord;
    if (result.ok !== true || result.formal_research_eligible !== true) {
      return blocked("OHLC_1D_NOT_FORMAL", { symbol, as_of: asOf, source_revision: revision, reader_error: result.error ?? result.data_status ?? null });
    }
    const provenanceRevision = String(result.provenance?.branch ?? "");
    if (provenanceRevision.toLowerCase() !== revision.toLowerCase()) {
      return blocked("OHLC_SOURCE_REVISION_MISMATCH", { requested: revision, actual: provenanceRevision || null });
    }
    const rows = Array.isArray(result.rows) ? result.rows.map((row: AnyRecord) => presentAutomationDailyVolume(row)) : [];
    const response = json({
      ok: true,
      blocked: false,
      bridge_version: AUTOMATION_RESEARCH_REST_VERSION,
      reader_version: CROSS_ACCOUNT_READ_SERVICE_VERSION,
      symbol,
      as_of: asOf,
      source_revision: revision,
      data_status: result.data_status,
      formal_research_eligible: true,
      verification_level: result.verification_level,
      dataset_id: result.dataset_id,
      dataset_version: result.dataset_version,
      dataset_hash: result.dataset_hash,
      provenance: result.provenance,
      row_count: result.row_count,
      returned: rows.length,
      volume_contract: "1D_VOLUME_PRESENTED_AS_SHARES_RAW_PRESERVED",
      rows,
    });
    if (request.method === "HEAD") return new Response(null, { status: response.status, headers: response.headers });
    return response;
  } catch (error) {
    return blocked("OHLC_1D_BRIDGE_FAIL_CLOSED", { detail: error instanceof Error ? error.message : String(error) });
  }
}
