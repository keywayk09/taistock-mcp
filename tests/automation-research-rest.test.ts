import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { handleAutomationOhlc1dRoute } from "../src/v6/automation-ohlc-1d-route.ts";
import { handleAutomationResearchRest } from "../src/v6/automation-research-rest.ts";

const BASE = "https://taistock-mcp.keywayk09.workers.dev";
const REV = "a".repeat(40);
const HEADER = "symbol,bar_time_tw,ts_ms,open,high,low,close,volume,source,updated_at_ms,trade_date,updated_at,ingest_id,export_batch,export_status";

function minuteTs(date: string, hhmm: string) { return Date.parse(`${date}T${hhmm}:00+08:00`); }
function minuteRow(date: string, symbol: string, hhmm: string, price: number) {
  const ts = minuteTs(date, hhmm);
  return [symbol, `${date} ${hhmm}:00`, ts, price, price + 1, price - 1, price + 0.5, 1000, "fixture", ts + 1, date, `${date} 14:00:00`, `${symbol}|${ts}`, "", ""].join(",");
}
function blindMemory(date: string, symbol: string) {
  const path = `data/OHLC/tw/1m/${date.slice(0,4)}/${date.slice(5,7)}/${date.slice(8,10)}/${symbol}.csv`;
  const rows = ["09:00","09:01","09:02","09:03","09:04","09:05","09:06"].map((time, i) => minuteRow(date, symbol, time, 100 + i));
  return new Map([[path, { sha: "fixture-blind-sha", text: [HEADER, ...rows, ""].join("\n") }]]);
}

// Root is a bounded navigation surface, not an arbitrary proxy.
{
  const response = await handleAutomationResearchRest(new Request(`${BASE}/research/automation`), {} as any)!;
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /READ ONLY/);
  assert.match(text, /formal-blind-canary/);
  assert.match(text, /market-latest/);
  assert.doesNotMatch(text, /GITHUB_DATA_TOKEN|FUGLE_API_KEY|Authorization:/i);
}

// Mutating methods are never accepted.
{
  const response = await handleAutomationResearchRest(new Request(`${BASE}/research/automation/health`, { method: "POST" }), {} as any)!;
  assert.equal(response.status, 405);
  const body = await response.json() as any;
  assert.equal(body.blocked, true);
  assert.equal(body.error, "METHOD_NOT_ALLOWED");
}

// Health contract explicitly denies writers and arbitrary proxy access.
{
  const response = await handleAutomationResearchRest(new Request(`${BASE}/research/automation/health?path=data/private&url=https://example.com`), {
    GITHUB_DATA_TOKEN: "DO_NOT_LEAK_THIS_TOKEN",
    FUGLE_API_KEY: "DO_NOT_LEAK_THIS_KEY",
  } as any)!;
  const text = await response.text();
  const body = JSON.parse(text);
  assert.equal(body.ok, true);
  assert.equal(body.read_only, true);
  assert.equal(body.writer_routes, false);
  assert.equal(body.arbitrary_path_access, false);
  assert.equal(body.arbitrary_url_access, false);
  assert.doesNotMatch(text, /DO_NOT_LEAK_THIS/);
}

