import { DEFAULT_GITHUB_DATA_BRANCH, DEFAULT_GITHUB_DATA_REPO, readGitHubJson } from "./github-data-store.ts";
import { decodeGitHubCompressedJsonText, isGitHubCompressedJsonEnvelope } from "./github-compressed-json.ts";
import { validateMarketReadPublishPrerequisites, type MarketReadManifest } from "./market-data-publish-fence.ts";
import {
  type InstitutionalRow,
  type MarginRow,
  type SecuritiesLendingRow,
  type SblShortSaleRow,
  type TwMarketDataKind,
} from "./tw-market-data.ts";

/**
 * Whole-market, read-only research view over the canonical prefix/month index.
 *
 * Formal-research invariants:
 * - manifest and every shard are pinned to one immutable Git commit;
 * - large GitHub Contents objects fall back to their immutable Git Blob SHA;
 * - compressed canonical envelopes are decoded inside the reader;
 * - manifest readiness reuses the canonical publisher fence instead of drifting;
 * - every requested shard is structurally validated before its rows are consumed;
 * - incomplete or null-contaminated 1d/3d/5d histories are never mislabeled
 *   as complete horizons;
 * - formal eligibility stays fail-closed unless every gate passes.
 */
export const MARKET_DATA_CROSS_SECTION_VERSION = "diamond-market-data-cross-section/v1";

export type MarketCrossSectionInput = {
  as_of?: string;
  calendar_days?: number;
  prefix?: string;
  limit?: number;
};

type SymbolMonthShard = {
  schema_version?: string;
  month?: string;
  prefix?: string;
  symbols?: Record<string, Partial<Record<TwMarketDataKind, any[]>>>;
  updated_at?: string;
};

type CanonicalRead<T> = {
  exists: boolean;
  path: string;
  sha: string | null;
  value: T | null;
};

type MemoryEnv = Env & { __GITHUB_DATA_MEMORY?: Map<string, unknown> };

type WindowValue = {
  days: number;
  observations: number;
  value: number | null;
};

