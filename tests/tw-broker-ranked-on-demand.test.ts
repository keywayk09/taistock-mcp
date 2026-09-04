import assert from "node:assert/strict";
import {
  getTwBrokerRankedOnDemand,
  getTwBrokerRankedWindowBundleOnDemand,
  resetTwBrokerRankedCacheForTests,
} from "../src/v6/tw-broker-ranked-on-demand.ts";
import { resetTwseTradingCalendarCacheForTests } from "../src/v6/twse-trading-calendar-on-demand.ts";

const table = (date: string) => `<!doctype html><html><body>
<div>台積電(2330) 券商分點-進出明細 單位：張　最後更新日：${date}</div>
<table>
<tr><th>買超券商</th><th>買進</th><th>賣出</th><th>買超</th><th>佔成交比重</th><th>賣超券商</th><th>買進</th><th>賣出</th><th>賣超</th><th>佔成交比重</th></tr>
<tr><td>凱基-台北</td><td>937</td><td>237</td><td>700</td><td>5.19%</td><td>花旗環球</td><td>249</td><td>1,155</td><td>906</td><td>6.72%</td></tr>
<tr><td>新加坡商瑞銀</td><td>1,192</td><td>905</td><td>287</td><td>2.13%</td><td>台灣摩根士丹利</td><td>1,377</td><td>1,603</td><td>226</td><td>1.68%</td></tr>
</table></body></html>`;

const windowTable = (input: {
  date: string;
  selector: number;
  label: string;
  buyBranch: string;
  buyNet: number;
  sellBranch: string;
  sellNet: number;
}) => `<!doctype html><html><body>
<div>台積電(2330) 券商分點-進出明細 單位：張　最後更新日：${input.date}</div>
<select name="D">
<option value="1"${input.selector === 1 ? " selected" : ""}>近一日</option>
<option value="2"${input.selector === 2 ? " selected" : ""}>近五日</option>
<option value="3"${input.selector === 3 ? " selected" : ""}>近十日</option>
<option value="4"${input.selector === 4 ? " selected" : ""}>近20日</option>
<option value="5"${input.selector === 5 ? " selected" : ""}>近40日</option>
<option value="6"${input.selector === 6 ? " selected" : ""}>近60日</option>
<option value="7"${input.selector === 7 ? " selected" : ""}>近120日</option>
<option value="8"${input.selector === 8 ? " selected" : ""}>近240日</option>
</select>
<table>
<tr><th>買超券商</th><th>買進</th><th>賣出</th><th>買超</th><th>佔成交比重</th><th>賣超券商</th><th>買進</th><th>賣出</th><th>賣超</th><th>佔成交比重</th></tr>
<tr><td>${input.buyBranch}</td><td>${input.buyNet + 100}</td><td>100</td><td>${input.buyNet}</td><td>5.00%</td><td>${input.sellBranch}</td><td>100</td><td>${input.sellNet + 100}</td><td>${input.sellNet}</td><td>4.00%</td></tr>
</table>
<div>合計買超張數 ${input.buyNet} 合計賣超張數 ${input.sellNet}</div>
</body></html>`;

function makeFetch(html: string) {
  let count = 0;
  const fetcher: typeof fetch = async () => {
    count += 1;
    return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  };
  return { fetcher, count: () => count };
}

const moneyDjBig5Fixture = Buffer.from(
  "PCFkb2N0eXBlIGh0bWw+PGh0bWw+PGJvZHk+CjxkaXY+pXi/brlxKDIzMzApIKjpsNOkwMJJLbZppVip+rLTILPmpuyhR7FpoUCzzKvhp/O3c6TpoUcyMDI2LzA5LzA0PC9kaXY+Cjx0YWJsZT4KPHRyPjx0aD62UrZXqOmw0zwvdGg+PHRoPrZStmk8L3RoPjx0aD695qVYPC90aD48dGg+tlK2VzwvdGg+PHRoPqb7pqil5qTxras8L3RoPjx0aD695rZXqOmw0zwvdGg+PHRoPrZStmk8L3RoPjx0aD695qVYPC90aD48dGg+vea2VzwvdGg+PHRoPqb7pqil5qTxras8L3RoPjwvdHI+Cjx0cj48dGQ+s82w8i2leKVfPC90ZD48dGQ+OTM3PC90ZD48dGQ+MjM3PC90ZD48dGQ+NzAwPC90ZD48dGQ+NS4xOSU8L3RkPjx0ZD6q4bpYwPSyeTwvdGQ+PHRkPjI0OTwvdGQ+PHRkPjEsMTU1PC90ZD48dGQ+OTA2PC90ZD48dGQ+Ni43MiU8L3RkPjwvdHI+CjwvdGFibGU+PC9ib2R5PjwvaHRtbD4=",
  "base64",
);

