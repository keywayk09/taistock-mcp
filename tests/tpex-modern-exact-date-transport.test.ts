import assert from "node:assert/strict";
import {
  getTpexInstitutionalPayload,
  getTpexMarginPayload,
} from "../src/v6/tpex-cloudflare-transport.ts";

const tradeDate = "2026-10-07";
const listedLikeRows = Array.from({ length: 5 }, (_, i) => {
  const row = Array(24).fill("0");
  row[0] = String(6001 + i);
  row[1] = "O" + i;
  row[10] = String(10000 + i);
  row[13] = String(2000 + i);
  row[22] = String(-500 - i);
  row[23] = String(11500 + i);
  return row;
});
const marginRows = Array.from({ length: 5 }, (_, i) => {
  const row = Array(20).fill("0");
  row[0] = String(6001 + i);
  row[1] = "O" + i;
  row[2] = String(1000 + i);
  row[6] = String(1010 + i);
  row[10] = String(100 + i);
  row[14] = String(98 + i);
  return row;
});

const modernInstitutional = {
  date: "20261007",
  stat: "ok",
  tables: [{ date: "115/10/07", data: listedLikeRows }],
};
const modernMargin = {
  date: "20261007",
  stat: "ok",
  tables: [{ date: "115/10/07", data: marginRows }],
};

const originalFetch = globalThis.fetch;
const calls: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  calls.push(url);
  if (url.includes("/openapi/v1/tpex_3insti_daily_trading") || url.includes("/openapi/v1/tpex_mainboard_margin_balance")) {
    return new Response("", { status: 302, headers: { location: "https://www.tpex.org.tw/errors" } });
  }
  if (url.includes("/www/zh-tw/insti/dailyTrade")) {
    assert.match(url, /date=115%2F10%2F07/);
    return new Response(JSON.stringify(modernInstitutional), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/www/zh-tw/margin/balance")) {
    assert.match(url, /date=2026%2F10%2F07/);
    return new Response(JSON.stringify(modernMargin), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error("unexpected network fallback: " + url);
}) as typeof fetch;

try {
  const institutional = await getTpexInstitutionalPayload(tradeDate) as any[];
  assert.equal(institutional.length, 5);
  assert.equal(institutional[0].Date, tradeDate);
  assert.equal(institutional[0]["證券代號"], "6001");
  assert.equal(institutional[0]["外資及陸資買賣超股數"], "10000");
  assert.equal(institutional[0]["投信買賣超股數"], "2000");
  assert.equal(institutional[0]["自營商買賣超股數"], "-500");

  const margin = await getTpexMarginPayload(tradeDate) as any[];
  assert.equal(margin.length, 5);
  assert.equal(margin[0].Date, tradeDate);
  assert.equal(margin[0]["證券代號"], "6001");
  assert.equal(margin[0]["融資前日餘額"], "1000");
  assert.equal(margin[0]["融資今日餘額"], "1010");
  assert.equal(margin[0]["融券前日餘額"], "100");
  assert.equal(margin[0]["融券今日餘額"], "98");

  assert.ok(calls.some((url) => url.includes("/www/zh-tw/insti/dailyTrade")));
  assert.ok(calls.some((url) => url.includes("/www/zh-tw/margin/balance")));
  assert.ok(!calls.some((url) => url.includes("raw.githubusercontent.com")), "modern official TPEx must win before GitHub relay");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("TPEx modern exact-date Cloudflare transport regression passed");
