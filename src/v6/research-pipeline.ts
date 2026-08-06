type PipelineMode = "close" | "repair";
type Timeframe = "1" | "5";
type JsonObject = Record<string, unknown>;

declare global {
  interface Env {
    RESEARCH_DB: D1Database;
    RESEARCH_BUCKET: R2Bucket;
    RESEARCH_MAX_SYMBOLS?: string;
    RESEARCH_MAX_ONE_MINUTE?: string;
    RESEARCH_SYMBOLS?: string;
    MCP_API_KEY?: string;
  }
}

const FUGLE_ROOT = "https://api.fugle.tw/marketdata/v1.0/stock";
const DEFAULT_WATCHLIST = ["2330", "2337", "2408", "2454", "3081", "3481", "5347", "6147", "6196"];

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
    r2_key TEXT,
    status TEXT NOT NULL,
    error TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (trade_date, symbol, timeframe)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_research_candles_status ON research_candle_sets(trade_date, timeframe, status)`,
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
];

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

function taipeiDate(value = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function iso(value: unknown): string {
  const raw = String(value ?? "");
  if (!raw) return raw;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
}

function parseInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

async function fugleJson(env: Env, path: string, query: Record<string, string> = {}): Promise<any> {
  if (!env.FUGLE_API_KEY) throw new Error("FUGLE_API_KEY 尚未設定");
  const url = new URL(`${FUGLE_ROOT}${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-API-KEY": env.FUGLE_API_KEY },
  });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const message = record(body).message ?? record(body).error ?? text.slice(0, 200);
    throw new Error(`Fugle HTTP ${response.status}: ${String(message)}`);
  }
  return body;
}

function snapshotRows(body: unknown, market: "TSE" | "OTC") {
  const root = record(body);
  const rows = Array.isArray(root.data) ? root.data : Array.isArray(body) ? body : [];
  return rows.map((item: unknown) => {
    const row = record(item);
    const open = numberValue(row.openPrice ?? row.open);
    const high = numberValue(row.highPrice ?? row.high);
    const low = numberValue(row.lowPrice ?? row.low);
    const close = numberValue(row.closePrice ?? row.close ?? row.lastPrice);
    const rangePercent = open > 0 ? ((high - low) / open) * 100 : 0;
    return {
      symbol: String(row.symbol ?? "").trim(),
      market,
      name: String(row.name ?? ""),
      open,
      high,
      low,
      close,
      changePercent: numberValue(row.changePercent),
      tradeVolume: numberValue(row.tradeVolume),
      tradeValue: numberValue(row.tradeValue),
      rangePercent,
      raw: row,
    };
  }).filter((row) => /^\d{4,6}$/.test(row.symbol) && row.close > 0);
}

type Snapshot = ReturnType<typeof snapshotRows>[number];

function selectCandidates(rows: Snapshot[], env: Env): Array<Snapshot & { reasons: string[]; rank: number }> {
  const maxSymbols = parseInteger(env.RESEARCH_MAX_SYMBOLS, 40, 10, 45);
  const watchlist = new Set([
    ...DEFAULT_WATCHLIST,
    ...(env.RESEARCH_SYMBOLS ?? "").split(",").map((x) => x.trim()).filter(Boolean),
  ]);
  const selected = new Map<string, { row: Snapshot; reasons: Set<string> }>();
  const add = (row: Snapshot, reason: string) => {
    const current = selected.get(row.symbol) ?? { row, reasons: new Set<string>() };
    current.reasons.add(reason);
    selected.set(row.symbol, current);
  };
  rows.filter((x) => watchlist.has(x.symbol)).forEach((x) => add(x, "watchlist"));
  [...rows].sort((a, b) => b.tradeValue - a.tradeValue).slice(0, Math.ceil(maxSymbols * 0.55)).forEach((x) => add(x, "top_trade_value"));
  [...rows].sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)).slice(0, Math.ceil(maxSymbols * 0.25)).forEach((x) => add(x, "high_absolute_change"));
  [...rows].sort((a, b) => b.rangePercent - a.rangePercent).slice(0, Math.ceil(maxSymbols * 0.25)).forEach((x) => add(x, "high_intraday_range"));
  return [...selected.values()]
    .sort((a, b) => b.row.tradeValue - a.row.tradeValue)
    .slice(0, maxSymbols)
    .map((item, index) => ({ ...item.row, reasons: [...item.reasons], rank: index + 1 }));
}

