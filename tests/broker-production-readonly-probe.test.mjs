import assert from "node:assert/strict";
import {
  EXPECTED_WINDOWS,
  probeBrokerMcpEndpoint,
  validateBrokerPayload,
} from "../scripts/broker-production-readonly-probe.mjs";

function readyWindow(days, provider = "MONEYDJ") {
  return {
    provider_id: provider,
    provider_name: provider,
    status: "READY",
    window_days: days,
    source_date: "2026-09-04",
    source_date_verified: true,
    source_range_verified: true,
    requested_range_start: "2026-08-01",
    requested_range_end: "2026-09-04",
    top_net_buyers: [],
    top_net_sellers: [],
    error: null,
  };
}

function payload() {
  return {
    provider: "MoneyDJ",
    provider_id: "MONEYDJ",
    symbol: "2317",
    date: "2026-09-04",
    status: "READY",
    source_date: "2026-09-04",
    source_date_verified: true,
    previous_day_substitution: false,
    missing_branch_means_zero: false,
    error: null,
    broker_evidence_contract: {
      same_provider_required: true,
      same_requested_as_of_required: true,
      cross_source_backfill_allowed: false,
      cross_provider_window_mixing: false,
      partial_single_provider_result_allowed: true,
      broker_identity_attribution_allowed: false,
      window_comparison_semantics: "NESTED_WINDOWS_SAME_END_DATE_NOT_TIME_SERIES",
      missing_window_means: "UNKNOWN",
    },
    multi_window: {
      status: "READY",
      requested_windows: [...EXPECTED_WINDOWS],
      canonical_provider_id: "MONEYDJ",
      canonical_provider_name: "MoneyDJ",
      bundle_failover_used: false,
      same_provider_required: true,
      same_requested_as_of_required: true,
      cross_source_backfill_allowed: false,
      cross_provider_window_mixing: false,
      windows: {
        "5D": readyWindow(5),
        "10D": readyWindow(10),
        "20D": readyWindow(20),
        "60D": readyWindow(60),
      },
    },
  };
}

{
  const result = validateBrokerPayload(payload(), { symbol: "2317", date: "2026-09-04" });
  assert.equal(result.status, "PASS");
  assert.equal(result.ready_window_count, 5);
  assert.equal(result.all_windows_ready, true);
  assert.equal(result.canonical_provider_id, "MONEYDJ");
  assert.equal(result.cross_provider_window_mixing, false);
}

{
  const mixed = payload();
  mixed.multi_window.windows["60D"].provider_id = "OTHER";
  assert.throws(
    () => validateBrokerPayload(mixed, { symbol: "2317", date: "2026-09-04" }),
    /broker_window_provider_mismatch:60D/,
  );
}

{
  const stale = payload();
  stale.multi_window.windows["20D"].source_date = "2026-09-03";
  assert.throws(
    () => validateBrokerPayload(stale, { symbol: "2317", date: "2026-09-04" }),
    /broker_window_source_date_mismatch:20D/,
  );
}

{
  const partial = payload();
  partial.multi_window.status = "DEGRADED";
  partial.multi_window.windows["60D"].status = "PENDING";
  partial.multi_window.windows["60D"].source_date = null;
  partial.multi_window.windows["60D"].source_date_verified = false;
  partial.multi_window.windows["60D"].source_range_verified = false;
  partial.multi_window.windows["60D"].error = "source_date_mismatch";
  assert.throws(
    () => validateBrokerPayload(partial, { symbol: "2317", date: "2026-09-04" }),
    /broker_not_all_windows_ready:4\/5/,
  );
  const contractOnly = validateBrokerPayload(partial, {
    symbol: "2317",
    date: "2026-09-04",
    requireAllWindowsReady: false,
  });
  assert.equal(contractOnly.status, "PASS");
  assert.equal(contractOnly.all_windows_ready, false);
  assert.equal(contractOnly.ready_window_count, 4);
}

{
  const requests = [];
  const fetcher = async (_url, init) => {
    const request = JSON.parse(String(init.body));
    requests.push(request);
    if (request.method === "tools/list") {
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: { tools: [{ name: "get_broker_chips", inputSchema: { type: "object" } }] },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (request.method === "tools/call") {
      assert.equal(request.params.name, "get_broker_chips");
      assert.deepEqual(request.params.arguments, { symbol: "2317", date: "2026-09-04", top_n: 20 });
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: JSON.stringify(payload()) }] },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected method ${request.method}`);
  };
  const result = await probeBrokerMcpEndpoint({
    endpoint: "https://example.test/my-mcp",
    bearerToken: "test-token",
    symbol: "2317",
    date: "2026-09-04",
    fetcher,
  });
  assert.equal(result.status, "PASS");
  assert.equal(result.protocol_lane, "MODERN_2026");
  assert.equal(result.production_mutation, "NONE");
  assert.equal(result.bearer_token_present, true);
  assert.equal(requests.length, 2);
}

console.log("broker production read-only probe contract passed");
