import assert from "node:assert/strict";
import {
  routeBrokerProviderBundle,
  type BrokerBundleProvider,
  type BrokerProviderBundle,
} from "../src/v6/broker-provider-bundle-router.ts";

const requestedWindows = [1, 5, 10, 20, 60] as const;

type WindowStatus = "READY" | "READY_EMPTY" | "PENDING" | "ERROR";

function fixtureBundle(input: {
  provider_id: string;
  statuses: Record<number, WindowStatus>;
  requested_as_of?: string;
  source_date_override?: Partial<Record<number, string>>;
}): BrokerProviderBundle {
  const requestedAsOf = input.requested_as_of ?? "2026-09-04";
  const windows = Object.fromEntries(requestedWindows.map((days) => {
    const status = input.statuses[days] ?? "ERROR";
    const sourceDate = input.source_date_override?.[days] ?? requestedAsOf;
    return [`${days}D`, {
      provider_id: input.provider_id,
      provider_name: input.provider_id,
      status,
      window_days: days,
      requested_as_of: requestedAsOf,
      source_date: sourceDate,
      source_date_verified: status === "READY" || status === "READY_EMPTY",
      source_range_verified: status === "READY" || status === "READY_EMPTY",
      requested_range_start: requestedAsOf,
      requested_range_end: requestedAsOf,
      top_net_buyers: status === "READY" ? [{ broker_branch: `${input.provider_id}-BUY-${days}`, net_lots: days * 10 }] : [],
      top_net_sellers: status === "READY" ? [{ broker_branch: `${input.provider_id}-SELL-${days}`, net_lots: -days * 9 }] : [],
      error: status === "PENDING" ? "source_date_mismatch" : status === "ERROR" ? "fixture_error" : null,
    }];
  }));
  const ready = Object.values(windows).filter((row: any) => row.status === "READY" || row.status === "READY_EMPTY").length;
  return {
    version: "fixture/v1",
    provider_id: input.provider_id,
    provider_name: input.provider_id,
    provider_tier: "PUBLIC_SECONDARY",
    symbol: "2317",
    requested_as_of: requestedAsOf,
    requested_windows: [...requestedWindows],
    status: ready === requestedWindows.length ? "READY" : ready > 0 ? "DEGRADED" : "ERROR",
    ready_window_count: ready,
    windows,
    branch_matrix: [],
    completeness: "RANKED_ONLY",
    persistence: "NONE",
    daily_rank_summing: false,
    previous_day_substitution: false,
    missing_branch_means_zero: false,
    same_provider_bundle: true,
    window_semantics: "EXACT_TWSE_TRADING_DAY_WINDOWS",
  };
}

function provider(id: string, bundle: BrokerProviderBundle): BrokerBundleProvider {
  return {
    id,
    priority: id === "MONEYDJ" ? 10 : 20,
    capabilities: {
      exact_as_of: true,
      exact_twse_trading_day_windows: true,
      historical_as_of: true,
      ranked_only: true,
    },
    readBundle: async () => bundle,
  };
}

// Whole-bundle failover: MoneyDJ may be partial, but if another qualified
// provider can satisfy every requested window at the same as-of and semantics,
// the canonical result must switch the ENTIRE bundle to that provider.
{
  const money = fixtureBundle({
    provider_id: "MONEYDJ",
    statuses: { 1: "READY", 5: "READY", 10: "READY", 20: "READY", 60: "PENDING" },
  });
  const histock = fixtureBundle({
    provider_id: "HISTOCK",
    statuses: { 1: "READY", 5: "READY", 10: "READY", 20: "READY", 60: "READY" },
  });
  const result = await routeBrokerProviderBundle({
    symbol: "2317",
    as_of: "2026-09-04",
    windows: requestedWindows,
    providers: [provider("MONEYDJ", money), provider("HISTOCK", histock)],
  });
  assert.equal(result.status, "READY");
  assert.equal(result.canonical_provider_id, "HISTOCK");
  assert.equal(result.bundle_failover_used, true);
  assert.equal(result.cross_provider_window_mixing, false);
  assert.equal(result.same_provider_required, true);
  assert.equal(result.same_requested_as_of_required, true);
  assert.equal(result.cross_source_backfill_allowed, false);
  assert.deepEqual(result.requested_windows, [...requestedWindows]);
  assert.ok(Object.values(result.windows).every((row: any) => row.provider_id === "HISTOCK"));
  assert.equal(result.provider_attempts[0]?.provider_id, "MONEYDJ");
  assert.equal(result.provider_attempts[1]?.provider_id, "HISTOCK");
}

