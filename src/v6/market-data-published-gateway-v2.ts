import { readGitHubJson, sha256Hex, stableJson } from "./github-data-store.ts";
import { readGitHubBlobJson } from "./github-atomic-json.ts";
import {
  assertPublishedGenerationManifest,
  assertPublishedShard,
  marketReadCacheKey,
  marketReadPublishedGenerationManifestPath,
  marketReadPublishedPointerPath,
  marketReadPublishedShardPath,
  type MarketReadGenerationManifestV5,
  type MarketReadPublishedPointer,
  type MarketReadReferenceShardReceiptV4,
  type MarketReadShardReceipt,
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

export const MARKET_DATA_PUBLISHED_GATEWAY_VERSION = "diamond-market-data-published-gateway/v4-universal-compact";
export const MARKET_DATA_PUBLISHED_MAX_CALENDAR_DAYS = 180;

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

function closedMonthShardPath(month: string, prefix: string) {
  const [year, mon] = month.split("-");
  return `data/market-data/index/${year}/${mon}/${prefix}.json`;
}

function prefixCandidates(symbol: string) {
  return [symbol.slice(0, 1), symbol.slice(0, 2)];
}

async function readClosedMonthState(env: Env, month: string, symbol: string) {
  const [compactPrefix, legacyPrefix] = prefixCandidates(symbol);
  const compact = await readGitHubJson<ClosedMonthShard>(env, closedMonthShardPath(month, compactPrefix));
  if (compact.value?.symbols?.[symbol]) {
    return { state: compact.value.symbols[symbol], dataset: { path: compact.path, sha: compact.sha, role: "MONTH_SHARD_COMPACT" } };
  }
  const legacy = await readGitHubJson<ClosedMonthShard>(env, closedMonthShardPath(month, legacyPrefix));
  return {
    state: legacy.value?.symbols?.[symbol] ?? {},
    dataset: legacy.value?.symbols?.[symbol] ? { path: legacy.path, sha: legacy.sha, role: "MONTH_SHARD_LEGACY_FALLBACK" } : null,
  };
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

async function stateFromPinnedReference(
  env: Env,
  pointer: MarketReadPublishedPointer,
  prefix: string,
  symbol: string,
  reference: { source_path: string; source_blob_sha: string; source_logical_sha256: string },
) {
  const source = await readGitHubBlobJson<ClosedMonthShard>(env, reference.source_blob_sha);
  if (source.schema_version !== "diamond-market-data-symbol-shard/v2") throw new Error(`published_source_schema:${prefix}`);
  if (source.prefix !== prefix) throw new Error(`published_source_prefix:${prefix}`);
  if (source.month !== pointer.trade_date.slice(0, 7)) throw new Error(`published_source_month:${prefix}`);
  const logicalSha = await sha256Hex(stableJson(source));
  if (logicalSha !== reference.source_logical_sha256) throw new Error(`published_source_logical_sha:${prefix}`);
  return {
    state: source.symbols?.[symbol] ?? {},
    sourceDataset: { path: reference.source_path, sha: reference.source_blob_sha, role: "PINNED_SOURCE_BLOB" },
  };
}

async function stateFromPublishedGeneration(
  env: Env,
  pointer: MarketReadPublishedPointer,
  symbol: string,
) {
  const [compactPrefix, legacyPrefix] = prefixCandidates(symbol);
  const generationManifestPath = marketReadPublishedGenerationManifestPath(pointer.trade_date, pointer.generation);
  const generationRead = await readGitHubJson<MarketReadGenerationManifestV5>(env, generationManifestPath);
  if (generationRead.value?.schema_version === "diamond-market-data-generation-ref/v5") {
    assertPublishedGenerationManifest(pointer, generationRead.value);
    const prefix = generationRead.value.prefixes[compactPrefix] ? compactPrefix : legacyPrefix;
    const reference = generationRead.value.prefixes[prefix];
    if (!reference) throw new Error(`published_generation_prefix_missing:${compactPrefix}|${legacyPrefix}`);
    const pinned = await stateFromPinnedReference(env, pointer, prefix, symbol, reference);
    return {
      state: pinned.state,
      datasets: [
        { path: generationRead.path, sha: generationRead.sha, role: "PUBLISHED_GENERATION_MANIFEST_V5" },
        pinned.sourceDataset,
      ],
      format: "GENERATION_MANIFEST_V5" as const,
      prefix,
    };
  }

  let prefix = compactPrefix;
  let read = await readGitHubJson<MarketReadShardReceipt>(env, marketReadPublishedShardPath(pointer.trade_date, pointer.generation, prefix));
  if (!read.value) {
    prefix = legacyPrefix;
    read = await readGitHubJson<MarketReadShardReceipt>(env, marketReadPublishedShardPath(pointer.trade_date, pointer.generation, prefix));
  }
  if (!read.value) throw new Error(`published_shard_missing:${compactPrefix}|${legacyPrefix}`);
  assertPublishedShard(pointer, read.value);

  if (read.value.schema_version === "diamond-market-data-symbol-shard/v3") {
    return {
      state: (read.value.symbols?.[symbol] ?? {}) as Partial<Record<TwMarketDataKind, any[]>>,
      datasets: [{ path: read.path, sha: read.sha, role: "PUBLISHED_GENERATION_SHARD_V3" }],
      format: "LEGACY_V3" as const,
      prefix,
    };
  }

  const receipt = read.value as MarketReadReferenceShardReceiptV4;
  const pinned = await stateFromPinnedReference(env, pointer, prefix, symbol, receipt);
  return {
    state: pinned.state,
    datasets: [
      { path: read.path, sha: read.sha, role: "PUBLISHED_GENERATION_REFERENCE_V4" },
      pinned.sourceDataset,
    ],
    format: "LEGACY_V4" as const,
    prefix,
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
  const calendarDays = Math.max(30, Math.min(MARKET_DATA_PUBLISHED_MAX_CALENDAR_DAYS, Number(input.calendar_days ?? 60)));
  const start = subtractDays(asOf, calendarDays);
  const months = monthRange(start, asOf);
  const publishedMonth = pointer.trade_date.slice(0, 7);

  const institutionalRows: InstitutionalRow[] = [];
  const marginRows: MarginRow[] = [];
  const securitiesLendingRows: SecuritiesLendingRow[] = [];
  const sblShortSaleRows: SblShortSaleRow[] = [];
  const datasets: Array<{ path: string; sha: string | null; role: string }> = [];
  const logicalBundles: Array<{ month: string; symbol: string; logical_path: string }> = [];
  let publishedFormat: "GENERATION_MANIFEST_V5" | "LEGACY_V3" | "LEGACY_V4" | null = null;
  let publishedPrefix: string | null = null;

  for (const month of months) {
    let state: Partial<Record<TwMarketDataKind, any[]>> = {};
    if (month === publishedMonth) {
      try {
        const resolved = await stateFromPublishedGeneration(env, pointer, input.symbol);
        state = resolved.state;
        datasets.push(...resolved.datasets);
        publishedFormat = resolved.format;
        publishedPrefix = resolved.prefix;
      } catch (error) {
        return unavailable(input, `published_shard_invalid:${String(error)}`, pointer);
      }
    } else {
      const closed = await readClosedMonthState(env, month, input.symbol);
      state = closed.state;
      if (closed.dataset) datasets.push(closed.dataset);
    }

    const bundle = buildMonthlySymbolBundle({ month, symbol: input.symbol, state });
    const series = monthlySymbolBundleSeries(bundle);
    logicalBundles.push({ month, symbol: input.symbol, logical_path: monthlySymbolBundleLogicalPath(month, input.symbol) });

    for (const row of series.institutional) if (row.trade_date >= start && row.trade_date <= asOf) institutionalRows.push(row as InstitutionalRow);
    for (const row of series.margin) if (row.trade_date >= start && row.trade_date <= asOf) marginRows.push(row as MarginRow);
    for (const row of series.securities_lending) if (row.trade_date >= start && row.trade_date <= asOf) securitiesLendingRows.push(row as SecuritiesLendingRow);
    for (const row of series.sbl_short_sale) if (row.trade_date >= start && row.trade_date <= asOf) sblShortSaleRows.push(row as SblShortSaleRow);
  }

  const institutional = dedupeRows(institutionalRows).slice(-MARKET_DATA_PUBLISHED_MAX_CALENDAR_DAYS);
  const margin = dedupeRows(marginRows).slice(-MARKET_DATA_PUBLISHED_MAX_CALENDAR_DAYS);
  const securitiesLending = dedupeRows(securitiesLendingRows).slice(-MARKET_DATA_PUBLISHED_MAX_CALENDAR_DAYS);
  const sblShortSale = dedupeRows(sblShortSaleRows).slice(-MARKET_DATA_PUBLISHED_MAX_CALENDAR_DAYS);
  const groups = [institutional, margin, securitiesLending, sblShortSale];
  const unavailableLayers = groups.filter((rows) => !rows.length).length;

  return {
    ok: true,
    version: MARKET_DATA_PUBLISHED_GATEWAY_VERSION,
    storage: "GITHUB_ONLY",
    consistency: "PUBLISHED" as const,
    read_strategy: "LOGICAL_MONTH_SYMBOL_BUNDLE_OVER_COMPACT_GENERATION_FENCED_STORAGE",
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
      format: publishedFormat,
    },
    data_quality: {
      formal_published: true,
      current_month_generation_fenced: true,
      mixed_generation_current_day: false,
      daily_snapshot_overlay: false,
      universal_compact_shard_write: true,
      legacy_two_digit_shard_read_fallback: true,
      published_generation_uses_blob_reference: publishedFormat === "GENERATION_MANIFEST_V5" || publishedFormat === "LEGACY_V4",
      single_generation_manifest: publishedFormat === "GENERATION_MANIFEST_V5",
    },
    logical_read_model: {
      shape: "YEAR/MONTH/SYMBOL -> ALL CHIP DATA BY DATE",
      physically_persisted_per_symbol: false,
      reason: "Avoid per-symbol GitHub write amplification while preserving the same program-facing model.",
      bundles: logicalBundles,
    },
    read_efficiency: {
      prefix: publishedPrefix ?? input.symbol.slice(0, 1),
      compact_prefix: input.symbol.slice(0, 1),
      legacy_prefix_fallback: input.symbol.slice(0, 2),
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