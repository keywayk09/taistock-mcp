import { readGitHubJson, sha256Hex, stableJson } from "./github-data-store.ts";
import { readGitHubBlobJson } from "./github-atomic-json.ts";
import {
  assertPublishedShard,
  marketReadCacheKey,
  marketReadPublishedPointerPath,
  marketReadPublishedShardPath,
  type MarketReadPublishedPointer,
  type MarketReadShardReceipt,
  type MarketReadReferenceShardReceiptV4,
} from "./market-data-publish-fence.ts";
import {
  buildMonthlySymbolBundle,
  monthlySymbolBundleLogicalPath,
  monthlySymbolBundleSeries,
} from "./market-data-monthly-symbol-bundle.ts";
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

export const MARKET_DATA_PUBLISHED_GATEWAY_VERSION = "diamond-market-data-published-gateway/v2-reference";

type ClosedMonthShard = {
  schema_version: "diamond-market-data-symbol-shard/v2";
  month: string;
  prefix: string;
  symbols: Record<string, Partial<Record<TwMarketDataKind, any[]>>>;
  updated_at: string;
};

export type PublishedGatewayInput = {
  symbol: string;
  as_of?: string;
  calendar_days?: number;
  reference_price?: number;
  estimated_financing_cost?: number;
  financing_ratio?: number;
};

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

