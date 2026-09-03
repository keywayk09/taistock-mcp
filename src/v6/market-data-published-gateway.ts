import {
  getTwMarketChipSummaryPublished as getLegacyPublishedSummary,
  MARKET_DATA_PUBLISHED_GATEWAY_VERSION as LEGACY_PUBLISHED_GATEWAY_VERSION,
  MARKET_DATA_PUBLISHED_MAX_CALENDAR_DAYS,
  type PublishedGatewayInput,
} from "./market-data-published-gateway-v2.ts";
import { getTwBrokerRankedOnDemand, TW_BROKER_RANKED_ON_DEMAND_VERSION } from "./tw-broker-ranked-on-demand.ts";
import { getTwChipOnDemandSnapshot, TW_CHIP_ON_DEMAND_VERSION } from "./tw-chip-on-demand.ts";

export { MARKET_DATA_PUBLISHED_MAX_CALENDAR_DAYS, type PublishedGatewayInput };

export const MARKET_DATA_PUBLISHED_GATEWAY_VERSION = "diamond-market-data-gateway/v5-on-demand-current";

function taipeiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Compatibility facade for the existing Owner/Family tool surface.
 *
 * Public tool names and MCP ingress stay frozen. Current-day official chip
 * evidence is fetched directly from TWSE/TPEx. Broker-branch evidence is a
 * fail-soft PUBLIC_SECONDARY ranked page and can never block or downgrade the
 * official layers. Nothing fetched here is persisted.
 */
export async function getTwMarketChipSummaryPublished(env: Env, input: PublishedGatewayInput) {
  const requestedAsOf = input.as_of ?? taipeiToday();
  const [onDemand, brokerRanked, legacy] = await Promise.all([
    getTwChipOnDemandSnapshot({ symbol: input.symbol, as_of: requestedAsOf }),
    getTwBrokerRankedOnDemand({ symbol: input.symbol, as_of: requestedAsOf }),
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
      broker_ranked: TW_BROKER_RANKED_ON_DEMAND_VERSION,
      legacy_archive: LEGACY_PUBLISHED_GATEWAY_VERSION,
    },
    storage: "ON_DEMAND_CURRENT+LEGACY_ARCHIVE_READ_ONLY",
    consistency: "ON_DEMAND_CURRENT_WITH_LEGACY_CONTEXT",
    read_strategy: "OFFICIAL_EXACT_DATE_ON_DEMAND_FIRST; BROKER_RANKED_FAIL_SOFT; LEGACY_GITHUB_HISTORY_CONTEXT_ONLY",
    symbol: input.symbol,
    requested_as_of: onDemand.requested_as_of,
    data_as_of: currentUsable ? onDemand.requested_as_of : (legacyRecord.data_as_of ?? null),
    status: currentUsable ? onDemand.status : (legacyRecord.status ?? "UNAVAILABLE"),
    preferred_current_evidence: "on_demand_current",
    on_demand_current: onDemand,
    broker_branch_ranked: brokerRanked,
    broker_branch_policy: {
      tier: "PUBLIC_SECONDARY",
      completeness: "RANKED_ONLY",
      fail_soft: true,
      blocks_official_chip_analysis: false,
      missing_branch_means_zero: false,
      persistence: "NONE",
    },
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
      broker_ranked_status: brokerRanked.status,
      broker_ranked_source_date_verified: brokerRanked.source_date_verified,
      broker_ranked_completeness: "RANKED_ONLY",
      previous_day_substitution: false,
      current_raw_persistence: "NONE",
      current_normalized_persistence: "NONE",
      legacy_archive_is_decision_source_for_current_day: false,
    },
    migration_note: "Current chip data is fetched on demand. Ranked broker evidence is secondary/fail-soft. Legacy GitHub chip data remains read-only historical context and is not required to continue daily capture.",
  };
}
