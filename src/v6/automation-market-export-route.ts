import { getTwMarketCrossSection, MARKET_DATA_CROSS_SECTION_VERSION } from "./market-data-cross-section.ts";
import {
  isRetryableAutomationTransportError,
  retryableAutomationTransportBody,
} from "./automation-transport-error.ts";

export const AUTOMATION_MARKET_EXPORT_VERSION = "automation-market-export/v1.1.0";
const ROUTE = "/research/automation/market-export";

type AnyRecord = Record<string, any>;

function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value); }
function validRevision(value: string) { return /^[0-9a-f]{40}$/i.test(value); }
function validPrefix(value: string) { return /^[0-9]$/.test(value); }

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
  return json({
    ok: false,
    blocked: true,
    route_version: AUTOMATION_MARKET_EXPORT_VERSION,
    read_only: true,
    writer_routes: false,
    error,
    ...extra,
  });
}

function transportUnavailable(detail: unknown, extra: AnyRecord = {}) {
  return json({
    route_version: AUTOMATION_MARKET_EXPORT_VERSION,
    read_only: true,
    writer_routes: false,
    ...retryableAutomationTransportBody("MARKET_EXPORT_TRANSPORT_UNAVAILABLE", detail, extra),
  }, 503);
}

function pinnedEnv(env: Env, revision: string): Env {
  return { ...(env as any), GITHUB_DATA_BRANCH: revision } as Env;
}

/**
 * Read-only compact export for the automation GitHub relay.
 * This route intentionally reuses the canonical cross-section reader rather
 * than reimplementing shard, manifest, horizon, or immutable-revision logic.
 */
export async function handleAutomationMarketExportRoute(
  request: Request,
  env: Env,
  parsedUrl?: URL,
): Promise<Response | null> {
  const url = parsedUrl ?? new URL(request.url);
  if (url.pathname !== ROUTE) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return blocked("METHOD_NOT_ALLOWED", { method: request.method });

  const asOf = String(url.searchParams.get("as_of") ?? "").trim();
  const revision = String(url.searchParams.get("source_revision") ?? "").trim();
  const prefix = String(url.searchParams.get("prefix") ?? "").trim();
  if (!validDate(asOf)) return blocked("INVALID_AS_OF");
  if (!validRevision(revision)) return blocked("INVALID_SOURCE_REVISION");
  if (!validPrefix(prefix)) return blocked("INVALID_PREFIX");

  try {
    const result = await getTwMarketCrossSection(pinnedEnv(env, revision), {
      as_of: asOf,
      prefix,
      limit: 500,
      calendar_days: 20,
    }) as AnyRecord;

    const actualRevision = String(result.source_revision ?? "");
    if (actualRevision.toLowerCase() !== revision.toLowerCase()) {
      return blocked("SOURCE_REVISION_MISMATCH", { requested: revision, actual: actualRevision || null });
    }
    if (result.formal_research_eligible !== true) {
      // The canonical reader intentionally converts individual shard read
      // exceptions into fail-closed scan diagnostics. Recover only when those
      // diagnostics prove a transient transport failure; schema/date/content
      // failures remain semantic BLOCKED responses.
      const scanFailure = result.scan?.invalid_shards ?? null;
      if (isRetryableAutomationTransportError(scanFailure)) {
        return transportUnavailable(scanFailure, {
          as_of: asOf,
          source_revision: revision,
          prefix,
          data_gate: result.data_gate ?? null,
          scan: result.scan ?? null,
        });
      }
      return blocked("MARKET_DATA_NOT_FORMAL", {
        as_of: asOf,
        source_revision: revision,
        prefix,
        data_gate: result.data_gate ?? null,
        scan: result.scan ?? null,
      });
    }

    const symbols = Array.isArray(result.symbols) ? result.symbols : [];
    const body = {
      ok: true,
      blocked: false,
      route_version: AUTOMATION_MARKET_EXPORT_VERSION,
      reader_version: result.version ?? MARKET_DATA_CROSS_SECTION_VERSION,
      read_only: true,
      writer_routes: false,
      formal_research_eligible: true,
      as_of: asOf,
      prefix,
      source_revision: revision,
      data_gate: result.data_gate ?? null,
      scan: result.scan ?? null,
      datasets: result.datasets ?? [],
      symbol_count: symbols.length,
      symbols,
    };
    if (request.method === "HEAD") return new Response(null, { status: 200, headers: headers() });
    return json(body);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (isRetryableAutomationTransportError(detail)) {
      return transportUnavailable(detail, { as_of: asOf, source_revision: revision, prefix });
    }
    return blocked("MARKET_EXPORT_READER_ERROR", {
      as_of: asOf,
      source_revision: revision,
      prefix,
      reader_error: detail,
    });
  }
}
