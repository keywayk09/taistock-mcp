type PipelineMode = "close" | "repair";

declare global {
  interface Env {
    RESEARCH_DB: D1Database;
    RESEARCH_MAX_SYMBOLS?: string;
    RESEARCH_MAX_ONE_MINUTE?: string;
    RESEARCH_SYMBOLS?: string;
    MCP_API_KEY?: string;
  }
}

export const RESEARCH_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS research_runs (
    run_id TEXT PRIMARY KEY,
    trade_date TEXT NOT NULL,
    mode TEXT NOT NULL,
    source TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    selected_count INTEGER NOT NULL DEFAULT 0,
    fetched_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    summary_json TEXT,
    error_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_research_runs_date ON research_runs(trade_date, started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS research_universe (
    trade_date TEXT NOT NULL,
    symbol TEXT NOT NULL,
    market TEXT NOT NULL,
    name TEXT,
    close REAL,
    change_percent REAL,
    trade_volume REAL,
    trade_value REAL,
    range_percent REAL,
    selected_rank INTEGER,
    selected_reasons_json TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (trade_date, symbol)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_research_universe_rank ON research_universe(trade_date, selected_rank)`,
  `CREATE TABLE IF NOT EXISTS research_candle_sets (
    trade_date TEXT NOT NULL,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    source TEXT NOT NULL,
    bar_count INTEGER NOT NULL DEFAULT 0,
    first_time TEXT,
    last_time TEXT,
    missing_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    invalid_ohlc_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    error TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (trade_date, symbol, timeframe)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_research_candles_status ON research_candle_sets(trade_date, timeframe, status)`,
  `CREATE TABLE IF NOT EXISTS research_candle_payload_d1 (
    trade_date TEXT NOT NULL,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    content_sha256 TEXT,
    stored_at TEXT NOT NULL,
    PRIMARY KEY(trade_date, symbol, timeframe)
  )`,
  `CREATE TABLE IF NOT EXISTS engine_labels (
    id TEXT PRIMARY KEY,
    trade_date TEXT NOT NULL,
    symbol TEXT NOT NULL,
    event_time TEXT NOT NULL,
    strategy TEXT NOT NULL,
    side TEXT NOT NULL,
    price REAL,
    stage TEXT,
    reason_codes_json TEXT,
    payload_json TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_engine_labels_lookup ON engine_labels(trade_date, symbol, event_time)`,
  `CREATE TABLE IF NOT EXISTS research_cases (
    id TEXT PRIMARY KEY,
    trade_date TEXT NOT NULL,
    symbol TEXT NOT NULL,
    verdict TEXT NOT NULL,
    strategy TEXT,
    event_time TEXT,
    score REAL,
    mfe_r REAL,
    mae_r REAL,
    evidence_json TEXT,
    created_at TEXT NOT NULL
  )`,
] as const;

async function ensureSchema(env: Env) {
  if (!env.RESEARCH_DB) throw new Error("RESEARCH_DB 尚未綁定");
  await env.RESEARCH_DB.batch(RESEARCH_SCHEMA_SQL.map((sql) => env.RESEARCH_DB.prepare(sql)));
}

function taipeiDate(value = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export async function runResearchPipeline(env: Env, mode: PipelineMode, scheduledAt = new Date()) {
  await ensureSchema(env);
  return {
    ok:false,
    status:"DISABLED",
    trade_date:taipeiDate(scheduledAt),
    mode,
    policy:"OHLC_MCP_ONLY",
    storage:"D1_ONLY_NO_R2",
    message:"Legacy Fugle research candle ingestion is disabled. Formal OHLC must be read through OHLC MCP.",
  };
}

export async function getResearchStatus(env: Env) {
  await ensureSchema(env);
  const lastRun = await env.RESEARCH_DB.prepare(`
    SELECT run_id,trade_date,mode,source,started_at,finished_at,status,selected_count,fetched_count,failed_count,summary_json,error_json
    FROM research_runs ORDER BY started_at DESC LIMIT 1
  `).first<Record<string, unknown>>();
  const latestUniverse = await env.RESEARCH_DB.prepare(`
    SELECT trade_date,COUNT(*) AS symbol_count FROM research_universe GROUP BY trade_date ORDER BY trade_date DESC LIMIT 1
  `).first<Record<string, unknown>>();
  return {
    ok:true,
    status:"LEGACY_DISABLED",
    policy:"OHLC_MCP_ONLY",
    storage:"D1_ONLY_NO_R2",
    scheduled:false,
    latest_universe:latestUniverse ?? null,
    last_run:lastRun ?? null,
  };
}

export async function getStoredCandles(env: Env, tradeDate: string, symbol: string, timeframe: "1m" | "5m") {
  await ensureSchema(env);
  const metadata = await env.RESEARCH_DB.prepare(`
    SELECT trade_date,symbol,timeframe,source,bar_count,first_time,last_time,missing_count,duplicate_count,invalid_ohlc_count,status,error,updated_at
    FROM research_candle_sets WHERE trade_date=? AND symbol=? AND timeframe=?
  `).bind(tradeDate, symbol, timeframe).first<Record<string, unknown>>();
  const payload = await env.RESEARCH_DB.prepare(`
    SELECT payload_json,content_sha256,stored_at FROM research_candle_payload_d1
    WHERE trade_date=? AND symbol=? AND timeframe=?
  `).bind(tradeDate, symbol, timeframe).first<Record<string, unknown>>();
  if (!payload?.payload_json) {
    return {
      found:false,
      storage:"D1_ONLY_NO_R2",
      metadata:metadata ?? null,
      policy:"LEGACY_DATA_ONLY; FORMAL_OHLC_USE_OHLC_MCP",
    };
  }
  let data:unknown = null;
  try { data = JSON.parse(String(payload.payload_json)); } catch {}
  return {
    found:data !== null,
    storage:"D1_ONLY_NO_R2",
    metadata:{ ...(metadata ?? {}), content_sha256:payload.content_sha256, stored_at:payload.stored_at },
    data,
    policy:"LEGACY_DATA_ONLY; FORMAL_OHLC_USE_OHLC_MCP",
  };
}

export function isAuthorizedResearchRequest(request: Request, env: Env): boolean {
  if (!env.MCP_API_KEY) return false;
  return request.headers.get("x-api-key") === env.MCP_API_KEY || request.headers.get("authorization") === `Bearer ${env.MCP_API_KEY}`;
}
