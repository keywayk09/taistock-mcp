import { readFamilyMarketRegimeContext } from "./family-ohlc-read-bridge";
import { loadJin10MarketBriefContext } from "./jin10-facade-provider";

export const FAMILY_MARKET_QUESTION_VERSION = "family-market-question/v1.0.0";

type MarketQuestionInput = {
  as_of_date: string;
  question: string;
  intent?: string;
};

type MarketQuestionIo = {
  readRegime?: typeof readFamilyMarketRegimeContext;
  readJin10?: typeof loadJin10MarketBriefContext;
};

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error ?? "UNKNOWN"))
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .slice(0, 300);
}

function text(value: unknown, max = 600) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return raw.length <= max ? raw : `${raw.slice(0, max)}…`;
}

function projectBar(row: any) {
  return {
    trade_date: row?.trade_date ?? row?.date ?? null,
    bar_time_tw: row?.bar_time_tw ?? row?.time ?? null,
    ts_ms: Number.isFinite(Number(row?.ts_ms)) ? Number(row.ts_ms) : null,
    open: Number.isFinite(Number(row?.open)) ? Number(row.open) : null,
    high: Number.isFinite(Number(row?.high)) ? Number(row.high) : null,
    low: Number.isFinite(Number(row?.low)) ? Number(row.low) : null,
    close: Number.isFinite(Number(row?.close)) ? Number(row.close) : null,
    volume: Number.isFinite(Number(row?.volume)) ? Number(row.volume) : null,
  };
}

function recentBars(value: any, limit: number) {
  const rows = Array.isArray(value?.rows)
    ? value.rows
    : Array.isArray(value?.bars)
      ? value.bars
      : [];
  return rows.slice(-limit).map(projectBar);
}

function compactTxfContext(context: any) {
  const data = context?.data && typeof context.data === "object" ? context.data : null;
  return {
    status: context?.status ?? "UNAVAILABLE",
    source: context?.source ?? "OHLC_MCP_TXF_READ",
    verification_level: context?.verification_level ?? "NOT_ATTACHED_OR_UNAVAILABLE",
    dataset_version: context?.dataset_version ?? null,
    data_as_of: context?.data_as_of ?? data?.trade_date ?? null,
    error: text(context?.error, 300),
    data: data ? {
      ok: data.ok ?? null,
      blocked: data.blocked ?? null,
      status: data.status ?? data.data_status ?? null,
      trade_date: data.trade_date ?? data.resolved_date ?? null,
      timeframe: data.timeframe ?? "5m",
      returned: data.returned ?? data.count ?? null,
      rows: recentBars(data, 60),
    } : null,
  };
}

function compactGlobalFuturesContext(context: any) {
  const data = context?.data && typeof context.data === "object" ? context.data : null;
  const products = Array.isArray(data?.products) ? data.products : [];
  return {
    status: context?.status ?? "UNAVAILABLE",
    source: context?.source ?? "OHLC_MCP_GLOBAL_FUTURES_READ",
    verification_level: context?.verification_level ?? "NOT_ATTACHED_OR_UNAVAILABLE",
    data_as_of: context?.data_as_of ?? data?.trade_date ?? null,
    error: text(context?.error, 300),
    data: data ? {
      ok: data.ok ?? null,
      blocked: data.blocked ?? null,
      status: data.status ?? null,
      trade_date: data.trade_date ?? null,
      requested_as_of_date: data.requested_as_of_date ?? null,
      requested_products: Array.isArray(data.requested_products) ? data.requested_products.slice(0, 8) : [],
      failures: Array.isArray(data.failures) ? data.failures.slice(0, 8).map((item: any) => ({ product: item?.product ?? null, error: text(item?.error, 240) })) : [],
      products: products.slice(0, 8).map((item: any) => ({
        product: item?.product ?? null,
        trade_date: item?.trade_date ?? null,
        status: item?.status ?? item?.data_status ?? null,
        verification_level: item?.verification_level ?? null,
        dataset_version: item?.dataset_version ?? null,
        rows: recentBars(item, 36),
      })),
    } : null,
  };
}