function normalizeCandles(body: unknown) {
  const root = record(body);
  const rows = Array.isArray(root.data) ? root.data : [];
  return rows.map((item: unknown) => {
    const row = record(item);
    return {
      time: iso(row.date ?? row.time ?? row.timestamp),
      open: numberValue(row.open),
      high: numberValue(row.high),
      low: numberValue(row.low),
      close: numberValue(row.close),
      volume: numberValue(row.volume),
      average: numberValue(row.average),
    };
  }).filter((bar) => bar.time && bar.close > 0).sort((a, b) => a.time.localeCompare(b.time));
}

function validateCandles(bars: ReturnType<typeof normalizeCandles>, timeframe: Timeframe) {
  const step = timeframe === "1" ? 60_000 : 300_000;
  const seen = new Set<string>();
  let duplicates = 0;
  let invalid = 0;
  let missing = 0;
  let previous = 0;
  for (const bar of bars) {
    if (seen.has(bar.time)) duplicates += 1;
    seen.add(bar.time);
    if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.low > bar.high) invalid += 1;
    const current = new Date(bar.time).getTime();
    if (previous && current - previous > step * 1.5) missing += Math.max(0, Math.round((current - previous) / step) - 1);
    previous = current;
  }
  return {
    barCount: bars.length,
    firstTime: bars.at(0)?.time ?? null,
    lastTime: bars.at(-1)?.time ?? null,
    missingCount: missing,
    duplicateCount: duplicates,
    invalidOhlcCount: invalid,
    status: bars.length > 0 && invalid === 0 ? (missing > 2 ? "incomplete" : "ok") : "failed",
  };
}

async function ensureSchema(env: Env) {
  await env.RESEARCH_DB.batch(RESEARCH_SCHEMA_SQL.map((sql) => env.RESEARCH_DB.prepare(sql)));
}

async function putJson(env: Env, key: string, value: unknown) {
  await env.RESEARCH_BUCKET.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { source: "Fugle", storedAt: new Date().toISOString() },
  });
}

async function saveUniverse(env: Env, tradeDate: string, selected: ReturnType<typeof selectCandidates>) {
  const now = new Date().toISOString();
  const statements = selected.map((row) => env.RESEARCH_DB.prepare(`
    INSERT INTO research_universe (
      trade_date, symbol, market, name, close, change_percent, trade_volume,
      trade_value, range_percent, selected_rank, selected_reasons_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(trade_date, symbol) DO UPDATE SET
      market=excluded.market, name=excluded.name, close=excluded.close,
      change_percent=excluded.change_percent, trade_volume=excluded.trade_volume,
      trade_value=excluded.trade_value, range_percent=excluded.range_percent,
      selected_rank=excluded.selected_rank, selected_reasons_json=excluded.selected_reasons_json,
      updated_at=excluded.updated_at
  `).bind(tradeDate, row.symbol, row.market, row.name, row.close, row.changePercent,
    row.tradeVolume, row.tradeValue, row.rangePercent, row.rank, JSON.stringify(row.reasons), now));
  for (let i = 0; i < statements.length; i += 50) await env.RESEARCH_DB.batch(statements.slice(i, i + 50));
}