function closedMonthShardPath(month: string, symbol: string) {
  const [year, mon] = month.split("-");
  return `data/market-data/index/${year}/${mon}/${symbol.slice(0, 2)}.json`;
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

function buildMaintenanceRisk(input: PublishedGatewayInput, marginRows: MarginRow[]) {
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

function unavailable(input: PublishedGatewayInput, reason: string, pointer: MarketReadPublishedPointer | null = null) {
  return {
    ok: false,
    version: MARKET_DATA_PUBLISHED_GATEWAY_VERSION,
    storage: "GITHUB_ONLY",
    consistency: "PUBLISHED" as const,
    status: "UNAVAILABLE" as const,
    reason,
    symbol: input.symbol,
    requested_as_of: input.as_of ?? null,
    published_trade_date: pointer?.trade_date ?? null,
    generation: pointer?.generation ?? null,
    data_quality: {
      formal_published: false,
      mixed_generation_current_day: false,
      daily_snapshot_overlay: false,
    },
  };
}

async function stateFromPublishedReceipt(
  env: Env,
  pointer: MarketReadPublishedPointer,
  prefix: string,
  symbol: string,
) {
  const receiptPath = marketReadPublishedShardPath(pointer.trade_date, pointer.generation, prefix);
  const read = await readGitHubJson<MarketReadShardReceipt>(env, receiptPath);
  if (!read.value) throw new Error(`published_shard_missing:${prefix}`);
  assertPublishedShard(pointer, read.value);

  if (read.value.schema_version === "diamond-market-data-symbol-shard/v3") {
    return {
      state: (read.value.symbols?.[symbol] ?? {}) as Partial<Record<TwMarketDataKind, any[]>>,
      datasets: [{ path: read.path, sha: read.sha, role: "PUBLISHED_GENERATION_SHARD_V3" }],
    };
  }

  const receipt = read.value as MarketReadReferenceShardReceiptV4;
  const source = await readGitHubBlobJson<ClosedMonthShard>(env, receipt.source_blob_sha);
  if (source.schema_version !== "diamond-market-data-symbol-shard/v2") throw new Error(`published_source_schema:${prefix}`);
  if (source.prefix !== prefix) throw new Error(`published_source_prefix:${prefix}`);
  if (source.month !== pointer.trade_date.slice(0, 7)) throw new Error(`published_source_month:${prefix}`);
  const logicalSha = await sha256Hex(stableJson(source));
  if (logicalSha !== receipt.source_logical_sha256) throw new Error(`published_source_logical_sha:${prefix}`);
  return {
    state: source.symbols?.[symbol] ?? {},
    datasets: [
      { path: read.path, sha: read.sha, role: "PUBLISHED_GENERATION_REFERENCE_V4" },
      { path: receipt.source_path, sha: receipt.source_blob_sha, role: "PINNED_SOURCE_BLOB" },
    ],
  };
}

export async function getTwMarketChipSummaryPublished(env: Env, input: PublishedGatewayInput) {
  const pointerRead = await readGitHubJson<MarketReadPublishedPointer>(env, marketReadPublishedPointerPath());
  const pointer = pointerRead.value;
  if (!pointer || pointer.schema_version !== "diamond-market-data-published-pointer/v1") {
    return unavailable(input, "published_pointer_missing");
  }
  if (input.as_of && input.as_of > pointer.trade_date) {
    return unavailable(input, "requested_as_of_newer_than_published_pointer", pointer);
  }

  const asOf = input.as_of ?? pointer.trade_date;
  const calendarDays = Math.max(30, Math.min(360, Number(input.calendar_days ?? 60)));
  const start = subtractDays(asOf, calendarDays);
  const months = monthRange(start, asOf);
  const publishedMonth = pointer.trade_date.slice(0, 7);
  const prefix = input.symbol.slice(0, 2);

  const institutionalRows: InstitutionalRow[] = [];
  const marginRows: MarginRow[] = [];
  const securitiesLendingRows: SecuritiesLendingRow[] = [];
  const sblShortSaleRows: SblShortSaleRow[] = [];
  const datasets: Array<{ path: string; sha: string | null; role: string }> = [];
  const logicalBundles: Array<{ month: string; symbol: string; logical_path: string }> = [];

  for (const month of months) {
    let state: Partial<Record<TwMarketDataKind, any[]>> = {};
    if (month === publishedMonth) {
      try {
        const resolved = await stateFromPublishedReceipt(env, pointer, prefix, input.symbol);
        state = resolved.state;
        datasets.push(...resolved.datasets);
      } catch (error) {
        return unavailable(input, `published_shard_invalid:${String(error)}`, pointer);
      }
    } else {
      const read = await readGitHubJson<ClosedMonthShard>(env, closedMonthShardPath(month, input.symbol));
      state = read.value?.symbols?.[input.symbol] ?? {};
      if (Object.keys(state).length) datasets.push({ path: read.path, sha: read.sha, role: "CLOSED_MONTH_HISTORY_SHARD" });
    }

    const bundle = buildMonthlySymbolBundle({ month, symbol: input.symbol, state });
    const series = monthlySymbolBundleSeries(bundle);
    logicalBundles.push({ month, symbol: input.symbol, logical_path: monthlySymbolBundleLogicalPath(month, input.symbol) });

    for (const row of series.institutional) if (row.trade_date >= start && row.trade_date <= asOf) institutionalRows.push(row as InstitutionalRow);
    for (const row of series.margin) if (row.trade_date >= start && row.trade_date <= asOf) marginRows.push(row as MarginRow);
    for (const row of series.securities_lending) if (row.trade_date >= start && row.trade_date <= asOf) securitiesLendingRows.push(row as SecuritiesLendingRow);
    for (const row of series.sbl_short_sale) if (row.trade_date >= start && row.trade_date <= asOf) sblShortSaleRows.push(row as SblShortSaleRow);
  }

  const institutional = dedupeRows(institutionalRows).slice(-360);
  const margin = dedupeRows(marginRows).slice(-360);
  const securitiesLending = dedupeRows(securitiesLendingRows).slice(-360);
  const sblShortSale = dedupeRows(sblShortSaleRows).slice(-360);
  const groups = [institutional, margin, securitiesLending, sblShortSale];
  const unavailableLayers = groups.filter((rows) => !rows.length).length;

  return {
    ok: true,
    version: MARKET_DATA_PUBLISHED_GATEWAY_VERSION,
    storage: "GITHUB_ONLY",
    consistency: "PUBLISHED" as const,
    read_strategy: "LOGICAL_MONTH_SYMBOL_BUNDLE_OVER_GENERATION_FENCED_PREFIX_STORAGE",
    symbol: input.symbol,
    requested_as_of: asOf,
    data_as_of: dataAsOf(groups),
    calendar_days: calendarDays,
    status: unavailableLayers === 0 ? "READY" : unavailableLayers === 4 ? "UNAVAILABLE" : "DEGRADED",
    publication: {
      pointer_path: pointerRead.path,
      pointer_sha: pointerRead.sha,
      trade_date: pointer.trade_date,
      generation: pointer.generation,
      source_manifest_sha: pointer.source_manifest_sha,
      prefix_count: pointer.prefix_count,
      published_at: pointer.published_at,
      previous_generation: pointer.previous_generation,
      cache_key: marketReadCacheKey(input.symbol, pointer),
    },
    data_quality: {
      formal_published: true,
      current_month_generation_fenced: true,
      mixed_generation_current_day: false,
      daily_snapshot_overlay: false,
      historical_closed_months_use_terminal_month_index: true,
      published_generation_uses_blob_reference: true,
    },
    logical_read_model: {
      shape: "YEAR/MONTH/SYMBOL -> ALL CHIP DATA BY DATE",
      physically_persisted_per_symbol: false,
      reason: "Avoid per-symbol GitHub write amplification while preserving the same program-facing model.",
      bundles: logicalBundles,
    },
    read_efficiency: {
      prefix,
      months_requested: months.length,
      physical_reads_per_month: 1,
      published_generation_shards: months.includes(publishedMonth) ? 1 : 0,
      closed_month_history_shards: months.filter((month) => month !== publishedMonth).length,
      daily_manifest_reads: 0,
      daily_snapshot_reads: 0,
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
