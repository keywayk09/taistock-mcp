import { runExtendedScheduledMarketDataController } from "./market-data-scheduled-dispatch.ts";
import { runSelectionAuditDelta } from "./selection-audit.ts";
import { runIntradayReviewSelection, runNightSelections } from "./selection-engine.ts";
import { decideSelectionSchedule } from "./selection-schedule.ts";

export const SELECTION_SCHEDULED_DISPATCH_VERSION = "diamond-selection-scheduled-dispatch/v1.0.0";

function isPending(value: any) {
  return value?.status === "PENDING";
}

export async function runSelectionAwareScheduledController(env: Env, scheduledTime: number) {
  const now = new Date(scheduledTime);
  const decision = decideSelectionSchedule(now);

  if (decision.action === "INTRADAY_REVIEW") {
    const selection = await runIntradayReviewSelection(env, {
      source_trade_date: decision.source_trade_date,
      now,
    });
    console.log("selection-intraday-review", { decision, selection });
    return { version: SELECTION_SCHEDULED_DISPATCH_VERSION, lane: "SELECTION", decision, selection };
  }

  if (decision.action === "NIGHT_SELECTION") {
    // Selection probes readiness first. If the canonical late-data layers are
    // not complete, this wake is handed back to the market-data recovery lane.
    // The next five-minute wake retries selection. This prevents heavy swing
    // enrichment and recovery writes from competing in the same invocation.
    const selection = await runNightSelections(env, {
      source_trade_date: decision.source_trade_date,
      target_session_date: decision.target_session_date,
      now,
    });
    if (isPending(selection)) {
      const marketData = await runExtendedScheduledMarketDataController(env, scheduledTime);
      console.log("selection-night-pending-market-recovery", { decision, selection, marketData });
      return { version: SELECTION_SCHEDULED_DISPATCH_VERSION, lane: "MARKET_RECOVERY", decision, selection, marketData };
    }
    console.log("selection-night", { decision, selection });
    return { version: SELECTION_SCHEDULED_DISPATCH_VERSION, lane: "SELECTION", decision, selection };
  }

  if (decision.action === "AUDIT_DELTA") {
    const audit = await runSelectionAuditDelta(env, { source_trade_date: decision.source_trade_date, now });
    if (isPending(audit)) {
      const marketData = await runExtendedScheduledMarketDataController(env, scheduledTime);
      console.log("selection-audit-pending-market-audit", { decision, audit, marketData });
      return { version: SELECTION_SCHEDULED_DISPATCH_VERSION, lane: "MARKET_AUDIT", decision, audit, marketData };
    }
    console.log("selection-audit-delta", { decision, audit });
    return { version: SELECTION_SCHEDULED_DISPATCH_VERSION, lane: "SELECTION_AUDIT", decision, audit };
  }

  const marketData = await runExtendedScheduledMarketDataController(env, scheduledTime);
  return { version: SELECTION_SCHEDULED_DISPATCH_VERSION, lane: "MARKET_DATA", decision, marketData };
}
