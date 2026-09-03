import {
  getTwMarketChipSummaryPublished as getLegacyPublishedSummary,
  MARKET_DATA_PUBLISHED_GATEWAY_VERSION as LEGACY_PUBLISHED_GATEWAY_VERSION,
  MARKET_DATA_PUBLISHED_MAX_CALENDAR_DAYS,
  type PublishedGatewayInput,
} from "./market-data-published-gateway-v2.ts";
import { getTwBrokerRankedOnDemand, TW_BROKER_RANKED_ON_DEMAND_VERSION } from "./tw-broker-ranked-on-demand.ts";
import { getTwChipOnDemandSnapshot, TW_CHIP_ON_DEMAND_VERSION } from "./tw-chip-on-demand.ts";
import type { MarginRow } from "./tw-market-data.ts";
import { getTwWarrantActivityOnDemand, TW_WARRANT_ACTIVITY_ON_DEMAND_VERSION } from "./tw-warrant-activity-on-demand.ts";

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

function buildCurrentMaintenanceRisk(
  input: PublishedGatewayInput,
  latestMargin: MarginRow | null,
  currentMarginStatus: string,
) {
  const price = Number(input.reference_price);
  const estimatedCost = Number(input.estimated_financing_cost);
  const financingRatio = Number.isFinite(Number(input.financing_ratio))
    ? Math.max(0.1, Math.min(0.9, Number(input.financing_ratio)))
    : 0.6;

  if (!(price > 0) || !(estimatedCost > 0)) {
    return {
      status: "NEEDS_OHLC_JOIN" as const,
      metric: "ESTIMATED_POSITION_MAINTENANCE_PROXY",
      official_account_maintenance_ratio: false,
      requires: ["reference_price_from_OHLC_MCP", "estimated_financing_cost"],
      financing_ratio_assumption: financingRatio,
      official_margin_context: latestMargin,
      official_margin_context_status: currentMarginStatus,
      source_scope: "CURRENT_EXACT_DATE_ON_DEMAND",
      note: "公開個股資料無法還原券商整戶擔保維持率；此層只計算部位維持率代理值，不得標示為官方整戶維持率。",
    };
  }

  const ratio = (price / (estimatedCost * financingRatio)) * 100;
  const distance130 = ratio - 130;
  const riskZone = ratio < 130 ? "CRITICAL" : ratio < 140 ? "HIGH" : ratio < 160 ? "ELEVATED" : ratio < 180 ? "NORMAL" : "LOW";
  return {
    status: "READY" as const,
    metric: "ESTIMATED_POSITION_MAINTENANCE_PROXY",
    official_account_maintenance_ratio: false,
    estimated_maintenance_ratio_pct: Number(ratio.toFixed(2)),
    distance_to_130_pct_points: Number(distance130.toFixed(2)),
    risk_zone: riskZone,
    reference_price: price,
    estimated_financing_cost: estimatedCost,
    financing_ratio_assumption: financingRatio,
    official_margin_context: latestMargin,
    official_margin_context_status: currentMarginStatus,
    source_scope: "CURRENT_EXACT_DATE_ON_DEMAND",
    note: "估算部位代理值，不等同券商整戶擔保維持率。",
  };
}

/**
 * Compatibility facade for the existing Owner/Family tool surface.
 *
 * Public tool names and MCP ingress stay frozen. Current-day official chip
 * evidence is fetched directly from TWSE/TPEx. Broker-branch evidence is a
 * fail-soft PUBLIC_SECONDARY ranked page and can never block or downgrade the
 * official layers. Warrant turnover is official free activity evidence but is
 * explicitly non-directional. Nothing fetched here is persisted.
 *
 * `consistency: PUBLISHED` is retained as a frozen response ABI label for old
 * callers/tests. The actual current-day provider is disclosed separately by
 * `current_consistency` and `preferred_current_evidence`.
 */