resetTwBrokerRankedCacheForTests();
{
  const mock = makeFetch(table("2026/09/03"));
  const result = await getTwBrokerRankedOnDemand({ symbol: "2330", as_of: "2026-09-03", fetcher: mock.fetcher });
  assert.equal(result.status, "READY");
  assert.equal(result.source_date_verified, true);
  assert.equal(result.completeness, "RANKED_ONLY");
  assert.equal(result.persistence, "NONE");
  assert.equal((result as any).source_query_mode, "CUSTOM_EXACT_DATE");
  assert.equal((result as any).requested_range_start, "2026-09-03");
  assert.match(String(result.source_url), /[?&]e=2026-09-03&f=2026-09-03$/);
  assert.equal(result.buys[0]?.broker_branch, "凱基-台北");
  assert.equal(result.buys[0]?.net_lots, 700);
  assert.equal(result.sells[0]?.broker_branch, "花旗環球");
  assert.equal(result.sells[0]?.net_lots, -906);
  assert.equal(result.buys[1]?.turnover_share_pct, 2.13);

  const second = await getTwBrokerRankedOnDemand({ symbol: "2330", as_of: "2026-09-03", fetcher: mock.fetcher });
  assert.equal(second.status, "READY");
  assert.equal(mock.count(), 1, "ranked broker page should reuse the short-lived per-isolate cache");
}

resetTwBrokerRankedCacheForTests();
{
  const mock = makeFetch(table("2026/09/02"));
  const result = await getTwBrokerRankedOnDemand({ symbol: "2330", as_of: "2026-09-03", fetcher: mock.fetcher });
  assert.equal(result.status, "PENDING");
  assert.equal(result.source_date, "2026-09-02");
  assert.equal(result.source_date_verified, false);
  assert.deepEqual(result.buys, []);
  assert.deepEqual(result.sells, []);
}

resetTwBrokerRankedCacheForTests();
{
  const noData = `<!doctype html><html><body><div>最後更新日：2026/09/03</div><div>查無(0080)券商分點-進出明細</div></body></html>`;
  const mock = makeFetch(noData);
  const result = await getTwBrokerRankedOnDemand({ symbol: "0080", as_of: "2026-09-03", fetcher: mock.fetcher });
  assert.equal(result.status, "READY_EMPTY");
  assert.equal(result.ok, true);
}

resetTwBrokerRankedCacheForTests();
{
  let count = 0;
  const fetcher: typeof fetch = async () => {
    count += 1;
    return new Response(moneyDjBig5Fixture, {
      status: 200,
      headers: { "content-type": "text/html;Charset=big5" },
    });
  };
  const result = await getTwBrokerRankedOnDemand({ symbol: "2330", as_of: "2026-09-04", fetcher });
  assert.equal(result.status, "READY");
  assert.equal(result.source_date, "2026-09-04");
  assert.equal(result.source_date_verified, true);
  assert.equal(result.source_charset, "big5");
  assert.equal(result.transport_attempts, 1);
  assert.equal(result.buys[0]?.broker_branch, "凱基-台北");
  assert.equal(result.sells[0]?.broker_branch, "花旗環球");
  assert.equal(count, 1);
}

