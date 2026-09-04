import assert from "node:assert/strict";
import { getTwBrokerRankedOnDemand, resetTwBrokerRankedCacheForTests } from "../src/v6/tw-broker-ranked-on-demand.ts";

const table = (date: string) => `<!doctype html><html><body>
<div>台積電(2330) 券商分點-進出明細 單位：張　最後更新日：${date}</div>
<table>
<tr><th>買超券商</th><th>買進</th><th>賣出</th><th>買超</th><th>佔成交比重</th><th>賣超券商</th><th>買進</th><th>賣出</th><th>賣超</th><th>佔成交比重</th></tr>
<tr><td>凱基-台北</td><td>937</td><td>237</td><td>700</td><td>5.19%</td><td>花旗環球</td><td>249</td><td>1,155</td><td>906</td><td>6.72%</td></tr>
<tr><td>新加坡商瑞銀</td><td>1,192</td><td>905</td><td>287</td><td>2.13%</td><td>台灣摩根士丹利</td><td>1,377</td><td>1,603</td><td>226</td><td>1.68%</td></tr>
</table></body></html>`;

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

console.log("TW ranked broker on-demand tests passed");
