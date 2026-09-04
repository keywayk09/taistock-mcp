import assert from "node:assert/strict";
import { getTwChipOnDemandSnapshot, resetTwChipOnDemandCacheForTests } from "../src/v6/tw-chip-on-demand.ts";

const date = "2026-09-03";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fixtures(t86Date = "20260903") {
  return {
    t86: {
      date: t86Date,
      fields: ["證券代號", "證券名稱", "外陸資買賣超股數(不含外資自營商)", "投信買賣超股數", "自營商買賣超股數", "三大法人買賣超股數"],
      data: [["2330", "台積電", "1000", "200", "-100", "1100"]],
    },
    margin: {
      date: "20260903",
      tables: [{
        title: "融資融券彙總 (全部)",
        fields: ["證券代號", "證券名稱", "前日餘額", "買進", "賣出", "現金償還", "今日餘額", "前日餘額", "賣出", "買進", "現券償還", "今日餘額"],
        data: [["2330", "台積電", "10000", "500", "300", "0", "10200", "100", "20", "10", "0", "110"]],
      }],
    },
    lending: {
      date: "20260903",
      fields: ["證券代號", "證券名稱", "市場別", "前日借券餘額(1)股", "本日異動股借券(2)", "本日異動股還券(3)", "本日借券餘額股(4)=(1)+(2)-(3)", "本日收盤價(5)單位：元", "借券餘額市值單位：元(6)=(4)*(5)"],
      data: [["2330", "台積電", "上市", "100000", "10000", "5000", "105000", "2300", "241500000"]],
    },
    sbl: {
      date: "20260903",
      fields: Array.from({ length: 14 }, (_, i) => `F${i}`),
      data: [["2330", "台積電", 0, 0, 0, 0, 0, 0, "50000", "8000", "3000", "0", "55000", "120000"]],
    },
  };
}

function makeFetcher(t86Date = "20260903") {
  const data = fixtures(t86Date);
  let calls = 0;
  const fetcher: typeof fetch = async (input) => {
    calls += 1;
    const url = String(input);
    if (url.includes("/fund/T86")) return jsonResponse(data.t86);
    if (url.includes("/marginTrading/MI_MARGN")) return jsonResponse(data.margin);
    if (url.includes("/exchangeReport/TWT72U")) return jsonResponse(data.lending);
    if (url.includes("/marginTrading/TWT93U")) return jsonResponse(data.sbl);
    // OTC sources are deliberately empty in this listed-stock fixture. The
    // gateway must infer listed market from exact-date listed rows and must not
    // let irrelevant OTC source emptiness block the selected market layers.
    return jsonResponse([]);
  };
  return { fetcher, calls: () => calls };
}

resetTwChipOnDemandCacheForTests();
{
  const mock = makeFetcher();
  const first = await getTwChipOnDemandSnapshot({ symbol: "2330", as_of: date, fetcher: mock.fetcher });
  assert.equal(first.market, "listed");
  assert.equal(first.status, "READY");
  assert.equal(first.persistence, "NONE");
  assert.equal(first.previous_day_substitution, false);
  assert.equal(first.layers.margin_short.status, "READY");
  assert.equal(first.layers.margin_short.latest?.margin_balance_lots, 10200);
  assert.equal(first.layers.margin_short.latest?.short_balance_lots, 110);
  assert.equal(first.layers.securities_lending.latest?.balance_shares, 105000);
  assert.equal(first.layers.sbl_short_sale.latest?.balance_shares, 55000);

  const second = await getTwChipOnDemandSnapshot({ symbol: "2330", as_of: date, fetcher: mock.fetcher });
  assert.equal(second.status, "READY");
  assert.equal(mock.calls(), 8, "same-date full-market source responses must be reused inside the Worker isolate cache");
}

resetTwChipOnDemandCacheForTests();
{
  const mock = makeFetcher("20260902");
  const result = await getTwChipOnDemandSnapshot({ symbol: "2330", as_of: date, fetcher: mock.fetcher });
  assert.equal(result.market, "listed");
  assert.equal(result.layers.institutional.status, "PENDING");
  assert.equal(result.status, "DEGRADED");
  assert.equal(result.previous_day_substitution, false);
  const t86 = result.source_health.find((source) => source.source_id === "twse_institutional_t86");
  assert.equal(t86?.source_date, "2026-09-02");
  assert.equal(t86?.source_date_verified, false);
}

console.log("TW chip on-demand exact-date tests passed");
