export const GITHUB_COMPRESSED_JSON_VERSION = "diamond-github-compressed-json/v1";
export const GITHUB_COMPRESSED_JSON_CODEC = "gzip+base64" as const;

export type GitHubCompressedJsonEnvelope = {
  schema_version: typeof GITHUB_COMPRESSED_JSON_VERSION;
  codec: typeof GITHUB_COMPRESSED_JSON_CODEC;
  uncompressed_sha256: string;
  compressed_sha256: string;
  uncompressed_bytes: number;
  compressed_bytes: number;
  payload_b64: string;
};

async function sha256HexLocal(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

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
  return await collectStream(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")));
}

async function gunzip(bytes: Uint8Array) {
  return await collectStream(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")));
}

export function isGitHubCompressedJsonEnvelope(value: unknown): value is GitHubCompressedJsonEnvelope {
  const candidate = value as Partial<GitHubCompressedJsonEnvelope> | null;
  return Boolean(
    candidate
    && candidate.schema_version === GITHUB_COMPRESSED_JSON_VERSION
    && candidate.codec === GITHUB_COMPRESSED_JSON_CODEC
    && typeof candidate.payload_b64 === "string"
    && typeof candidate.uncompressed_sha256 === "string"
    && typeof candidate.compressed_sha256 === "string",
  );
}

export async function encodeGitHubCompressedJsonText(text: string): Promise<GitHubCompressedJsonEnvelope> {
  const plain = new TextEncoder().encode(text);
  const compressed = await gzip(plain);
  const payloadB64 = bytesToBase64(compressed);
  return {
    schema_version: GITHUB_COMPRESSED_JSON_VERSION,
    codec: GITHUB_COMPRESSED_JSON_CODEC,
    uncompressed_sha256: await sha256HexLocal(text),
    compressed_sha256: await sha256HexLocal(payloadB64),
    uncompressed_bytes: plain.byteLength,
    compressed_bytes: compressed.byteLength,
    payload_b64: payloadB64,
  };
}

export async function decodeGitHubCompressedJsonText(envelope: GitHubCompressedJsonEnvelope) {
  if (!isGitHubCompressedJsonEnvelope(envelope)) throw new Error("github_compressed_json_invalid_envelope");
  const compressed = base64ToBytes(envelope.payload_b64);
  if (compressed.byteLength !== envelope.compressed_bytes) throw new Error("github_compressed_json_compressed_size_mismatch");
  if (await sha256HexLocal(bytesToBase64(compressed)) !== envelope.compressed_sha256) {
    throw new Error("github_compressed_json_compressed_sha_mismatch");
  }
  const plain = await gunzip(compressed);
  if (plain.byteLength !== envelope.uncompressed_bytes) throw new Error("github_compressed_json_uncompressed_size_mismatch");
  const text = new TextDecoder().decode(plain);
  if (await sha256HexLocal(text) !== envelope.uncompressed_sha256) throw new Error("github_compressed_json_uncompressed_sha_mismatch");
  return text;
}
