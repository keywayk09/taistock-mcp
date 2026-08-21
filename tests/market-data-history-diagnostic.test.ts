import assert from "node:assert/strict";
import fs from "node:fs";
import {
  HISTORY_FAILURE_DIAGNOSTIC_PATH,
  buildHistoryFailureDiagnostic,
  persistHistoryFailureDiagnostic,
} from "../src/v6/market-data-history-diagnostic.ts";
import { GitHubDataStoreError, stableJson, type MemoryGitHubDataStore } from "../src/v6/github-data-store.ts";

assert.equal(HISTORY_FAILURE_DIAGNOSTIC_PATH, "data/market-data/backfill/last-error.json");

const githubError = new GitHubDataStoreError(
  "GITHUB_ATOMIC_INVALID_CONTENT",
  "GitHub contents response is not a file",
  200,
  { path: "data/market-data/index/2026/08/1.json" },
);
const first = await buildHistoryFailureDiagnostic({
  error: githubError,
  stage: "HISTORY_BACKFILL_STEP",
  anchorTradeDate: "2026-08-21",
  cursorDate: "2026-08-14",
  observedAt: "2026-08-21T20:40:00.000Z",
});
assert.equal(first.error_name, "GitHubDataStoreError");
assert.equal(first.error_code, "GITHUB_ATOMIC_INVALID_CONTENT");
assert.equal(first.error_status, 200);
assert.equal(first.cursor_date, "2026-08-14");
assert.equal(first.stage, "HISTORY_BACKFILL_STEP");
assert.match(first.fingerprint, /^[0-9a-f]{64}$/);
assert.ok(first.error_message.length <= 1200);

const sameLater = await buildHistoryFailureDiagnostic({
  error: githubError,
  stage: "HISTORY_BACKFILL_STEP",
  anchorTradeDate: "2026-08-21",
  cursorDate: "2026-08-14",
  observedAt: "2026-08-21T20:45:00.000Z",
});
assert.equal(sameLater.fingerprint, first.fingerprint, "fingerprint must not change only because time changed");

const memory: MemoryGitHubDataStore = new Map();
const env = { __GITHUB_DATA_MEMORY: memory } as unknown as Env;
const write1 = await persistHistoryFailureDiagnostic(env, first);
assert.equal(write1.idempotent, false);
const text1 = memory.get(HISTORY_FAILURE_DIAGNOSTIC_PATH)?.text;
assert.ok(text1);
const write2 = await persistHistoryFailureDiagnostic(env, sameLater);
assert.equal(write2.idempotent, true, "repeating the same production error must not create commit churn");
assert.equal(memory.get(HISTORY_FAILURE_DIAGNOSTIC_PATH)?.text, text1);

const changedError = await buildHistoryFailureDiagnostic({
  error: new Error("different_failure"),
  stage: "HISTORY_BACKFILL_STEP",
  anchorTradeDate: "2026-08-21",
  cursorDate: "2026-08-14",
  observedAt: "2026-08-21T20:50:00.000Z",
});
const write3 = await persistHistoryFailureDiagnostic(env, changedError);
assert.equal(write3.idempotent, false);
const stored = JSON.parse(memory.get(HISTORY_FAILURE_DIAGNOSTIC_PATH)!.text);
assert.equal(stored.error_message, "different_failure");
assert.equal(stored.first_observed_at, "2026-08-21T20:50:00.000Z");
assert.equal(stored.fingerprint, changedError.fingerprint);
assert.notEqual(stableJson(stored), text1);

const dispatch = fs.readFileSync("src/v6/market-data-scheduled-dispatch.ts", "utf8");
assert.match(dispatch, /recordHistoryBackfillFailure/);
assert.match(dispatch, /HISTORY_BACKFILL_STEP/);
assert.match(dispatch, /catch \(error\)/);
assert.match(dispatch, /throw error/);

console.log("market-data History production failure diagnostic contract passed");
