import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getTpexInstitutionalPayload, getTpexMarginPayload } from "../src/v6/tpex-cloudflare-transport.ts";

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
assert.match(dailyRelay, /3itrade_hedge_result\.php/);
assert.match(dailyRelay, /margin_bal_result\.php/);
assert.match(dailyRelay, /institutional_openapi/);
assert.match(dailyRelay, /margin_openapi/);
assert.match(dailyRelay, /exact_openapi_rows/);
assert.match(dailyRelay, /TPEX_INSTI_OPENAPI/);
assert.match(dailyRelay, /TPEX_MARGIN_OPENAPI/);
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
// The recovery order is direct OpenAPI -> immutable relay -> modern exact-date official JSON
// -> legacy PHP only for transport-level modern failures. Exact-date semantic failures remain
// hard fail-closed and must never be hidden by the legacy endpoint.
const tpexTransport = read("src/v6/tpex-cloudflare-transport.ts");
assert.match(tpexTransport, /\/www\/zh-tw\/margin\/sbl\?date=/);
assert.match(tpexTransport, /TPEX_SBL_MODERN_WEB_JSON/);
assert.match(tpexTransport, /modernExactDateRows/);
assert.match(tpexTransport, /normalizeSblRows/);
assert.match(tpexTransport, /isModernSblSemanticError/);
assert.match(tpexTransport, /source_date_mismatch/);
assert.match(tpexTransport, /table_date_mismatch/);
assert.match(tpexTransport, /root_not_object/);
assert.match(tpexTransport, /tables_missing/);
assert.match(tpexTransport, /exact_date_empty/);
assert.match(tpexTransport, /if \(isModernSblSemanticError\(modernError\)\) throw modernError/);
assert.match(tpexTransport, /getLegacyOfficialWebSblDataset/);
assert.match(tpexTransport, /TPEX_SBL_OFFICIAL_FALLBACK_failed/);
const sblRecoveryStart = tpexTransport.indexOf("async function getOfficialWebSblDataset");
const sblRecoveryEnd = tpexTransport.indexOf("export async function getTpexJson", sblRecoveryStart);
assert.ok(sblRecoveryStart >= 0 && sblRecoveryEnd > sblRecoveryStart, "SBL recovery wrapper missing");
const sblRecoveryBlock = tpexTransport.slice(sblRecoveryStart, sblRecoveryEnd);
const modernPos = sblRecoveryBlock.indexOf("TPEX_SBL_MODERN_WEB_JSON");
const legacyPos = sblRecoveryBlock.indexOf("getLegacyOfficialWebSblDataset");
assert.ok(modernPos >= 0 && legacyPos > modernPos, "modern exact-date SBL recovery must precede legacy PHP fallback");

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


// Exact-date TPEx recovery regression: upstream latest-only OpenAPI redirects
// to /errors while the relay exists but lacks institutional/margin snapshots.
// A modern day-addressable official response can recover only if it proves the
// requested date at both root/table. Undated legacy PHP must never be relabelled.
assert.match(tpexTransport, /TPEX_3INSTI_MODERN_EXACT_DATE/);
assert.match(tpexTransport, /TPEX_MARGIN_MODERN_EXACT_DATE/);
assert.match(tpexTransport, /legacy_exact_date_unverifiable/);
assert.match(dailyRelay, /Enforce report-critical TPEx datasets after publishing/);
assert.match(dailyRelay, /SystemExit\(1\)/);
assert.match(dailyRelay, /23:15 \/ 23:45/);
const originalTpexFetch = globalThis.fetch;
const testDay = "2026-10-08";
let modernMode: "ready" | "stale" | "redirect" = "ready";
let legacyCalls = 0;
const instRow = Array(24).fill("0");
instRow[0] = "5347";
instRow[1] = "世界";
instRow[10] = "1200000";
instRow[13] = "100000";
instRow[22] = "5000";
instRow[23] = "1305000";
const marginRow = Array(15).fill("0");
marginRow[0] = "5347";
marginRow[1] = "世界";
marginRow[2] = "12000";
marginRow[6] = "11777";
marginRow[10] = "445";
marginRow[14] = "600";
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  const json = (body: unknown) => new Response(JSON.stringify(body), {
    status: 200, headers: { "content-type": "application/json" },
  });
  const redirect = () => new Response("", {
    status: 302, headers: { location: "https://www.tpex.org.tw/errors" },
  });
  if (url.includes("/openapi/v1/tpex_")) return redirect();
  if (url.includes("/market-data/tpex-relay/2026-10-08/manifest.json")) {
    return json({ schema: "TPEX_OFFICIAL_RELAY_V2", trade_date: testDay, source_owner: "TPEx", datasets: {} });
  }
  if (url.includes("/www/zh-tw/insti/dailyTrade")) {
    if (modernMode === "redirect") return redirect();
    return json({ date: modernMode === "stale" ? "20261007" : "20261008", tables: [
      { date: modernMode === "stale" ? "115/10/07" : "115/10/08", data: [instRow] },
    ] });
  }
  if (url.includes("/www/zh-tw/margin/balance")) {
    if (modernMode === "redirect") return redirect();
    return json({ date: modernMode === "stale" ? "20261007" : "20261008", tables: [
      { date: modernMode === "stale" ? "115/10/07" : "115/10/08", data: [marginRow] },
    ] });
  }
  if (url.includes("/web/stock/")) {
    legacyCalls += 1;
    return json({ aaData: [instRow] });
  }
  throw new Error("unexpected_tpex_test_url:" + url);
}) as typeof fetch;
try {
  const instRecovered = await getTpexInstitutionalPayload(testDay) as any[];
  const marginRecovered = await getTpexMarginPayload(testDay) as any[];
  assert.equal(instRecovered.length, 1);
  assert.equal(instRecovered[0].Date, testDay);
  assert.equal(instRecovered[0]["外資及陸資買賣超股數"], "1200000");
  assert.equal(marginRecovered.length, 1);
  assert.equal(marginRecovered[0].Date, testDay);
  assert.equal(marginRecovered[0]["融資今日餘額"], "11777");
  assert.equal(legacyCalls, 0);

  modernMode = "stale";
  await assert.rejects(() => getTpexInstitutionalPayload(testDay), /source_date_mismatch/);
  await assert.rejects(() => getTpexMarginPayload(testDay), /source_date_mismatch/);
  assert.equal(legacyCalls, 0, "stale verified modern dates must never trigger unverifiable PHP fallback");

  modernMode = "redirect";
  await assert.rejects(() => getTpexInstitutionalPayload(testDay), /legacy_exact_date_unverifiable/);
  await assert.rejects(() => getTpexMarginPayload(testDay), /legacy_exact_date_unverifiable/);
  assert.equal(legacyCalls, 2, "legacy is attempted but undated old rows must fail closed");
} finally {
  globalThis.fetch = originalTpexFetch;
}

console.log("P19 exact-date monotonic TPEx daily + historical no-trading evidence contracts passed");
