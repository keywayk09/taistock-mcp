import type { PublishedGatewayInput } from "./market-data-published-gateway.ts";
import {
  getTwBrokerProviderBundleOnDemand,
} from "./broker-provider-bundle-router.ts";
import type { TwBrokerWindowDays } from "./tw-broker-ranked-on-demand.ts";
import { getTwMarketChipSummaryOnDemand } from "./tw-market-chip-on-demand-facade.ts";

export const FAMILY_BROKER_QUERY_FAST_PATH_VERSION = "family-broker-query-fast-path/v1.1.0";

function compactBrokerWindow(result: any, topN: number) {
  const buys = Array.isArray(result?.top_net_buyers)
    ? result.top_net_buyers
    : Array.isArray(result?.buys) ? result.buys : [];
  const sells = Array.isArray(result?.top_net_sellers)
    ? result.top_net_sellers
    : Array.isArray(result?.sells) ? result.sells : [];
  return {
    provider_id: result?.provider_id ?? null,
    provider_name: result?.provider_name ?? null,
    window_days: result?.window_days ?? null,
    source_window_label: result?.source_window_label ?? null,
    status: result?.status ?? "UNAVAILABLE",
    source_date: result?.source_date ?? null,
    source_date_verified: result?.source_date_verified === true,
    source_window_verified: result?.source_window_verified !== false,
    source_range_verified: result?.source_range_verified === true,
    requested_range_start: result?.requested_range_start ?? null,
    requested_range_end: result?.requested_range_end ?? null,
    ranked_output_totals: result?.ranked_output_totals ?? null,
    top_net_buyers: buys.slice(0, topN),
    top_net_sellers: sells.slice(0, topN),
    rank_count: result?.rank_count ?? { buy: buys.length, sell: sells.length },
    error: result && "error" in result ? result.error : null,
  };
}

function compactBundle(bundle: any, topN: number) {
  const requestedWindows = Array.isArray(bundle?.requested_windows) ? bundle.requested_windows : [];
  const windows = Object.fromEntries(requestedWindows.map((days: number) => {
    const key = `${days}D`;
    return [key, compactBrokerWindow(bundle?.windows?.[key], topN)];
  }));
  return {
    version: bundle?.version ?? null,
    status: bundle?.status ?? "UNAVAILABLE",
    requested_as_of: bundle?.requested_as_of ?? null,
    requested_windows: requestedWindows,
    ready_window_count: bundle?.ready_window_count ?? 0,
    canonical_provider_id: bundle?.canonical_provider_id ?? null,
    canonical_provider_name: bundle?.canonical_provider_name ?? null,
    canonical_provider_tier: bundle?.canonical_provider_tier ?? null,
    provider_attempts: Array.isArray(bundle?.provider_attempts) ? bundle.provider_attempts : [],
    bundle_failover_used: bundle?.bundle_failover_used === true,
    same_provider_required: bundle?.same_provider_required === true,
    same_requested_as_of_required: bundle?.same_requested_as_of_required === true,
    cross_source_backfill_allowed: bundle?.cross_source_backfill_allowed === true,
    cross_provider_window_mixing: bundle?.cross_provider_window_mixing === true,
    broker_identity_attribution_allowed: bundle?.broker_identity_attribution_allowed === true,
    window_comparison_semantics: bundle?.window_comparison_semantics ?? null,
    windows,
    branch_matrix: Array.isArray(bundle?.branch_matrix) ? bundle.branch_matrix.slice(0, topN) : [],
    daily_rank_summing: bundle?.daily_rank_summing === true,
    missing_branch_means_zero: bundle?.missing_branch_means_zero === true,
    missing_window_observation: bundle?.missing_window_observation ?? "UNKNOWN",
    previous_day_substitution: bundle?.previous_day_substitution === true,
    completeness: bundle?.completeness ?? "RANKED_ONLY",
    persistence: bundle?.persistence ?? "NONE",
    interpretation_boundary: bundle?.interpretation_boundary ?? null,
  };
}