function taipeiDate(ms = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function subtractDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function monthRange(start: string, end: string) {
  const cursor = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
  const last = new Date(`${end.slice(0, 7)}-01T00:00:00Z`);
  const out: string[] = [];
  while (cursor <= last) {
    out.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

function shardPath(month: string, prefix: string) {
  const [year, mon] = month.split("-");
  return `data/market-data/index/${year}/${mon}/${prefix}.json`;
}

function manifestPath(date: string) {
  const [year, month, day] = date.split("-");
  return `data/market-data/daily/${year}/${month}/${day}/manifest.json`;
}

function canonicalConfig(env: Env) {
  return {
    repo: String(env.GITHUB_DATA_REPO || DEFAULT_GITHUB_DATA_REPO).trim(),
    branch: String(env.GITHUB_DATA_BRANCH || DEFAULT_GITHUB_DATA_BRANCH).trim(),
    token: String(env.GITHUB_DATA_TOKEN || env.GITHUB_TOKEN || "").trim(),
  };
}

function canonicalHeaders(env: Env): HeadersInit {
  const { token } = canonicalConfig(env);
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "taistock-market-data-cross-section/1.0",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function normalizeCanonicalPath(path: string) {
  const out = path.replace(/^\/+/, "").replace(/\/{2,}/g, "/").trim();
  if (!out || out.includes("..")) throw new Error(`invalid GitHub data path: ${path}`);
  return out;
}

function base64ToUtf8(text: string) {
  const binary = atob(text.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function decodeCanonicalJson<T>(text: string): Promise<T> {
  const parsed = JSON.parse(text);
  if (!isGitHubCompressedJsonEnvelope(parsed)) return parsed as T;
  return JSON.parse(await decodeGitHubCompressedJsonText(parsed)) as T;
}

/** Resolve the moving canonical branch once before any formal cross-section read. */
async function resolveCanonicalRevision(env: Env) {
  const memory = (env as MemoryEnv).__GITHUB_DATA_MEMORY;
  const { repo, branch } = canonicalConfig(env);
  if (memory) return `memory:${branch}`;

  const response = await fetch(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`, {
    method: "GET",
    headers: canonicalHeaders(env),
    cache: "no-store",
  });
  const body = await response.json<any>().catch(() => null);
  if (!response.ok) throw new Error(`canonical_revision_resolve_failed:${response.status}`);
  const sha = String(body?.sha ?? "").trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error("canonical_revision_invalid_sha");
  return sha;
}

/**
 * Read the complete immutable blob. GitHub Contents responses stop embedding
 * base64 content once a file grows beyond the inline threshold, so large month
 * shards must fall back to the Git Blob endpoint keyed by the Contents blob SHA.
 */
async function readBlobBase64(env: Env, repo: string, blobSha: string) {
  if (!/^[0-9a-f]{40}$/i.test(blobSha)) throw new Error("canonical_blob_invalid_sha");
  const response = await fetch(`https://api.github.com/repos/${repo}/git/blobs/${encodeURIComponent(blobSha)}`, {
    method: "GET",
    headers: canonicalHeaders(env),
    cache: "no-store",
  });
  const body = await response.json<any>().catch(() => null);
  if (!response.ok) throw new Error(`canonical_blob_read_failed:${response.status}:${blobSha}`);
  if (body?.sha && String(body.sha) !== blobSha) throw new Error(`canonical_blob_sha_mismatch:${blobSha}`);
  if (String(body?.encoding ?? "").toLowerCase() !== "base64" || typeof body?.content !== "string" || !body.content.trim()) {
    throw new Error(`canonical_blob_invalid_content:${blobSha}`);
  }
  return body.content as string;
}

/** Read one canonical JSON file at the immutable revision selected above. */
async function readCanonicalJsonAtRevision<T>(env: Env, path: string, revision: string): Promise<CanonicalRead<T>> {
  const normalized = normalizeCanonicalPath(path);
  if ((env as MemoryEnv).__GITHUB_DATA_MEMORY) return await readGitHubJson<T>(env, normalized);

  if (!/^[0-9a-f]{40}$/i.test(revision)) throw new Error("canonical_revision_required");
  const { repo } = canonicalConfig(env);
  const encodedPath = normalized.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`https://api.github.com/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(revision)}`, {
    method: "GET",
    headers: canonicalHeaders(env),
    cache: "no-store",
  });
  if (response.status === 404) return { exists: false, path: normalized, sha: null, value: null };
  const body = await response.json<any>().catch(() => null);
  if (!response.ok) throw new Error(`canonical_read_failed:${response.status}:${normalized}`);
  if (!body || Array.isArray(body) || typeof body.sha !== "string" || !/^[0-9a-f]{40}$/i.test(body.sha)) {
    throw new Error(`canonical_read_invalid_metadata:${normalized}`);
  }

  const inlineBase64 = String(body.encoding ?? "base64").toLowerCase() === "base64"
    && typeof body.content === "string"
    && body.content.trim()
    ? body.content
    : null;
  const encoded = inlineBase64 ?? await readBlobBase64(env, repo, body.sha);

  return {
    exists: true,
    path: normalized,
    sha: body.sha,
    value: await decodeCanonicalJson<T>(base64ToUtf8(encoded)),
  };
}

function validateManifestForCrossSection(manifest: MarketReadManifest | null, asOf: string) {
  if (!manifest) return { valid: false, error: "manifest_missing" };
  try {
    const validated = validateMarketReadPublishPrerequisites(manifest);
    if (validated.trade_date !== asOf) return { valid: false, error: "manifest_trade_date_mismatch" };
    return { valid: true, error: null };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function shardValidationError(shard: SymbolMonthShard | null, expectedMonth: string, expectedPrefix: string): string | null {
  if (!shard || typeof shard !== "object" || Array.isArray(shard)) return "shard_not_object";
  if (shard.schema_version !== "diamond-market-data-symbol-shard/v2") return "shard_schema_invalid";
  if (shard.month !== expectedMonth) return "shard_month_mismatch";
  if (shard.prefix !== expectedPrefix) return "shard_prefix_mismatch";
  if (!shard.symbols || typeof shard.symbols !== "object" || Array.isArray(shard.symbols)) return "shard_symbols_invalid";

  for (const [symbol, state] of Object.entries(shard.symbols)) {
    if (!/^\d{4,6}$/.test(symbol) || !symbol.startsWith(expectedPrefix)) return `shard_symbol_prefix:${symbol}`;
    if (!state || typeof state !== "object" || Array.isArray(state)) return `shard_symbol_state:${symbol}`;

    for (const kind of ["institutional", "margin", "securities_lending", "sbl_short_sale"] as const) {
      const rows = state[kind];
      if (rows === undefined) continue;
      if (!Array.isArray(rows)) return `shard_kind_not_array:${symbol}:${kind}`;
      const seen = new Set<string>();
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) return `shard_row_invalid:${symbol}:${kind}`;
        const tradeDate = String((row as any).trade_date ?? "");
        if (!validDate(tradeDate) || tradeDate.slice(0, 7) !== expectedMonth) return `shard_row_date:${symbol}:${kind}`;
        if (String((row as any).symbol ?? "") !== symbol) return `shard_row_symbol:${symbol}:${kind}`;
        if (seen.has(tradeDate)) return `shard_duplicate_trade_date:${symbol}:${kind}:${tradeDate}`;
        seen.add(tradeDate);
      }
    }
  }
  return null;
}

function dedupeRows<T extends { trade_date: string }>(rows: T[]) {
  const map = new Map<string, T>();
  for (const row of rows) map.set(row.trade_date, row);
  return [...map.values()].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
}

function rowsInRange<T extends { trade_date: string }>(rows: T[] | undefined, start: string, end: string) {
  return (rows ?? []).filter((row) => row.trade_date >= start && row.trade_date <= end);
}

function finiteMetric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Build one horizon from the actual rows, not from helper aggregates that may
 * coalesce nullable observations to zero. A horizon is publishable only when
 * both the row count and the usable observation count equal the horizon.
 */
function metricWindow<T>(rows: T[], horizon: number, valueOf: (row: T) => number | null): WindowValue {
  const slice = rows.slice(-horizon);
  let observations = 0;
  let sum = 0;
  for (const row of slice) {
    const value = valueOf(row);
    if (value === null || !Number.isFinite(value)) continue;
    observations += 1;
    sum += value;
  }
  return {
    days: slice.length,
    observations,
    value: slice.length === horizon && observations === horizon ? sum : null,
  };
}

function dayReceipt(d1: WindowValue, d3: WindowValue, d5: WindowValue) {
  return { "1d": d1.days, "3d": d3.days, "5d": d5.days };
}

function observationReceipt(d1: WindowValue, d3: WindowValue, d5: WindowValue) {
  return { "1d": d1.observations, "3d": d3.observations, "5d": d5.observations };
}

function compactInstitutional(rows: InstitutionalRow[]) {
  const latest = rows.at(-1) ?? null;
  const valueOf = (row: InstitutionalRow) => finiteMetric(row.total_net_shares);
  const d1 = metricWindow(rows, 1, valueOf);
  const d3 = metricWindow(rows, 3, valueOf);
  const d5 = metricWindow(rows, 5, valueOf);
  return {
    latest_trade_date: latest?.trade_date ?? null,
    latest_total_net_shares: latest?.total_net_shares ?? null,
    latest_foreign_net_shares: latest?.foreign_net_shares ?? null,
    latest_trust_net_shares: latest?.trust_net_shares ?? null,
    latest_dealer_net_shares: latest?.dealer_net_shares ?? null,
    window_days: dayReceipt(d1, d3, d5),
    window_observations: observationReceipt(d1, d3, d5),
    net_1d: d1.value,
    net_3d: d3.value,
    net_5d: d5.value,
  };
}

function compactMargin(rows: MarginRow[]) {
  const latest = rows.at(-1) ?? null;
  const marginValue = (row: MarginRow) => finiteMetric(row.margin_balance_change_lots);
  const shortValue = (row: MarginRow) => finiteMetric(row.short_balance_change_lots);
  const margin1 = metricWindow(rows, 1, marginValue);
  const margin3 = metricWindow(rows, 3, marginValue);
  const margin5 = metricWindow(rows, 5, marginValue);
  const short1 = metricWindow(rows, 1, shortValue);
  const short3 = metricWindow(rows, 3, shortValue);
  const short5 = metricWindow(rows, 5, shortValue);
  return {
    latest_trade_date: latest?.trade_date ?? null,
    margin_balance_lots: latest?.margin_balance_lots ?? null,
    short_balance_lots: latest?.short_balance_lots ?? null,
    window_days: dayReceipt(margin1, margin3, margin5),
    margin_change_observations: observationReceipt(margin1, margin3, margin5),
    short_change_observations: observationReceipt(short1, short3, short5),
    margin_change_1d: margin1.value,
    margin_change_3d: margin3.value,
    margin_change_5d: margin5.value,
    short_change_1d: short1.value,
    short_change_3d: short3.value,
    short_change_5d: short5.value,
  };
}

function compactLending(rows: SecuritiesLendingRow[]) {
  const latest = rows.at(-1) ?? null;
  const netBorrowed = (row: SecuritiesLendingRow) => {
    const borrowed = finiteMetric(row.borrowed_shares);
    const returned = finiteMetric(row.returned_shares);
    return borrowed === null || returned === null ? null : borrowed - returned;
  };
  const d1 = metricWindow(rows, 1, netBorrowed);
  const d3 = metricWindow(rows, 3, netBorrowed);
  const d5 = metricWindow(rows, 5, netBorrowed);
  return {
    latest_trade_date: latest?.trade_date ?? null,
    balance_shares: latest?.balance_shares ?? null,
    window_days: dayReceipt(d1, d3, d5),
    window_observations: observationReceipt(d1, d3, d5),
    net_borrowed_1d: d1.value,
    net_borrowed_3d: d3.value,
    net_borrowed_5d: d5.value,
  };
}

function compactSbl(rows: SblShortSaleRow[]) {
  const latest = rows.at(-1) ?? null;
  const sold = (row: SblShortSaleRow) => finiteMetric(row.sold_shares);
  const d1 = metricWindow(rows, 1, sold);
  const d3 = metricWindow(rows, 3, sold);
  const d5 = metricWindow(rows, 5, sold);
  return {
    latest_trade_date: latest?.trade_date ?? null,
    balance_shares: latest?.balance_shares ?? null,
    available_shares: latest?.available_shares ?? null,
    window_days: dayReceipt(d1, d3, d5),
    window_observations: observationReceipt(d1, d3, d5),
    sold_1d: d1.value,
    sold_3d: d3.value,
    sold_5d: d5.value,
  };
}

export async function getTwMarketCrossSection(env: Env, input: MarketCrossSectionInput = {}) {
  const asOf = String(input.as_of ?? taipeiDate());
  if (!validDate(asOf)) throw new Error(`invalid as_of: ${asOf}`);

  // Twenty calendar days comfortably covers 1/3/5 trading-day windows while
  // avoiding unnecessary historical shards for the normal research path.
  const calendarDays = Math.max(20, Math.min(62, Math.floor(Number(input.calendar_days ?? 20))));
  const start = subtractDays(asOf, calendarDays);
  const requestedPrefix = input.prefix == null ? null : String(input.prefix).trim();
  if (requestedPrefix !== null && !/^[0-9]$/.test(requestedPrefix)) throw new Error(`invalid prefix: ${requestedPrefix}`);
  const prefixes = requestedPrefix === null ? ["0","1","2","3","4","5","6","7","8","9"] : [requestedPrefix];
  const limit = Math.max(1, Math.min(2500, Math.floor(Number(input.limit ?? (requestedPrefix === null ? 2500 : 500)))));

  const sourceRevision = await resolveCanonicalRevision(env);
  const manifest = await readCanonicalJsonAtRevision<MarketReadManifest>(env, manifestPath(asOf), sourceRevision);
  const manifestGate = validateManifestForCrossSection(manifest.value, asOf);
  const completedPrefixSet = new Set(manifest.value?.index_state?.completed_prefixes ?? []);
  const requestedPrefixesComplete = prefixes.every((prefix) => completedPrefixSet.has(prefix));

  const months = monthRange(start, asOf);
  const reads = await Promise.all(months.flatMap((month) => prefixes.map(async (prefix) => {
    const path = shardPath(month, prefix);
    try {
      return {
        month,
        prefix,
        read: await readCanonicalJsonAtRevision<SymbolMonthShard>(env, path, sourceRevision),
        read_error: null as string | null,
      };
    } catch (error) {
      return {
        month,
        prefix,
        read: { exists: false, path, sha: null, value: null } as CanonicalRead<SymbolMonthShard>,
        read_error: error instanceof Error ? error.message : String(error),
      };
    }
  }))));

  const missingShards = reads.filter((item) => !item.read.value && !item.read_error).map((item) => item.read.path);
  const invalidShards = reads.flatMap((item) => {
    if (item.read_error) return [{ path: item.read.path, reason: `shard_read_error:${item.read_error}` }];
    if (!item.read.value) return [];
    const reason = shardValidationError(item.read.value, item.month, item.prefix);
    return reason ? [{ path: item.read.path, reason }] : [];
  });
  const invalidShardPaths = new Set(invalidShards.map((item) => item.path));
  const bySymbol = new Map<string, Partial<Record<TwMarketDataKind, any[]>>>();
  const datasets: Array<{ path: string; sha: string | null; month: string; prefix: string }> = [];

  for (const item of reads) {
    const shard = item.read.value;
    if (!shard?.symbols || invalidShardPaths.has(item.read.path)) continue;
    datasets.push({ path: item.read.path, sha: item.read.sha, month: item.month, prefix: item.prefix });
    for (const [symbol, state] of Object.entries(shard.symbols)) {
      const target = bySymbol.get(symbol) ?? {};
      for (const kind of ["institutional", "margin", "securities_lending", "sbl_short_sale"] as const) {
        const incoming = Array.isArray(state[kind]) ? state[kind]! : [];
        if (incoming.length) target[kind] = [...(target[kind] ?? []), ...incoming];
      }
      bySymbol.set(symbol, target);
    }
  }

  const symbols = [...bySymbol.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, limit)
    .map(([symbol, state]) => {
      const institutional = dedupeRows(rowsInRange(state.institutional as InstitutionalRow[] | undefined, start, asOf));
      const margin = dedupeRows(rowsInRange(state.margin as MarginRow[] | undefined, start, asOf));
      const lending = dedupeRows(rowsInRange(state.securities_lending as SecuritiesLendingRow[] | undefined, start, asOf));
      const sbl = dedupeRows(rowsInRange(state.sbl_short_sale as SblShortSaleRow[] | undefined, start, asOf));
      const latest = institutional.at(-1) ?? margin.at(-1) ?? lending.at(-1) ?? sbl.at(-1) ?? null;
      const coverage = {
        institutional: institutional.length > 0,
        margin: margin.length > 0,
        securities_lending: lending.length > 0,
        sbl_short_sale: sbl.length > 0,
      };
      const readyLayers = Object.values(coverage).filter(Boolean).length;
      return {
        symbol,
        name: latest?.name ?? "",
        market: latest?.market ?? null,
        data_as_of: [institutional.at(-1)?.trade_date, margin.at(-1)?.trade_date, lending.at(-1)?.trade_date, sbl.at(-1)?.trade_date]
          .filter(Boolean).sort().at(-1) ?? null,
        coverage: { ...coverage, ready_layers: readyLayers, expected_layers: 4 },
        institutional: compactInstitutional(institutional),
        margin: compactMargin(margin),
        securities_lending: compactLending(lending),
        sbl_short_sale: compactSbl(sbl),
      };
    });

  const formalResearchEligible = manifestGate.valid
    && requestedPrefixesComplete
    && missingShards.length === 0
    && invalidShards.length === 0;
  return {
    ok: true,
    version: MARKET_DATA_CROSS_SECTION_VERSION,
    storage: "GITHUB_ONLY",
    read_only: true,
    requested_as_of: asOf,
    history_start: start,
    calendar_days: calendarDays,
    prefix: requestedPrefix,
    source_revision: sourceRevision,
    status: formalResearchEligible ? "READY" : "DEGRADED",
    formal_research_eligible: formalResearchEligible,
    data_gate: {
      source_revision: sourceRevision,
      manifest_path: manifest.path,
      manifest_sha: manifest.sha,
      manifest_valid: manifestGate.valid,
      manifest_error: manifestGate.error,
      manifest_trade_date: manifest.value?.trade_date ?? null,
      day_status: manifest.value?.day_status ?? null,
      ready_layers: manifest.value?.ready_layers ?? null,
      expected_layers: manifest.value?.expected_layers ?? null,
      missing_layers: manifest.value?.missing_layers ?? [],
      index_status: manifest.value?.index_state?.status ?? null,
      completed_prefixes: manifest.value?.index_state?.completed_prefixes ?? [],
      requested_prefixes_complete: requestedPrefixesComplete,
    },
    scan: {
      prefixes_requested: prefixes,
      months_requested: months,
      shard_reads: reads.length,
      missing_shards: missingShards,
      invalid_shards: invalidShards,
      symbols_discovered: bySymbol.size,
      symbols_returned: symbols.length,
      limit,
    },
    datasets,
    symbols,
    note: "Compact canonical market-data feature vectors only. Manifest and shards are pinned to source_revision; manifest readiness reuses the canonical publish fence; large shards are read by immutable blob SHA; malformed shards are excluded and fail formal eligibility. Incomplete or null-contaminated horizons return null with row-day and usable-observation receipts. Price/volume remains an OHLC MCP join; sector metadata is a separate research metadata join.",
  };
}
