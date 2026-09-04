import assert from "node:assert/strict";
import {
  resetTwseTradingCalendarCacheForTests,
  resolveTwseTradingWindowStart,
} from "../src/v6/twse-trading-calendar-on-demand.ts";

function calendarPayload(year: number) {
  const rows: string[][] = [];
  if (year === 2026) {
    rows.push(
      ["2026-01-01", "中華民國開國紀念日", "依規定放假1日。"],
      ["2026-01-02", "國曆新年開始交易日", "國曆新年開始交易。"],
      ["2026-02-11", "農曆春節前最後交易日", "農曆春節前最後交易。"],
      ["2026-02-12", "市場無交易，僅辦理結算交割作業", ""],
      ["2026-02-13", "市場無交易，僅辦理結算交割作業", ""],
      ["2026-02-16", "農曆除夕及春節", "休市"],
      ["2026-02-17", "農曆除夕及春節", "休市"],
      ["2026-02-18", "農曆除夕及春節", "休市"],
      ["2026-02-19", "農曆除夕及春節", "休市"],
      ["2026-02-20", "農曆除夕及春節", "休市"],
      ["2026-02-23", "農曆春節後開始交易日", "農曆春節後開始交易。"],
      ["2026-06-19", "端午節", "依規定放假1日。"],
    );
  } else if (year === 2025) {
    rows.push(["2025-12-25", "行憲紀念日", "依規定放假1日。"]);
  }
  return { stat: "ok", queryYear: year, data: rows };
}

let calendarFetchCount = 0;
const calendarFetcher: typeof fetch = async (input) => {
  calendarFetchCount += 1;
  const url = new URL(String(input));
  const rocYear = Number(url.searchParams.get("queryYear"));
  const year = rocYear + 1911;
  return new Response(JSON.stringify(calendarPayload(year)), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};

resetTwseTradingCalendarCacheForTests();
for (const [days, expected] of [
  [1, "2026-09-03"],
  [5, "2026-08-28"],
  [10, "2026-08-21"],
  [20, "2026-08-07"],
  [60, "2026-06-11"],
] as const) {
  const result = await resolveTwseTradingWindowStart({
    as_of: "2026-09-03",
    trading_days: days,
    fetcher: calendarFetcher,
  });
  assert.equal(result.start_date, expected, `${days}D trading-window start`);
  assert.equal(result.end_date, "2026-09-03");
  assert.equal(result.previous_day_substitution, false);
  assert.deepEqual(result.calendar_years, [2026]);
}
assert.equal(calendarFetchCount, 1, "one official yearly calendar should be cached inside the isolate");

await assert.rejects(
  resolveTwseTradingWindowStart({
    as_of: "2026-06-19",
    trading_days: 5,
    fetcher: calendarFetcher,
  }),
  /requested_as_of_not_trading_day:2026-06-19/,
);

resetTwseTradingCalendarCacheForTests();
const crossYear = await resolveTwseTradingWindowStart({
  as_of: "2026-01-05",
  trading_days: 8,
  fetcher: calendarFetcher,
});
assert.deepEqual(crossYear.calendar_years, [2025, 2026]);
assert.ok(crossYear.start_date < "2026-01-01");

console.log("TWSE exact trading-calendar window tests passed");
