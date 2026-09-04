import type { PublishedGatewayInput } from "./market-data-published-gateway.ts";
import {
  getTwBrokerRankedWindowBundleOnDemand,
  type TwBrokerWindowDays,
} from "./tw-broker-ranked-on-demand.ts";
import { getTwMarketChipSummaryOnDemand } from "./tw-market-chip-on-demand-facade.ts";

export const FAMILY_BROKER_QUERY_FAST_PATH_VERSION = "family-broker-query-fast-path/v1.0.0";

function compactBrokerWindow(result: any, topN: number) {
  const buys = Array.isArray(result?.buys) ? result.buys : [];
  const sells = Array.isArray(result?.sells) ? result.sells : [];
  return {
    window_days: result?.window_days ?? null,
    source_window_label: result?.source_window_label ?? null,
    status: result?.status ?? "UNAVAILABLE",
    source_date: result?.source_date ?? null,
    source_date_verified: result?.source_date_verified === true,
    source_window_verified: result?.source_window_verified === true,
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
    windows,
    branch_matrix: Array.isArray(bundle?.branch_matrix) ? bundle.branch_matrix.slice(0, topN) : [],
    server_side_interval_aggregation: bundle?.server_side_interval_aggregation === true,
    range_basis: bundle?.range_basis ?? null,
    daily_rank_summing: bundle?.daily_rank_summing === true,
    missing_branch_means_zero: bundle?.missing_branch_means_zero === true,
    missing_window_observation: bundle?.missing_window_observation ?? "UNKNOWN",
    previous_day_substitution: bundle?.previous_day_substitution === true,
    origin_concurrency_limit: bundle?.origin_concurrency_limit ?? null,
    tier: bundle?.tier ?? "PUBLIC_SECONDARY",
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
  const bundle = await getTwBrokerRankedWindowBundleOnDemand({
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
    provider: "MoneyDJ" as const,
    source: "MoneyDJ broker ranked public page",
    tier: "PUBLIC_SECONDARY" as const,
    completeness: "RANKED_ONLY" as const,
    persistence: "NONE" as const,
    broker_branch_ranked: oneDay,
    broker_multi_window: compact,
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
      origin_concurrency_limit: bundle.origin_concurrency_limit,
    },
    response_instructions: [
      "只依MoneyDJ伺服器端分點排名回答本次券商分點問題；不要啟動完整11點個股研究。",
      "1D與多日區間都必須以requested_as_of為結束日；不得拿前一交易日或最新頁替代指定日期。",
      "MoneyDJ屬PUBLIC_SECONDARY / RANKED_ONLY；未出現在排名中的分點是UNKNOWN，不得解讀為零交易。",
      "券商分點名稱是執行通路，不等同特定投資人身分。",
    ],
  };
}

/**
 * Frozen Family MCP tool response enrichment.
 *
 * The public `get_family_market_chip_summary` input schema stays unchanged. The
 * normal current-chip summary is fetched first; only then do we append the same
 * bounded MoneyDJ multi-window sidecar already used by the frozen Owner bridge.
 * Sequencing lowers peak fan-out versus launching the full chip graph and all
 * broker windows at the same instant.
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

  const bundle = await getTwBrokerRankedWindowBundleOnDemand({
    symbol: input.symbol,
    as_of: requestedAsOf,
    windows: [1, 5, 10, 20, 60],
  });
  return {
    ...summary,
    broker_multi_window: compactBundle(bundle, 20),
  };
}
