import assert from "node:assert/strict";
import {
  getTwBrokerRankedOnDemand,
  resetTwBrokerRankedCacheForTests,
} from "../src/v6/tw-broker-ranked-on-demand.ts";

// Realistic MoneyDJ Big5 fixture already used by the broker adapter tests. The
// regression here is specifically the transport variant where the origin/CDN
// omits charset from Content-Type. The current adapter defaults such a response
// to UTF-8, garbles Chinese labels, and then fails with
// last_updated_date_not_found even though the ranked table is present.
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
    // Intentionally no charset. This is the production failure mode we need to
    // handle without weakening exact-date verification.
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

console.log("MoneyDJ broker charset auto-detect regression passed");
