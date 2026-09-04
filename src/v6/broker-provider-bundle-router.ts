import {
  getTwBrokerRankedWindowBundleOnDemand,
  type TwBrokerWindowDays,
} from "./tw-broker-ranked-on-demand.ts";

export const BROKER_PROVIDER_BUNDLE_ROUTER_VERSION = "broker-provider-bundle-router/v1.0.0";

export type BrokerWindowStatus = "READY" | "READY_EMPTY" | "PENDING" | "ERROR" | "UNAVAILABLE";

export type BrokerProviderWindow = {
  provider_id: string;
  provider_name: string;
  status: BrokerWindowStatus;
  window_days: number;
  requested_as_of: string;
  source_date: string | null;
  source_date_verified: boolean;
  source_range_verified: boolean;
  requested_range_start: string | null;
  requested_range_end: string | null;
  top_net_buyers: unknown[];
  top_net_sellers: unknown[];
  error: string | null;
  [key: string]: unknown;
};

export type BrokerProviderBundle = {
  version: string;
  provider_id: string;
  provider_name: string;
  provider_tier: string;
  symbol: string;
  requested_as_of: string;
  requested_windows: number[];
  status: "READY" | "DEGRADED" | "PENDING" | "ERROR" | "UNAVAILABLE";
  ready_window_count: number;
  windows: Record<string, BrokerProviderWindow>;
  branch_matrix: unknown[];
  completeness: string;
  persistence: string;
  daily_rank_summing: boolean;
  previous_day_substitution: boolean;
  missing_branch_means_zero: boolean;
  same_provider_bundle: boolean;
  window_semantics: "EXACT_TWSE_TRADING_DAY_WINDOWS" | string;
  [key: string]: unknown;
};

export type BrokerProviderCapabilities = {
  exact_as_of: boolean;
  exact_twse_trading_day_windows: boolean;
  historical_as_of: boolean;
  ranked_only: boolean;
  supported_windows?: readonly number[];
};

export type BrokerBundleProvider = {
  id: string;
  priority: number;
  capabilities: BrokerProviderCapabilities;
  readBundle(input: {
    symbol: string;
    as_of: string;
    windows: readonly number[];
  }): Promise<BrokerProviderBundle>;
};

type ProviderAttempt = {
  provider_id: string;
  priority: number;
  attempted: boolean;
  skipped_reason: string | null;
  bundle_status: string | null;
  ready_window_count: number;
  contract_valid: boolean;
  contract_errors: string[];
};

function windowKey(days: number) {
  return `${days}D`;
}

function isUsable(status: BrokerWindowStatus) {
  return status === "READY" || status === "READY_EMPTY";
}

