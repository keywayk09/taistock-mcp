import { readGitHubJson } from "./github-data-store";
import {
  getTwInstitutionalFlow as getLegacyInstitutionalFlow,
  getTwMarginShort as getLegacyMarginShort,
  getTwSecuritiesLending as getLegacySecuritiesLending,
  getTwSblShortSale as getLegacySblShortSale,
} from "./tw-market-data-github";
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

export const TW_MARKET_DATA_VERSION = "diamond-tw-market-data/v2.3.0-daily-snapshot-live";

type DailyManifestLayer = {
  kind: TwMarketDataKind;
  market: "listed" | "otc";
  status: string;
  snapshot_path?: string | null;
};

type DailyManifest = {
  layers?: DailyManifestLayer[];
};

function manifestPath(date: string) {
  const [y, m, d] = date.split("-");
  return `data/market-data/daily/${y}/${m}/${d}/manifest.json`;
}

async function loadDailyRows<T extends { trade_date: string; symbol: string }>(env: Env, kind: TwMarketDataKind, symbol: string, asOf: string) {
  const manifest = await readGitHubJson<DailyManifest>(env, manifestPath(asOf));
  const layers = (manifest.value?.layers ?? []).filter((layer) => layer.kind === kind && layer.status === "READY" && layer.snapshot_path);
  const reads = await Promise.all(layers.map((layer) => readGitHubJson<{ rows?: T[] }>(env, String(layer.snapshot_path))));
  const rows: T[] = [];
  const datasets: any[] = [];
  for (let i = 0; i < reads.length; i++) {
    const read = reads[i];
    const matches = (read.value?.rows ?? []).filter((row) => String(row.symbol) === symbol && row.trade_date === asOf);
    rows.push(...matches);
    if (matches.length) datasets.push({ path: read.path, sha: read.sha, storage: "GITHUB_ONLY", role: "DAILY_SNAPSHOT_LIVE" });
  }
  return { rows, datasets };
}

function mergeByDate<T extends { trade_date: string }>(historical: T[], daily: T[]) {
  const map = new Map<string, T>();
  for (const row of historical) map.set(row.trade_date, row);
  for (const row of daily) map.set(row.trade_date, row);
  return [...map.values()].sort((a, b) => a.trade_date.localeCompare(b.trade_date)).slice(-120);
}

export async function getTwInstitutionalFlow(env: Env, input: { symbol: string; as_of?: string; calendar_days?: number }) {
  const base = await getLegacyInstitutionalFlow(env, input);
  const asOf = base.as_of;
  const daily = await loadDailyRows<InstitutionalRow>(env, "institutional", input.symbol, asOf);
  const rows = mergeByDate(base.rows as InstitutionalRow[], daily.rows);
  const officialDays = rows.filter((row) => row.source_priority === "OFFICIAL").length;
  return {
    ...base,
    version: TW_MARKET_DATA_VERSION,
    status: rows.length ? (officialDays ? "READY" : "DEGRADED") : "UNAVAILABLE",
    data_quality: { ...(base.data_quality ?? {}), official_days: officialDays, total_days: rows.length },
    windows: institutionalWindows(rows),
    rows,
    datasets: [...(base.datasets ?? []), ...daily.datasets],
  };
}

export async function getTwMarginShort(env: Env, input: { symbol: string; as_of?: string; calendar_days?: number }) {
  const base = await getLegacyMarginShort(env, input);
  const asOf = base.as_of;
  const daily = await loadDailyRows<MarginRow>(env, "margin", input.symbol, asOf);
  const rows = mergeByDate(base.rows as MarginRow[], daily.rows);
  const officialDays = rows.filter((row) => row.source_priority === "OFFICIAL").length;
  return {
    ...base,
    version: TW_MARKET_DATA_VERSION,
    status: rows.length ? (officialDays ? "READY" : "DEGRADED") : "UNAVAILABLE",
    data_quality: { ...(base.data_quality ?? {}), official_days: officialDays, total_days: rows.length },
    ...marginWindows(rows),
    rows,
    datasets: [...(base.datasets ?? []), ...daily.datasets],
  };
}

export async function getTwSecuritiesLending(env: Env, input: { symbol: string; as_of?: string; calendar_days?: number }) {
  const base = await getLegacySecuritiesLending(env, input);
  const asOf = base.as_of;
  const daily = await loadDailyRows<SecuritiesLendingRow>(env, "securities_lending", input.symbol, asOf);
  const rows = mergeByDate(base.rows as SecuritiesLendingRow[], daily.rows);
  return {
    ...base,
    version: TW_MARKET_DATA_VERSION,
    status: rows.length ? "READY" : "UNAVAILABLE",
    ...securitiesLendingWindows(rows),
    rows,
    datasets: [...(base.datasets ?? []), ...daily.datasets],
  };
}

export async function getTwSblShortSale(env: Env, input: { symbol: string; as_of?: string; calendar_days?: number }) {
  const base = await getLegacySblShortSale(env, input);
  const asOf = base.as_of;
  const daily = await loadDailyRows<SblShortSaleRow>(env, "sbl_short_sale", input.symbol, asOf);
  const rows = mergeByDate(base.rows as SblShortSaleRow[], daily.rows);
  return {
    ...base,
    version: TW_MARKET_DATA_VERSION,
    status: rows.length ? "READY" : "UNAVAILABLE",
    ...sblShortSaleWindows(rows),
    rows,
    datasets: [...(base.datasets ?? []), ...daily.datasets],
  };
}

export async function getTwMarketDataBundle(env: Env, input: { symbol: string; as_of?: string; calendar_days?: number }) {
  const [institutional, margin, securitiesLending, sblShortSale] = await Promise.all([
    getTwInstitutionalFlow(env, input),
    getTwMarginShort(env, input),
    getTwSecuritiesLending(env, input),
    getTwSblShortSale(env, input),
  ]);
  const layers = { institutional, margin, securities_lending: securitiesLending, sbl_short_sale: sblShortSale };
  const degradedLayers = Object.entries(layers).filter(([, value]) => value.status !== "READY").map(([key]) => key);
  return {
    ok: true,
    version: TW_MARKET_DATA_VERSION,
    storage: "GITHUB_ONLY",
    symbol: input.symbol,
    as_of: input.as_of ?? institutional.as_of,
    status: degradedLayers.length ? (degradedLayers.length === 4 ? "UNAVAILABLE" : "DEGRADED") : "READY",
    degraded_layers: degradedLayers,
    market_data_blocks_ohlc: false,
    ohlc_dependency: "OHLC_MCP_ONLY",
    formal_swing_policy: "JOIN_OHLC_WITH_DIAMOND_MARKET_DATA; NEVER_SUBSTITUTE_FINMIND_PRICE_FOR_OHLC",
    ...layers,
  };
}
