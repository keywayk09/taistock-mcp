import assert from "node:assert/strict";
import { inferFamilyAdaptiveIntent } from "../src/v6/family-adaptive-planner.ts";
import { resolveTradingAsOf } from "../src/v6/tw-trading-asof-resolver.ts";

// Focused credit/SBL questions must never fall through to the heavy generic
// stock graph. This is the real-user 2419 2026-09-04 query shape.
assert.equal(
  inferFamilyAdaptiveIntent("查 2419 2026-09-04 融資融券、借券賣出", ["2419"]),
  "CREDIT_SBL_QUERY",
);

const fakeWindowResolver = async ({ as_of }: { as_of: string; trading_days: number }) => {
  if (as_of === "2026-09-05") throw new Error("requested_as_of_not_trading_day");
  if (as_of === "2026-09-04") return { start_date: "2026-09-04", end_date: "2026-09-04", trading_days: 1 };
  throw new Error(`unexpected_date:${as_of}`);
};

// Explicit user date is authoritative and never rolls backward silently.
assert.deepEqual(
  await resolveTradingAsOf({
    as_of: "2026-09-04",
    explicit: true,
    resolve_window: fakeWindowResolver,
  }),
  { resolved_as_of: "2026-09-04", mode: "EXPLICIT_EXACT_TRADING_DAY" },
);

await assert.rejects(
  resolveTradingAsOf({
    as_of: "2026-09-05",
    explicit: true,
    resolve_window: fakeWindowResolver,
  }),
  /requested_as_of_not_trading_day/,
);

// Only an implicit current-date query may roll a weekend/holiday back to the
// latest official trading day.
assert.deepEqual(
  await resolveTradingAsOf({
    as_of: "2026-09-05",
    explicit: false,
    resolve_window: fakeWindowResolver,
  }),
  { resolved_as_of: "2026-09-04", mode: "IMPLICIT_LATEST_TRADING_DAY" },
);

await import("./credit-sbl-fast-path-runtime.test.ts");

console.log("credit/SBL exact-date routing v2 contract passed");
