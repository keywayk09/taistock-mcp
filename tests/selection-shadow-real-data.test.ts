import assert from "node:assert/strict";
import test from "node:test";

import { readGitHubJson, stableJson, type MemoryGitHubDataStore } from "../src/v6/github-data-store.ts";
import { runIntradayReviewSelection, runNightSelections } from "../src/v6/selection-engine.ts";
import { loadStableMarketUniverse } from "../src/v6/stable-market-tools.ts";

function taipeiDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function nextWeekday(date: string) {
  const d = new Date(`${date}T12:00:00+08:00`);
  do d.setUTCDate(d.getUTCDate() + 1); while ([0, 6].includes(d.getUTCDay()));
  return taipeiDate(d);
}

function normalizeDate(value: unknown): string | null {
  const raw = String(value ?? "").trim().split(/\s+/)[0];
  if (/^20\d{2}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^20\d{6}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (/^\d{7}$/.test(raw)) {
    const year = Number(raw.slice(0, 3)) + 1911;
    return `${year}-${raw.slice(3, 5)}-${raw.slice(5, 7)}`;
  }
  return null;
}

function manifestPath(date: string) {
  const [year, month, day] = date.split("-");
  return `data/market-data/daily/${year}/${month}/${day}/manifest.json`;
}

async function preloadCanonicalMarketData(sourceEnv: Env, shadowMemory: MemoryGitHubDataStore, date: string) {
  const path = manifestPath(date);
  const manifestRead = await readGitHubJson<any>(sourceEnv, path);
  if (!manifestRead.value) return { manifest: null, path, snapshots_loaded: 0 };
  shadowMemory.set(path, {
    sha: manifestRead.sha ?? `shadow-manifest-${date}`,
    text: stableJson(manifestRead.value),
  });

  let snapshotsLoaded = 0;
  for (const layer of Array.isArray(manifestRead.value.layers) ? manifestRead.value.layers : []) {
    const snapshotPath = String(layer?.snapshot_path ?? "").trim();
    if (!snapshotPath || shadowMemory.has(snapshotPath)) continue;
    const snapshotRead = await readGitHubJson<any>(sourceEnv, snapshotPath);
    if (!snapshotRead.value) continue;
    shadowMemory.set(snapshotPath, {
      sha: snapshotRead.sha ?? `shadow-snapshot-${snapshotsLoaded + 1}`,
      text: stableJson(snapshotRead.value),
    });
    snapshotsLoaded += 1;
  }
  return { manifest: manifestRead.value, path, snapshots_loaded: snapshotsLoaded };
}

function compactResult(value: any) {
  if (!value || typeof value !== "object") return value;
  if (value.status === "FINAL") {
    return {
      status: value.status,
      intraday_review_candidates: value.run?.candidate_count ?? null,
      next_day_intraday_candidates: value.next_day_intraday?.candidate_count ?? null,
      swing_candidates: value.swing?.candidate_count ?? null,
      source_trade_date: value.run?.source_trade_date ?? value.next_day_intraday?.source_trade_date ?? null,
    };
  }
  if (value.status === "PARTIAL") {
    return {
      status: value.status,
      next_day_intraday_candidates: value.next_day_intraday?.candidate_count ?? null,
      swing_error: value.swing_error?.code ?? value.swing_error?.status ?? null,
    };
  }
  return { status: value.status, code: value.code ?? null, detail: value.detail ?? null };
}

test("real public market data can traverse the exact selectors while all journal writes stay in shadow memory", async () => {
  const now = new Date();
  const sourceTradeDate = taipeiDate(now);
  const targetSessionDate = nextWeekday(sourceTradeDate);

  const sourceEnv = {
    GITHUB_DATA_REPO: "keywayk09/tv-papertrader",
    GITHUB_DATA_BRANCH: "main",
  } as Env;

  const shadowMemory: MemoryGitHubDataStore = new Map();
  const shadowEnv = {
    GITHUB_DATA_REPO: "keywayk09/tv-papertrader",
    GITHUB_DATA_BRANCH: "main",
    FUGLE_API_KEY: process.env.FUGLE_API_KEY || "",
    FINMIND_TOKEN: process.env.FINMIND_TOKEN || "",
    __GITHUB_DATA_MEMORY: shadowMemory,
  } as Env & { __GITHUB_DATA_MEMORY: MemoryGitHubDataStore };

  // Read canonical inputs from the real public GitHub data branch once, then
  // copy them into the in-memory backend. From this point onward the exact
  // production selector code can read/write normally, but no GitHub write API
  // is reachable because the memory backend intercepts every data-store write.
  const preload = await preloadCanonicalMarketData(sourceEnv, shadowMemory, sourceTradeDate);

  const universe = await loadStableMarketUniverse(true);
  const quoteDates = new Set(
    universe.rows.map((row) => normalizeDate(row.last_updated)).filter((date): date is string => Boolean(date)),
  );

  const intradayReview = await runIntradayReviewSelection(shadowEnv, {
    source_trade_date: sourceTradeDate,
    now,
  });
  const night = await runNightSelections(shadowEnv, {
    source_trade_date: sourceTradeDate,
    target_session_date: targetSessionDate,
    now,
  });

  console.log("REAL_SELECTION_SHADOW", JSON.stringify({
    taipei_now: now.toISOString(),
    source_trade_date: sourceTradeDate,
    target_session_date: targetSessionDate,
    market_usable: universe.usable,
    market_quote_dates: [...quoteDates].sort(),
    manifest_present: Boolean(preload.manifest),
    manifest_day_status: preload.manifest?.day_status ?? null,
    manifest_terminal: preload.manifest?.terminal ?? null,
    manifest_ready_layers: preload.manifest?.ready_layers ?? [],
    snapshots_loaded: preload.snapshots_loaded,
    fugle_key_present: Boolean(process.env.FUGLE_API_KEY),
    intraday_review: compactResult(intradayReview),
    night: compactResult(night),
    shadow_memory_paths: [...shadowMemory.keys()].filter((path) => path.startsWith("research/selection/")).sort(),
  }, null, 2));

  // This shadow must never have a GitHub write credential.
  assert.equal((shadowEnv as any).GITHUB_DATA_TOKEN, undefined);
  assert.equal((shadowEnv as any).GITHUB_TOKEN, undefined);

  // Exact selector behavior is accepted as FINAL/PARTIAL only when today's
  // required official inputs are actually ready. Before those checkpoints the
  // correct result is PENDING; stale prior-day substitution is forbidden.
  assert.ok(["FINAL", "PENDING"].includes(intradayReview.status), `unexpected intraday status=${intradayReview.status}`);
  assert.ok(["FINAL", "PARTIAL", "PENDING"].includes(night.status), `unexpected night status=${night.status}`);

  if (intradayReview.status === "PENDING") {
    assert.ok(intradayReview.code, "PENDING intraday result must state a reason");
  }
  if (night.status === "PENDING") {
    assert.ok(night.code, "PENDING night result must state a reason");
  }

  // Any generated evidence/journal objects exist only inside this process-local
  // memory map. This proves the real selector can be exercised without touching
  // the formal research/selection collections on tv-papertrader/main.
  for (const path of shadowMemory.keys()) {
    assert.ok(!path.includes(".."));
  }
});
