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

export const MARKET_DATA_FAST_GATEWAY_VERSION = "diamond-market-data-fast-gateway/v1";

type SymbolMonthShard = {
  schema_version: "diamond-market-data-symbol-shard/v2";
  month: string;
  prefix: string;
  symbols: Record<string, Partial<Record<TwMarketDataKind, any[]>>>;
  updated_at: string;
};

type DailyManifestLayer = {
  kind: TwMarketDataKind;
  market: "listed" | "otc";
  status: string;
  snapshot_path?: string | null;
};

type DailyManifest = {
  trade_date?: string;
  day_status?: string;
  terminal?: boolean;
  layers?: DailyManifestLayer[];
};

type FastGatewayInput = {
  symbol: string;
  as_of?: string;
  calendar_days?: number;
  reference_price?: number;
  estimated_financing_cost?: number;
  financing_ratio?: number;
};

function taipeiDate(ms = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
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

function shardPath(month: string, symbol: string) {
  const [year, mon] = month.split("-");
  return `data/market-data/index/${year}/${mon}/${symbol.slice(0, 2)}.json`;
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

function dataAsOf(groups: Array<Array<{ trade_date: string }>>) {
  return groups.flat().map((row) => row.trade_date).sort().at(-1) ?? null;
}

function layerStatus(rows: unknown[]) {
  return rows.length ? "READY" as const : "UNAVAILABLE" as const;
}

function buildMaintenanceRisk(input: FastGatewayInput, marginRows: MarginRow[]) {
  const latestMargin = marginRows.at(-1) ?? null;
  const price = Number(input.reference_price);
  const estimatedCost = Number(input.estimated_financing_cost);
  const financingRatio = Number.isFinite(Number(input.financing_ratio))
    ? Math.max(0.1, Math.min(0.9, Number(input.financing_ratio)))
    : 0.6;

  if (!(price > 0) || !(estimatedCost > 0)) {
    return {
      status: "NEEDS_OHLC_JOIN" as const,
      metric: "ESTIMATED_POSITION_MAINTENANCE_PROXY",
      official_account_maintenance_ratio: false,
      requires: ["reference_price_from_OHLC_MCP", "estimated_financing_cost"],
      financing_ratio_assumption: financingRatio,
      official_margin_context: latestMargin,
      note: "公開個股資料無法還原券商整戶擔保維持率；此層只有在 OHLC 與估算融資成本可用時才計算代理值。",
    };
  }

  const ratio = (price / (estimatedCost * financingRatio)) * 100;
  const distance130 = ratio - 130;
  const riskZone = ratio < 130 ? "CRITICAL" : ratio < 140 ? "HIGH" : ratio < 160 ? "ELEVATED" : ratio < 180 ? "NORMAL" : "LOW";
  return {
    status: "READY" as const,
    metric: "ESTIMATED_POSITION_MAINTENANCE_PROXY",
    official_account_maintenance_ratio: false,
    estimated_maintenance_ratio_pct: Number(ratio.toFixed(2)),
    distance_to_130_pct_points: Number(distance130.toFixed(2)),
    risk_zone: riskZone,
    reference_price: price,
    estimated_financing_cost: estimatedCost,
    financing_ratio_assumption: financingRatio,
    official_margin_context: latestMargin,
    note: "估算代理值，不等同券商整戶擔保維持率。",
  };
}

export async function getTwMarketChipSummaryFast(env: Env, input: FastGatewayInput) {
  const asOf = input.as_of ?? taipeiDate();
  const calendarDays = Math.max(30, Math.min(180, Number(input.calendar_days ?? 60)));
  const start = subtractDays(asOf, calendarDays);
  const months = monthRange(start, asOf);
  const monthReads = await Promise.all(months.map((month) => readGitHubJson<SymbolMonthShard>(env, shardPath(month, input.symbol))));

  const institutionalRows: InstitutionalRow[] = [];
  const marginRows: MarginRow[] = [];
  const securitiesLendingRows: SecuritiesLendingRow[] = [];
  const sblShortSaleRows: SblShortSaleRow[] = [];
  const datasets: Array<{ path: string; sha: string | null; role: string }> = [];

  for (const read of monthReads) {
    const state = read.value?.symbols?.[input.symbol] ?? {};
    for (const row of state.institutional ?? []) if (row.trade_date >= start && row.trade_date <= asOf) institutionalRows.push(row as InstitutionalRow);
    for (const row of state.margin ?? []) if (row.trade_date >= start && row.trade_date <= asOf) marginRows.push(row as MarginRow);
    for (const row of state.securities_lending ?? []) if (row.trade_date >= start && row.trade_date <= asOf) securitiesLendingRows.push(row as SecuritiesLendingRow);
    for (const row of state.sbl_short_sale ?? []) if (row.trade_date >= start && row.trade_date <= asOf) sblShortSaleRows.push(row as SblShortSaleRow);
    if (Object.keys(state).length) datasets.push({ path: read.path, sha: read.sha, role: "PREFIX_MONTH_READ_MODEL" });
  }

  const manifest = await readGitHubJson<DailyManifest>(env, manifestPath(asOf));
  const liveLayers = (manifest.value?.layers ?? []).filter((layer) => layer.status === "READY" && layer.snapshot_path);
  const liveReads = await Promise.all(liveLayers.map((layer) => readGitHubJson<{ rows?: any[] }>(env, String(layer.snapshot_path))));
  for (let i = 0; i < liveLayers.length; i++) {
    const layer = liveLayers[i];
    const read = liveReads[i];
    const matches = (read.value?.rows ?? []).filter((row) => String(row.symbol) === input.symbol && row.trade_date >= start && row.trade_date <= asOf);
    if (!matches.length) continue;
    if (layer.kind === "institutional") institutionalRows.push(...matches as InstitutionalRow[]);
    if (layer.kind === "margin") marginRows.push(...matches as MarginRow[]);
    if (layer.kind === "securities_lending") securitiesLendingRows.push(...matches as SecuritiesLendingRow[]);
    if (layer.kind === "sbl_short_sale") sblShortSaleRows.push(...matches as SblShortSaleRow[]);
    datasets.push({ path: read.path, sha: read.sha, role: "DAILY_SNAPSHOT_OVERLAY" });
  }

  const institutional = dedupeRows(institutionalRows).slice(-120);
  const margin = dedupeRows(marginRows).slice(-120);
  const securitiesLending = dedupeRows(securitiesLendingRows).slice(-120);
  const sblShortSale = dedupeRows(sblShortSaleRows).slice(-120);
  const groups = [institutional, margin, securitiesLending, sblShortSale];
  const unavailable = groups.filter((rows) => !rows.length).length;

  return {
    ok: true,
    version: MARKET_DATA_FAST_GATEWAY_VERSION,
    storage: "GITHUB_ONLY",
    read_strategy: "PREFIX_MONTH_READ_MODEL_PLUS_DAILY_SNAPSHOT_OVERLAY",
    symbol: input.symbol,
    requested_as_of: asOf,
    data_as_of: dataAsOf(groups),
    calendar_days: calendarDays,
    status: unavailable === 0 ? "READY" : unavailable === 4 ? "UNAVAILABLE" : "DEGRADED",
    read_efficiency: {
      prefix: input.symbol.slice(0, 2),
      month_shards_requested: months.length,
      daily_manifest_reads: 1,
      daily_snapshot_reads: liveReads.length,
      avoids_four_independent_bundle_scans: true,
    },
    layers: {
      institutional: {
        status: layerStatus(institutional),
        latest: institutional.at(-1) ?? null,
        windows: institutionalWindows(institutional),
        rows: institutional,
      },
      margin: {
        status: layerStatus(margin),
        ...marginWindows(margin),
        rows: margin,
      },
      securities_lending: {
        status: layerStatus(securitiesLending),
        ...securitiesLendingWindows(securitiesLending),
        rows: securitiesLending,
      },
      sbl_short_sale: {
        status: layerStatus(sblShortSale),
        ...sblShortSaleWindows(sblShortSale),
        rows: sblShortSale,
      },
      maintenance_risk: buildMaintenanceRisk(input, margin),
    },
    datasets,
    ohlc_dependency: "OHLC_MCP_ONLY",
    market_data_blocks_ohlc: false,
  };
}