export async function runFamilyBrokerQueryFastPath(input: {
  symbol: string;
  as_of: string;
  windows?: readonly TwBrokerWindowDays[];
  top_n?: number;
}) {
  const topN = Number.isFinite(Number(input.top_n))
    ? Math.max(1, Math.min(50, Math.trunc(Number(input.top_n))))
    : 20;
  const bundle = await getTwBrokerProviderBundleOnDemand({
    symbol: input.symbol,
    as_of: input.as_of,
    windows: input.windows,
  });
  const compact = compactBundle(bundle, topN);
  const oneDay = compact.windows["1D"] ?? null;

  return {
    ok: bundle.status === "READY" || bundle.status === "DEGRADED",
    version: FAMILY_BROKER_QUERY_FAST_PATH_VERSION,
    route: "BROKER_WINDOW_FAST_PATH" as const,
    read_only: true,
    symbol: String(input.symbol),
    requested_as_of: input.as_of,
    provider: compact.canonical_provider_name,
    provider_id: compact.canonical_provider_id,
    source: compact.canonical_provider_name ? `${compact.canonical_provider_name} broker ranked public page` : null,
    tier: compact.canonical_provider_tier ?? "PUBLIC_SECONDARY",
    completeness: "RANKED_ONLY" as const,
    persistence: "NONE" as const,
    broker_branch_ranked: oneDay,
    broker_multi_window: compact,
    broker_evidence_contract: {
      same_provider_required: true,
      same_requested_as_of_required: true,
      cross_source_backfill_allowed: false,
      cross_provider_window_mixing: false,
      partial_single_provider_result_allowed: true,
      broker_identity_attribution_allowed: false,
      window_comparison_semantics: "NESTED_WINDOWS_SAME_END_DATE_NOT_TIME_SERIES" as const,
      missing_window_means: "UNKNOWN" as const,
    },
    provider_policy: {
      official_chip_fetch: false,
      finmind_fetch: false,
      ohlc_fetch: false,
      jin10_fetch: false,
      fundamental_fetch: false,
      web_fetch: false,
      daily_rank_summing: false,
      previous_day_substitution: false,
      missing_branch_means_zero: false,
      whole_bundle_provider_failover: true,
      window_by_window_provider_backfill: false,
    },
    response_instructions: [
      "券商分點問題只能使用broker_multi_window中的canonical provider數字回答；不得自行用Open Web把缺少的單一window補入同一張比較表。",
      "若canonical provider不完整，可以回傳該同一provider的PARTIAL/DEGRADED結果；若切換provider，必須整個requested windows bundle一起切換，禁止逐window混來源。",
      "所有READY視窗必須使用同一requested_as_of與同一精確TWSE交易日窗口語義；不得拿前一交易日、最新頁或不同平台區間替代。",
      "分點資料屬PUBLIC_SECONDARY / RANKED_ONLY；未出現在排名中的分點是UNKNOWN，不得解讀為零交易。",
      "券商分點名稱是執行通路，不等同外資、投信、自營商或特定投資人身分；不得從分點名稱推定投資人身份。",
      "1D/5D/10D/20D/60D是共享同一截止日的巢狀窗口，不是按20D→10D→5D→1D排列的時間序列；解讀轉強轉弱時必須明示這個限制。",
    ],
  };
}

/**
 * Frozen Family MCP tool response enrichment. Public input schema stays frozen.
 * The current official chip summary is read first; broker windows are then
 * selected through the same whole-provider bundle router as the natural-language
 * Broker Fast Path. This preserves lower peak fan-out while preventing mixed
 * provider windows in the sidecar.
 */
export async function runFamilyMarketChipSummaryWithBrokerWindows(env: Env, input: PublishedGatewayInput) {
  const summary = await getTwMarketChipSummaryOnDemand(env, input);
  const requestedAsOf = String((summary as Record<string, any>).requested_as_of ?? input.as_of ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedAsOf)) return {
    ...summary,
    broker_multi_window: {
      status: "UNAVAILABLE",
      requested_as_of: requestedAsOf || null,
      requested_windows: [1, 5, 10, 20, 60],
      error: "invalid_requested_as_of_for_broker_windows",
    },
  };

  const bundle = await getTwBrokerProviderBundleOnDemand({
    symbol: input.symbol,
    as_of: requestedAsOf,
    windows: [1, 5, 10, 20, 60],
  });
  return {
    ...summary,
    broker_multi_window: compactBundle(bundle, 20),
  };
}
