import assert from "node:assert/strict";
import {
  summarizeFamilyAccounting,
  summarizeFamilyRevenue,
} from "../src/v6/family-fundamental-summary.ts";

const revenues = [
  { revenue_year: 2025, revenue_month: 7, revenue: 100 },
  { revenue_year: 2026, revenue_month: 6, revenue: 110 },
  { revenue_year: 2026, revenue_month: 7, revenue: 120 },
];
const revenue = summarizeFamilyRevenue(revenues);
assert.equal(revenue.status, "READY");
assert.equal(revenue.latest?.mom_percent, 9.09);
assert.equal(revenue.latest?.yoy_percent, 20);

const income = [
  { date: "2026-03-31", type: "OperatingRevenue", value: 1000 },
  { date: "2026-03-31", type: "GrossProfit", value: 300 },
  { date: "2026-03-31", type: "OperatingIncome", value: 180 },
  { date: "2026-03-31", type: "NetIncome", value: 120 },
  { date: "2026-03-31", type: "BasicEarningsPerShare", value: 1.2 },
  { date: "2026-06-30", type: "OperatingRevenue", value: 1200 },
  { date: "2026-06-30", type: "GrossProfit", value: 420 },
  { date: "2026-06-30", type: "OperatingIncome", value: 240 },
  { date: "2026-06-30", type: "NetIncome", value: 150 },
  { date: "2026-06-30", type: "BasicEarningsPerShare", value: 1.5 },
];
const balance = [
  { date: "2026-03-31", type: "TotalAssets", value: 5000 },
  { date: "2026-03-31", type: "TotalLiabilities", value: 2000 },
  { date: "2026-03-31", type: "TotalEquity", value: 3000 },
  { date: "2026-03-31", type: "Inventory", value: 500 },
  { date: "2026-03-31", type: "AccountsReceivable", value: 400 },
  { date: "2026-06-30", type: "TotalAssets", value: 5200 },
  { date: "2026-06-30", type: "TotalLiabilities", value: 2050 },
  { date: "2026-06-30", type: "TotalEquity", value: 3150 },
  { date: "2026-06-30", type: "Inventory", value: 520 },
  { date: "2026-06-30", type: "AccountsReceivable", value: 430 },
];
const cash = [
  { date: "2026-03-31", type: "CashFlowsFromOperatingActivities", value: 180 },
  { date: "2026-03-31", type: "PurchaseOfPropertyPlantAndEquipment", value: -50 },
  { date: "2026-06-30", type: "CashFlowsFromOperatingActivities", value: 220 },
  { date: "2026-06-30", type: "PurchaseOfPropertyPlantAndEquipment", value: -60 },
];
const accounting = summarizeFamilyAccounting(income, balance, cash);
assert.equal(accounting.status, "READY");
assert.equal(accounting.latest?.gross_margin_percent, 35);
assert.equal(accounting.latest?.operating_margin_percent, 20);
assert.equal(accounting.latest?.net_margin_percent, 12.5);
assert.equal(accounting.latest?.eps, 1.5);
assert.equal(accounting.latest?.debt_ratio_percent, 39.42);
assert.equal(accounting.latest?.roe_period_estimate_percent, 4.76);
assert.equal(accounting.latest?.free_cash_flow_estimate, 160);
assert.equal(accounting.quality, "healthy");

const missing = summarizeFamilyAccounting([], [], []);
assert.equal(missing.status, "UNAVAILABLE");
assert.equal(missing.latest, null);

console.log("Family normalized revenue/accounting summary fixtures passed");
