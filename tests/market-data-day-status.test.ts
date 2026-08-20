import assert from "node:assert/strict";
import { getTwMarketDataDayStatus } from "../src/v6/market-data-day-status.ts";

function envWith(path: string, value: unknown) {
  return {
    __GITHUB_DATA_MEMORY: new Map([[path, { sha: "fixture-sha", text: JSON.stringify(value) + "\n" }]]),
  } as unknown as Env;
}

const holidayPath = "data/market-data/daily/2026/09/25/manifest.json";
const holiday = await getTwMarketDataDayStatus(envWith(holidayPath, {
  schema_version: "diamond-market-data-manifest/v2",
  trade_date: "2026-09-25",
  storage: "GITHUB_ONLY",
  day_status: "NO_TRADING_DAY",
  terminal: true,
  expected_layers: 0,
  ready_layers: 0,
  missing_layers: [],
  trading_day_gate: { status: "CLOSED_SCHEDULED", terminal: true, evidence: { source: "TWSE_HOLIDAY_SCHEDULE", verified: true } },
  layers: [],
  updated_at: "2026-09-25T10:15:00Z",
}), "2026-09-25");
assert.equal(holiday.status, "NO_TRADING_DAY");
assert.equal(holiday.terminal, true);
assert.equal(holiday.expected_layers, 0);

const partialPath = "data/market-data/daily/2026/08/20/manifest.json";
const partial = await getTwMarketDataDayStatus(envWith(partialPath, {
  schema_version: "diamond-market-data-manifest/v2",
  trade_date: "2026-08-20",
  storage: "GITHUB_ONLY",
  day_status: "PARTIAL",
  terminal: false,
  expected_layers: 8,
  ready_layers: 1,
  missing_layers: ["margin-listed"],
  layers: [
    { kind: "institutional", market: "listed", status: "READY", row_count: 100 },
    { kind: "margin", market: "listed", status: "PENDING", row_count: 0, next_retry_at: "2026-08-20T14:05:00Z" },
  ],
  updated_at: "2026-08-20T13:55:00Z",
}), "2026-08-20");
assert.equal(partial.status, "DEGRADED");
assert.equal(partial.terminal, false);
assert.equal(partial.exact_ready_layers, 1);
assert.deepEqual(partial.missing_layers, ["margin-listed"]);

const missing = await getTwMarketDataDayStatus({ __GITHUB_DATA_MEMORY: new Map() } as unknown as Env, "2026-08-21");
assert.equal(missing.status, "UNAVAILABLE");
assert.equal(missing.terminal, false);

console.log("market-data day status v2.1 tests passed");
