export const FAMILY_BROKER_WINDOW_RENDER_VERSION = "family-broker-window-render/v1.0.0";

type BrokerWindowLike = {
  provider_id?: string | null;
  provider_name?: string | null;
  window_days?: number | null;
  source_window_label?: string | null;
  status?: string | null;
  source_date?: string | null;
  source_date_verified?: boolean;
  source_window_verified?: boolean;
  source_range_verified?: boolean;
  requested_range_start?: string | null;
  requested_range_end?: string | null;
  top_net_buyers?: unknown[];
  top_net_sellers?: unknown[];
  error?: string | null;
};

type BrokerBundleLike = {
  canonical_provider_id?: string | null;
  canonical_provider_name?: string | null;
  requested_as_of?: string | null;
  windows?: Record<string, BrokerWindowLike | undefined>;
};

function labelFor(days: number) {
  if (days === 1) return "1D";
  return `${days}D`;
}

export function buildFamilyBrokerWindowRenderRows(input: {
  requested_windows: readonly number[];
  broker: BrokerBundleLike;
}) {
  return input.requested_windows.map((days) => {
    const key = `${days}D`;
    const row = input.broker.windows?.[key];
    return {
      version: FAMILY_BROKER_WINDOW_RENDER_VERSION,
      must_render: true as const,
      window_days: days,
      window_label: row?.source_window_label ?? labelFor(days),
      status: row?.status ?? "UNAVAILABLE",
      provider_id: row?.provider_id ?? input.broker.canonical_provider_id ?? null,
      provider_name: row?.provider_name ?? input.broker.canonical_provider_name ?? null,
      requested_as_of: input.broker.requested_as_of ?? null,
      source_date: row?.source_date ?? null,
      source_date_verified: row?.source_date_verified === true,
      source_window_verified: row?.source_window_verified !== false,
      source_range_verified: row?.source_range_verified === true,
      requested_range_start: row?.requested_range_start ?? null,
      requested_range_end: row?.requested_range_end ?? null,
      top_net_buyers: Array.isArray(row?.top_net_buyers) ? row!.top_net_buyers! : [],
      top_net_sellers: Array.isArray(row?.top_net_sellers) ? row!.top_net_sellers! : [],
      error: row?.error ?? (row ? null : "missing_requested_window"),
    };
  });
}

export const FAMILY_BROKER_WINDOW_RENDER_CONTRACT = Object.freeze({
  every_requested_window_must_render: true,
  omission_allowed: false,
  pending_or_error_window_must_render_status_and_reason: true,
  ready_window_must_render_source_date: true,
  preserve_requested_window_order: true,
  missing_window_means: "UNKNOWN",
  nested_window_semantics: "NESTED_WINDOWS_SAME_END_DATE_NOT_TIME_SERIES",
});
