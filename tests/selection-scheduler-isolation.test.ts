import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { enqueueSelectionWake, SELECTION_QUEUE_BINDING } from "../src/v6/selection-scheduled-dispatch.ts";

const dispatcherSource = readFileSync(new URL("../src/v6/selection-scheduled-dispatch.ts", import.meta.url), "utf8");
const entrySource = readFileSync(new URL("../src/index-v7.ts", import.meta.url), "utf8");
const wrangler = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""));

test("missing selection queue fails closed without throwing", async () => {
  const result = await enqueueSelectionWake({} as any, Date.parse("2026-08-24T14:30:00.000Z"));
  assert.equal(result.status, "SELECTION_QUEUE_NOT_BOUND");
  assert.equal(result.enqueued, false);
  assert.equal(result.decision.action, "NIGHT_SELECTION");
});

test("18:00 wake only enqueues a lightweight intraday-review job", async () => {
  const sent: any[] = [];
  const env = {
    [SELECTION_QUEUE_BINDING]: {
      async send(body: any) {
        sent.push(body);
      },
    },
  } as any;
  const result = await enqueueSelectionWake(env, Date.parse("2026-08-24T10:00:00.000Z"));
  assert.equal(result.status, "ENQUEUED");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].action, "INTRADAY_REVIEW");
  assert.equal(sent[0].source_trade_date, "2026-08-24");
  assert.equal(sent[0].slot, "EOD_1800");
});

test("08:55 never enqueues selection work", async () => {
  const sent: any[] = [];
  const env = { [SELECTION_QUEUE_BINDING]: { async send(body: any) { sent.push(body); } } } as any;
  const result = await enqueueSelectionWake(env, Date.parse("2026-08-25T00:55:00.000Z"));
  assert.equal(result.status, "NO_SELECTION_WORK_DUE");
  assert.equal(sent.length, 0);
});

test("scheduled safety invariant runs verified market-data controller before selection enqueue", () => {
  const fnStart = dispatcherSource.indexOf("export async function runSelectionAwareScheduledController");
  const marketCall = dispatcherSource.indexOf("await runExtendedScheduledMarketDataController", fnStart);
  const enqueueCall = dispatcherSource.indexOf("await enqueueSelectionWake", fnStart);
  assert.ok(fnStart >= 0);
  assert.ok(marketCall > fnStart);
  assert.ok(enqueueCall > marketCall);
  assert.match(dispatcherSource, /If market-data throws, the error propagates and no/);
});

test("heavy selectors execute only in queue consumer path, never before market-data cron lane", () => {
  const scheduledStart = dispatcherSource.indexOf("export async function runSelectionAwareScheduledController");
  const queueJobStart = dispatcherSource.indexOf("export async function runSelectionQueueJob");
  const scheduledBody = dispatcherSource.slice(scheduledStart, queueJobStart);
  assert.doesNotMatch(scheduledBody, /runIntradayReviewSelection\(/);
  assert.doesNotMatch(scheduledBody, /runNightSelections\(/);
  assert.match(entrySource, /async queue\(/);
  assert.match(entrySource, /runSelectionQueueBatch/);
});

test("test branch keeps the existing single taistock cron and introduces no production queue binding yet", () => {
  assert.deepEqual(wrangler.triggers?.crons, ["*/5 * * * *"]);
  assert.equal(wrangler.queues, undefined);
});
