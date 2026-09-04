import assert from "node:assert/strict";
import {
  getTwBrokerRankedOnDemand,
  resetTwBrokerRankedCacheForTests,
} from "../src/v6/tw-broker-ranked-on-demand.ts";

const signIn = `<!doctype html><html><head><meta charset="utf-8"><title>Sign in Page - SSO</title></head><body><h5>MoneyDJ - 會員</h5></body></html>`;
const broker = `<!doctype html><html><body>
<div>仲琦(2419) 券商分點-進出明細 單位：張 最後更新日：2026/09/04</div>
<table>
<tr><th>買超券商</th><th>買進</th><th>賣出</th><th>買超</th><th>佔成交比重</th><th>賣超券商</th><th>買進</th><th>賣出</th><th>賣超</th><th>佔成交比重</th></tr>
<tr><td>測試買方</td><td>500</td><td>100</td><td>400</td><td>5.0%</td><td>測試賣方</td><td>100</td><td>350</td><td>250</td><td>4.0%</td></tr>
</table>
</body></html>`;

resetTwBrokerRankedCacheForTests();
const requested: string[] = [];
const fetcher: typeof fetch = async (input) => {
  const url = String(input);
  requested.push(url);
  const host = new URL(url).host;
  if (host === "concords.moneydj.com") {
    // Reproduce a successful HTTP response that is not a broker payload. The
    // adapter must not mistake an SSO/wrapper page for authoritative evidence.
    return new Response(signIn, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (host === "5850web.moneydj.com") {
    return new Response(broker, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  throw new Error(`unexpected_moneydj_host:${host}`);
};

const result = await getTwBrokerRankedOnDemand({
  symbol: "2419",
  as_of: "2026-09-04",
  fetcher,
});

assert.equal(result.status, "READY");
assert.equal(result.source_date, "2026-09-04");
assert.equal(result.source_date_verified, true);
assert.equal((result as any).source_host, "5850web.moneydj.com");
assert.equal((result as any).origin_attempts, 2);
assert.equal(result.buys[0]?.broker_branch, "測試買方");
assert.equal(result.buys[0]?.net_lots, 400);
assert.equal(requested.length, 2);
assert.ok(requested.every((url) => !url.startsWith("https://www.moneydj.com/")), "anonymous www MoneyDJ SSO endpoint must not be used for broker evidence");

console.log("MoneyDJ same-provider public-origin failover contract passed");
