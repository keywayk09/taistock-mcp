import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getTwBrokerProviderBundleOnDemand } from "./broker-provider-bundle-router.ts";
import { getTwMarketChipSummaryPublished } from "./market-data-published-gateway.ts";
import { getTwChipOnDemandSnapshot } from "./tw-chip-on-demand.ts";
import { runFamilyCreditSblQueryFastPath } from "./tw-credit-sbl-query-fast-path.ts";

export const LEGACY_OWNER_CHIP_OVERRIDE_TOOL_NAMES = Object.freeze([
  "get_broker_chips",
  "get_institutional",
  "get_margin",
  "get_short_pressure",
] as const);

const symbolSchema = z.string().trim().min(1).max(20).regex(/^[0-9A-Za-z._-]+$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const marketSchema = z.enum(["auto", "listed", "otc"]);

const out = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

function taipeiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function calendarDays(startDate: string | undefined, asOf: string, fallback: number) {
  if (!startDate) return Math.max(30, Math.min(180, fallback));
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return Math.max(30, Math.min(180, fallback));
  return Math.max(30, Math.min(180, Math.floor((end - start) / 86_400_000) + 1));
}

function rowsOf(value: unknown) {
  const record = value && typeof value === "object" ? value as Record<string, any> : {};
  return Array.isArray(record.rows) ? record.rows as any[] : [];
}

function mergeCurrentOverHistory(historyRows: any[], currentRows: any[], limit: number) {
  const rows = new Map<string, any>();
  for (const row of [...historyRows, ...currentRows]) {
    const key = `${String(row?.trade_date ?? row?.date ?? "")}:${String(row?.market ?? "")}:${String(row?.symbol ?? "")}`;
    rows.set(key, row);
  }
  return [...rows.values()]
    .sort((a, b) => String(a?.trade_date ?? a?.date ?? "").localeCompare(String(b?.trade_date ?? b?.date ?? "")))
    .slice(-limit);
}

async function currentAndHistory(env: Env, input: {
  symbol: string;
  as_of: string;
  calendar_days: number;
}) {
  const [current, history] = await Promise.all([
    getTwChipOnDemandSnapshot({ symbol: input.symbol, as_of: input.as_of }),
    getTwMarketChipSummaryPublished(env, {
      symbol: input.symbol,
      as_of: input.as_of,
      calendar_days: input.calendar_days,
    }),
  ]);
  return { current, history: history as Record<string, any> };
}

function compactBrokerWindow(result: any, topN: number) {
  const buys = Array.isArray(result?.top_net_buyers)
    ? result.top_net_buyers
    : Array.isArray(result?.buys) ? result.buys : [];
  const sells = Array.isArray(result?.top_net_sellers)
    ? result.top_net_sellers
    : Array.isArray(result?.sells) ? result.sells : [];
  return {
    provider_id: result?.provider_id ?? null,
    provider_name: result?.provider_name ?? null,
    window_days: result?.window_days ?? null,
    source_window_label: result?.source_window_label ?? null,
    status: result?.status ?? "UNAVAILABLE",
    source_date: result?.source_date ?? null,
    source_date_verified: result?.source_date_verified === true,
    source_window_verified: result?.source_window_verified !== false,
    source_range_verified: result?.source_range_verified === true,
    requested_range_start: result?.requested_range_start ?? null,
    requested_range_end: result?.requested_range_end ?? null,
    ranked_output_totals: result?.ranked_output_totals ?? null,
    top_net_buyers: buys.slice(0, topN),
    top_net_sellers: sells.slice(0, topN),
    rank_count: result?.rank_count ?? { buy: buys.length, sell: sells.length },
    error: result && "error" in result ? result.error : null,
  };
}

/**
 * Frozen 79-tool semantic bridge.
 *
 * These public names and input schemas are intentionally preserved because old
 * ChatGPT connections may cache them indefinitely. Only the provider behind the
 * names changes: current chip evidence is exact-date official on-demand;
 * Published/GitHub data is history context only; broker branches use a governed
 * whole-provider ranked-only bundle router. No current raw/normalized chip data
 * is saved.
 */
export function registerLegacyOwnerChipTools(server: McpServer, env: Env) {
  server.registerTool("get_broker_chips", {
    description: "券商分點 Ranked-only 查詢；保留原 symbol/date/top_n 輸入，同一次回傳同一平台、同一截止日的 1/5/10/20/60 日排名。Provider 可整包 failover，但禁止逐 window 混用不同平台；缺席分點不代表零交易；exact-date 驗證、唯讀、不保存，且不依賴 FinMind Token。",
    inputSchema: {
      symbol: symbolSchema,
      date: dateSchema,
      top_n: z.number().int().min(1).max(50).optional().default(20),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ symbol, date, top_n }) => {
    const bundle = await getTwBrokerProviderBundleOnDemand({
      symbol,
      as_of: date,
      windows: [1, 5, 10, 20, 60],
    });
    const oneDay = compactBrokerWindow(bundle.windows["1D"], top_n);
    const multiWindow = Object.fromEntries(
      ["5D", "10D", "20D", "60D"].map((key) => [key, compactBrokerWindow(bundle.windows[key], top_n)]),
    );
    return out({
      source: bundle.canonical_provider_name ? `${bundle.canonical_provider_name} broker ranked public page` : null,
      provider: bundle.canonical_provider_name,
      provider_id: bundle.canonical_provider_id,
      tier: bundle.canonical_provider_tier ?? "PUBLIC_SECONDARY",
      completeness: "RANKED_ONLY",
      symbol,
      date,
      status: oneDay.status,
      source_date: oneDay.source_date,
      source_date_verified: oneDay.source_date_verified,
      top_net_buyers: oneDay.top_net_buyers,
      top_net_sellers: oneDay.top_net_sellers,
      rank_count: oneDay.rank_count,
      missing_branch_means_zero: false,
      previous_day_substitution: false,
      persistence: "NONE",
      broker_evidence_contract: {
        same_provider_required: true,
        same_requested_as_of_required: true,
        cross_source_backfill_allowed: false,
        cross_provider_window_mixing: false,
        partial_single_provider_result_allowed: true,
        broker_identity_attribution_allowed: false,
        window_comparison_semantics: "NESTED_WINDOWS_SAME_END_DATE_NOT_TIME_SERIES",
        missing_window_means: "UNKNOWN",
      },
      interpretation_boundary: "Ranked public-page output only. Every canonical requested window must come from one provider under one exact requested as-of and one TWSE-trading-day window contract. A branch missing from the ranking is UNKNOWN, not zero activity. Broker names are execution channels and must not be treated as investor identity. N-day values are nested same-end-date windows, not a chronological time series.",
      multi_window: {
        version: bundle.version,
        status: bundle.status,
        requested_windows: bundle.requested_windows,
        canonical_provider_id: bundle.canonical_provider_id,
        canonical_provider_name: bundle.canonical_provider_name,
        provider_attempts: bundle.provider_attempts,
        bundle_failover_used: bundle.bundle_failover_used,
        same_provider_required: bundle.same_provider_required,
        same_requested_as_of_required: bundle.same_requested_as_of_required,
        cross_source_backfill_allowed: bundle.cross_source_backfill_allowed,
        cross_provider_window_mixing: bundle.cross_provider_window_mixing,
        daily_rank_summing: bundle.daily_rank_summing,
        missing_window_observation: bundle.missing_window_observation,
        windows: multiWindow,
        branch_matrix: bundle.branch_matrix.slice(0, top_n),
        horizon_lens: {
          S: ["1D", "5D", "10D"],
          M: ["10D", "20D", "60D"],
          L: ["20D", "60D"],
          optional_deep_L_window_days: 120,
        },
        interpretation_boundary: bundle.interpretation_boundary,
      },
      error: oneDay.error,
    });
  });

  server.registerTool("get_institutional", {
    description: "個股三大法人籌碼。requested end_date 當日優先直接讀 TWSE/TPEx 官方 exact-date on-demand；舊 Published/GitHub 只補歷史背景，禁止前一交易日冒充當日。公開名稱與舊參數保持相容。",
    inputSchema: {
      symbol: symbolSchema,
      start_date: dateSchema.optional(),
      end_date: dateSchema.optional(),
      limit_days: z.number().int().min(1).max(120).optional().default(20),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ symbol, start_date, end_date, limit_days }) => {
    const asOf = end_date ?? taipeiToday();
    const window = calendarDays(start_date, asOf, Math.max(60, limit_days * 3));
    const { current, history } = await currentAndHistory(env, { symbol, as_of: asOf, calendar_days: window });
    const currentLayer = current.layers.institutional;
    const historyLayer = history.layers?.institutional ?? null;
    return out({
      source_priority: ["TWSE/TPEx OFFICIAL EXACT_DATE_ON_DEMAND", "PUBLISHED_GITHUB HISTORY_CONTEXT_ONLY"],
      symbol,
      requested_as_of: asOf,
      status: currentLayer.status,
      data: mergeCurrentOverHistory(rowsOf(historyLayer), currentLayer.rows, limit_days),
      on_demand_current: currentLayer,
      history_context: {
        role: "HISTORY_CONTEXT_ONLY",
        data_as_of: history.data_as_of ?? null,
        status: historyLayer?.status ?? history.status ?? "UNAVAILABLE",
        rows: rowsOf(historyLayer).slice(-limit_days),
      },
      source_health: current.source_health,
      previous_day_substitution: false,
      current_persistence: "NONE",
    });
  });

  server.registerTool("get_margin", {
    description: "個股融資融券。requested end_date 當日直接讀 TWSE MI_MARGN 或 TPEx 官方 exact-date on-demand；舊 Published/GitHub 只補歷史背景，未公布回 PENDING，不拿前一日冒充。公開名稱與舊參數保持相容。",
    inputSchema: {
      symbol: symbolSchema,
      start_date: dateSchema.optional(),
      end_date: dateSchema.optional(),
      limit: z.number().int().min(1).max(250).optional().default(30),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ symbol, start_date, end_date, limit }) => {
    const asOf = end_date ?? taipeiToday();
    const window = calendarDays(start_date, asOf, Math.max(60, Math.min(180, limit * 3)));
    const { current, history } = await currentAndHistory(env, { symbol, as_of: asOf, calendar_days: window });
    const currentLayer = current.layers.margin_short;
    const historyLayer = history.layers?.margin ?? null;
    return out({
      source_priority: ["TWSE/TPEx OFFICIAL EXACT_DATE_ON_DEMAND", "PUBLISHED_GITHUB HISTORY_CONTEXT_ONLY"],
      symbol,
      requested_as_of: asOf,
      status: currentLayer.status,
      data: mergeCurrentOverHistory(rowsOf(historyLayer), currentLayer.rows, limit),
      on_demand_current: currentLayer,
      history_context: {
        role: "HISTORY_CONTEXT_ONLY",
        data_as_of: history.data_as_of ?? null,
        status: historyLayer?.status ?? history.status ?? "UNAVAILABLE",
        rows: rowsOf(historyLayer).slice(-limit),
      },
      source_health: current.source_health,
      previous_day_substitution: false,
      current_persistence: "NONE",
    });
  });

  server.registerTool("get_short_pressure", {
    description: "最新交易日空方/籌碼壓力相容入口，沒有日期參數。若使用者明示 YYYY-MM-DD，禁止用本工具代表該歷史日期；借券賣出請改用 get_tw_sbl_short_sale(as_of)，借券成交/還券請用 get_tw_securities_lending(as_of)，融資融券請用 get_margin(end_date)。未明示日期時，本工具會把週末/假日解析到最近 TWSE 交易日。公開 input schema 保持不變。",
    inputSchema: {
      symbol: symbolSchema,
      market: marketSchema.optional().default("auto"),
      days: z.number().int().min(5).max(120).optional().default(30),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ symbol, market, days }) => {
    const requestedAsOf = taipeiToday();
    const credit = await runFamilyCreditSblQueryFastPath(env, {
      symbol,
      query: `${symbol} 融資融券 借券賣出 借券餘額 1日 5日 10日 20日 60日`,
      as_of: requestedAsOf,
      as_of_explicit: false,
    });
    const resolvedAsOf = credit.resolved_as_of ?? requestedAsOf;
    const window = Math.max(30, Math.min(180, days * 3));
    const history = await getTwMarketChipSummaryPublished(env, {
      symbol,
      as_of: resolvedAsOf,
      calendar_days: window,
    }) as Record<string, any>;
    const marginLayer = credit.layers?.margin_short ?? null;
    const lendingLayer = credit.layers?.securities_lending ?? null;
    const sblLayer = credit.layers?.sbl_short_sale ?? null;
    const marginLatest = marginLayer?.latest ?? null;
    const lendingLatest = lendingLayer?.latest ?? null;
    const sblLatest = sblLayer?.latest ?? null;
    const marginHistory = rowsOf(history.layers?.margin).slice(-days);
    const lendingHistory = rowsOf(history.layers?.securities_lending).slice(-days);
    const sblHistory = rowsOf(history.layers?.sbl_short_sale).slice(-days);
    return out({
      source_priority: ["TWSE/TPEx OFFICIAL TARGETED_EXACT_DATE", "PUBLISHED_GITHUB HISTORY_CONTEXT_ONLY"],
      symbol,
      market_requested: market,
      market_resolved: credit.market ?? null,
      requested_as_of: requestedAsOf,
      resolved_as_of: resolvedAsOf,
      as_of_resolution: credit.as_of_resolution ?? null,
      explicit_historical_date_supported: false,
      explicit_date_tools: {
        margin_short: "get_margin(end_date)",
        securities_lending: "get_tw_securities_lending(as_of)",
        sbl_short_sale: "get_tw_sbl_short_sale(as_of)",
      },
      status: credit.status,
      current_summary: {
        margin_short: marginLatest ? {
          trade_date: marginLatest.trade_date ?? null,
          margin_previous_balance_lots: marginLatest.margin_previous_balance_lots ?? null,
          margin_balance_lots: marginLatest.margin_balance_lots ?? null,
          margin_balance_change_lots: marginLatest.margin_balance_change_lots ?? null,
          short_previous_balance_lots: marginLatest.short_previous_balance_lots ?? null,
          short_balance_lots: marginLatest.short_balance_lots ?? null,
          short_balance_change_lots: marginLatest.short_balance_change_lots ?? null,
          source: marginLatest.source ?? marginLayer?.current_source ?? null,
        } : null,
        securities_lending: lendingLatest ? {
          trade_date: lendingLatest.trade_date ?? null,
          previous_balance_shares: lendingLatest.previous_balance_shares ?? null,
          borrowed_shares: lendingLatest.borrowed_shares ?? null,
          returned_shares: lendingLatest.returned_shares ?? null,
          balance_shares: lendingLatest.balance_shares ?? null,
          source: lendingLatest.source ?? lendingLayer?.current_source ?? null,
        } : null,
        sbl_short_sale: sblLatest ? {
          trade_date: sblLatest.trade_date ?? null,
          previous_balance_shares: sblLatest.previous_balance_shares ?? null,
          sold_shares: sblLatest.sold_shares ?? null,
          returned_shares: sblLatest.returned_shares ?? null,
          adjustment_shares: sblLatest.adjustment_shares ?? null,
          balance_shares: sblLatest.balance_shares ?? null,
          sold_lots_equivalent: sblLatest.sold_shares == null ? null : sblLatest.sold_shares / 1000,
          balance_lots_equivalent: sblLatest.balance_shares == null ? null : sblLatest.balance_shares / 1000,
          source: sblLatest.source ?? sblLayer?.current_source ?? null,
        } : null,
      },
      official_current: {
        margin_short: marginLayer,
        securities_lending: lendingLayer,
        sbl_short_sale: sblLayer,
      },
      windows: {
        margin_short: marginLayer?.windows ?? null,
        securities_lending: lendingLayer?.windows ?? null,
        sbl_short_sale: sblLayer?.windows ?? null,
      },
      margin_history: mergeCurrentOverHistory(marginHistory, rowsOf(marginLayer), days),
      securities_lending: mergeCurrentOverHistory(lendingHistory, rowsOf(lendingLayer), days),
      sbl_short_sale: mergeCurrentOverHistory(sblHistory, rowsOf(sblLayer), days),
      history_context: {
        role: "HISTORY_CONTEXT_ONLY",
        data_as_of: history.data_as_of ?? null,
        status: history.status ?? "UNAVAILABLE",
      },
      source_health: {
        targeted_fast_path: credit.diagnostics ?? null,
        margin_source: marginLayer?.current_source ?? null,
        lending_source: lendingLayer?.current_source ?? null,
        sbl_source: sblLayer?.current_source ?? null,
      },
      previous_day_substitution: false,
      current_persistence: "NONE",
      unknown_is_zero: false,
      interpretation_boundary: "融資增加不自動等於偏空；借券餘額、借券賣出與融券是不同事件層，須分開解讀。借券成交本身不等同新增放空。",
    });
  });
}
