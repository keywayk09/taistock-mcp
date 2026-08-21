import { readGitHubJson, sha256Hex, stableJson } from "./github-data-store.ts";

export const MARKET_DATA_HISTORY_ARCHIVE_VERSION = "diamond-market-data-history-layer-archive/v1";
export const MARKET_DATA_HISTORY_ARCHIVE_CODEC = "gzip+base64" as const;

export type MarketDataHistoryArchivePayload = {
  schema_version: "diamond-market-data-history-layer-payload/v1";
  trade_date: string;
  kind: string;
  market: string;
  source: string;
  normalized: Record<string, unknown>;
  raw_evidence: Array<{
    source: string;
    content_sha256: string;
    body: unknown;
  }>;
};

export type MarketDataHistoryArchiveEnvelope = {
  schema_version: typeof MARKET_DATA_HISTORY_ARCHIVE_VERSION;
  trade_date: string;
  kind: string;
  market: string;
  source: string;
  codec: typeof MARKET_DATA_HISTORY_ARCHIVE_CODEC;
  payload_sha256: string;
  compressed_sha256: string;
  uncompressed_bytes: number;
  compressed_bytes: number;
  payload_b64: string;
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value.replace(/\s/g, ""));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function collectStream(stream: ReadableStream<Uint8Array>) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gzip(bytes: Uint8Array) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return await collectStream(stream);
}

async function gunzip(bytes: Uint8Array) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await collectStream(stream);
}

export function marketDataHistoryArchivePath(input: {
  tradeDate: string;
  kind: string;
  market: string;
  contentSha256: string;
}) {
  const [year, month, day] = input.tradeDate.split("-");
  return `data/market-data/archive/layers/${year}/${month}/${day}/${input.kind}-${input.market}/${input.contentSha256}.json`;
}

export async function encodeMarketDataHistoryArchive(payload: MarketDataHistoryArchivePayload) {
  const text = stableJson(payload);
  const plain = new TextEncoder().encode(text);
  const compressed = await gzip(plain);
  return {
    schema_version: MARKET_DATA_HISTORY_ARCHIVE_VERSION,
    trade_date: payload.trade_date,
    kind: payload.kind,
    market: payload.market,
    source: payload.source,
    codec: MARKET_DATA_HISTORY_ARCHIVE_CODEC,
    payload_sha256: await sha256Hex(text),
    compressed_sha256: await sha256Hex(bytesToBase64(compressed)),
    uncompressed_bytes: plain.byteLength,
    compressed_bytes: compressed.byteLength,
    payload_b64: bytesToBase64(compressed),
  } satisfies MarketDataHistoryArchiveEnvelope;
}

export async function decodeMarketDataHistoryArchive(envelope: MarketDataHistoryArchiveEnvelope) {
  if (envelope.schema_version !== MARKET_DATA_HISTORY_ARCHIVE_VERSION) {
    throw new Error(`history_archive_schema:${String(envelope.schema_version)}`);
  }
  if (envelope.codec !== MARKET_DATA_HISTORY_ARCHIVE_CODEC) {
    throw new Error(`history_archive_codec:${String(envelope.codec)}`);
  }
  const compressed = base64ToBytes(envelope.payload_b64);
  if (compressed.byteLength !== envelope.compressed_bytes) throw new Error("history_archive_compressed_size_mismatch");
  const compressedSha = await sha256Hex(bytesToBase64(compressed));
  if (compressedSha !== envelope.compressed_sha256) throw new Error("history_archive_compressed_sha_mismatch");
  const plain = await gunzip(compressed);
  if (plain.byteLength !== envelope.uncompressed_bytes) throw new Error("history_archive_uncompressed_size_mismatch");
  const text = new TextDecoder().decode(plain);
  if (await sha256Hex(text) !== envelope.payload_sha256) throw new Error("history_archive_payload_sha_mismatch");
  const payload = JSON.parse(text) as MarketDataHistoryArchivePayload;
  if (
    payload.schema_version !== "diamond-market-data-history-layer-payload/v1"
    || payload.trade_date !== envelope.trade_date
    || payload.kind !== envelope.kind
    || payload.market !== envelope.market
    || payload.source !== envelope.source
  ) {
    throw new Error("history_archive_identity_mismatch");
  }
  return payload;
}

export async function readMarketDataLayerSnapshot(env: Env, path: string) {
  const read = await readGitHubJson<any>(env, path);
  if (!read.value) return { ...read, value: null };
  if (read.value.schema_version === MARKET_DATA_HISTORY_ARCHIVE_VERSION) {
    const payload = await decodeMarketDataHistoryArchive(read.value as MarketDataHistoryArchiveEnvelope);
    return {
      ...read,
      value: payload.normalized as Record<string, unknown>,
      archive: {
        path: read.path,
        codec: MARKET_DATA_HISTORY_ARCHIVE_CODEC,
        payload_sha256: read.value.payload_sha256,
        compressed_sha256: read.value.compressed_sha256,
        compressed_bytes: read.value.compressed_bytes,
        uncompressed_bytes: read.value.uncompressed_bytes,
      },
    };
  }
  return { ...read, archive: null };
}
