import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  handleAutomationOhlc1dRoute,
  presentAutomationDailyVolume,
} from "../src/v6/automation-ohlc-1d-route.ts";

const BASE = "https://taistock-mcp.keywayk09.workers.dev";
const REV = "a".repeat(40);

// Missing volume is semantically missing, never a manufactured zero.
{
  const row = { date: "2026-08-28", symbol: "2330", volume: null, source: "derived_from_1m" };
  const out = presentAutomationDailyVolume(row);
  assert.equal(out.volume, null);
  assert.equal("volume_shares" in out, false);
  assert.equal("volume_lots" in out, false);
  assert.equal("volume_presentation" in out, false);
}

// Legacy lot-valued daily rows are still presented in shares with raw audit data.
{
  const out = presentAutomationDailyVolume({ date: "2026-08-28", symbol: "2330", volume: 13471, source: "derived_from_1m" });
  assert.equal(out.volume, 13_471_000);
  assert.equal(out.volume_raw, 13471);
  assert.equal(out.volume_raw_unit, "lot");
  assert.equal(out.volume_unit, "share");
}

// Omitting the optional 1D limit must use the documented 220 default rather
// than Number(null)=0 clamped to the 20-row minimum. A 25-row fixture proves
// the request is not silently truncated to 20.
{
  const path = "data/OHLC/tw/1d/2026/2330.csv";
  const rows: string[] = ["date,symbol,open,high,low,close,volume,source"];
  for (let day = 1; day <= 25; day += 1) {
    const dd = String(day).padStart(2, "0");
    rows.push(`2026-08-${dd},2330,100,101,99,100,1000000,fugle_clean_v2`);
  }
  rows.push("");
  const env = { __GITHUB_DATA_MEMORY: new Map([[path, { sha: "fixture-ohlc-sha", text: rows.join("\n") }]]) } as any;
  const response = await handleAutomationOhlc1dRoute(
    new Request(`${BASE}/research/automation/ohlc-1d?symbol=2330&as_of=2026-08-25&source_revision=${REV}`),
    env,
  );
  assert.ok(response);
  const body = await response!.json() as any;
  assert.equal(body.ok, true);
  assert.equal(body.returned, 25);
}

// Formal-Blind ingress must explicitly normalize its documented default before
// the compatibility handler sees URLSearchParams.get(null). This is a wrapper
// contract; Wrangler dry-run verifies actual Cloudflare bundling.
{
  const wrapper = await readFile(new URL("../src/index-automation-bridge.ts", import.meta.url), "utf8");
  assert.match(wrapper, /pathname === "\/research\/automation\/formal-blind"/);
  assert.match(wrapper, /!url\.searchParams\.has\("limit"\)/);
  assert.match(wrapper, /url\.searchParams\.set\("limit", "300"\)/);
}

console.log("automation-research-bridge-edgecases: PASS");