export async function getTwMarketChipSummaryPublished(env: Env, input: PublishedGatewayInput) {
  const requestedAsOf = input.as_of ?? taipeiToday();
  const [onDemand, brokerRanked, warrantActivity, legacy] = await Promise.all([
    getTwChipOnDemandSnapshot({ symbol: input.symbol, as_of: requestedAsOf }),
    getTwBrokerRankedOnDemand({ symbol: input.symbol, as_of: requestedAsOf }),
    getTwWarrantActivityOnDemand({ symbol: input.symbol, as_of: requestedAsOf }),
    getLegacyPublishedSummary(env, input),
  ]);

  const currentUsable = onDemand.status === "READY" || onDemand.status === "DEGRADED";
  const legacyRecord = legacy as Record<string, any>;
  const legacyQuality = legacyRecord.data_quality && typeof legacyRecord.data_quality === "object"
    ? legacyRecord.data_quality
    : {};
  const currentMaintenanceRisk = buildCurrentMaintenanceRisk(
    input,
    onDemand.layers.margin_short.latest,
    onDemand.layers.margin_short.status,
  );
  const legacyLayers = legacyRecord.layers && typeof legacyRecord.layers === "object"
    ? legacyRecord.layers as Record<string, any>
    : {};

  return {
    ...legacyRecord,
    ok: currentUsable || legacyRecord.ok === true,
    version: MARKET_DATA_PUBLISHED_GATEWAY_VERSION,
    provider_versions: {
      on_demand: TW_CHIP_ON_DEMAND_VERSION,
      broker_ranked: TW_BROKER_RANKED_ON_DEMAND_VERSION,
      warrant_activity: TW_WARRANT_ACTIVITY_ON_DEMAND_VERSION,
      legacy_archive: LEGACY_PUBLISHED_GATEWAY_VERSION,
    },
    storage: "ON_DEMAND_CURRENT+LEGACY_ARCHIVE_READ_ONLY",
    consistency: "PUBLISHED" as const,
    current_consistency: "EXACT_DATE_ON_DEMAND" as const,
    read_strategy: "OFFICIAL_EXACT_DATE_ON_DEMAND_FIRST; WARRANT_ACTIVITY_OFFICIAL_NON_DIRECTIONAL; BROKER_RANKED_FAIL_SOFT; LEGACY_GITHUB_HISTORY_CONTEXT_ONLY",
    symbol: input.symbol,
    requested_as_of: onDemand.requested_as_of,
    data_as_of: currentUsable ? onDemand.requested_as_of : (legacyRecord.data_as_of ?? null),
    status: currentUsable ? onDemand.status : (legacyRecord.status ?? "UNAVAILABLE"),
    preferred_current_evidence: "on_demand_current",
    on_demand_current: onDemand,
    warrant_activity: warrantActivity,
    warrant_policy: {
      tier: "OFFICIAL_PRIMARY",
      measures: "TURNOVER_AND_VOLUME_ACTIVITY",
      directionality: "NOT_AVAILABLE_FROM_TURNOVER_ONLY",
      may_call_it_buying: false,
      dealer_hedge_direction_included: false,
      persistence: "NONE",
      fail_soft: true,
    },
    broker_branch_ranked: brokerRanked,
    broker_branch_policy: {
      tier: "PUBLIC_SECONDARY",
      completeness: "RANKED_ONLY",
      fail_soft: true,
      blocks_official_chip_analysis: false,
      missing_branch_means_zero: false,
      persistence: "NONE",
    },
    layers: {
      ...legacyLayers,
      maintenance_risk: currentMaintenanceRisk,
    },
    current_maintenance_risk: currentMaintenanceRisk,
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
      warrant_activity_status: warrantActivity.status,
      warrant_activity_directionality: "NON_DIRECTIONAL_TURNOVER_ONLY",
      broker_ranked_status: brokerRanked.status,
      broker_ranked_source_date_verified: brokerRanked.source_date_verified,
      broker_ranked_completeness: "RANKED_ONLY",
      maintenance_ratio_kind: "ESTIMATED_POSITION_MAINTENANCE_PROXY_NOT_OFFICIAL_ACCOUNT_RATIO",
      previous_day_substitution: false,
      current_raw_persistence: "NONE",
      current_normalized_persistence: "NONE",
      legacy_archive_is_decision_source_for_current_day: false,
    },
    migration_note: "Current chip data is fetched on demand. Warrant activity is official but non-directional. Ranked broker evidence is secondary/fail-soft. Legacy GitHub chip data remains read-only historical context and is not required to continue daily capture.",
  };
}
