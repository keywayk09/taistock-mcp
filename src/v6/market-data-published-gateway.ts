import {
  getTwMarketChipSummaryPublished as getLegacyPublishedSummary,
  MARKET_DATA_PUBLISHED_GATEWAY_VERSION as LEGACY_PUBLISHED_GATEWAY_VERSION,
  MARKET_DATA_PUBLISHED_MAX_CALENDAR_DAYS,
  type PublishedGatewayInput,
} from "./market-data-published-gateway-v2.ts";
import { getTwChipOnDemandSnapshot, TW_CHIP_ON_DEMAND_VERSION } from "./tw-chip-on-demand.ts";

export { MARKET_DATA_PUBLISHED_MAX_CALENDAR_DAYS, type PublishedGatewayInput };

export const MARKET_DATA_PUBLISHED_GATEWAY_VERSION = "diamond-market-data-gateway/v5-on-demand-current";

/**
 * Compatibility facade for the existing Owner/Family tool surface.
 *
 * Public tool names and MCP ingress stay frozen. Current-day chip evidence is
 * fetched directly from official TWSE/TPEx sources on demand and is never
 * persisted. The historical GitHub generation is retained only as read-only
 * legacy context while the system migrates away from daily raw chip capture.
 * Callers must prefer `on_demand_current` for the requested date.
 */
export async function getTwMarketChipSummaryPublished(env: Env, input: PublishedGatewayInput) {
  const [onDemand, legacy] = await Promise.all([
    getTwChipOnDemandSnapshot({ symbol: input.symbol, as_of: input.as_of }),
    getLegacyPublishedSummary(env, input),
  ]);

  const currentUsable = onDemand.status === "READY" || onDemand.status === "DEGRADED";
  const legacyRecord = legacy as Record<string, any>;
  const legacyQuality = legacyRecord.data_quality && typeof legacyRecord.data_quality === "object"
    ? legacyRecord.data_quality
    : {};

  return {
    ...legacyRecord,
    ok: currentUsable || legacyRecord.ok === true,
    version: MARKET_DATA_PUBLISHED_GATEWAY_VERSION,
    provider_versions: {
      on_demand: TW_CHIP_ON_DEMAND_VERSION,
      legacy_archive: LEGACY_PUBLISHED_GATEWAY_VERSION,
    },
    storage: "ON_DEMAND_CURRENT+LEGACY_ARCHIVE_READ_ONLY",
    consistency: "ON_DEMAND_CURRENT_WITH_LEGACY_CONTEXT",
    read_strategy: "OFFICIAL_EXACT_DATE_ON_DEMAND_FIRST; LEGACY_GITHUB_HISTORY_CONTEXT_ONLY",
    symbol: input.symbol,
    requested_as_of: onDemand.requested_as_of,
    data_as_of: currentUsable ? onDemand.requested_as_of : (legacyRecord.data_as_of ?? null),
    status: currentUsable ? onDemand.status : (legacyRecord.status ?? "UNAVAILABLE"),
    preferred_current_evidence: "on_demand_current",
    on_demand_current: onDemand,
    legacy_archive_context: {
      role: "HISTORY_CONTEXT_ONLY",
      frozen_daily_capture_dependency: false,
      status: legacyRecord.status ?? "UNAVAILABLE",
      data_as_of: legacyRecord.data_as_of ?? null,
      publication: legacyRecord.publication ?? null,
      reason: legacyRecord.reason ?? null,
    },
    data_quality: {
      ...legacyQuality,
      current_exact_date_source: "TWSE_TPEX_OFFICIAL_ON_DEMAND",
      current_exact_date_status: onDemand.status,
      current_exact_date_verified: Object.values(onDemand.layers).every((layer) => layer.source_date_verified),
      previous_day_substitution: false,
      current_raw_persistence: "NONE",
      current_normalized_persistence: "NONE",
      legacy_archive_is_decision_source_for_current_day: false,
    },
    migration_note: "Current chip data is fetched on demand. Legacy GitHub chip data remains read-only historical context and is not required to continue daily capture.",
  };
}