function compactJin10(context: any) {
  const projectEvent = (item: any) => ({
    id: item?.id ?? null,
    time: item?.time ?? item?.pub_time ?? null,
    title: text(item?.title, 300),
    summary: text(item?.summary ?? item?.content ?? item?.introduction, 700),
    important: item?.important ?? item?.star ?? null,
    previous: item?.previous ?? null,
    consensus: item?.consensus ?? null,
    actual: item?.actual ?? null,
    affect_txt: text(item?.affect_txt, 500),
  });
  return {
    ok: context?.ok === true,
    provider: "jin10-mcp",
    mode: context?.mode ?? "market_brief",
    read_only: true,
    persistence: "NONE",
    flash: Array.isArray(context?.flash) ? context.flash.slice(0, 8).map(projectEvent) : [],
    news: Array.isArray(context?.news) ? context.news.slice(0, 5).map(projectEvent) : [],
    calendar: Array.isArray(context?.calendar) ? context.calendar.slice(0, 8).map(projectEvent) : [],
    partial_errors: Array.isArray(context?.partial_errors) ? context.partial_errors.slice(0, 6).map((error: unknown) => text(error, 300)) : [],
  };
}

function unavailableRegime(error: unknown) {
  const message = safeError(error);
  return {
    txf_context: { status: "UNAVAILABLE", source: "OHLC_MCP_TXF_READ", error: message },
    global_futures_context: { status: "UNAVAILABLE", source: "OHLC_MCP_GLOBAL_FUTURES_READ", error: message },
  };
}

function unavailableJin10(error: unknown) {
  return {
    ok: false,
    provider: "jin10-mcp",
    mode: "market_brief",
    read_only: true,
    persistence: "NONE",
    flash: [],
    news: [],
    calendar: [],
    partial_errors: [safeError(error)],
  };
}

/**
 * Request-scoped market-event context for Family/Custom GPT questions that do
 * not name a stock symbol, such as "昨晚美盤為什麼台指期下跌". It reuses the
 * existing governed TXF/Global Futures read bridge and the internal Jin10 MCP
 * facade. No new public Action is added and no data is persisted.
 */
export async function buildFamilyMarketQuestionContext(
  env: Env,
  input: MarketQuestionInput,
  io: MarketQuestionIo = {},
) {
  const readRegime = io.readRegime ?? readFamilyMarketRegimeContext;
  const readJin10 = io.readJin10 ?? loadJin10MarketBriefContext;
  const [regime, jin10] = await Promise.all([
    readRegime(env, {
      as_of_date: input.as_of_date,
      question: input.question,
      intent: input.intent ?? "MARKET_CONTEXT",
    }).catch(unavailableRegime),
    readJin10(env, 12).catch(unavailableJin10),
  ]);

  const txf = compactTxfContext(regime?.txf_context);
  const globalFutures = compactGlobalFuturesContext(regime?.global_futures_context);
  const events = compactJin10(jin10);

  return {
    contract: "FAMILY_MARKET_CONTEXT_READ_ONLY",
    version: FAMILY_MARKET_QUESTION_VERSION,
    as_of_date: input.as_of_date,
    question: input.question,
    txf_context: txf,
    global_futures_context: globalFutures,
    jin10_context: events,
    decision_readiness: {
      txf_context: ["READY", "DEGRADED"].includes(String(txf.status)),
      global_futures_context: ["READY", "DEGRADED"].includes(String(globalFutures.status)),
      jin10_context: events.ok === true,
    },
    evidence_policy: {
      txf: "GOVERNED_READ_ONLY_MARKET_REGIME_CONTEXT",
      global_futures: "VERIFIED_READ_ONLY_MARKET_REGIME_CONTEXT",
      jin10: "READ_ONLY_EVENT_RESEARCH_CONTEXT_NOT_FORMAL_TRUTH",
      web: "OPEN_WORLD_SUPPLEMENT_AND_CONFLICT_CHECK",
      persistence: "NONE",
      writes: false,
    },
  };
}
