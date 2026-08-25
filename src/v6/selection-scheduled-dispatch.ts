import { runExtendedScheduledMarketDataController } from "./market-data-scheduled-dispatch.ts";
import { runIntradayReviewSelection, runNightSelections } from "./selection-engine.ts";
import {
  enqueueSelectionWake,
  SELECTION_QUEUE_BINDING,
  type SelectionQueueJob,
} from "./selection-queue-delivery.ts";

export { SELECTION_QUEUE_BINDING } from "./selection-queue-delivery.ts";
export type { SelectionQueueJob } from "./selection-queue-delivery.ts";

export const SELECTION_SCHEDULED_DISPATCH_VERSION = "diamond-selection-scheduled-dispatch/v1.1.1-queue-isolated";

function isPending(value: any) {
  return value?.status === "PENDING";
}

export async function runSelectionAwareScheduledController(env: Env, scheduledTime: number) {
  // Safety invariant: the verified V6 market-data controller always runs first
  // and is awaited exactly as before. Selection delivery is only a lightweight
  // follow-up enqueue. If market-data throws, the error propagates and no
  // selection work is started in this invocation.
  const marketData = await runExtendedScheduledMarketDataController(env, scheduledTime);
  const selectionDelivery = await enqueueSelectionWake(env, scheduledTime);
  return {
    version: SELECTION_SCHEDULED_DISPATCH_VERSION,
    lane: "MARKET_DATA_THEN_SELECTION_QUEUE",
    marketData,
    selectionDelivery,
  };
}

export async function runSelectionQueueJob(env: Env, job: SelectionQueueJob) {
  if (!job || job.schema !== "diamond-selection-queue-job/v1") {
    throw new Error("INVALID_SELECTION_QUEUE_JOB");
  }

  const now = new Date(job.scheduled_time_ms);
  if (job.action === "INTRADAY_REVIEW") {
    const selection = await runIntradayReviewSelection(env, {
      source_trade_date: job.source_trade_date,
      now,
    });
    return { status: isPending(selection) ? "PENDING" : "DONE", action: job.action, selection };
  }

  if (job.action === "NIGHT_SELECTION") {
    const selection = await runNightSelections(env, {
      source_trade_date: job.source_trade_date,
      target_session_date: job.target_session_date,
      now,
    });
    return { status: isPending(selection) ? "PENDING" : "DONE", action: job.action, selection };
  }

  throw new Error(`UNSUPPORTED_SELECTION_QUEUE_ACTION:${String((job as any).action ?? "")}`);
}

export async function runSelectionQueueBatch(env: Env, batch: any) {
  const results: any[] = [];
  for (const message of Array.isArray(batch?.messages) ? batch.messages : []) {
    try {
      const result = await runSelectionQueueJob(env, message.body as SelectionQueueJob);
      // PENDING is acknowledged intentionally. The existing */5 Cron will send
      // a fresh point-in-time retry on the next wake; Queue retry storms are not
      // used as a readiness poller.
      message.ack?.();
      results.push(result);
    } catch (error) {
      message.retry?.();
      console.error("selection-queue-job-failed", { error: String(error), binding: SELECTION_QUEUE_BINDING });
      results.push({ status: "ERROR_RETRY", error: String(error) });
    }
  }
  return { version: SELECTION_SCHEDULED_DISPATCH_VERSION, results };
}