resetTwBrokerRankedCacheForTests();
{
  let count = 0;
  const fetcher: typeof fetch = async () => {
    count += 1;
    if (count === 1) {
      return new Response("temporary origin error", {
        status: 520,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return new Response(moneyDjBig5Fixture, {
      status: 200,
      headers: { "content-type": "text/html;Charset=big5" },
    });
  };
  const result = await getTwBrokerRankedOnDemand({ symbol: "2330", as_of: "2026-09-04", fetcher });
  assert.equal(result.status, "READY");
  assert.equal(result.source_date, "2026-09-04");
  assert.equal(result.source_charset, "big5");
  assert.equal(result.transport_attempts, 2);
  assert.equal(count, 2, "one transient 520 should be retried exactly once");
}

resetTwBrokerRankedCacheForTests();
resetTwseTradingCalendarCacheForTests();
{
  const requestedUrls: string[] = [];
  const fixtures = new Map<string, string>([
    ["1D", windowTable({ date: "2026/09/03", selector: 1, label: "近一日", buyBranch: "單日買方", buyNet: 100, sellBranch: "單日賣方", sellNet: 90 })],
    ["5D", windowTable({ date: "2026/09/03", selector: 2, label: "近五日", buyBranch: "長線累積", buyNet: 500, sellBranch: "短空長多", sellNet: 400 })],
    ["10D", windowTable({ date: "2026/09/03", selector: 3, label: "近十日", buyBranch: "長線累積", buyNet: 900, sellBranch: "短空長多", sellNet: 600 })],
    ["20D", windowTable({ date: "2026/09/03", selector: 4, label: "近20日", buyBranch: "長線累積", buyNet: 1600, sellBranch: "長線派發", sellNet: 1200 })],
    ["60D", windowTable({ date: "2026/09/03", selector: 6, label: "近60日", buyBranch: "短空長多", buyNet: 3000, sellBranch: "長線派發", sellNet: 2600 })],
  ]);
  const startToKey = new Map([
    ["2026-09-03", "1D"],
    ["2026-08-28", "5D"],
    ["2026-08-21", "10D"],
    ["2026-08-07", "20D"],
    ["2026-06-11", "60D"],
  ]);
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    const start = new URL(url).searchParams.get("e") ?? "";
    const key = startToKey.get(start);
    assert.ok(key, `unexpected MoneyDJ custom range: ${url}`);
    return new Response(fixtures.get(key)!, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  };
  let calendarFetchCount = 0;
  const calendarFetcher: typeof fetch = async () => {
    calendarFetchCount += 1;
    return new Response(JSON.stringify({
      stat: "ok",
      queryYear: 2026,
      data: [["2026-06-19", "端午節", "依規定放假1日。"]],
    }), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
  };

  const bundle = await getTwBrokerRankedWindowBundleOnDemand({
    symbol: "2330",
    as_of: "2026-09-03",
    fetcher,
    calendar_fetcher: calendarFetcher,
  });
  assert.equal(bundle.status, "READY");
  assert.equal(bundle.server_side_interval_aggregation, true);
  assert.equal(bundle.daily_rank_summing, false);
  assert.equal(bundle.missing_branch_means_zero, false);
  assert.equal(bundle.previous_day_substitution, false);
  assert.deepEqual(bundle.requested_windows, [1, 5, 10, 20, 60]);
  assert.equal((bundle.windows["1D"] as any).source_query_mode, "CUSTOM_EXACT_DATE");
  assert.equal((bundle.windows["5D"] as any).source_query_mode, "CUSTOM_TRADING_DAY_RANGE");
  assert.equal((bundle.windows["5D"] as any).requested_range_start, "2026-08-28");
  assert.equal((bundle.windows["10D"] as any).requested_range_start, "2026-08-21");
  assert.equal((bundle.windows["20D"] as any).requested_range_start, "2026-08-07");
  assert.equal((bundle.windows["60D"] as any).requested_range_start, "2026-06-11");
  assert.equal((bundle.windows["60D"] as any).source_range_verified, true);
  assert.equal(calendarFetchCount, 1, "multi-window reads should reuse one cached TWSE yearly calendar");
  for (const [start, key] of startToKey) {
    assert.ok(
      requestedUrls.some((url) => url.includes(`e=${start}&f=2026-09-03`)),
      `${key} must use exact historical custom range ending requested_as_of`,
    );
  }
  assert.ok(requestedUrls.every((url) => /zco\.djhtm\?a=2330&e=/.test(url)), "no fixed latest-window page may substitute for historical as_of");
  assert.equal(bundle.windows["5D"].source_window_label, "近五日");
  assert.equal(bundle.windows["10D"].source_window_label, "近十日");
  assert.equal(bundle.windows["20D"].source_window_label, "近20日");
  assert.equal(bundle.windows["60D"].source_window_label, "近60日");
  assert.equal(bundle.windows["60D"].source_date_verified, true);

  const accumulating = bundle.branch_matrix.find((row) => row.broker_branch === "長線累積");
  assert.ok(accumulating);
  assert.equal(accumulating.pattern, "PERSISTENT_ACCUMULATION");
  assert.equal(accumulating.windows["5D"]?.net_lots, 500);
  assert.equal(accumulating.windows["60D"], null, "missing ranked branch must remain UNKNOWN/null, never zero");

  const reversal = bundle.branch_matrix.find((row) => row.broker_branch === "短空長多");
  assert.ok(reversal);
  assert.equal(reversal.windows["5D"]?.net_lots, -400);
  assert.equal(reversal.windows["60D"]?.net_lots, 3000);
  assert.equal(reversal.pattern, "SHORT_TERM_DISTRIBUTION_AGAINST_LONGER_ACCUMULATION");
}

console.log("TW ranked broker on-demand tests passed");