function sameNumbers(left: readonly number[], right: readonly number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateBundleContract(input: {
  bundle: BrokerProviderBundle;
  provider: BrokerBundleProvider;
  symbol: string;
  as_of: string;
  windows: readonly number[];
}) {
  const { bundle, provider, symbol, as_of: asOf, windows } = input;
  const errors: string[] = [];
  if (bundle.provider_id !== provider.id) errors.push("provider_id_mismatch");
  if (bundle.symbol !== symbol) errors.push("symbol_mismatch");
  if (bundle.requested_as_of !== asOf) errors.push("requested_as_of_mismatch");
  if (!sameNumbers(bundle.requested_windows, windows)) errors.push("requested_windows_mismatch");
  if (bundle.same_provider_bundle !== true) errors.push("same_provider_bundle_not_proven");
  if (bundle.window_semantics !== "EXACT_TWSE_TRADING_DAY_WINDOWS") errors.push("window_semantics_not_exact_twse_trading_days");
  if (bundle.previous_day_substitution !== false) errors.push("previous_day_substitution_forbidden");
  if (bundle.daily_rank_summing !== false) errors.push("daily_rank_summing_forbidden");
  if (bundle.missing_branch_means_zero !== false) errors.push("missing_branch_zero_forbidden");

  for (const days of windows) {
    const key = windowKey(days);
    const row = bundle.windows[key];
    if (!row) {
      errors.push(`missing_window:${key}`);
      continue;
    }
    if (row.provider_id !== provider.id) errors.push(`window_provider_mismatch:${key}`);
    if (row.window_days !== days) errors.push(`window_days_mismatch:${key}`);
    if (row.requested_as_of !== asOf) errors.push(`window_requested_as_of_mismatch:${key}`);
    if (row.requested_range_end !== asOf) errors.push(`window_range_end_mismatch:${key}`);
    if (isUsable(row.status)) {
      if (row.source_date !== asOf) errors.push(`source_date_mismatch:${key}:${row.source_date ?? "null"}`);
      if (row.source_date_verified !== true) errors.push(`source_date_unverified:${key}`);
      if (row.source_range_verified !== true) errors.push(`source_range_unverified:${key}`);
    }
  }
  return errors;
}

function fullBundleReady(bundle: BrokerProviderBundle, windows: readonly number[]) {
  return windows.every((days) => isUsable(bundle.windows[windowKey(days)]?.status));
}

function normalizedReadyCount(bundle: BrokerProviderBundle, windows: readonly number[]) {
  return windows.filter((days) => isUsable(bundle.windows[windowKey(days)]?.status)).length;
}

function derivedStatus(bundle: BrokerProviderBundle, windows: readonly number[]) {
  const ready = normalizedReadyCount(bundle, windows);
  if (ready === windows.length) return "READY" as const;
  if (ready > 0) return "DEGRADED" as const;
  const pending = windows.some((days) => bundle.windows[windowKey(days)]?.status === "PENDING");
  return pending ? "PENDING" as const : "ERROR" as const;
}

function providerEligible(provider: BrokerBundleProvider, windows: readonly number[]) {
  if (!provider.capabilities.exact_as_of) return "provider_lacks_exact_as_of";
  if (!provider.capabilities.exact_twse_trading_day_windows) return "provider_lacks_exact_twse_trading_day_windows";
  const supported = provider.capabilities.supported_windows;
  if (supported && windows.some((days) => !supported.includes(days))) return "provider_lacks_requested_window";
  return null;
}

export async function routeBrokerProviderBundle(input: {
  symbol: string;
  as_of: string;
  windows: readonly number[];
  providers: readonly BrokerBundleProvider[];
}) {
  if (!/^\d{4,6}$/.test(String(input.symbol ?? ""))) throw new Error("invalid_taiwan_symbol");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.as_of ?? ""))) throw new Error("invalid_as_of_date");
  const requestedWindows = [...input.windows];
  if (!requestedWindows.length) throw new Error("broker_windows_required");
  if (new Set(requestedWindows).size !== requestedWindows.length) throw new Error("duplicate_broker_windows");
  if (!input.providers.length) throw new Error("broker_providers_required");

  const providers = [...input.providers].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const providerAttempts: ProviderAttempt[] = [];
  const validCandidates: Array<{ provider: BrokerBundleProvider; bundle: BrokerProviderBundle; ready: number; order: number }> = [];
  let canonical: { provider: BrokerBundleProvider; bundle: BrokerProviderBundle; ready: number; order: number } | null = null;

  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index];
    const skippedReason = providerEligible(provider, requestedWindows);
    if (skippedReason) {
      providerAttempts.push({
        provider_id: provider.id,
        priority: provider.priority,
        attempted: false,
        skipped_reason: skippedReason,
        bundle_status: null,
        ready_window_count: 0,
        contract_valid: false,
        contract_errors: [skippedReason],
      });
      continue;
    }

    let bundle: BrokerProviderBundle;
    try {
      bundle = await provider.readBundle({ symbol: input.symbol, as_of: input.as_of, windows: requestedWindows });
    } catch (error) {
      providerAttempts.push({
        provider_id: provider.id,
        priority: provider.priority,
        attempted: true,
        skipped_reason: null,
        bundle_status: "ERROR",
        ready_window_count: 0,
        contract_valid: false,
        contract_errors: [`provider_throw:${error instanceof Error ? error.message : String(error)}`],
      });
      continue;
    }

    const contractErrors = validateBundleContract({
      bundle,
      provider,
      symbol: input.symbol,
      as_of: input.as_of,
      windows: requestedWindows,
    });
    const ready = normalizedReadyCount(bundle, requestedWindows);
    const contractValid = contractErrors.length === 0;
    providerAttempts.push({
      provider_id: provider.id,
      priority: provider.priority,
      attempted: true,
      skipped_reason: null,
      bundle_status: bundle.status,
      ready_window_count: ready,
      contract_valid: contractValid,
      contract_errors: contractErrors,
    });
    if (!contractValid) continue;

    const candidate = { provider, bundle, ready, order: index };
    validCandidates.push(candidate);
    if (fullBundleReady(bundle, requestedWindows)) {
      canonical = candidate;
      break;
    }
  }

  if (!canonical && validCandidates.length) {
    canonical = [...validCandidates].sort((a, b) =>
      b.ready - a.ready
      || a.provider.priority - b.provider.priority
      || a.order - b.order)[0];
  }

  if (!canonical) {
    return {
      version: BROKER_PROVIDER_BUNDLE_ROUTER_VERSION,
      status: "ERROR" as const,
      symbol: input.symbol,
      requested_as_of: input.as_of,
      requested_windows: requestedWindows,
      canonical_provider_id: null,
      canonical_provider_name: null,
      provider_attempts: providerAttempts,
      ready_window_count: 0,
      windows: {} as Record<string, BrokerProviderWindow>,
      branch_matrix: [],
      bundle_failover_used: false,
      same_provider_required: true,
      same_requested_as_of_required: true,
      cross_source_backfill_allowed: false,
      cross_provider_window_mixing: false,
      broker_identity_attribution_allowed: false,
      window_comparison_semantics: "NESTED_WINDOWS_SAME_END_DATE_NOT_TIME_SERIES" as const,
      missing_window_observation: "UNKNOWN" as const,
      previous_day_substitution: false,
      persistence: "NONE" as const,
    };
  }

  const firstAttemptedId = providerAttempts.find((attempt) => attempt.attempted)?.provider_id ?? null;
  const bundleFailoverUsed = firstAttemptedId !== null && canonical.provider.id !== firstAttemptedId;
  const status = derivedStatus(canonical.bundle, requestedWindows);
  return {
    version: BROKER_PROVIDER_BUNDLE_ROUTER_VERSION,
    status,
    symbol: input.symbol,
    requested_as_of: input.as_of,
    requested_windows: requestedWindows,
    canonical_provider_id: canonical.provider.id,
    canonical_provider_name: canonical.bundle.provider_name,
    canonical_provider_tier: canonical.bundle.provider_tier,
    provider_attempts: providerAttempts,
    ready_window_count: canonical.ready,
    windows: canonical.bundle.windows,
    branch_matrix: canonical.bundle.branch_matrix,
    bundle_failover_used: bundleFailoverUsed,
    same_provider_required: true,
    same_requested_as_of_required: true,
    cross_source_backfill_allowed: false,
    cross_provider_window_mixing: false,
    broker_identity_attribution_allowed: false,
    window_comparison_semantics: "NESTED_WINDOWS_SAME_END_DATE_NOT_TIME_SERIES" as const,
    missing_window_observation: "UNKNOWN" as const,
    previous_day_substitution: false,
    daily_rank_summing: false,
    completeness: canonical.bundle.completeness,
    persistence: "NONE" as const,
    interpretation_boundary: "All canonical requested windows come from one provider under one exact requested as-of and one TWSE-trading-day window contract. Providers may fail over only as a whole bundle; individual missing windows are never backfilled from another provider. Broker branch names are execution channels, not investor identity. N-day values are nested windows sharing the same end date, not a chronological time series.",
  };
}

