export const FAMILY_OHLC_READ_BRIDGE_VERSION = "family-ohlc-read-bridge/v1.0.0";

type AnyRecord = Record<string, any>;

type FamilyOhlcReadService = {
  readOhlc(args?: AnyRecord): Promise<any>;
  readTxfOhlc(args?: AnyRecord): Promise<any>;
  getTxfOhlcStatus(args?: AnyRecord): Promise<any>;
  readGlobalOhlc(args?: AnyRecord): Promise<any>;
  readGlobalFuturesOhlc(args?: AnyRecord): Promise<any>;
  getGlobalFuturesStatus(args?: AnyRecord): Promise<any>;
};

type FamilyReadIntent =
  | "QUICK_STOCK_QUESTION"
  | "FULL_STOCK_ANALYSIS"
  | "STOCK_COMPARE"
  | "SWING_DISCOVERY"
  | "MARKET_CONTEXT"
  | "OPEN_RESEARCH"
  | string;

function rec(value: unknown): AnyRecord {
  return value !== null && typeof value === "object" ? value as AnyRecord : {};
}

function service(env: Env): FamilyOhlcReadService | null {
  const candidate = (env as any)?.OHLC_READ_SERVICE;
  return candidate && typeof candidate.readOhlc === "function" ? candidate as FamilyOhlcReadService : null;
}

function subtractDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
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
  const dataset = rec(value.dataset);
  const datasetProvenance = rec(dataset.provenance);
  return String(
    value.verification_level
      ?? provenance.verification_level
      ?? datasetProvenance.verification_level
      ?? rec(value.quality).verification_level
      ?? fallback,
  );
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
  if (!/^\d{4,6}$/.test(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return canonicalUnavailable("INVALID_FAMILY_OHLC_REQUEST");
  }

  const dailyCall = await safeRpc("OHLC_MCP_READ_1D", () => rpc.readOhlc({
    symbol,
    timeframe: "1d",
    mode: "research",
    from: subtractDays(asOf, 280),
    to: asOf,
    limit: 420,
  }));
  if (!dailyCall.ok) return canonicalUnavailable(dailyCall.error);

  const daily = compactOhlcResult(dailyCall.data);
  const dailyFormal = daily.ok
    && !daily.blocked
    && daily.formal_research_eligible
    && daily.dataset_complete_view
    && Boolean(daily.dataset_version);
  if (!dailyFormal) {
    return canonicalUnavailable(
      String(rec(dailyCall.data).error ?? rec(dailyCall.data).data_status ?? "OHLC_MCP_FORMAL_GATE_NOT_READY"),
    );
  }

  let intraday5m: ReturnType<typeof compactOhlcResult> | null = null;
  if (shouldUseFamilyIntradayContext(input.question ?? "", input.intent ?? "")) {
    const intradayCall = await safeRpc("OHLC_MCP_READ_5M", () => rpc.readOhlc({
      symbol,
      timeframe: "5m",
      mode: "research",
      from: subtractDays(asOf, 10),
      to: asOf,
      limit: 2000,
    }));
    if (intradayCall.ok) {
      const candidate = compactOhlcResult(intradayCall.data);
      if (
        candidate.ok
        && !candidate.blocked
        && candidate.formal_research_eligible
        && candidate.dataset_complete_view
        && Boolean(candidate.dataset_version)
      ) intraday5m = candidate;
    }
  }

  return {
    status: "READY",
    source: "OHLC_MCP",
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

function governedContext(raw: unknown, source: string, error: string | null = null) {
  const value = rec(raw);
  const ready = value.ok === true && value.blocked !== true && (Array.isArray(value.rows) ? value.rows.length > 0 : true);
  return {
    status: ready ? "READY" : "UNAVAILABLE",
    source,
    formal_research_eligible: false,
    verification_level: ready ? verificationLevel(value, "GOVERNED_READ_ONLY") : "NOT_ATTACHED_OR_UNAVAILABLE",
    dataset_version: value.dataset_version ?? null,
    provenance: value.provenance ?? null,
    data_as_of: value.as_of ?? value.trade_date ?? value.resolved_date ?? null,
    data: ready ? value : null,
    error: error ?? (ready ? null : String(value.error ?? value.status ?? "unavailable")),
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
  if (!shouldUseFamilyRegimeContext(question, intent)) {
    return {
      txf_context: governedContext(null, "OHLC_MCP_TXF_READ", "NOT_REQUIRED_BY_ADAPTIVE_PLAN"),
      global_futures_context: governedContext(null, "OHLC_MCP_GLOBAL_FUTURES_READ", "NOT_REQUIRED_BY_ADAPTIVE_PLAN"),
    };
  }

  const txfPromise = safeRpc("OHLC_MCP_TXF_READ", () => rpc.readTxfOhlc({
    timeframe: "5m",
    lookback_days: 7,
    limit: 180,
  }));
  const products = globalFutureProducts(intent, question);
  const futuresPromise = Promise.all(products.map(async (product) => {
    const result = await safeRpc(`OHLC_MCP_GLOBAL_FUTURES_${product}`, () => rpc.readGlobalFuturesOhlc({
      product,
      timeframe: "5m",
      lookback_days: 14,
      limit: 120,
    }));
    return { product, ...result };
  }));

  const [txfCall, futuresCalls] = await Promise.all([txfPromise, futuresPromise]);
  const txfContext = txfCall.ok
    ? governedContext(txfCall.data, "OHLC_MCP_TXF_READ")
    : governedContext(null, "OHLC_MCP_TXF_READ", txfCall.error);

  const successful = futuresCalls
    .filter((item) => item.ok && rec(item.data).ok === true && rec(item.data).blocked !== true)
    .map((item) => ({ product: item.product, ...rec(item.data) }));
  const failures = futuresCalls
    .filter((item) => !(item.ok && rec(item.data).ok === true && rec(item.data).blocked !== true))
    .map((item) => ({ product: item.product, error: item.error ?? rec(item.data).error ?? "unavailable" }));

  const globalFuturesRaw = successful.length > 0 ? {
    ok: true,
    blocked: false,
    status: failures.length ? "DEGRADED" : "READY",
    source: "OHLC_MCP_GLOBAL_FUTURES_READ",
    verification_level: "VERIFIED_CANONICAL_CONTEXT_WHEN_AVAILABLE",
    formal_research_eligible: false,
    products: successful,
    failures,
    requested_products: products,
  } : {
    ok: false,
    blocked: true,
    status: "UNAVAILABLE",
    source: "OHLC_MCP_GLOBAL_FUTURES_READ",
    products: [],
    failures,
    requested_products: products,
    error: failures.map((item) => `${item.product}:${item.error}`).join("; ") || "global_futures_unavailable",
  };

  return {
    txf_context: txfContext,
    global_futures_context: governedContext(globalFuturesRaw, "OHLC_MCP_GLOBAL_FUTURES_READ"),
  };
}
