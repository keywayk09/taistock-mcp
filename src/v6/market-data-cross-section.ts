import { DEFAULT_GITHUB_DATA_BRANCH, DEFAULT_GITHUB_DATA_REPO, readGitHubJson } from "./github-data-store.ts";
import { decodeGitHubCompressedJsonText, isGitHubCompressedJsonEnvelope } from "./github-compressed-json.ts";
import {
  institutionalWindows,
  marginWindows,
  securitiesLendingWindows,
  sblShortSaleWindows,
  type InstitutionalRow,
  type MarginRow,
  type SecuritiesLendingRow,
  type SblShortSaleRow,
  type TwMarketDataKind,
} from "./tw-market-data.ts";

/**
 * Whole-market, read-only research view over the canonical prefix/month index.
 *
 * Design goals:
 * - never require a research client to decode gzip+base64 snapshots itself;
 * - keep GitHub as the only persistent source of truth;
 * - expose compact, rank-ready per-symbol features instead of raw full snapshots;
 * - fail closed for formal research unless the requested day is COMPLETE and the
 *   cross-sectional index is READY;
 * - pin manifest + every shard to one immutable GitHub commit so a formal scan
 *   can never mix two canonical generations while the branch advances;
 * - support prefix paging (0-9) so callers can scan the whole market without one
 *   oversized MCP response.
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

type DailyManifest = {
  trade_date?: string;
  day_status?: string;
  terminal?: boolean;
  ready_layers?: number;
  expected_layers?: number;
  missing_layers?: string[];
  index_state?: {
    status?: string;
    completed_prefixes?: string[];
    total_prefixes?: number | null;
    updated_at?: string;
  };
};

type CanonicalRead<T> = {
  exists: boolean;
  path: string;
  sha: string | null;
  value: T | null;
};

type MemoryEnv = Env & { __GITHUB_DATA_MEMORY?: Map<string, unknown> };

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

/** Resolve the moving canonical branch once, before any formal cross-section read. */
async function resolveCanonicalRevision(env: Env) {
  const memory = (env as MemoryEnv).__GITHUB_DATA_MEMORY;
  const { repo, branch } = canonicalConfig(env);
  // The in-memory test store is already one synchronous snapshot and has no real
  // Git commit. Keep an explicit synthetic revision so tests exercise the same
  // formal-research contract without making network calls.
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

/** Read one canonical JSON file at the immutable revision selected above. */
async function readCanonicalJsonAtRevision<T>(env: Env, path: string, revision: string): Promise<CanonicalRead<T>> {
  const normalized = normalizeCanonicalPath(path);
  if ((env as MemoryEnv).__GITHUB_DATA_MEMORY) {
    return await readGitHubJson<T>(env, normalized);
  }

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
  if (!body || Array.isArray(body) || typeof body.content !== "string" || typeof body.sha !== "string") {
    throw new Error(`canonical_read_invalid_content:${normalized}`);
  }
  return {
    exists: true,
    path: normalized,
    sha: body.sha,
    value: await decodeCanonicalJson<T>(base64ToUtf8(body.content)),
  };
}

function dedupeRows<T extends { trade_date: string; market?: string }>(rows: T[]) {
  const map = new Map<string, T>();
  for (const row of rows) map.set(`${row.trade_date}:${row.market ?? ""}`, row);
  return [...map.values()].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
}

function rowsInRange<T extends { trade_date: string }>(rows: T[] | undefined, start: string, end: string) {
  return (rows ?? []).filter((row) => row.trade_date >= start && row.trade_date <= end);
}

function compactInstitutional(rows: InstitutionalRow[]) {
  const latest = rows.at(-1) ?? null;
  const windows = institutionalWindows(rows) as Record<string, any>;
  return {
    latest_trade_date: latest?.trade_date ?? null,
    latest_total_net_shares: latest?.total_net_shares ?? null,
    latest_foreign_net_shares: latest?.foreign_net_shares ?? null,
    latest_trust_net_shares: latest?.trust_net_shares ?? null,
    latest_dealer_net_shares: latest?.dealer_net_shares ?? null,
    net_1d: windows["1d"]?.total_net_shares ?? null,
    net_3d: windows["3d"]?.total_net_shares ?? null,
    net_5d: windows["5d"]?.total_net_shares ?? null,
  };
}

function compactMargin(rows: MarginRow[]) {
  const view = marginWindows(rows) as any;
  const latest = view.latest as MarginRow | null;
  return {
    latest_trade_date: latest?.trade_date ?? null,
    margin_balance_lots: latest?.margin_balance_lots ?? null,
    short_balance_lots: latest?.short_balance_lots ?? null,
    margin_change_1d: view.windows?.["1d"]?.margin_balance_change_lots ?? null,
    margin_change_3d: view.windows?.["3d"]?.margin_balance_change_lots ?? null,
    margin_change_5d: view.windows?.["5d"]?.margin_balance_change_lots ?? null,
    short_change_1d: view.windows?.["1d"]?.short_balance_change_lots ?? null,
    short_change_3d: view.windows?.["3d"]?.short_balance_change_lots ?? null,
    short_change_5d: view.windows?.["5d"]?.short_balance_change_lots ?? null,
  };
}

function compactLending(rows: SecuritiesLendingRow[]) {
  const view = securitiesLendingWindows(rows) as any;
  const latest = view.latest as SecuritiesLendingRow | null;
  return {
    latest_trade_date: latest?.trade_date ?? null,
    balance_shares: latest?.balance_shares ?? null,
    net_borrowed_1d: view.windows?.["1d"]?.net_borrowed_shares ?? null,
    net_borrowed_3d: view.windows?.["3d"]?.net_borrowed_shares ?? null,
    net_borrowed_5d: view.windows?.["5d"]?.net_borrowed_shares ?? null,
  };
}

function compactSbl(rows: SblShortSaleRow[]) {
  const view = sblShortSaleWindows(rows) as any;
  const latest = view.latest as SblShortSaleRow | null;
  return {
    latest_trade_date: latest?.trade_date ?? null,
    balance_shares: latest?.balance_shares ?? null,
    available_shares: latest?.available_shares ?? null,
    sold_1d: view.windows?.["1d"]?.sold_shares ?? null,
    sold_3d: view.windows?.["3d"]?.sold_shares ?? null,
    sold_5d: view.windows?.["5d"]?.sold_shares ?? null,
  };
}

export async function getTwMarketCrossSection(env: Env, input: MarketCrossSectionInput = {}) {
  const asOf = String(input.as_of ?? taipeiDate());
  if (!validDate(asOf)) throw new Error(`invalid as_of: ${asOf}`);

  // Twenty calendar days comfortably covers 1/3/5 trading-day windows while
  // avoiding an unnecessary previous-month shard dependency for late-month runs.
  // Callers can explicitly request up to 62 days when longer history is available.
  const calendarDays = Math.max(20, Math.min(62, Math.floor(Number(input.calendar_days ?? 20))));
  const start = subtractDays(asOf, calendarDays);
  const requestedPrefix = input.prefix == null ? null : String(input.prefix).trim();
  if (requestedPrefix !== null && !/^[0-9]$/.test(requestedPrefix)) throw new Error(`invalid prefix: ${requestedPrefix}`);
  const prefixes = requestedPrefix === null ? ["0","1","2","3","4","5","6","7","8","9"] : [requestedPrefix];
  const limit = Math.max(1, Math.min(2500, Math.floor(Number(input.limit ?? (requestedPrefix === null ? 2500 : 500)))));

  // P0/P1 formal-read fence: resolve main once and read the manifest + every
  // month/prefix shard at exactly that immutable commit. No moving-branch mixture.
  const sourceRevision = await resolveCanonicalRevision(env);
  const manifest = await readCanonicalJsonAtRevision<DailyManifest>(env, manifestPath(asOf), sourceRevision);
  const dayComplete = manifest.value?.day_status === "COMPLETE" && manifest.value?.terminal === true;
  const indexReady = manifest.value?.index_state?.status === "READY";
  const completedPrefixSet = new Set(manifest.value?.index_state?.completed_prefixes ?? []);
  const requestedPrefixesComplete = prefixes.every((prefix) => completedPrefixSet.has(prefix));

  const months = monthRange(start, asOf);
  const reads = await Promise.all(months.flatMap((month) => prefixes.map(async (prefix) => ({
    month,
    prefix,
    read: await readCanonicalJsonAtRevision<SymbolMonthShard>(env, shardPath(month, prefix), sourceRevision),
  }))));

  const missingShards = reads.filter((item) => !item.read.value).map((item) => item.read.path);
  const bySymbol = new Map<string, Partial<Record<TwMarketDataKind, any[]>>>();
  const datasets: Array<{ path: string; sha: string | null; month: string; prefix: string }> = [];

  for (const item of reads) {
    const shard = item.read.value;
    if (!shard?.symbols) continue;
    datasets.push({ path: item.read.path, sha: item.read.sha, month: item.month, prefix: item.prefix });
    for (const [symbol, state] of Object.entries(shard.symbols)) {
      if (!/^\d{4,6}$/.test(symbol)) continue;
      const target = bySymbol.get(symbol) ?? {};
      for (const kind of ["institutional", "margin", "securities_lending", "sbl_short_sale"] as const) {
        const incoming = Array.isArray(state[kind]) ? state[kind]! : [];
        if (incoming.length) target[kind] = [...(target[kind] ?? []), ...incoming];
      }
      bySymbol.set(symbol, target);
    }
  }

  const symbols = [...bySymbol.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, limit).map(([symbol, state]) => {
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

  const formalResearchEligible = dayComplete && indexReady && requestedPrefixesComplete && missingShards.length === 0;
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
      symbols_discovered: bySymbol.size,
      symbols_returned: symbols.length,
      limit,
    },
    datasets,
    symbols,
    note: "Compact canonical market-data feature vectors only. Manifest and shards are pinned to source_revision. Price/volume remains an OHLC MCP join; sector metadata is a separate research metadata join.",
  };
}
