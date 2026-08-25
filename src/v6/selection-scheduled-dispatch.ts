import { runExtendedScheduledMarketDataController } from "./market-data-scheduled-dispatch.ts";
import { runIntradayReviewSelection, runNightSelections } from "./selection-engine.ts";
import { decideSelectionSchedule, type SelectionScheduleDecision } from "./selection-schedule.ts";

export const SELECTION_SCHEDULED_DISPATCH_VERSION = "diamond-selection-scheduled-dispatch/v1.1.0-queue-isolated";
export const SELECTION_QUEUE_BINDING = "DIAMOND_SELECTION_QUEUE";

export type SelectionQueueJob = {
  schema: "diamond-selection-queue-job/v1";
  scheduled_at: string;
  scheduled_time_ms: number;
  action: Exclude<SelectionScheduleDecision["action"], "NONE">;
  source_trade_date: string;
  target_session_date: string;
  slot: SelectionScheduleDecision["slot"];
  schedule_version: string;
};

function isPending(value: any) {
  return value?.status === "PENDING";
}

function makeQueueJob(decision: SelectionScheduleDecision, scheduledTime: number): SelectionQueueJob | null {
  if (decision.action === "NONE") return null;
  return {
    schema: "diamond-selection-queue-job/v1",
    scheduled_at: new Date(scheduledTime).toISOString(),
    scheduled_time_ms: scheduledTime,
    action: decision.action,
    source_trade_date: decision.source_trade_date,
    target_session_date: decision.target_session_date,
    slot: decision.slot,
    schedule_version: decision.version,
  };
}

export async function enqueueSelectionWake(env: Env, scheduledTime: number) {
  const decision = decideSelectionSchedule(new Date(scheduledTime));
  const job = makeQueueJob(decision, scheduledTime);
  if (!job) {
    return { status: "NO_SELECTION_WORK_DUE", decision, enqueued: false };
  }

  const queue = (env as any)?.[SELECTION_QUEUE_BINDING];
  if (!queue || typeof queue.send !== "function") {
    // Fail closed: missing queue delivery can only suppress the new selection
    // feature. It must never change or block the existing market-data pipeline.
    console.warn("selection-queue-not-bound", { decision, binding: SELECTION_QUEUE_BINDING });
    return { status: "SELECTION_QUEUE_NOT_BOUND", decision, enqueued: false };
  }

  await queue.send(job);
  console.log("selection-queue-enqueued", { decision, job });
  return { status: "ENQUEUED", decision, enqueued: true, job };
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
      console.error("selection-queue-job-failed", { error: String(error) });
      results.push({ status: "ERROR_RETRY", error: String(error) });
    }
  }
  return { version: SELECTION_SCHEDULED_DISPATCH_VERSION, results };
}
