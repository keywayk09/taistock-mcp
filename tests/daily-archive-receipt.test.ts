import assert from "node:assert/strict";
import { verifyDailyArchiveReceipt } from "../src/v6/daily-archive-receipt.ts";
import { buildResearchVerificationFingerprint } from "../src/v6/ohlc-core-fingerprint-v1.js";
import { parseCanonicalCsv } from "../src/v6/cross-account-read-service.ts";

const date = "2026-11-20", symbol = "0050", ts = Date.parse(date + "T09:00:00+08:00");
const csv = `symbol,trade_date,ts_ms,open,high,low,close\n${symbol},${date},${ts},10,11,9,10\n`;
const daily = [{ symbol, date, open:10, high:11, low:9, close:10 }];
const rows = parseCanonicalCsv(csv);
const { fingerprint } = await buildResearchVerificationFingerprint({ symbol, tradeDate:date, dailyRows:daily, fiveRows:rows, minuteRows:rows });
const receipt = { symbol, trade_date:date, status:"VERIFIED", canonical_fingerprint:fingerprint,
  schema:"OHLC_RESEARCH_VERIFICATION_RECEIPT_V1", fingerprint_schema:"OHLC_CORE_FINGERPRINT_V1",
  row_counts:{"1m":1,"5m":1,"1d":1}, official:{source:"TWSE_MI_INDEX",matched_fields:["open","high","low","close"]},
  source_digests:{TWSE_MI_INDEX:"a".repeat(64)} };
const entry = { status:"VERIFIED", current_fingerprint:fingerprint, active_in_current_universe:true, receipts:[receipt] };
const manifest = { schema:"OHLC_RESEARCH_VERIFICATION_MANIFEST_V1", trade_date:date, symbols:{[symbol]:entry} };
const key = "data/OHLC/tw/verification/v1/2026/11/20/manifest.json";
const minute = "data/OHLC/tw/1m/2026/11/20/0050.csv";
const memory = new Map([[minute, {sha:"min",text:csv}], [minute.replace("/1m/","/5m/"), {sha:"five",text:csv}]]);
const env = { __GITHUB_DATA_MEMORY:memory } as any;
const run = () => verifyDailyArchiveReceipt(env,symbol,date,daily);
const save = () => memory.set(key,{sha:"manifest",text:JSON.stringify(manifest)});
assert.equal((await run()).verified,false);
save();
assert.equal((await run()).verified,true);
assert.equal((await verifyDailyArchiveReceipt(env,symbol,date,[{...daily[0],high:12}])).verified,false);
memory.set(minute,{sha:"changed",text:csv.replace(",11,",",12,")});
assert.equal((await run()).verified,false);
memory.set(minute,{sha:"min",text:csv});
entry.status = "BLOCKED";save();
assert.equal((await run()).verified,false);
entry.status = "VERIFIED"; entry.active_in_current_universe = false;save();
assert.equal((await run()).verified,false);
entry.active_in_current_universe=true;receipt.trade_date="2026-11-19";save();
assert.equal((await run()).verified,false);
console.log("daily-archive-receipt: PASS");