// If no provider can produce a full bundle, return the best ONE-provider
// partial bundle. Never fill missing MoneyDJ windows with another provider.
{
  const money = fixtureBundle({
    provider_id: "MONEYDJ",
    statuses: { 1: "READY", 5: "READY", 10: "READY", 20: "READY", 60: "PENDING" },
  });
  const histock = fixtureBundle({
    provider_id: "HISTOCK",
    statuses: { 1: "READY", 5: "READY", 10: "READY", 20: "PENDING", 60: "PENDING" },
  });
  const result = await routeBrokerProviderBundle({
    symbol: "2317",
    as_of: "2026-09-04",
    windows: requestedWindows,
    providers: [provider("MONEYDJ", money), provider("HISTOCK", histock)],
  });
  assert.equal(result.status, "DEGRADED");
  assert.equal(result.canonical_provider_id, "MONEYDJ");
  assert.equal(result.cross_provider_window_mixing, false);
  assert.equal((result.windows["60D"] as any).provider_id, "MONEYDJ");
  assert.equal((result.windows["60D"] as any).status, "PENDING");
}

// A provider that appears full but cannot prove the requested exact as-of for
// every window is not eligible as a canonical full-bundle replacement.
{
  const money = fixtureBundle({
    provider_id: "MONEYDJ",
    statuses: { 1: "READY", 5: "READY", 10: "READY", 20: "READY", 60: "PENDING" },
  });
  const histock = fixtureBundle({
    provider_id: "HISTOCK",
    statuses: { 1: "READY", 5: "READY", 10: "READY", 20: "READY", 60: "READY" },
    source_date_override: { 60: "2026-09-03" },
  });
  const result = await routeBrokerProviderBundle({
    symbol: "2317",
    as_of: "2026-09-04",
    windows: requestedWindows,
    providers: [provider("MONEYDJ", money), provider("HISTOCK", histock)],
  });
  assert.equal(result.canonical_provider_id, "MONEYDJ");
  assert.equal(result.status, "DEGRADED");
  assert.ok(result.provider_attempts.some((attempt) => attempt.provider_id === "HISTOCK" && attempt.contract_valid === false));
}

// A one-window question is itself a one-window bundle. Failover to another
// provider is allowed as long as the whole requested bundle (that one window)
// comes from the same provider.
{
  const oneWindowMoney = fixtureBundle({
    provider_id: "MONEYDJ",
    statuses: { 1: "ERROR", 5: "ERROR", 10: "ERROR", 20: "ERROR", 60: "ERROR" },
  });
  const oneWindowHi = fixtureBundle({
    provider_id: "HISTOCK",
    statuses: { 1: "READY", 5: "ERROR", 10: "ERROR", 20: "ERROR", 60: "ERROR" },
  });
  const result = await routeBrokerProviderBundle({
    symbol: "2317",
    as_of: "2026-09-04",
    windows: [1],
    providers: [provider("MONEYDJ", oneWindowMoney), provider("HISTOCK", oneWindowHi)],
  });
  assert.equal(result.status, "READY");
  assert.equal(result.canonical_provider_id, "HISTOCK");
  assert.deepEqual(result.requested_windows, [1]);
}

// Broker execution channels are never investor identity. The router must make
// this machine-readable so the answer layer cannot turn a branch name into an
// unsupported foreign/institutional-investor attribution.
{
  const money = fixtureBundle({
    provider_id: "MONEYDJ",
    statuses: { 1: "READY", 5: "READY", 10: "READY", 20: "READY", 60: "READY" },
  });
  const result = await routeBrokerProviderBundle({
    symbol: "2317",
    as_of: "2026-09-04",
    windows: requestedWindows,
    providers: [provider("MONEYDJ", money)],
  });
  assert.equal(result.broker_identity_attribution_allowed, false);
  assert.equal(result.window_comparison_semantics, "NESTED_WINDOWS_SAME_END_DATE_NOT_TIME_SERIES");
}

console.log("broker provider whole-bundle router RED/contract tests passed");
