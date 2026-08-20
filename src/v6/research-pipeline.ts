type PipelineMode = "close" | "repair";

declare global {
  interface Env {
    RESEARCH_MAX_SYMBOLS?: string;
    RESEARCH_MAX_ONE_MINUTE?: string;
    RESEARCH_SYMBOLS?: string;
    MCP_API_KEY?: string;
  }
}

function taipeiDate(value = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export async function runResearchPipeline(_env: Env, mode: PipelineMode, scheduledAt = new Date()) {
  return {
    ok: false,
    status: "DISABLED",
    trade_date: taipeiDate(scheduledAt),
    mode,
    policy: "OHLC_MCP_ONLY",
    storage: "GITHUB_ONLY",
    persistence: "NONE_FOR_LEGACY_OHLC_PATH",
    message: "Legacy research candle ingestion is retired. Formal OHLC must be read through OHLC MCP; Diamond persistent data is GitHub-only.",
  };
}

export async function getResearchStatus(_env: Env) {
  return {
    ok: true,
    status: "LEGACY_DISABLED",
    policy: "OHLC_MCP_ONLY",
    storage: "GITHUB_ONLY",
    scheduled: false,
    latest_universe: null,
    last_run: null,
    message: "Legacy research ingestion state is retired; canonical Diamond persistence is GitHub diamond-data.",
  };
}

export async function getStoredCandles(_env: Env, tradeDate: string, symbol: string, timeframe: "1m" | "5m") {
  return {
    found: false,
    trade_date: tradeDate,
    symbol,
    timeframe,
    storage: "OHLC_MCP_ONLY",
    metadata: null,
    data: null,
    policy: "LEGACY_PATH_RETIRED; FORMAL_OHLC_USE_OHLC_MCP",
  };
}

export function isAuthorizedResearchRequest(request: Request, env: Env): boolean {
  if (!env.MCP_API_KEY) return false;
  return request.headers.get("x-api-key") === env.MCP_API_KEY || request.headers.get("authorization") === `Bearer ${env.MCP_API_KEY}`;
}
