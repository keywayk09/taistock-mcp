import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
assert.doesNotMatch(dailyRelay, /grouped\.setdefault\(item\[0\]/);
assertPythonCompiles("Daily relay", dailyRelay);

// The final exact-date watchdog must finish before the canonical Cloudflare DAILY_RECOVERY
// window closes at 22:55 Taipei. A 23:00 watchdog can repair the relay cache but is too late
// for the same-day canonical 5-minute writer, leaving the Published pointer stale until the
// next morning's final audit.
const watchdogRelay = read(".github/workflows/tpex-relay-watchdog-v1.yml");
const marketSchedule = read("src/v6/market-data-schedule.ts");
assert.match(marketSchedule, /inMinuteWindow\(hour, minute, 22, 15, 55\)/);
assert.match(watchdogRelay, /22:50/);
assert.match(watchdogRelay, /cron: '50 14 \* \* 1-5'/);
assert.doesNotMatch(watchdogRelay, /cron: '0 15 \* \* 1-5'/);
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

console.log("P19 exact-date monotonic TPEx daily + historical no-trading evidence contracts passed");