function normalizeMoneyDjWindow(row: any, providerId: string, providerName: string): BrokerProviderWindow {
  return {
    ...row,
    provider_id: providerId,
    provider_name: providerName,
    window_days: Number(row?.window_days ?? 0),
    requested_as_of: String(row?.requested_as_of ?? ""),
    source_date: row?.source_date ?? null,
    source_date_verified: row?.source_date_verified === true,
    source_range_verified: row?.source_range_verified === true,
    requested_range_start: row?.requested_range_start ?? null,
    requested_range_end: row?.requested_range_end ?? null,
    top_net_buyers: Array.isArray(row?.buys) ? row.buys : [],
    top_net_sellers: Array.isArray(row?.sells) ? row.sells : [],
    error: row?.error ?? null,
  };
}

export function moneyDjBrokerBundleProvider(input: {
  fetcher?: typeof fetch;
  calendar_fetcher?: typeof fetch;
} = {}): BrokerBundleProvider {
  return {
    id: "MONEYDJ",
    priority: 10,
    capabilities: {
      exact_as_of: true,
      exact_twse_trading_day_windows: true,
      historical_as_of: true,
      ranked_only: true,
      supported_windows: [1, 5, 10, 20, 40, 60, 120, 240],
    },
    async readBundle(request) {
      const bundle = await getTwBrokerRankedWindowBundleOnDemand({
        symbol: request.symbol,
        as_of: request.as_of,
        windows: request.windows as TwBrokerWindowDays[],
        fetcher: input.fetcher,
        calendar_fetcher: input.calendar_fetcher,
      });
      const windows = Object.fromEntries(request.windows.map((days) => {
        const key = windowKey(days);
        return [key, normalizeMoneyDjWindow((bundle.windows as Record<string, any>)[key], "MONEYDJ", "MoneyDJ")];
      }));
      return {
        ...bundle,
        provider_id: "MONEYDJ",
        provider_name: "MoneyDJ",
        provider_tier: "PUBLIC_SECONDARY",
        requested_windows: [...request.windows],
        windows,
        same_provider_bundle: true,
        window_semantics: "EXACT_TWSE_TRADING_DAY_WINDOWS",
      } as BrokerProviderBundle;
    },
  };
}

/**
 * Production entry. Additional providers must implement the same exact-date,
 * exact-TWSE-trading-day bundle contract before being registered here. The
 * router itself already supports whole-bundle failover; a provider that cannot
 * prove the requested window semantics must stay shadow-only / ineligible.
 */
export async function getTwBrokerProviderBundleOnDemand(input: {
  symbol: string;
  as_of: string;
  windows?: readonly TwBrokerWindowDays[];
  providers?: readonly BrokerBundleProvider[];
  moneydj_fetcher?: typeof fetch;
  calendar_fetcher?: typeof fetch;
}) {
  const windows = [...(input.windows ?? [1, 5, 10, 20, 60])];
  const providers = input.providers ?? [moneyDjBrokerBundleProvider({
    fetcher: input.moneydj_fetcher,
    calendar_fetcher: input.calendar_fetcher,
  })];
  return routeBrokerProviderBundle({
    symbol: input.symbol,
    as_of: input.as_of,
    windows,
    providers,
  });
}
