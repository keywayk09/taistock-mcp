import assert from "node:assert/strict";
import { runSwingOutcomePath, SwingOutcomeError } from "../src/v6/swing-outcome-path.ts";

const COLUMNS = [
  "date", "symbol", "open", "high", "low", "close", "volume", "source", "updated_at_ms",
  "ema_5", "ema_10", "ema_20", "ema_60", "ema_120", "ind_updated_at", "ingest_id",
  "bar_time_tw", "ema_240", "k_9", "d_3",
] as const;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) output[key] = stableValue(source[key]);
    return output;
  }
  if (value === undefined) return null;
  return value;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

const bars = [
  { date:"2026-08-03", symbol:"2330", open:100, high:103, low:99, close:102, volume:1000, source:"test", updated_at_ms:1 },
  { date:"2026-08-04", symbol:"2330", open:102, high:104, low:100, close:103, volume:1100, source:"test", updated_at_ms:2 },
  { date:"2026-08-05", symbol:"2330", open:104, high:110, low:103, close:108, volume:1200, source:"test", updated_at_ms:3 },
  { date:"2026-08-06", symbol:"2330", open:109, high:111, low:106, close:107, volume:1300, source:"test", updated_at_ms:4 },
  { date:"2026-08-07", symbol:"2330", open:107, high:115, low:105, close:114, volume:1400, source:"test", updated_at_ms:5 },
];

async function datasetFor(inputBars = bars) {
  const sourceFiles = [{ path:"data/OHLC/tw/1d/2330/2026.csv", sha:"blob-sha", trade_date:null, year:2026 }];
  const fingerprint = {
    schema_version:"ohlc-dataset/v1",
    market:"tw-stock",
    symbol:"2330",
    timeframe:"1d",
    source:"github_historical",
    columns:[...COLUMNS],
    source_files:sourceFiles,
    scope:{ first:inputBars.at(0)?.date ?? null, last:inputBars.at(-1)?.date ?? null, row_count:inputBars.length },
    rows:inputBars.map((row) => COLUMNS.map((key) => {
      const value=(row as Record<string,unknown>)[key];
      if (value===undefined || value===null) return "";
      return typeof value === "number" ? value : String(value);
    })),
  };
  const hash=await sha256Hex(JSON.stringify(stableValue(fingerprint)));
  return {
    schema_version:"ohlc-dataset/v1",
    dataset_id:`tw-stock:2330:1d:${inputBars.at(0)?.date}:${inputBars.at(-1)?.date}:${inputBars.length}`,
    dataset_version:`sha256:${hash}`,
    dataset_hash:hash,
    frozen_view:true,
    complete_view:true,
    truncated:false,
    formal_research_eligible:true,
    row_count:inputBars.length,
    total_validated_rows:inputBars.length,
    source:"github_historical",
    source_files:sourceFiles,
    provenance:{ market:"tw-stock", symbol:"2330", timeframe:"1d", source:"github_historical" },
  } as const;
}

const signal = {
  signal_id:"sig-1",
  signal_version:"v1",
  symbol:"2330",
  side:"LONG" as const,
  signal_ts_ms:Date.parse("2026-08-04T05:00:00Z"),
  trade_date:"2026-08-04",
  strategy:"test",
};

{
  const dataset=await datasetFor();
  const a=await runSwingOutcomePath({dataset,bars,signal});
  const b=await runSwingOutcomePath({dataset,bars,signal});
  assert.deepEqual(a,b,"same input must produce byte-equivalent semantic result");
  assert.equal(a.reference_trade_date,"2026-08-05");
  assert.equal(a.reference_price,104);
  assert.equal(a.available_horizon_days,3);
  assert.equal(a.horizons[0].directional_close_return_pct,3.8461538462);
  assert.equal(a.horizons[2].mfe_pct,10.5769230769);
  assert.equal(a.outcome_only,true);
}

{
  const dataset=await datasetFor();
  const result=await runSwingOutcomePath({dataset,bars,signal:{...signal,side:"SHORT"}});
  assert.equal(result.horizons[0].directional_close_return_pct,-3.8461538462);
  assert.equal(result.horizons[2].mae_pct,-10.5769230769);
}

{
  const dataset=await datasetFor();
  await assert.rejects(
    () => runSwingOutcomePath({dataset:{...dataset,dataset_hash:"0".repeat(64),dataset_version:`sha256:${"0".repeat(64)}`},bars,signal}),
    (error: unknown) => error instanceof SwingOutcomeError && error.code === "DATASET_HASH_MISMATCH",
  );
}

{
  const limited=bars.slice(0,2);
  const dataset=await datasetFor(limited);
  await assert.rejects(
    () => runSwingOutcomePath({dataset,bars:limited,signal}),
    (error: unknown) => error instanceof SwingOutcomeError && error.code === "NO_FUTURE_SESSION",
  );
}

console.log("swing-outcome-path tests passed");
