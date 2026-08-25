import { decideSelectionSchedule, type SelectionScheduleDecision } from "./selection-schedule.ts";

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
