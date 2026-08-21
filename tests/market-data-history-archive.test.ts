import assert from "node:assert/strict";
import {
  decodeMarketDataHistoryArchive,
  encodeMarketDataHistoryArchive,
  marketDataHistoryArchivePath,
  type MarketDataHistoryArchivePayload,
} from "../src/v6/market-data-history-archive.ts";

const rows = Array.from({ length: 500 }, (_, index) => ({
  trade_date: "2026-08-18",
  symbol: String(1101 + index),
  market: "listed",
  margin_balance_lots: 10_000 + index,
  short_balance_lots: 500 + index,
  source: "TWSE_MI_MARGN",
}));

const payload: MarketDataHistoryArchivePayload = {
  schema_version: "diamond-market-data-history-layer-payload/v1",
  trade_date: "2026-08-18",
  kind: "margin",
  market: "listed",
  source: "TWSE_MI_MARGN",
  normalized: {
    schema_version: "diamond-tw-market-data/v2.3.1-cloudflare-one-layer-resumable",
    trade_date: "2026-08-18",
    market: "listed",
    kind: "margin",
    source: "TWSE_MI_MARGN",
    source_date_verified: true,
    rows,
  },
  raw_evidence: [
    {
      source: "TWSE_MI_MARGN",
      content_sha256: "a".repeat(64),
      body: { date: "20260818", stat: "OK", data: rows.map((row) => [row.symbol, row.margin_balance_lots, row.short_balance_lots]) },
    },
  ],
};

const archive = await encodeMarketDataHistoryArchive(payload);
assert.equal(archive.codec, "gzip+base64");
assert.ok(archive.compressed_bytes > 0);
assert.ok(archive.compressed_bytes < archive.uncompressed_bytes * 0.5, `expected meaningful compression: ${archive.compressed_bytes}/${archive.uncompressed_bytes}`);
assert.match(archive.payload_b64, /^[A-Za-z0-9+/=]+$/);

const decoded = await decodeMarketDataHistoryArchive(archive);
assert.deepEqual(decoded, payload);

const corrupted = { ...archive, payload_b64: `${archive.payload_b64.slice(0, -4)}AAAA` };
await assert.rejects(() => decodeMarketDataHistoryArchive(corrupted), /history_archive_/);

assert.equal(
  marketDataHistoryArchivePath({
    tradeDate: "2026-08-18",
    kind: "margin",
    market: "listed",
    contentSha256: "b".repeat(64),
  }),
  `data/market-data/archive/layers/2026/08/18/margin-listed/${"b".repeat(64)}.json`,
);

console.log("market-data gzip history archive roundtrip passed");
