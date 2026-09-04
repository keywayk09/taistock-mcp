import assert from "node:assert/strict";
import {
  getTwBrokerRankedOnDemand,
  resetTwBrokerRankedCacheForTests,
} from "../src/v6/tw-broker-ranked-on-demand.ts";

// Realistic MoneyDJ Big5 fixture. The regression is specifically the transport
// variant where the page omits charset; semantic decoding must still recover
// the Chinese broker/date labels without another network request.
const moneyDjBig5Fixture = Buffer.from(
  "PCFkb2N0eXBlIGh0bWw+PGh0bWw+PGJvZHk+CjxkaXY+pXi/brlxKDIzMzApIKjpsNOkwMJJLbZppVip+rLTILPmpuyhR7FpoUCzzKvhp/O3c6TpoUcyMDI2LzA5LzA0PC9kaXY+Cjx0YWJsZT4KPHRyPjx0aD62UrZXqOmw0zwvdGg+PHRoPrZStmk8L3RoPjx0aD695qVYPC90aD48dGg+tlK2VzwvdGg+PHRoPqb7pqil5qTxras8L3RoPjx0aD695rZXqOmw0zwvdGg+PHRoPrZStmk8L3RoPjx0aD695qVYPC90aD48dGg+vea2VzwvdGg+PHRoPqb7pqil5qTxras8L3RoPjwvdHI+Cjx0cj48dGQ+s82w8i2leKVfPC90ZD48dGQ+OTM3PC90ZD48dGQ+MjM3PC90ZD48dGQ+NzAwPC90ZD48dGQ+NS4xOSU8L3RkPjx0ZD6q4bpYwPSyeTwvdGQ+PHRkPjI0OTwvdGQ+PHRkPjEsMTU1PC90ZD48dGQ+OTA2PC90ZD48dGQ+Ni43MiU8L3RkPjwvdHI+CjwvdGFibGU+PC9ib2R5PjwvaHRtbD4=",
  "base64",
);

resetTwBrokerRankedCacheForTests();
let calls = 0;
const fetcher: typeof fetch = async () => {
  calls += 1;
  return new Response(moneyDjBig5Fixture, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
};

const result = await getTwBrokerRankedOnDemand({
  symbol: "2330",
  as_of: "2026-09-04",
  fetcher,
});

assert.equal(result.status, "READY");
assert.equal(result.source_date, "2026-09-04");
assert.equal(result.source_date_verified, true);
assert.equal(result.source_charset, "big5");
assert.equal(result.buys[0]?.broker_branch, "凱基-台北");
assert.equal(result.buys[0]?.net_lots, 700);
assert.equal(result.sells[0]?.broker_branch, "花旗環球");
assert.equal(result.sells[0]?.net_lots, -906);
assert.equal(calls, 1, "charset recovery must not require a second origin request");

await import("./moneydj-public-origin-failover.test.ts");
// Branch-only live canary. Remove before final GREEN/merge.
await import("./moneydj-2419-live-smoke-temp.ts");

console.log("MoneyDJ broker charset auto-detect regression passed");
