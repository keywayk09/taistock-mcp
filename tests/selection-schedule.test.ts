import assert from "node:assert/strict";
import test from "node:test";
import { decideSelectionSchedule, nextWeekday, previousWeekday } from "../src/v6/selection-schedule.ts";

test("18:30 Taipei is intraday review only", () => {
  const result = decideSelectionSchedule(new Date("2026-08-24T10:30:00.000Z"));
  assert.equal(result.action, "INTRADAY_REVIEW");
  assert.equal(result.source_trade_date, "2026-08-24");
  assert.equal(result.target_session_date, "2026-08-24");
  assert.equal(result.slot, "EOD_1830");
});

test("22:30 Taipei runs separate swing and next-day intraday selection lane", () => {
  const result = decideSelectionSchedule(new Date("2026-08-24T14:30:00.000Z"));
  assert.equal(result.action, "NIGHT_SELECTION");
  assert.equal(result.source_trade_date, "2026-08-24");
  assert.equal(result.target_session_date, "2026-08-25");
  assert.equal(result.slot, "FULL_2230");
});

test("08:55 Taipei records audit delta only after market final-audit window", () => {
  const result = decideSelectionSchedule(new Date("2026-08-25T00:55:00.000Z"));
  assert.equal(result.action, "AUDIT_DELTA");
  assert.equal(result.source_trade_date, "2026-08-24");
  assert.equal(result.reason, "08:55_POST_FINAL_AUDIT_DELTA_ONLY");
});

test("next and previous weekday cross weekends deterministically", () => {
  assert.equal(nextWeekday("2026-08-21"), "2026-08-24");
  assert.equal(previousWeekday("2026-08-24"), "2026-08-21");
});

test("ordinary non-selection wake remains market-data lane", () => {
  const result = decideSelectionSchedule(new Date("2026-08-24T04:00:00.000Z"));
  assert.equal(result.action, "NONE");
});