async function saveCandleResult(env: Env, tradeDate: string, symbol: string, timeframe: Timeframe,
  bars: ReturnType<typeof normalizeCandles>, error?: string) {
  const quality = validateCandles(bars, timeframe);
  const key = `fugle/candles/${tradeDate}/${timeframe}m/${symbol}.json`;
  if (bars.length) await putJson(env, key, { source: "Fugle", tradeDate, symbol, timeframe: `${timeframe}m`, bars, quality });
  const status = error ? "failed" : quality.status;
  await env.RESEARCH_DB.prepare(`
    INSERT INTO research_candle_sets (
      trade_date, symbol, timeframe, source, bar_count, first_time, last_time,
      missing_count, duplicate_count, invalid_ohlc_count, r2_key, status, error, updated_at
    ) VALUES (?, ?, ?, 'Fugle', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(trade_date, symbol, timeframe) DO UPDATE SET
      bar_count=excluded.bar_count, first_time=excluded.first_time, last_time=excluded.last_time,
      missing_count=excluded.missing_count, duplicate_count=excluded.duplicate_count,
      invalid_ohlc_count=excluded.invalid_ohlc_count, r2_key=excluded.r2_key,
      status=excluded.status, error=excluded.error, updated_at=excluded.updated_at
  `).bind(tradeDate, symbol, `${timeframe}m`, quality.barCount, quality.firstTime, quality.lastTime,
    quality.missingCount, quality.duplicateCount, quality.invalidOhlcCount,
    bars.length ? key : null, status, error ?? null, new Date().toISOString()).run();
  return { symbol, timeframe: `${timeframe}m`, ...quality, status, error: error ?? null, r2Key: bars.length ? key : null };
}

async function fetchAndStoreCandles(env: Env, tradeDate: string, symbol: string, timeframe: Timeframe) {
  try {
    const body = await fugleJson(env, `/intraday/candles/${encodeURIComponent(symbol)}`, { timeframe, sort: "asc" });
    return await saveCandleResult(env, tradeDate, symbol, timeframe, normalizeCandles(body));
  } catch (error) {
    return saveCandleResult(env, tradeDate, symbol, timeframe, [], error instanceof Error ? error.message : String(error));
  }
}

async function symbolsForRepair(env: Env, tradeDate: string): Promise<string[]> {
  const result = await env.RESEARCH_DB.prepare(`
    SELECT symbol FROM research_candle_sets
    WHERE trade_date = ? AND timeframe = '5m' AND status != 'ok'
    ORDER BY symbol
  `).bind(tradeDate).all<{ symbol: string }>();
  return result.results.map((row) => row.symbol);
}

async function topSymbols(env: Env, tradeDate: string, limit: number): Promise<string[]> {
  const result = await env.RESEARCH_DB.prepare(`
    SELECT symbol FROM research_universe WHERE trade_date = ? ORDER BY selected_rank LIMIT ?
  `).bind(tradeDate, limit).all<{ symbol: string }>();
  return result.results.map((row) => row.symbol);
}

