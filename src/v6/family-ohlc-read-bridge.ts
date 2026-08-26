import { createCrossAccountReadService } from "./cross-account-read-service.ts";

export const FAMILY_OHLC_READ_BRIDGE_VERSION = "family-ohlc-read-bridge/v1.2.0";

type AnyRecord = Record<string, any>;
type FamilyReadIntent =
  | "QUICK_STOCK_QUESTION"
  | "FULL_STOCK_ANALYSIS"
  | "STOCK_COMPARE"
  | "SWING_DISCOVERY"
  | "MARKET_CONTEXT"
  | "OPEN_RESEARCH"
  | string;

type FamilyOhlcReadService = ReturnType<typeof createCrossAccountReadService> & Record<string, any>;

function rec(value: unknown): AnyRecord {
  return value !== null && typeof value === "object" ? value as AnyRecord : {};
}

/**
 * Prefer an injected same-account service in tests/compatible deployments.
 * Production taistock-mcp and tv-fugle-1d are in different Cloudflare accounts,
 * therefore production falls back to the read-only cross-account adapter.
 */
function service(env: Env): FamilyOhlcReadService | null {
  const candidate = (env as any)?.OHLC_READ_SERVICE;
  if (candidate && typeof candidate.readOhlc === "function") return candidate as FamilyOhlcReadService;
  const hasDirectReadConfig = Boolean(
    String((env as any)?.GITHUB_DATA_REPO ?? "").trim()
    || String((env as any)?.FUGLE_API_KEY ?? "").trim(),
  );
  return hasDirectReadConfig ? createCrossAccountReadService(env) as FamilyOhlcReadService : null;
}

function subtractDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function weekdayCandidates(anchor: string, maxCalendarDays = 8) {
  const out: string[] = [];
  for (let offset = 0; offset <= maxCalendarDays; offset += 1) {
    const date = subtractDays(anchor, offset);
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) out.push(date);
  }
  return out;
}

