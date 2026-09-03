import assert from "node:assert/strict";
import { getTwWarrantActivityOnDemand, resetTwWarrantActivityCacheForTests } from "../src/v6/tw-warrant-activity-on-demand.ts";

const asOf = "2026-09-03";

function makeFetcher(date = "20260903") {
  let calls = 0;
  const fetcher: typeof fetch = async (input) => {
    calls += 1;
    const url = String(input);
    if (url.includes("t187ap37_L")) {
      return new Response(JSON.stringify([
        { 出表日期: date, 權證代號: "030001", 權證簡稱: "台積電測試購", 權證類型: "認購", 標的證券代號: "2330" },
        { 出表日期: date, 權證代號: "030002", 權證簡稱: "台積電測試售", 權證類型: "認售", 標的證券代號: "2330" },
      ]));
    }
    if (url.includes("t187ap42_L")) {
      return new Response(JSON.stringify([
        { 交易日期: date, 權證代號: "030001", 權證名稱: "台積電測試購", 成交金額: "1,000,000", 成交數量: "500" },
        { 交易日期: date, 權證代號: "030002", 權證名稱: "台積電測試售", 成交金額: "250,000", 成交數量: "100" },
      ]));
    }
    if (url.endsWith("/tpex_warrant")) {
      return new Response(JSON.stringify([
        { 資料日期: date, 權證代號: "700001", 權證名稱: "台積電櫃測購", 權證標的: "2330", 認購售: "認購" },
      ]));
    }
    if (url.endsWith("/tpex_warrant_quts")) {
      return new Response(JSON.stringify([
        { 資料日期: date, 代號: "700001", 名稱: "台積電櫃測購", 成交量: "50", 成交金額: "100,000", 標的代號: "2330" },
      ]));
    }
    return new Response("not found", { status: 404 });
  };
  return { fetcher, calls: () => calls };
}

resetTwWarrantActivityCacheForTests();
{
  const mock = makeFetcher();
  const result = await getTwWarrantActivityOnDemand({ symbol: "2330", as_of: asOf, fetcher: mock.fetcher });
  assert.equal(result.status, "READY");
  assert.equal(result.persistence, "NONE");
  assert.equal(result.directionality, "NOT_AVAILABLE_FROM_TURNOVER_ONLY");
  assert.equal(result.summary.total_amount, 1_350_000);
  assert.equal(result.summary.total_volume, 650);
  assert.equal(result.summary.call.amount, 1_100_000);
  assert.equal(result.summary.put.amount, 250_000);
  assert.equal(result.summary.call_put_amount_ratio, 4.4);
  assert.equal(result.summary.warrant_count, 3);

  const second = await getTwWarrantActivityOnDemand({ symbol: "2330", as_of: asOf, fetcher: mock.fetcher });
  assert.equal(second.status, "READY");
  assert.equal(mock.calls(), 4, "same source responses should be reused in the short-lived Worker isolate cache");
}

resetTwWarrantActivityCacheForTests();
{
  const mock = makeFetcher("20260902");
  const result = await getTwWarrantActivityOnDemand({ symbol: "2330", as_of: asOf, fetcher: mock.fetcher });
  assert.equal(result.status, "PENDING");
  assert.equal(result.ok, false);
  assert.equal(result.summary.total_amount, 0);
}

console.log("TW warrant activity on-demand tests passed");