export async function runResearchPipeline(env: Env, mode: PipelineMode, scheduledAt = new Date()) {
  if (!env.RESEARCH_DB || !env.RESEARCH_BUCKET) throw new Error("RESEARCH_DB 或 RESEARCH_BUCKET 尚未綁定");
  await ensureSchema(env);
  const tradeDate = taipeiDate(scheduledAt);
  const startedAt = new Date().toISOString();
  const runId = `${tradeDate}:${mode}:${startedAt}`;
  await env.RESEARCH_DB.prepare(`
    INSERT INTO research_runs (run_id, trade_date, mode, source, started_at, status)
    VALUES (?, ?, ?, 'Fugle', ?, 'running')
  `).bind(runId, tradeDate, mode, startedAt).run();

  try {
    let symbols: string[] = [];
    let selectedCount = 0;
    if (mode === "close") {
      const [tseBody, otcBody] = await Promise.all([
        fugleJson(env, "/snapshot/quotes/TSE", { type: "COMMONSTOCK" }),
        fugleJson(env, "/snapshot/quotes/OTC", { type: "COMMONSTOCK" }),
      ]);
      await Promise.all([
        putJson(env, `fugle/snapshots/${tradeDate}/TSE.json`, tseBody),
        putJson(env, `fugle/snapshots/${tradeDate}/OTC.json`, otcBody),
      ]);
      const universe = [...snapshotRows(tseBody, "TSE"), ...snapshotRows(otcBody, "OTC")];
      const selected = selectCandidates(universe, env);
      selectedCount = selected.length;
      symbols = selected.map((row) => row.symbol);
      await saveUniverse(env, tradeDate, selected);
      await putJson(env, `research/universe/${tradeDate}/selected.json`, { tradeDate, selected, totalSnapshotRows: universe.length });
    } else {
      const repair = await symbolsForRepair(env, tradeDate);
      symbols = repair.length ? repair.slice(0, 35) : await topSymbols(env, tradeDate, 8);
      selectedCount = symbols.length;
    }

    const fiveMinute = await Promise.all(symbols.map((symbol) => fetchAndStoreCandles(env, tradeDate, symbol, "5")));
    let oneMinute: Awaited<ReturnType<typeof fetchAndStoreCandles>>[] = [];
    if (mode === "repair") {
      const limit = parseInteger(env.RESEARCH_MAX_ONE_MINUTE, 8, 0, 12);
      const oneMinuteSymbols = await topSymbols(env, tradeDate, limit);
      oneMinute = await Promise.all(oneMinuteSymbols.map((symbol) => fetchAndStoreCandles(env, tradeDate, symbol, "1")));
    }
    const all = [...fiveMinute, ...oneMinute];
    const failed = all.filter((item) => item.status === "failed");
    const incomplete = all.filter((item) => item.status === "incomplete");
    const summary = { tradeDate, mode, selectedCount, fiveMinute, oneMinute, failed: failed.length, incomplete: incomplete.length };
    await putJson(env, `research/runs/${tradeDate}/${runId.replaceAll(":", "-")}.json`, summary);
    await env.RESEARCH_DB.prepare(`
      UPDATE research_runs SET finished_at=?, status=?, selected_count=?, fetched_count=?, failed_count=?, summary_json=?
      WHERE run_id=?
    `).bind(new Date().toISOString(), failed.length ? "partial" : "ok", selectedCount, all.length,
      failed.length, JSON.stringify({ incomplete: incomplete.length }), runId).run();
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.RESEARCH_DB.prepare(`
      UPDATE research_runs SET finished_at=?, status='failed', error_json=? WHERE run_id=?
    `).bind(new Date().toISOString(), JSON.stringify({ message }), runId).run();
    throw error;
  }
}

export async function getResearchStatus(env: Env) {
  await ensureSchema(env);
  const lastRun = await env.RESEARCH_DB.prepare(`
    SELECT run_id, trade_date, mode, started_at, finished_at, status,
           selected_count, fetched_count, failed_count, summary_json, error_json
    FROM research_runs ORDER BY started_at DESC LIMIT 1
  `).first();
  return {
    service: "TRAI Cloudflare Research Pipeline",
    bindings: { d1: Boolean(env.RESEARCH_DB), r2: Boolean(env.RESEARCH_BUCKET), fugle: Boolean(env.FUGLE_API_KEY) },
    schedule: { close: "13:40 Asia/Taipei weekdays", repair: "13:55 Asia/Taipei weekdays" },
    lastRun,
  };
}

export async function getStoredCandles(env: Env, tradeDate: string, symbol: string, timeframe: "1m" | "5m") {
  const row = await env.RESEARCH_DB.prepare(`
    SELECT r2_key, status, bar_count, missing_count, duplicate_count, invalid_ohlc_count, error
    FROM research_candle_sets WHERE trade_date=? AND symbol=? AND timeframe=?
  `).bind(tradeDate, symbol, timeframe).first<Record<string, unknown>>();
  if (!row?.r2_key) return { found: false, metadata: row ?? null };
  const object = await env.RESEARCH_BUCKET.get(String(row.r2_key));
  return { found: Boolean(object), metadata: row, data: object ? await object.json() : null };
}

export function isAuthorizedResearchRequest(request: Request, env: Env): boolean {
  if (!env.MCP_API_KEY) return false;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return request.headers.get("x-api-key") === env.MCP_API_KEY || bearer === env.MCP_API_KEY;
}