async function safeRpc<T>(label: string, call: () => Promise<T>) {
  try {
    return { ok: true as const, data: await call(), error: null };
  } catch (error) {
    return {
      ok: false as const,
      data: null,
      error: `${label}:${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function verificationLevel(raw: unknown, fallback: string) {
  const value = rec(raw);
  const provenance = rec(value.provenance);
  return String(value.verification_level ?? provenance.verification_level ?? fallback);
}

function statusToken(raw: unknown) {
  const value = rec(raw);
  return String(value.data_status ?? value.status ?? "").trim().toUpperCase();
}

function statusIsReady(raw: unknown) {
  return ["OK", "READY"].includes(statusToken(raw));
}

function compactOhlcResult(raw: unknown) {
  const value = rec(raw);
  const rows = Array.isArray(value.rows) ? value.rows : Array.isArray(value.bars) ? value.bars : [];
  return {
    ok: value.ok === true,
    blocked: value.blocked === true,
    data_status: value.data_status ?? value.status ?? null,
    market: value.market ?? null,
    symbol: value.symbol ?? null,
    timeframe: value.timeframe ?? null,
    mode: value.mode ?? null,
    source: value.source ?? null,
    resolved_date: value.resolved_date ?? value.trade_date ?? null,
    dataset_id: value.dataset_id ?? null,
    dataset_version: value.dataset_version ?? null,
    dataset_hash: value.dataset_hash ?? null,
    dataset_complete_view: value.dataset_complete_view === true,
    formal_research_eligible: value.formal_research_eligible === true,
    quality: value.quality ?? null,
    provenance: value.provenance ?? null,
    row_count: Number(value.row_count ?? rows.length ?? 0),
    returned: Number(value.returned ?? value.count ?? rows.length ?? 0),
    rows,
  };
}

function formalStockOhlcReady(raw: unknown) {
  const value = rec(raw);
  const rows = Array.isArray(value.rows) ? value.rows : Array.isArray(value.bars) ? value.bars : [];
  return value.ok === true
    && value.blocked !== true
    && statusIsReady(value)
    && value.formal_research_eligible === true
    && value.dataset_complete_view === true
    && Boolean(String(value.dataset_version ?? "").trim())
    && rows.length > 0
    && String(rec(value.quality).gate ?? "").toUpperCase() === "PASS";
}

function verifiedGlobalFutureReady(raw: unknown) {
  const value = rec(raw);
  const rows = Array.isArray(value.rows) ? value.rows : [];
  return value.ok === true
    && value.blocked !== true
    && String(value.status ?? "").toUpperCase() === "READY"
    && value.formal_research_eligible === true
    && String(value.verification_level ?? "") === "VERIFIED_RECEIPT_GZIP_LOGICAL_SHA256_BOUND"
    && Boolean(String(value.dataset_version ?? "").trim())
    && Boolean(String(rec(value.provenance).canonical_path ?? "").trim())
    && rows.length > 0;
}

function canonicalUnavailable(error: string) {
  return {
    status: "UNAVAILABLE",
    source: "OHLC_MCP",
    formal_research_eligible: false,
    verification_level: "NOT_VERIFIED",
    dataset_version: null,
    provenance: null,
    data_as_of: null,
    daily: null,
    intraday_5m: null,
    error,
    bridge_version: FAMILY_OHLC_READ_BRIDGE_VERSION,
  };
}

function stockLiveUnavailable(symbol: string, error: string) {
  return {
    status: "UNAVAILABLE",
    source: "FUGLE_REST_READ_ONLY",
    symbol,
    live_status: "LIVE_UNAVAILABLE",
    formal_research_eligible: false,
    verification_level: "NOT_ATTACHED_OR_UNAVAILABLE",
    decision_eligible: false,
    display_ready: false,
    last_price: null,
    best_bid: null,
    best_ask: null,
    book: { bids: [], asks: [], bid_depth: 0, ask_depth: 0, imbalance: 0 },
    recent_trades: [],
    trade_tape: null,
    order_flow: null,
    feed: null,
    stream: null,
    connection: null,
    persistence: "none",
    contract: null,
    historical_daily: null,
    error,
    bridge_version: FAMILY_OHLC_READ_BRIDGE_VERSION,
  };
}

function compactStockMarketContext(raw: unknown, symbol: string) {
  const value = rec(raw);
  const live = rec(value.live);
  const snapshot = rec(live.snapshot);
  const book = rec(snapshot.book);
  const bids = Array.isArray(book.bids) ? book.bids.slice(0, 5) : [];
  const asks = Array.isArray(book.asks) ? book.asks.slice(0, 5) : [];
  const recentTrades = Array.isArray(snapshot.recent_trades) ? snapshot.recent_trades.slice(0, 300) : [];
  const hasPrice = snapshot.last_price !== null
    && snapshot.last_price !== undefined
    && Number.isFinite(Number(snapshot.last_price));
  const displayReady = live.rpc_display_ready === true || (hasPrice && bids.length > 0 && asks.length > 0);
  const liveStatus = String(live.live_status ?? "LIVE_UNAVAILABLE").toUpperCase();
  const degraded = displayReady || ["WARMING_UP", "DEGRADED"].includes(liveStatus);
  const status = liveStatus === "READY" && displayReady ? "READY" : degraded ? "DEGRADED" : "UNAVAILABLE";

  return {
    status,
    source: String(rec(value.contract).source ?? "FUGLE_REST_READ_ONLY"),
    symbol: String(value.symbol ?? live.symbol ?? symbol),
    live_status: liveStatus,
    formal_research_eligible: false,
    verification_level: status === "UNAVAILABLE" ? "NOT_ATTACHED_OR_UNAVAILABLE" : "EPHEMERAL_READ_ONLY_LIVE_CONTEXT",
    decision_eligible: live.decision_eligible === true,
    display_ready: displayReady,
    last_price: hasPrice ? Number(snapshot.last_price) : null,
    best_bid: Number.isFinite(Number(snapshot.best_bid)) ? Number(snapshot.best_bid) : null,
    best_ask: Number.isFinite(Number(snapshot.best_ask)) ? Number(snapshot.best_ask) : null,
    book: {
      bids,
      asks,
      bid_depth: Number(book.bid_depth ?? 0),
      ask_depth: Number(book.ask_depth ?? 0),
      imbalance: Number(book.imbalance ?? 0),
    },
    recent_trades: recentTrades,
    trade_tape: snapshot.trade_tape ?? null,
    order_flow: snapshot ? {
      state: snapshot.state ?? null,
      windows: snapshot.windows ?? null,
      context_30m: snapshot.context_30m ?? null,
      cumulative: snapshot.cumulative ?? null,
    } : null,
    feed: snapshot.feed ?? null,
    stream: live.stream ?? null,
    connection: live.connection ?? null,
    rpc_wait_ms: Number(live.rpc_wait_ms ?? 0),
    persistence: String(live.persistence ?? "none"),
    contract: value.contract ?? null,
    historical_daily: rec(value.historical).daily ?? null,
    error: status === "UNAVAILABLE" ? String(live.error ?? rec(live.connection).last_error ?? "stock_live_unavailable") : null,
    bridge_version: FAMILY_OHLC_READ_BRIDGE_VERSION,
  };
}

export function shouldUseFamilyIntradayContext(question: string, intent: FamilyReadIntent) {
  if (intent === "FULL_STOCK_ANALYSIS" || intent === "STOCK_COMPARE" || intent === "SWING_DISCOVERY") return true;
  return /短線|當沖|盤中|技術|支撐|壓力|進場|位置|突破|回檔|趨勢|均線|量價|現在能不能|今天/i.test(String(question ?? ""));
}

export function shouldUseFamilyRegimeContext(question: string, intent: FamilyReadIntent) {
  if (["FULL_STOCK_ANALYSIS", "STOCK_COMPARE", "SWING_DISCOVERY", "MARKET_CONTEXT"].includes(String(intent))) return true;
  return /短線|當沖|盤中|技術|大盤|市場|期貨|台指|美股|那斯達克|日經|風險|risk|nasdaq|nikkei/i.test(String(question ?? ""));
}

export async function readFamilyCanonicalOhlc(
  env: Env,
  input: { symbol: string; as_of_date: string; question?: string; intent?: FamilyReadIntent },
) {
  const rpc = service(env);
  if (!rpc) return canonicalUnavailable("OHLC_READ_SERVICE_NOT_BOUND");
  const symbol = String(input.symbol ?? "").trim();
  const asOf = String(input.as_of_date ?? "").trim();
  if (!/^\d{4,6}$/.test(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return canonicalUnavailable("INVALID_FAMILY_OHLC_REQUEST");

  const dailyCall = await safeRpc("OHLC_MCP_READ_1D", () => rpc.readOhlc({
    symbol, timeframe: "1d", mode: "research", from: subtractDays(asOf, 280), to: asOf, limit: 420,
  }));
  if (!dailyCall.ok) return canonicalUnavailable(dailyCall.error);
  const daily = compactOhlcResult(dailyCall.data);
  if (!formalStockOhlcReady(dailyCall.data)) {
    return canonicalUnavailable(String(rec(dailyCall.data).error ?? rec(dailyCall.data).data_status ?? rec(dailyCall.data).status ?? "OHLC_MCP_FORMAL_GATE_NOT_READY"));
  }

  let intraday5m: ReturnType<typeof compactOhlcResult> | null = null;
  if (shouldUseFamilyIntradayContext(input.question ?? "", input.intent ?? "")) {
    const intradayCall = await safeRpc("OHLC_MCP_READ_5M", () => rpc.readOhlc({
      symbol, timeframe: "5m", mode: "research", from: subtractDays(asOf, 10), to: asOf, limit: 2000,
    }));
    if (intradayCall.ok && formalStockOhlcReady(intradayCall.data)) intraday5m = compactOhlcResult(intradayCall.data);
  }

  return {
    status: "READY",
    source: String(daily.source ?? "OHLC_MCP"),
    formal_research_eligible: true,
    verification_level: verificationLevel(dailyCall.data, "OHLC_MCP_VERIFIED"),
    dataset_version: daily.dataset_version,
    provenance: daily.provenance,
    data_as_of: daily.resolved_date ?? asOf,
    daily,
    intraday_5m: intraday5m,
    error: null,
    bridge_version: FAMILY_OHLC_READ_BRIDGE_VERSION,
  };
}

export async function readFamilyStockMarketContext(
  env: Env,
  input: { symbol: string; books?: boolean; wait_ms?: number },
) {
  const symbol = String(input.symbol ?? "").trim();
  if (!/^\d{4,6}$/.test(symbol)) return stockLiveUnavailable(symbol, "INVALID_STOCK_LIVE_REQUEST");
  const rpc = service(env);
  if (!rpc || typeof rpc.readStockMarketContext !== "function") return stockLiveUnavailable(symbol, "OHLC_READ_SERVICE_STOCK_LIVE_NOT_BOUND");
  const waitMs = Math.max(0, Math.min(2_500, Math.trunc(Number(input.wait_ms ?? 1_800) || 0)));
  const result = await safeRpc("STOCK_MARKET_CONTEXT", () => rpc.readStockMarketContext({
    symbol, books: input.books !== false, wait_ms: waitMs, history_days: 120, history_limit: 160,
  }));
  if (!result.ok) return stockLiveUnavailable(symbol, result.error);
  return compactStockMarketContext(result.data, symbol);
}

function governedContext(raw: unknown, source: string, error: string | null = null) {
  const value = rec(raw);
  const rowsOk = !Array.isArray(value.rows) || value.rows.length > 0;
  const rawStatus = String(value.status ?? value.data_status ?? "").toUpperCase();
  const statusOk = !rawStatus || ["OK", "READY", "DEGRADED"].includes(rawStatus);
  const ready = value.ok === true && value.blocked !== true && rowsOk && statusOk;
  return {
    status: ready ? (rawStatus === "DEGRADED" ? "DEGRADED" : "READY") : "UNAVAILABLE",
    source,
    formal_research_eligible: false,
    verification_level: ready ? verificationLevel(value, "GOVERNED_READ_ONLY") : "NOT_ATTACHED_OR_UNAVAILABLE",
    dataset_version: value.dataset_version ?? null,
    provenance: value.provenance ?? null,
    data_as_of: value.as_of ?? value.trade_date ?? value.resolved_date ?? null,
    data: ready ? value : null,
    error: error ?? (ready ? null : String(value.error ?? value.status ?? value.data_status ?? "unavailable")),
    bridge_version: FAMILY_OHLC_READ_BRIDGE_VERSION,
  };
}

function globalFutureProducts(intent: FamilyReadIntent, question: string) {
  if (intent === "FULL_STOCK_ANALYSIS" || intent === "MARKET_CONTEXT") return ["MNQ", "NIY", "MES", "GC"];
  if (intent === "STOCK_COMPARE" || intent === "SWING_DISCOVERY") return ["MNQ", "NIY", "MES"];
  if (/黃金|金價|避險|gold/i.test(question)) return ["GC", "MNQ"];
  if (/日經|日本|日股|nikkei/i.test(question)) return ["NIY", "MNQ"];
  return ["MNQ", "NIY"];
}

async function readGlobalFutureAsOf(rpc: FamilyOhlcReadService, product: string, asOf: string) {
  for (const tradeDate of weekdayCandidates(asOf, 8)) {
    const result = await safeRpc(`GLOBAL_FUTURES_${product}_${tradeDate}`, () => rpc.readGlobalFuturesOhlc({
      product, timeframe: "5m", trade_date: tradeDate, limit: 120,
    }));
    if (!result.ok) return { product, trade_date: tradeDate, ...result };
    const value = rec(result.data);
    if (verifiedGlobalFutureReady(value) && String(value.trade_date ?? "") === tradeDate) return { product, trade_date: tradeDate, ...result };
    if (String(value.error ?? "") === "DATA_NOT_FOUND") continue;
    return { product, trade_date: tradeDate, ok: true as const, data: value, error: value.error ? String(value.error) : "GLOBAL_FUTURES_NOT_VERIFIED_READY" };
  }
  return { product, trade_date: null, ok: true as const, data: { ok: false, blocked: true, status: "UNAVAILABLE", error: "DATA_NOT_FOUND" }, error: null };
}

export async function readFamilyMarketRegimeContext(
  env: Env,
  input: { as_of_date: string; question?: string; intent?: FamilyReadIntent },
) {
  const rpc = service(env);
  if (!rpc) {
    return {
      txf_context: governedContext(null, "OHLC_MCP_TXF_READ", "OHLC_READ_SERVICE_NOT_BOUND"),
      global_futures_context: governedContext(null, "OHLC_MCP_GLOBAL_FUTURES_READ", "OHLC_READ_SERVICE_NOT_BOUND"),
    };
  }
  const question = String(input.question ?? "");
  const intent = input.intent ?? "";
  const asOf = String(input.as_of_date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return {
      txf_context: governedContext(null, "OHLC_MCP_TXF_READ", "INVALID_AS_OF_DATE"),
      global_futures_context: governedContext(null, "OHLC_MCP_GLOBAL_FUTURES_READ", "INVALID_AS_OF_DATE"),
    };
  }
  if (!shouldUseFamilyRegimeContext(question, intent)) {
    return {
      txf_context: governedContext(null, "OHLC_MCP_TXF_READ", "NOT_REQUIRED_BY_ADAPTIVE_PLAN"),
      global_futures_context: governedContext(null, "OHLC_MCP_GLOBAL_FUTURES_READ", "NOT_REQUIRED_BY_ADAPTIVE_PLAN"),
    };
  }

  const [txfCall, futuresCalls] = await Promise.all([
    safeRpc("OHLC_MCP_TXF_READ", () => rpc.readTxfOhlc({ timeframe: "5m", trade_date: asOf, lookback_days: 7, limit: 180 })),
    Promise.all(globalFutureProducts(intent, question).map((product) => readGlobalFutureAsOf(rpc, product, asOf))),
  ]);
  const txfContext = txfCall.ok ? governedContext(txfCall.data, "OHLC_MCP_TXF_READ") : governedContext(null, "OHLC_MCP_TXF_READ", txfCall.error);
  const successful = futuresCalls
    .filter((item) => item.ok && verifiedGlobalFutureReady(item.data) && String(rec(item.data).trade_date ?? "") === String(item.trade_date ?? ""))
    .map((item) => ({ product: item.product, ...rec(item.data) }));
  const failures = futuresCalls
    .filter((item) => !(item.ok && verifiedGlobalFutureReady(item.data) && String(rec(item.data).trade_date ?? "") === String(item.trade_date ?? "")))
    .map((item) => ({ product: item.product, error: item.error ?? rec(item.data).error ?? "GLOBAL_FUTURES_NOT_VERIFIED_READY" }));
  const products = globalFutureProducts(intent, question);
  const globalRaw = successful.length ? {
    ok: true, blocked: false, status: failures.length ? "DEGRADED" : "READY", source: "OHLC_MCP_GLOBAL_FUTURES_READ",
    verification_level: "VERIFIED_CANONICAL_CONTEXT", formal_research_eligible: false,
    trade_date: successful.map((item) => String(item.trade_date ?? "")).filter(Boolean).sort().at(-1) ?? null,
    products: successful, failures, requested_products: products, requested_as_of_date: asOf,
  } : {
    ok: false, blocked: true, status: "UNAVAILABLE", source: "OHLC_MCP_GLOBAL_FUTURES_READ", verification_level: "NOT_VERIFIED",
    trade_date: null, products: [], failures, requested_products: products, requested_as_of_date: asOf,
    error: failures.map((item) => `${item.product}:${item.error}`).join("; ") || "global_futures_unavailable",
  };
  return {
    txf_context: txfContext,
    global_futures_context: governedContext(globalRaw, "OHLC_MCP_GLOBAL_FUTURES_READ"),
  };
}
