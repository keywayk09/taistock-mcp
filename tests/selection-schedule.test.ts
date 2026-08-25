import assert from "node:assert/strict";
import test from "node:test";
import { decideSelectionSchedule, nextWeekday, previousWeekday } from "../src/v6/selection-schedule.ts";

test("18:00 Taipei starts intraday review eligibility", () => {
  const result = decideSelectionSchedule(new Date("2026-08-24T10:00:00.000Z"));
  assert.equal(result.action, "INTRADAY_REVIEW");
  assert.equal(result.source_trade_date, "2026-08-24");
  assert.equal(result.target_session_date, "2026-08-24");
  assert.equal(result.slot, "EOD_1800");
});

test("18:55 Taipei remains an idempotent intraday-review catch-up wake", () => {
  const result = decideSelectionSchedule(new Date("2026-08-24T10:55:00.000Z"));
  assert.equal(result.action, "INTRADAY_REVIEW");
  assert.equal(result.slot, "EOD_1800");
});

test("22:30 Taipei runs separate swing and next-day intraday selection lane", () => {
  const result = decideSelectionSchedule(new Date("2026-08-24T14:30:00.000Z"));
  assert.equal(result.action, "NIGHT_SELECTION");
  assert.equal(result.source_trade_date, "2026-08-24");
  assert.equal(result.target_session_date, "2026-08-25");
  assert.equal(result.slot, "FULL_2230");
});

test("08:55 Taipei never runs a selection audit or rewrites the prior prediction", () => {
  const result = decideSelectionSchedule(new Date("2026-08-25T00:55:00.000Z"));
  assert.equal(result.action, "NONE");
  assert.equal(result.reason, "NO_SELECTION_WORK_DUE");
});

test("next and previous weekday cross weekends deterministically", () => {
  assert.equal(nextWeekday("2026-08-21"), "2026-08-24");
  assert.equal(previousWeekday("2026-08-24"), "2026-08-21");
});

test("ordinary non-selection wake remains non-selection", () => {
  const result = decideSelectionSchedule(new Date("2026-08-24T04:00:00.000Z"));
  assert.equal(result.action, "NONE");
});
