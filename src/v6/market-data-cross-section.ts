import { readGitHubJson } from "./github-data-store";
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
} from "./tw-market-data";

/**
 * Whole-market, read-only research view over the canonical prefix/month index.
 *
 * Design goals:
 * - never require a research client to decode gzip+base64 snapshots itself;
 * - keep GitHub as the only persistent source of truth;
 * - expose compact, rank-ready per-symbol features instead of raw full snapshots;
 * - fail closed for formal research unless the requested day is COMPLETE and the
 *   cross-sectional index is READY;
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

  const manifest = await readGitHubJson<DailyManifest>(env, manifestPath(asOf));
  const dayComplete = manifest.value?.day_status === "COMPLETE" && manifest.value?.terminal === true;
  const indexReady = manifest.value?.index_state?.status === "READY";

  const months = monthRange(start, asOf);
  const reads = await Promise.all(months.flatMap((month) => prefixes.map(async (prefix) => ({
    month,
    prefix,
    read: await readGitHubJson<SymbolMonthShard>(env, shardPath(month, prefix)),
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

  const formalResearchEligible = dayComplete && indexReady && missingShards.length === 0;
  return {
    ok: true,
    version: MARKET_DATA_CROSS_SECTION_VERSION,
    storage: "GITHUB_ONLY",
    read_only: true,
    requested_as_of: asOf,
    history_start: start,
    calendar_days: calendarDays,
    prefix: requestedPrefix,
    status: formalResearchEligible ? "READY" : "DEGRADED",
    formal_research_eligible: formalResearchEligible,
    data_gate: {
      manifest_path: manifest.path,
      manifest_sha: manifest.sha,
      day_status: manifest.value?.day_status ?? null,
      ready_layers: manifest.value?.ready_layers ?? null,
      expected_layers: manifest.value?.expected_layers ?? null,
      missing_layers: manifest.value?.missing_layers ?? [],
      index_status: manifest.value?.index_state?.status ?? null,
      completed_prefixes: manifest.value?.index_state?.completed_prefixes ?? [],
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
    note: "Compact canonical market-data feature vectors only. Price/volume remains an OHLC MCP join; sector metadata is a separate research metadata join.",
  };
}
