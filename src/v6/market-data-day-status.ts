import { readGitHubJson } from "./github-data-store.ts";
import type { TwMarketDataKind } from "./tw-market-data.ts";

export const MARKET_DATA_DAY_STATUS_VERSION = "diamond-market-data-day-status/v2.1";

type ManifestLayer = {
  kind: TwMarketDataKind;
  market: "listed" | "otc";
  status: "READY" | "PENDING" | "ERROR" | "DEGRADED" | "MISSING";
  row_count?: number;
  error?: string | null;
  next_retry_at?: string | null;
  [key: string]: unknown;
};

type DayManifest = {
  schema_version?: string;
  trade_date?: string;
  storage?: string;
  day_status?: "COMPLETE" | "PARTIAL" | "NO_TRADING_DAY" | string;
  terminal?: boolean;
  expected_layers?: number;
  ready_layers?: number;
  missing_layers?: string[];
  trading_day_gate?: unknown;
  calendar_path?: string | null;
  calendar_error?: string | null;
  layers?: ManifestLayer[];
  updated_at?: string;
};

function manifestPath(date: string) {
  const [year, month, day] = date.split("-");
  return `data/market-data/daily/${year}/${month}/${day}/manifest.json`;
}

export async function getTwMarketDataDayStatus(env: Env, tradeDate: string) {
  const read = await readGitHubJson<DayManifest>(env, manifestPath(tradeDate));
  const manifest = read.value;
  if (!manifest) {
    return {
      ok: true,
      version: MARKET_DATA_DAY_STATUS_VERSION,
      storage: "GITHUB_ONLY" as const,
      requested_trade_date: tradeDate,
      status: "UNAVAILABLE" as const,
      day_status: "UNAVAILABLE" as const,
      terminal: false,
      blocking: false,
      market_data_failure_blocks_ohlc: false,
      expected_layers: 8,
      exact_ready_layers: 0,
      missing_layers: [],
      manifest_path: read.path,
      manifest_sha: read.sha,
      trading_day_gate: null,
      layers: [],
    };
  }

  const layers = Array.isArray(manifest.layers) ? manifest.layers : [];
  const exactReady = layers.filter((layer) => layer.status === "READY").length;
  const noTradingDay = manifest.day_status === "NO_TRADING_DAY" && manifest.terminal === true;
  if (noTradingDay) {
    return {
      ok: true,
      version: MARKET_DATA_DAY_STATUS_VERSION,
      storage: "GITHUB_ONLY" as const,
      requested_trade_date: tradeDate,
      status: "NO_TRADING_DAY" as const,
      day_status: "NO_TRADING_DAY" as const,
      terminal: true,
      blocking: false,
      market_data_failure_blocks_ohlc: false,
      expected_layers: 0,
      exact_ready_layers: 0,
      missing_layers: [],
      manifest_path: read.path,
      manifest_sha: read.sha,
      trading_day_gate: manifest.trading_day_gate ?? null,
      calendar_path: manifest.calendar_path ?? null,
      calendar_error: manifest.calendar_error ?? null,
      layers,
    };
  }

  const expected = Number.isFinite(Number(manifest.expected_layers)) ? Number(manifest.expected_layers) : 8;
  const complete = manifest.day_status === "COMPLETE" && manifest.terminal === true && exactReady === expected;
  const missing = Array.isArray(manifest.missing_layers)
    ? manifest.missing_layers
    : layers.filter((layer) => layer.status !== "READY").map((layer) => `${layer.kind}-${layer.market}`);

  return {
    ok: true,
    version: MARKET_DATA_DAY_STATUS_VERSION,
    storage: "GITHUB_ONLY" as const,
    requested_trade_date: tradeDate,
    status: complete ? "READY" as const : "DEGRADED" as const,
    day_status: manifest.day_status ?? (complete ? "COMPLETE" : "PARTIAL"),
    terminal: complete,
    blocking: false,
    market_data_failure_blocks_ohlc: false,
    expected_layers: expected,
    exact_ready_layers: exactReady,
    missing_layers: missing,
    manifest_path: read.path,
    manifest_sha: read.sha,
    trading_day_gate: manifest.trading_day_gate ?? null,
    calendar_path: manifest.calendar_path ?? null,
    calendar_error: manifest.calendar_error ?? null,
    updated_at: manifest.updated_at ?? null,
    layers,
  };
}
