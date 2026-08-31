import assert from "node:assert/strict";
import {
  inspectOneShotMarketDataRepairManifest,
  ONE_SHOT_MARKET_DATA_REPAIR_DATE,
  runOneShotMarketDataRepair20260831,
} from "../src/v6/market-data-one-shot-repair-20260831.ts";
import {
  getMarketDataCapturePolicy,
  getMarketDataCaptureTradeDate,
} from "../src/v6/market-data-capture-context.ts";

function layer(kind: string, market: string, status: string) {
  return { kind, market, status };
}

const baseLayers = [
  layer("institutional", "listed", "READY"),
  layer("institutional", "otc", "ERROR"),
  layer("margin", "listed", "READY"),
  layer("margin", "otc", "ERROR"),
  layer("securities_lending", "listed", "READY"),
  layer("securities_lending", "otc", "READY"),
  layer("sbl_short_sale", "listed", "READY"),
  layer("sbl_short_sale", "otc", "ERROR"),
];

{
  const result = inspectOneShotMarketDataRepairManifest({
    trade_date: ONE_SHOT_MARKET_DATA_REPAIR_DATE,
    day_status: "PARTIAL",
    terminal: false,
    expected_layers: 8,
    ready_layers: 5,
    missing_layers: ["institutional-otc", "margin-otc", "sbl_short_sale-otc"],
    index_state: { status: "PENDING", completed_prefixes: [], total_prefixes: null },
    layers: baseLayers,
  });
  assert.equal(result.status, "CAPTURE_REQUIRED");
  assert.equal(result.ready_layers, 5);
  assert.deepEqual(result.missing_layers, ["institutional-otc", "margin-otc", "sbl_short_sale-otc"]);
}

{
  const progressive = baseLayers.map((item) => ({ ...item }));
  progressive[1].status = "READY";
  progressive[3].status = "READY";
  const result = inspectOneShotMarketDataRepairManifest({
    trade_date: ONE_SHOT_MARKET_DATA_REPAIR_DATE,
    day_status: "PARTIAL",
    terminal: false,
    expected_layers: 8,
    ready_layers: 7,
    index_state: { status: "PENDING", completed_prefixes: [], total_prefixes: null },
    layers: progressive,
  });
  assert.equal(result.status, "CAPTURE_REQUIRED");
  assert.deepEqual(result.missing_layers, ["sbl_short_sale-otc"]);
}

{
  const bad = baseLayers.map((item) => ({ ...item }));
  bad[0].status = "ERROR";
  const result = inspectOneShotMarketDataRepairManifest({
    trade_date: ONE_SHOT_MARKET_DATA_REPAIR_DATE,
    day_status: "PARTIAL",
    terminal: false,
    layers: bad,
  });
  assert.equal(result.status, "BLOCKED");
  assert.match(result.reason, /unexpected_missing_layers:institutional-listed/);
}

{
  const completeLayers = baseLayers.map((item) => ({ ...item, status: "READY" }));
  const pending = inspectOneShotMarketDataRepairManifest({
    trade_date: ONE_SHOT_MARKET_DATA_REPAIR_DATE,
    day_status: "COMPLETE",
    terminal: true,
    expected_layers: 8,
    ready_layers: 8,
    missing_layers: [],
    index_state: { status: "PENDING", completed_prefixes: [], total_prefixes: 10 },
    layers: completeLayers,
  });
  assert.equal(pending.status, "INDEX_REQUIRED");

  const ready = inspectOneShotMarketDataRepairManifest({
    trade_date: ONE_SHOT_MARKET_DATA_REPAIR_DATE,
    day_status: "COMPLETE",
    terminal: true,
    expected_layers: 8,
    ready_layers: 8,
    missing_layers: [],
    index_state: { status: "READY", completed_prefixes: ["0","1","2","3","4","5","6","7","8","9"], total_prefixes: 10 },
    layers: completeLayers,
  });
  assert.equal(ready.status, "COMPLETE");
}

{
  let captureCalls = 0;
  const fakeManifest = {
    trade_date: ONE_SHOT_MARKET_DATA_REPAIR_DATE,
    day_status: "PARTIAL",
    terminal: false,
    expected_layers: 8,
    ready_layers: 5,
    missing_layers: ["institutional-otc", "margin-otc", "sbl_short_sale-otc"],
    index_state: { status: "PENDING", completed_prefixes: [], total_prefixes: null },
    layers: baseLayers,
  };
  const result = await runOneShotMarketDataRepair20260831({} as Env, {
    now: new Date("2026-09-01T02:30:00+08:00"),
    dependencies: {
      readManifest: async () => fakeManifest,
      capture: (async (_env: Env, input: any) => {
        captureCalls += 1;
        assert.equal(input.tradeDate, ONE_SHOT_MARKET_DATA_REPAIR_DATE);
        assert.equal(input.subrequestBudget, 37);
        assert.equal(getMarketDataCaptureTradeDate(), ONE_SHOT_MARKET_DATA_REPAIR_DATE);
        assert.deepEqual(getMarketDataCapturePolicy().allowedKinds, ["institutional", "margin", "sbl_short_sale"]);
        return { status: "PARTIAL", attempted_layers: ["institutional-otc"] };
      }) as any,
    },
  });
  assert.equal(result.status, "REPAIR_CAPTURE_STEP");
  assert.equal(result.prioritize_repair, true);
  assert.equal(captureCalls, 1);
  assert.equal(getMarketDataCaptureTradeDate(), null);
  assert.equal(getMarketDataCapturePolicy().allowedKinds, null);
}

console.log("market-data one-shot 2026-08-31 repair tests: PASS");
