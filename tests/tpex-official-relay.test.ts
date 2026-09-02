import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setMarketDataCaptureTradeDate } from "../src/v6/market-data-capture-context.ts";
import { getTpexJson } from "../src/v6/tpex-cloudflare-transport.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

function embeddedPython(workflow: string) {
  const match = workflow.match(/python - <<'PY'\n([\s\S]*?)\n\s+PY(?:\n|$)/);
  assert.ok(match, "workflow Python heredoc missing");
  const lines = match[1].split("\n");
  const nonEmpty = lines.filter((line) => line.trim());
  const minIndent = Math.min(...nonEmpty.map((line) => line.match(/^\s*/)?.[0].length ?? 0));
  return lines.map((line) => line.slice(Math.min(minIndent, line.length))).join("\n");
}

function assertPythonCompiles(label: string, workflow: string) {
  const python = embeddedPython(workflow);
  const result = spawnSync("python3", ["-c", "import sys; compile(sys.stdin.read(), '<workflow>', 'exec')"], {
    input: python,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${label} embedded Python syntax failed:\n${result.stderr}`);
}

assert.equal(fs.existsSync(path.join(root, ".github/workflows/market-data-github-archive.yml")), false);

const store = read("src/v6/github-data-store.ts");
assert.match(store, /keywayk09\/tv-papertrader/);
assert.match(store, /DEFAULT_GITHUB_DATA_BRANCH = "main"/);

const capture = read("scripts/capture-tw-market-data.ts");
assert.match(capture, /https:\/\/www\.tpex\.org\.tw\/openapi\/v1\/tpex_3insti_daily_trading/);
assert.match(capture, /tpex_mainboard_margin_balance/);
assert.match(capture, /tpex_margin_sbl/);
assert.match(capture, /tpex_short_sell/);
assert.match(capture, /source_date_mismatch/);
assert.match(capture, /sha256|sha\(/i);
assert.match(capture, /dueLayerKeys/);
assert.match(capture, /rawCapture/);
assert.match(capture, /validateDate/);

// Daily relay must use the same exact-date modern TPEx contract already proven by History.
// Latest-only OpenAPI is not sufficient because margin/SBL can remain on the prior trade date
// after institutional data has already advanced.
const dailyRelay = read(".github/workflows/tpex-official-relay-v2.yml");
assert.match(dailyRelay, /\/www\/zh-tw\/insti\/dailyTrade\?type=Daily&sect=EW&date=/);
assert.match(dailyRelay, /\/www\/zh-tw\/margin\/balance\?date=/);
assert.match(dailyRelay, /\/www\/zh-tw\/margin\/sbl\?date=/);
assert.match(dailyRelay, /exact_table/);
assert.match(dailyRelay, /source_date_mismatch/);
assert.match(dailyRelay, /Asia\/Taipei/);
assert.match(dailyRelay, /sbl_balance/);
assert.match(dailyRelay, /sbl_volume/);
assert.match(dailyRelay, /existing_manifest/);
assert.match(dailyRelay, /REQUIRED_DATASETS/);
assert.match(dailyRelay, /21:15/);
assert.match(dailyRelay, /22:15/);
assert.match(dailyRelay, /22:45/);
assert.match(dailyRelay, /group: tpex-official-relay-v2/);
assert.doesNotMatch(dailyRelay, /grouped\.setdefault\(item\[0\]/);
assertPythonCompiles("Daily relay", dailyRelay);

// Cloudflare recovery must not rely only on the retired legacy PHP SBL endpoint.
// It first uses the same modern exact-date official TPEx JSON contract as the relay.
const tpexTransport = read("src/v6/tpex-cloudflare-transport.ts");
assert.match(tpexTransport, /\/www\/zh-tw\/margin\/sbl\?date=/);
assert.match(tpexTransport, /TPEX_SBL_MODERN_WEB_JSON/);
assert.match(tpexTransport, /modernExactDateRows/);
assert.match(tpexTransport, /source_date_mismatch/);
assert.match(tpexTransport, /table_date_mismatch/);
assert.match(tpexTransport, /getLegacyOfficialWebSblDataset/);

// The watchdog must share the exact same concurrency group as the official relay writer.
// Its final wake remains 22:40 Taipei, while the Cloudflare DAILY_RECOVERY epoch is now
// intentionally allowed to continue through 23:55. This gives late official/relay data a
// bounded same-day self-heal window without reopening the checkpoint after midnight.
const watchdogRelay = read(".github/workflows/tpex-relay-watchdog-v1.yml");
const marketSchedule = read("src/v6/market-data-schedule.ts");
assert.match(marketSchedule, /inSameDayRecoveryWindow/);
assert.match(marketSchedule, /hour === 23/);
assert.match(marketSchedule, /23:55/);
assert.match(marketSchedule, /checkpointIso\(date, 22, 15\)/);
assert.match(watchdogRelay, /22:40/);
assert.match(watchdogRelay, /cron: '40 14 \* \* 1-5'/);
assert.match(watchdogRelay, /group: tpex-official-relay-v2/);
assert.doesNotMatch(watchdogRelay, /group: tpex-relay-watchdog-v1/);
assert.doesNotMatch(watchdogRelay, /cron: '50 14 \* \* 1-5'/);
assert.doesNotMatch(watchdogRelay, /cron: '0 15 \* \* 1-5'/);

// Transient TPEx transport failures are retryable, but semantic/date validation remains
// fail-closed. Production observed an initial HTTP 520 followed by a clean rerun, so the
// watchdog must absorb only bounded transient transport failures and then give up.
assert.match(watchdogRelay, /urllib\.error/);
assert.match(watchdogRelay, /http\.client/);
assert.match(watchdogRelay, /IncompleteRead/);
assert.match(watchdogRelay, /ConnectionResetError/);
assert.match(watchdogRelay, /time\.sleep/);
assert.match(watchdogRelay, /520/);
assert.match(watchdogRelay, /429/);
assert.match(watchdogRelay, /502/);
assert.match(watchdogRelay, /503/);
assert.match(watchdogRelay, /504/);
assert.match(watchdogRelay, /2\s*,\s*5\s*,\s*10/);
assert.match(watchdogRelay, /source_date_mismatch/);
assertPythonCompiles("TPEx relay watchdog", watchdogRelay);

// Historical exact-date capture may classify an old date as no-trading only when ALL
// independent TPEx datasets are empty. A partial empty remains a hard data error.
const historyRelay = read(".github/workflows/tpex-historical-relay-v1.yml");
assert.match(historyRelay, /ALL_EXACT_DATE_TPEX_DATASETS_EMPTY/);
assert.match(historyRelay, /exact_date_dataset_partial_empty/);
assert.match(historyRelay, /NO_TRADING_DAY/);
assert.match(historyRelay, /skipped_no_trading_dates/);
assert.match(historyRelay, /last_skipped_no_trading_date/);
assert.match(historyRelay, /if\s+all\(/);
assert.match(historyRelay, /if\s+any\(/);
assert.match(historyRelay, /target\s*=\s*anchor\s*-\s*dt\.timedelta\(days=HORIZON_DAYS\s*-\s*1\)/);
assertPythonCompiles("Historical relay", historyRelay);

assert.equal(fs.existsSync(path.join(root, "src/v6/github-canonical-sync.ts")), false);
assert.equal(fs.existsSync(path.join(root, "src/v6/tpex-official-relay.ts")), false);
assert.equal(fs.existsSync(path.join(root, "src/v6/tpex-market-data-backfill.ts")), false);
assert.equal(fs.existsSync(path.join(root, ".github/workflows/tpex-official-relay.yml")), false);

const originalFetch = globalThis.fetch;
const originalTradeDate = "2026-09-02";

function mockRelayManifest() {
  return {
    schema: "TPEX_OFFICIAL_RELAY_V2",
    trade_date: originalTradeDate,
    source_owner: "TPEx",
    datasets: {},
  };
}

function modernSblBody(date = "20260902", tableDate = "115/09/02") {
  return {
    date,
    tables: [{
      date: tableDate,
      data: [["1234", "測試公司", "0", "0", "0", "0", "0", "0", "1000", "2500", "100", "0", "3400", "5000"]],
    }],
  };
}

async function withSblFetchMock(modernBody: any, run: (calls: string[]) => Promise<void>) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/openapi/v1/tpex_short_sell")) {
      return new Response("", { status: 302, headers: { location: "https://www.tpex.org.tw/errors" } });
    }
    if (url.endsWith(`/tpex-relay/${originalTradeDate}/manifest.json`)) {
      return new Response(JSON.stringify(mockRelayManifest()), { status: 200 });
    }
    if (url.includes("/www/zh-tw/margin/sbl?")) {
      return new Response(JSON.stringify(modernBody), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/web/stock/margin_trading/margin_sbl/margin_sbl_result.php")) {
      return new Response("", { status: 302, headers: { location: "https://www.tpex.org.tw/errors" } });
    }
    throw new Error(`unexpected_test_fetch:${url}`);
  }) as typeof fetch;
  setMarketDataCaptureTradeDate(originalTradeDate);
  try {
    await run(calls);
  } finally {
    setMarketDataCaptureTradeDate(null);
    globalThis.fetch = originalFetch;
  }
}

await withSblFetchMock(modernSblBody(), async (calls) => {
  const rows = await getTpexJson("https://www.tpex.org.tw/openapi/v1/tpex_short_sell", "TPEX_SHORT_SELL");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Date, originalTradeDate);
  assert.equal(rows[0].SecuritiesCompanyCode, "1234");
  assert.equal(rows[0].SBLVolume, 2.5);
  assert.ok(calls.some((url) => url.includes("/www/zh-tw/margin/sbl?")), "modern exact-date SBL endpoint was not attempted");
  assert.equal(calls.some((url) => url.includes("/web/stock/margin_trading/margin_sbl/margin_sbl_result.php")), false,
    "legacy PHP fallback should not run after modern exact-date success");
});

await withSblFetchMock(modernSblBody("20260901", "115/09/01"), async (calls) => {
  await assert.rejects(
    () => getTpexJson("https://www.tpex.org.tw/openapi/v1/tpex_short_sell", "TPEX_SHORT_SELL"),
    /TPEX_SBL_MODERN_WEB_JSON_source_date_mismatch:20260901/,
  );
  assert.equal(calls.some((url) => url.includes("/web/stock/margin_trading/margin_sbl/margin_sbl_result.php")), false,
    "semantic date mismatch must fail closed instead of falling back to legacy PHP");
});

console.log("P19 exact-date monotonic TPEx daily + historical no-trading evidence contracts passed");
