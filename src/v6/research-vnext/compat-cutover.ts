export const RESEARCH_VNEXT_COMPAT_CUTOVER_VERSION =
  "research-vnext-compat-cutover/v1.0.0" as const;

export type ResearchVNextCompatCapability =
  | "review.summary"
  | "swing.rank"
  | "replay.resolve";

type GatewaySuccess = {
  ok: true;
  capability: string;
  value: unknown;
};

type GatewayFailure = {
  ok: false;
  capability: string;
  error: {
    code: string;
    message: string;
  };
};

type CompatGateway = {
  invoke(capability: string, input: unknown): Promise<GatewaySuccess | GatewayFailure>;
};

export type ResearchVNextCompatCutoverOptions = {
  loadGateway?: () => CompatGateway | Promise<CompatGateway>;
};

type LegacyFallback<T> = () => T | Promise<T>;

export type ResearchVNextCompatCutoverLike = {
  reviewSummary<T>(rows: unknown[], legacyFallback: LegacyFallback<T>): Promise<T>;
  swingRank<T>(signals: unknown[], limit: number, legacyFallback: LegacyFallback<T>): Promise<T>;
  replayResolve<T>(input: unknown, legacyFallback: LegacyFallback<T>): Promise<T>;
};

export type ResearchVNextCompatRegistrationOptions = {
  cutover?: ResearchVNextCompatCutoverLike;
};

type RegistrationServer = {
  registerTool: (...args: any[]) => any;
};

type ToolHandler = (...args: any[]) => any;

type JsonRecord = Record<string, any>;

const COMPAT_HANDLER_NAMES = new Set([
  "resolve_ambiguous_backtest_with_1m",
  "finalize_daily_review_run",
  "prepare_swing_selection_run",
]);

const LEGACY_RESPONSE = Symbol("research-vnext-legacy-response");

type LegacyResponseBox = {
  [LEGACY_RESPONSE]: true;
  response: unknown;
};

async function defaultLoadGateway(): Promise<CompatGateway> {
  const module = await import("./research-gateway.ts");
  return module.createResearchVNextGateway() as CompatGateway;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  return value;
}

function semanticEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function parseTextBody(response: unknown): JsonRecord | null {
  if (!isRecord(response) || response.isError === true || !Array.isArray(response.content)) return null;
  for (const item of response.content) {
    if (!isRecord(item) || item.type !== "text" || typeof item.text !== "string") continue;
    try {
      const parsed = JSON.parse(item.text);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function replaceTextBody(response: unknown, body: JsonRecord): unknown {
  if (!isRecord(response) || !Array.isArray(response.content)) return response;
  const content = response.content.map((item: unknown) => {
    if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
      return { ...item, text: JSON.stringify(body, null, 2) };
    }
    return item;
  });
  return { ...response, content };
}

function textResponse(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function stockMetric(row: unknown): JsonRecord | null {
  if (!isRecord(row) || !row.ok || row.status !== "OK") return null;
  return {
    market: "tw-stock",
    signal_id: String(row.signal_id),
    signal_version: String(row.signal_version),
    strategy: String(row.strategy ?? "UNSPECIFIED"),
    side: String(row.side),
    net_return_pct: Number(row.net_return_pct),
    mfe_pct: Number(row.mfe_pct),
    mae_pct: Number(row.mae_pct),
    ambiguous_intrabar: Boolean(row.ambiguous_intrabar),
    requires_1m_replay: Boolean(row.requires_1m_replay),
  };
}

function txfMetric(row: unknown): JsonRecord | null {
  if (!isRecord(row) || row.status !== "OK") return null;
  return {
    market: "txf",
    signal_id: String(row.signal_id),
    signal_version: String(row.signal_version),
    strategy: String(row.strategy ?? "UNSPECIFIED"),
    side: String(row.side),
    net_points: row.net_points === null ? Number(row.gross_points) : Number(row.net_points),
    mfe_points: Number(row.mfe_points),
    mae_points: Number(row.mae_points),
    ambiguous_intrabar: Boolean(row.ambiguous_intrabar),
    requires_1m_replay: Boolean(row.requires_1m_replay),
  };
}

function swingSignalFromSelected(row: unknown): JsonRecord | null {
  if (!isRecord(row)) return null;
  return {
    signal_id: String(row.signal_id),
    signal_version: String(row.signal_version),
    symbol: String(row.symbol),
    trade_date: String(row.trade_date),
    side: String(row.side),
    strategy: String(row.strategy),
    stage: row.stage == null ? null : String(row.stage),
    signal_ts_ms: Number(row.signal_ts_ms),
    reason_codes: Array.isArray(row.reason_codes) ? row.reason_codes : [],
    payload: { swing_score: Number(row.score) },
  };
}

function isLegacyResponseBox(value: unknown): value is LegacyResponseBox {
  return Boolean(isRecord(value) && value[LEGACY_RESPONSE] === true);
}

export function createResearchVNextCompatCutover(
  options: ResearchVNextCompatCutoverOptions = {},
) {
  const loader = options.loadGateway ?? defaultLoadGateway;
  let gatewayPromise: Promise<CompatGateway> | null = null;

  function loadGateway(): Promise<CompatGateway> {
    if (!gatewayPromise) gatewayPromise = Promise.resolve().then(() => loader());
    return gatewayPromise;
  }

  async function invokeWithFallback<T>(
    capability: ResearchVNextCompatCapability,
    input: unknown,
    legacyFallback: LegacyFallback<T>,
  ): Promise<T> {
    try {
      const gateway = await loadGateway();
      const result = await gateway.invoke(capability, input);
      if (result.ok) return result.value as T;
    } catch {
      // Availability protection only. The proven Legacy path stays available
      // until Production cutover and post-deploy validation finish.
    }
    return await legacyFallback();
  }

  return {
    contract() {
      return {
        schema: "RESEARCH_VNEXT_COMPAT_CUTOVER_CONTRACT_V1" as const,
        version: RESEARCH_VNEXT_COMPAT_CUTOVER_VERSION,
        runtime_mode: "COMPAT_CUTOVER_UNREGISTERED" as const,
        reasoning_owner: "GPT" as const,
        vnext_role: "PRIMARY_DETERMINISTIC" as const,
        legacy_role: "FALLBACK_ONLY" as const,
        eligible_capabilities: [
          "review.summary",
          "swing.rank",
          "replay.resolve",
        ] as const,
        loader: "LAZY_CACHED" as const,
        direct_provider_access: "FORBIDDEN" as const,
        ohlc_write: "FORBIDDEN" as const,
        automatic_strategy_promotion: "FORBIDDEN" as const,
        public_abi_change: "FORBIDDEN" as const,
      };
    },

    reviewSummary<T>(rows: unknown[], legacyFallback: LegacyFallback<T>) {
      return invokeWithFallback<T>("review.summary", { rows }, legacyFallback);
    },

    swingRank<T>(
      signals: unknown[],
      limit: number,
      legacyFallback: LegacyFallback<T>,
    ) {
      return invokeWithFallback<T>(
        "swing.rank",
        { signals, limit },
        legacyFallback,
      );
    },

    replayResolve<T>(input: unknown, legacyFallback: LegacyFallback<T>) {
      return invokeWithFallback<T>(
        "replay.resolve",
        { input },
        legacyFallback,
      );
    },
  };
}

async function wrapReplayHandler(
  cutover: ResearchVNextCompatCutoverLike,
  legacyHandler: ToolHandler,
  args: any[],
) {
  const result = await cutover.replayResolve<unknown | LegacyResponseBox>(
    args[0],
    async () => ({
      [LEGACY_RESPONSE]: true,
      response: await legacyHandler(...args),
    }),
  );
  if (isLegacyResponseBox(result)) return result.response;
  return textResponse(result);
}

async function wrapDailyReviewHandler(
  cutover: ResearchVNextCompatCutoverLike,
  legacyHandler: ToolHandler,
  args: any[],
) {
  const legacyResponse = await legacyHandler(...args);
  const body = parseTextBody(legacyResponse);
  if (!body || !isRecord(body.summary)) return legacyResponse;

  const stockRows = (Array.isArray(body.stock_results) ? body.stock_results : [])
    .map(stockMetric)
    .filter((row): row is JsonRecord => row !== null);
  const txfRows = (Array.isArray(body.txf_results) ? body.txf_results : [])
    .map(txfMetric)
    .filter((row): row is JsonRecord => row !== null);

  const legacyStock = body.summary.stock;
  const legacyTxf = body.summary.txf;
  const vnextStock = await cutover.reviewSummary(stockRows, async () => legacyStock);
  const vnextTxf = await cutover.reviewSummary(txfRows, async () => legacyTxf);

  // The cutover is fail-closed on unexpected drift. Phase 2 proves strict
  // parity for this lane; a mismatch keeps the original public response.
  if (!semanticEqual(vnextStock, legacyStock) || !semanticEqual(vnextTxf, legacyTxf)) {
    return legacyResponse;
  }

  return replaceTextBody(legacyResponse, {
    ...body,
    summary: {
      ...body.summary,
      stock: vnextStock,
      txf: vnextTxf,
    },
  });
}

async function wrapSwingSelectionHandler(
  cutover: ResearchVNextCompatCutoverLike,
  legacyHandler: ToolHandler,
  args: any[],
) {
  const legacyResponse = await legacyHandler(...args);
  const body = parseTextBody(legacyResponse);
  if (!body || !Array.isArray(body.selected)) return legacyResponse;

  const legacySelected = body.selected;
  const signals = legacySelected
    .map(swingSignalFromSelected)
    .filter((row): row is JsonRecord => row !== null);
  const vnextSelected = await cutover.swingRank(
    signals,
    Math.max(1, legacySelected.length),
    async () => legacySelected,
  );

  // Phase 3 freezes ranking semantics. Any unexpected mismatch keeps the
  // original selection snapshot instead of silently changing trading meaning.
  if (!semanticEqual(vnextSelected, legacySelected)) return legacyResponse;

  return replaceTextBody(legacyResponse, {
    ...body,
    selected: vnextSelected,
  });
}

function wrapTargetHandler(
  name: string,
  handler: ToolHandler,
  cutover: ResearchVNextCompatCutoverLike,
): ToolHandler {
  if (name === "resolve_ambiguous_backtest_with_1m") {
    return (...args: any[]) => wrapReplayHandler(cutover, handler, args);
  }
  if (name === "finalize_daily_review_run") {
    return (...args: any[]) => wrapDailyReviewHandler(cutover, handler, args);
  }
  if (name === "prepare_swing_selection_run") {
    return (...args: any[]) => wrapSwingSelectionHandler(cutover, handler, args);
  }
  return handler;
}

/**
 * Internal Phase 10B registration adapter.
 *
 * It does not register new tool names. It preserves the original registration
 * config object byte-for-byte and replaces only three parity-proven handlers.
 * All unrelated handlers, including GPT Memory and swing outcome summary, are
 * passed through untouched.
 */
export function createResearchVNextCompatRegistrationServer<T extends RegistrationServer>(
  server: T,
  options: ResearchVNextCompatRegistrationOptions = {},
): T {
  const cutover = options.cutover ?? createResearchVNextCompatCutover();

  return new Proxy(server, {
    get(target, property, receiver) {
      if (property !== "registerTool") return Reflect.get(target, property, receiver);

      return (...args: any[]) => {
        const name = String(args[0] ?? "");
        if (!COMPAT_HANDLER_NAMES.has(name)) {
          return Reflect.apply(target.registerTool, target, args);
        }

        let handlerIndex = -1;
        for (let index = args.length - 1; index >= 0; index -= 1) {
          if (typeof args[index] === "function") {
            handlerIndex = index;
            break;
          }
        }
        if (handlerIndex < 0) return Reflect.apply(target.registerTool, target, args);

        const nextArgs = [...args];
        nextArgs[handlerIndex] = wrapTargetHandler(name, args[handlerIndex] as ToolHandler, cutover);
        return Reflect.apply(target.registerTool, target, nextArgs);
      };
    },
  }) as T;
}
