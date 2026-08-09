export const SUPPLY_CHAIN_OFFICIAL_SOURCE_VERSION = "diamond-supply-chain-official-source/v1.0.0";

const ALLOWED_HOSTS = new Set([
  "www.sec.gov",
  "data.sec.gov",
  "sec.gov",
  "mops.twse.com.tw",
]);
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const EXCERPT_CHARS = 40_000;

export class OfficialSupplyChainSourceError extends Error {
  readonly code:string;
  readonly detail?:Record<string, unknown>;
  constructor(code:string, message:string, detail?:Record<string, unknown>) {
    super(message);
    this.name = "OfficialSupplyChainSourceError";
    this.code = code;
    this.detail = detail;
  }
}

async function sha256Bytes(bytes:ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2,"0")).join("");
}

function requireTimestamp(value:unknown, field:string) {
  const text = String(value ?? "").trim();
  if (!text || Number.isNaN(Date.parse(text))) throw new OfficialSupplyChainSourceError("INVALID_INPUT", `${field} must be an ISO timestamp`);
  return new Date(text).toISOString();
}

function validateUrl(raw:string) {
  let url:URL;
  try { url = new URL(raw); } catch { throw new OfficialSupplyChainSourceError("INVALID_URL", "source_url must be a valid URL"); }
  if (url.protocol !== "https:") throw new OfficialSupplyChainSourceError("HTTPS_REQUIRED", "official evidence fetch requires https");
  if (url.username || url.password || url.port) throw new OfficialSupplyChainSourceError("URL_CREDENTIALS_FORBIDDEN", "credentials/custom ports are forbidden");
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) throw new OfficialSupplyChainSourceError("HOST_NOT_ALLOWED", "official evidence host is not allowlisted", { host });
  return url;
}

function sourceTypeFor(host:string) {
  if (host.endsWith("sec.gov")) return "EXCHANGE_FILING" as const;
  if (host === "mops.twse.com.tw") return "EXCHANGE_FILING" as const;
  return "GOVERNMENT_DISCLOSURE" as const;
}

export function getOfficialSupplyChainSourceContract() {
  return {
    version:SUPPLY_CHAIN_OFFICIAL_SOURCE_VERSION,
    allowed_hosts:Array.from(ALLOWED_HOSTS).sort(),
    method:"GET_ONLY",
    redirect_policy:"REJECT",
    max_bytes:MAX_BYTES,
    timeout_ms:TIMEOUT_MS,
    sec_user_agent_required:true,
    output:"HASHED_EVIDENCE_CANDIDATE",
    relationship_auto_verification:false,
    production_write:false,
  };
}

export async function fetchOfficialSupplyChainEvidence(env:Env, input:{
  source_url:string;
  published_at:string;
  title?:string;
}) {
  const url = validateUrl(String(input?.source_url ?? ""));
  const publishedAt = requireTimestamp(input?.published_at, "published_at");
  const host = url.hostname.toLowerCase();
  const headers = new Headers({
    "Accept":"application/json,text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.2",
  });
  if (host.endsWith("sec.gov")) {
    const userAgent = String((env as any)?.SEC_USER_AGENT ?? "").trim();
    if (!userAgent) throw new OfficialSupplyChainSourceError("SEC_USER_AGENT_REQUIRED", "SEC official access requires SEC_USER_AGENT environment configuration");
    headers.set("User-Agent", userAgent);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response:Response;
  try {
    response = await fetch(url.toString(), { method:"GET", headers, redirect:"manual", signal:controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new OfficialSupplyChainSourceError("TIMEOUT", "official evidence request timed out");
    throw new OfficialSupplyChainSourceError("UPSTREAM_UNAVAILABLE", "official evidence request failed", { error:String(error) });
  } finally {
    clearTimeout(timer);
  }
  if (response.status >= 300 && response.status < 400) throw new OfficialSupplyChainSourceError("REDIRECT_REJECTED", "redirects are rejected to prevent allowlist bypass", { status:response.status });
  if (!response.ok) throw new OfficialSupplyChainSourceError("UPSTREAM_HTTP_ERROR", "official source returned non-success status", { status:response.status });
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new OfficialSupplyChainSourceError("RESPONSE_TOO_LARGE", "official evidence exceeds maximum size", { declared, max:MAX_BYTES });
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) throw new OfficialSupplyChainSourceError("RESPONSE_TOO_LARGE", "official evidence exceeds maximum size", { bytes:bytes.byteLength, max:MAX_BYTES });
  const evidenceHash = await sha256Bytes(bytes);
  const contentType = String(response.headers.get("content-type") ?? "application/octet-stream").slice(0,160);
  let excerpt:string|null = null;
  let decodedLength = 0;
  if (/json|text|html|xml|javascript/i.test(contentType)) {
    const decoded = new TextDecoder("utf-8").decode(bytes);
    decodedLength = decoded.length;
    excerpt = decoded.slice(0, EXCERPT_CHARS);
  }
  const observedAt = new Date().toISOString();
  return {
    ok:true as const,
    adapter_version:SUPPLY_CHAIN_OFFICIAL_SOURCE_VERSION,
    evidence:{
      evidence_id:`official:${evidenceHash}`,
      source_type:sourceTypeFor(host),
      source_ref:url.toString(),
      ...(input.title ? { title:String(input.title).trim().slice(0,300) } : {}),
      published_at:publishedAt,
      observed_at:observedAt,
      evidence_sha256:evidenceHash,
      note:`official source fetched via guarded allowlist adapter; content-type=${contentType}; bytes=${bytes.byteLength}`,
    },
    content:{ content_type:contentType, bytes:bytes.byteLength, excerpt, truncated:excerpt !== null && decodedLength > EXCERPT_CHARS },
    trust_boundary:{ relationship_status:"CANDIDATE_UNTIL_CROSS_VERIFIED", auto_edge_creation:false, auto_strategy_promotion:false, production_write:false },
  };
}
