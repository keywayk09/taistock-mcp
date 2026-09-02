import assert from "node:assert/strict";
import { getTwInstitutionalFlow } from "../src/v6/tw-market-data-github.ts";
import { stableJson, type MemoryGitHubDataStore } from "../src/v6/github-data-store.ts";

const compactPath = "data/market-data/index/2026/09/2.json";
const legacyPath = "data/market-data/index/2026/09/23.json";
const memory: MemoryGitHubDataStore = new Map([
  [compactPath, {
    sha: "a".repeat(40),
    text: stableJson({
      schema_version: "diamond-market-data-symbol-shard/v2",
      month: "2026-09",
      prefix: "2",
      symbols: {
        "2330": {
          institutional: [
            {
              trade_date: "2026-09-01",
              symbol: "2330",
              name: "台積電",
              market: "listed",
              foreign_net_shares: 5730863,
              trust_net_shares: 103869,
              dealer_net_shares: 130565,
              total_net_shares: 5965297,
              source: "TWSE_T86",
              source_priority: "OFFICIAL",
            },
          ],
        },
      },
      updated_at: "2026-09-01T08:00:00.000Z",
    }),
  }],
  [legacyPath, {
    sha: "b".repeat(40),
    text: stableJson({
      schema_version: "diamond-market-data-symbol-shard/v2",
      month: "2026-09",
      prefix: "23",
      symbols: {
        "2330": {
          institutional: [
            {
              trade_date: "2026-09-01",
              symbol: "2330",
              name: "STALE_LEGACY_ROW_MUST_NOT_WIN",
              market: "listed",
              foreign_net_shares: 1,
              trust_net_shares: 1,
              dealer_net_shares: 1,
              total_net_shares: 3,
              source: "LEGACY",
              source_priority: "OFFICIAL",
            },
          ],
        },
      },
      updated_at: "2026-09-01T07:00:00.000Z",
    }),
  }],
]);

const originalFetch = globalThis.fetch;
const authHeaders: Array<string | null> = [];
try {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get("authorization");
    authHeaders.push(auth);
    if (auth) return Response.json({ msg: "Token is illegal." }, { status: 400 });
    return Response.json({
      data: [
        { date: "2026-08-31", name: "Foreign_Investor", buy: 200, sell: 100 },
        { date: "2026-08-31", name: "Investment_Trust", buy: 50, sell: 20 },
        { date: "2026-08-31", name: "Dealer_self", buy: 10, sell: 5 },
      ],
    });
  }) as typeof fetch;

  const result = await getTwInstitutionalFlow({
    __GITHUB_DATA_MEMORY: memory,
    FINMIND_TOKEN: "expired-token",
  } as any, {
    symbol: "2330",
    as_of: "2026-09-01",
    calendar_days: 30,
  });

  assert.deepEqual(authHeaders, ["Bearer expired-token", null], "invalid FinMind token must retry anonymously");
  assert.equal(result.data_quality.fallback_error, null, "successful anonymous fallback must clear fallback_error");
  assert.equal(result.data_quality.official_days, 1);
  assert.equal(result.data_quality.total_days, 2);
  assert.equal(result.rows.at(-1)?.name, "台積電", "compact one-digit shard must win over legacy two-digit shard");
  assert.equal(result.rows.at(-1)?.total_net_shares, 5965297);
  assert.ok(result.datasets.some((x: any) => x.path === compactPath), "dataset evidence must identify compact one-digit shard");
  assert.ok(!result.datasets.some((x: any) => x.path === legacyPath), "legacy shard must not be read when compact shard contains the symbol");

  console.log(JSON.stringify({
    status: "PASS",
    compact_path: compactPath,
    finmind_invalid_token_retry: "ANONYMOUS",
    official_days: result.data_quality.official_days,
    total_days: result.data_quality.total_days,
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
}
