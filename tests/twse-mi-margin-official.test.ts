import assert from "node:assert/strict";
import { normalizeTwseMiMargnOfficial } from "../src/v6/twse-mi-margin-official.ts";

const body = {
  stat: "OK",
  date: "20260819",
  tables: [
    {
      title: "115年08月19日 信用交易統計",
      fields: ["項目", "買進", "賣出", "現金(券)償還", "前日餘額", "今日餘額"],
      data: [["融資(交易單位)", "303,949", "284,455", "6,465", "8,815,336", "8,828,365"]],
    },
    {
      title: "115年08月19日 融資融券彙總 (全部)",
      fields: [
        "代號", "名稱",
        "買進", "賣出", "現金償還", "前日餘額", "今日餘額", "次一營業日限額",
        "買進", "賣出", "現券償還", "前日餘額", "今日餘額", "次一營業日限額",
        "資券互抵", "註記",
      ],
      data: [
        ["00400A", "主動國泰動能高息", "833", "180", "0", "8,150", "8,803", "491,910", "12", "0", "0", "32", "20", "491,910", "12", " "],
        ["2330", "台積電", "100", "80", "1", "1,000", "1,019", "500,000", "5", "2", "0", "30", "33", "500,000", "1", ""],
      ],
    },
  ],
};

const rows = normalizeTwseMiMargnOfficial(body, "2026-08-19");
assert.equal(rows.length, 1);
assert.deepEqual(rows[0], {
  trade_date: "2026-08-19",
  symbol: "2330",
  name: "台積電",
  market: "listed",
  margin_previous_balance_lots: 1000,
  margin_balance_lots: 1019,
  margin_balance_change_lots: 19,
  short_previous_balance_lots: 30,
  short_balance_lots: 33,
  short_balance_change_lots: 3,
  source: "TWSE_MI_MARGN",
  source_priority: "OFFICIAL",
});
console.log("TWSE MI_MARGN official positional parser: ok");