// Formal Blind still uses the existing canonical reader. Future rows are in
// the fixture but must be removed by the server-side decision-time cutoff.
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    assert.match(url, /\/research\/formal-blind-verification\?/);
    return new Response(JSON.stringify({
      ok: true,
      formal_blind_eligible: true,
      symbol: "2330",
      timeframe: "1m",
      trade_date: "2026-08-28",
      decision_time: "09:05:00",
      cutoff: { leakage_validated: true, prefix_completeness: true },
      verification: { accepted_for_research: true, official_verified: true, level: "official_day_verified" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as any;
  try {
    const env = { __GITHUB_DATA_MEMORY: blindMemory("2026-08-28", "2330") } as any;
    const response = await handleAutomationResearchRest(new Request(`${BASE}/research/automation/formal-blind?symbol=2330&trade_date=2026-08-28&timeframe=1m&decision_time=09:05:00&limit=300`), env)!;
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.formal_blind_eligible, true);
    assert.equal(body.formal_research_eligible, true);
    assert.equal(body.scorecard_eligible, true);
    assert.equal(body.leakage_validated, true);
    assert.equal(body.cutoff.prefix_completeness, true);
    assert.deepEqual(body.rows.map((row: any) => row.bar_time_tw), ["09:00","09:01","09:02","09:03","09:04"].map((time) => `2026-08-28 ${time}:00`));
    assert.equal("bars" in body, false, "bridge must not duplicate rows as bars");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// Official verification rejection remains fail-closed even though transport is HTTP 200.
{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    ok: true,
    formal_blind_eligible: false,
    symbol: "2330",
    timeframe: "1m",
    trade_date: "2026-08-28",
    decision_time: "09:05:00",
    cutoff: { leakage_validated: true, prefix_completeness: true },
    verification: { accepted_for_research: false },
    eligibility_reason: "OFFICIAL_NOT_VERIFIED",
  }), { status: 200, headers: { "content-type": "application/json" } })) as any;
  try {
    const env = { __GITHUB_DATA_MEMORY: blindMemory("2026-08-28", "2330") } as any;
    const response = await handleAutomationResearchRest(new Request(`${BASE}/research/automation/formal-blind?symbol=2330&trade_date=2026-08-28&timeframe=1m&decision_time=09:05:00`), env)!;
    const body = await response.json() as any;
    assert.equal(body.formal_blind_eligible, false);
    assert.equal(body.formal_research_eligible, false);
    assert.equal(body.scorecard_eligible, false);
    assert.equal(body.eligibility_reason, "OFFICIAL_NOT_VERIFIED");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// Revision-pinned 1D route reads only the requested immutable GitHub ref and
// presents historical `derived_from_1m` volume in canonical shares.
{
  const path = "data/OHLC/tw/1d/2026/2330.csv";
  const csv = [
    "date,symbol,open,high,low,close,volume,source",
    "2026-08-27,2330,100,110,99,108,13471,derived_from_1m",
    "2026-08-28,2330,108,112,107,111,1200000,derived_from_1m_volume_shares_v2",
    "",
  ].join("\n");
  const env = { __GITHUB_DATA_MEMORY: new Map([[path, { sha: "ohlc-blob-sha", text: csv }]]) } as any;
  const response = await handleAutomationOhlc1dRoute(new Request(`${BASE}/research/automation/ohlc-1d?symbol=2330&as_of=2026-08-28&source_revision=${REV}&limit=220`), env)!;
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.ok, true);
  assert.equal(body.formal_research_eligible, true);
  assert.equal(body.source_revision, REV);
  assert.equal(body.provenance.branch, REV);
  assert.equal(body.rows[0].volume_raw, 13471);
  assert.equal(body.rows[0].volume_raw_unit, "lot");
  assert.equal(body.rows[0].volume, 13471000);
  assert.equal(body.rows[0].volume_shares, 13471000);
  assert.equal(body.rows[0].volume_lots, 13471);
  assert.equal(body.rows[1].volume, 1200000);
  assert.equal(body.rows[1].volume_raw_unit, "share");
  assert.equal(body.rows.at(-1).date, "2026-08-28");
}

// Invalid revisions cannot fall back to moving main.
{
  const response = await handleAutomationOhlc1dRoute(new Request(`${BASE}/research/automation/ohlc-1d?symbol=2330&as_of=2026-08-28&source_revision=main`), {} as any)!;
  const body = await response.json() as any;
  assert.equal(body.blocked, true);
  assert.equal(body.error, "INVALID_SOURCE_REVISION");
}

// The Cloudflare wrapper is statically constrained to intercept the bounded
// Automation namespace while delegating every ordinary request to index-v6.
// Root /health may overlay migration metadata only after the delegated response;
// this must not alter Automation routes or public MCP ingress behavior.
const wrapperSource = await readFile(new URL("../src/index-automation-bridge.ts", import.meta.url), "utf8");
const bridgeSource = await readFile(new URL("../src/v6/automation-research-rest.ts", import.meta.url), "utf8");
const ohlcRouteSource = await readFile(new URL("../src/v6/automation-ohlc-1d-route.ts", import.meta.url), "utf8");
const wranglerText = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const wrangler = JSON.parse(wranglerText.replace(/\/\*[\s\S]*?\*\//g, ""));
assert.equal(wrangler.main, "src/index-automation-bridge.ts");
assert.match(wrapperSource, /url\.pathname === "\/research\/automation\/ohlc-1d"/);
assert.match(wrapperSource, /url\.pathname\.startsWith\("\/research\/automation"\)/);
assert.match(wrapperSource, /const response = await app\.fetch\(request, env, ctx\)/);
assert.match(wrapperSource, /\(url\.pathname === "\/" \|\| url\.pathname === "\/health"\)/);
assert.match(wrapperSource, /return withOnDemandHealthMetadata\(response\)/);
assert.match(wrapperSource, /return response/);
assert.match(wrapperSource, /status:\s*"RETIRED_NOOP"/);
assert.match(wrapperSource, /reason:\s*"NON_OHLC_CHIP_DATA_MOVED_TO_ON_DEMAND"/);
assert.doesNotMatch(wrapperSource, /return app\.scheduled\(/);
assert.match(wrapperSource, /export \{ FamilyMCP, MyMCP \} from "\.\/index-v6\.ts"/);
assert.match(ohlcRouteSource, /LEGACY_DERIVED_1M_LOTS_TO_SHARES/);
assert.doesNotMatch(bridgeSource + ohlcRouteSource, /putImmutableGitHubJson|updateGitHubJson|fetch\([^\n]*url\.searchParams\.get\("url"/);
assert.doesNotMatch(bridgeSource + ohlcRouteSource, /GITHUB_DATA_TOKEN\s*[:=]|FUGLE_API_KEY\s*[:=]/);

console.log("automation-research-rest: PASS");
