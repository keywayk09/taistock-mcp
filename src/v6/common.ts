import { z } from "zod";

declare global {
  interface Env {
    FUGLE_API_KEY: string;
    FINMIND_TOKEN: string;
    DB?: D1Database;
  }
}

export type Obj = Record<string, any>;
export type DailyBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export const stockSchema = z.string().trim().min(1).max(20).regex(/^[0-9A-Za-z._-]+$/);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const watchlistNameSchema = z.string().trim().min(1).max(50);

export const ok = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export const fail = (error: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: `查詢失敗：${error instanceof Error ? error.message : String(error)}` }],
});

export function rec(value: unknown): Obj {
  return value !== null && typeof value === "object" ? value as Obj : {};
}

export function arr(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  const root = rec(value);
  return Array.isArray(root.data) ? root.data : [];
}

export function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

export function taipeiDate(daysAgo = 0): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() - daysAgo * 86_400_000));
}

export async function fetchJson(url: string | URL, init: RequestInit, source: string): Promise<any> {
  const started = Date.now();
  const response = await fetch(url, init);
  const text = await response.text();
  let body: any = text;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const root = rec(body);
    throw new Error(`${source} HTTP ${response.status}: ${String(root.message ?? root.msg ?? root.error ?? text.slice(0, 300))}`);
  }
  return { body, latency_ms: Date.now() - started };
}

export async function finmind(env: Env, dataset: string, params: Obj): Promise<any[]> {
  if (!env.FINMIND_TOKEN) throw new Error("FINMIND_TOKEN 尚未設定");
  const url = new URL("https://api.finmindtrade.com/api/v4/data");
  url.searchParams.set("dataset", dataset);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  const { body } = await fetchJson(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${env.FINMIND_TOKEN}` },
  }, `FinMind ${dataset}`);
  if (!Array.isArray(body?.data)) throw new Error(`FinMind ${dataset} 回傳缺少 data`);
  return body.data;
}

export async function fugle(env: Env, path: string, query: Obj = {}): Promise<any> {
  if (!env.FUGLE_API_KEY) throw new Error("FUGLE_API_KEY 尚未設定");
  const url = new URL(`https://api.fugle.tw/marketdata/v1.0/stock${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  const { body } = await fetchJson(url, {
    headers: { Accept: "application/json", "X-API-KEY": env.FUGLE_API_KEY },
  }, "Fugle");
  return body;
}

export function normalizeQuote(raw: unknown, requestedSymbol: string) {
  const root = rec(raw);
  const data = rec(root.data ?? raw);
  const total = rec(data.total);
  const lastTrade = rec(data.lastTrade);
  const open = num(data.openPrice ?? data.open);
  const high = num(data.highPrice ?? data.high);
  const low = num(data.lowPrice ?? data.low);
  const close = num(data.closePrice ?? data.lastPrice ?? lastTrade.price ?? data.price);
  const previousClose = num(data.previousClose ?? data.referencePrice ?? data.previousClosePrice);
  const change = num(data.change ?? (close && previousClose ? close - previousClose : 0));
  const changePercent = Number.isFinite(Number(data.changePercent))
    ? num(data.changePercent)
    : previousClose ? round(change / previousClose * 100) : 0;
  return {
    symbol: String(data.symbol ?? root.symbol ?? requestedSymbol),
    name: String(data.name ?? root.name ?? ""),
    open,
    high,
    low,
    close,
    previous_close: previousClose,
    change,
    change_percent: changePercent,
    trade_volume: num(data.tradeVolume ?? total.tradeVolume ?? total.volume),
    trade_value: num(data.tradeValue ?? total.tradeValue ?? total.value),
    intraday_position: high > low ? round((close - low) / (high - low) * 100) : null,
    last_updated: data.lastUpdated ?? root.lastUpdated ?? null,
  };
}

export function normalizeDailyBars(rows: any[]): DailyBar[] {
  return rows.map((row) => ({
    date: String(row.date ?? row.Date ?? ""),
    open: num(row.open ?? row.Open),
    high: num(row.max ?? row.high ?? row.High),
    low: num(row.min ?? row.low ?? row.Low),
    close: num(row.close ?? row.Close),
    volume: num(row.Trading_Volume ?? row.volume ?? row.Volume),
  })).filter((bar) => bar.date && bar.close > 0).sort((a, b) => a.date.localeCompare(b.date));
}

export function returnPct(current: number, base: number): number | null {
  return base ? round((current / base - 1) * 100, 2) : null;
}

export function technicalSummary(bars: DailyBar[]) {
  const latest = bars.at(-1);
  if (!latest) return { latest: null, score: 0 };
  const avg = (n: number) => {
    const sample = bars.slice(-n);
    return sample.length ? sample.reduce((sum, bar) => sum + bar.close, 0) / sample.length : 0;
  };
  const sma20 = avg(20), sma60 = avg(60), sma120 = avg(120);
  const base20 = bars.at(-21)?.close ?? 0;
  const base60 = bars.at(-61)?.close ?? 0;
  const base120 = bars.at(-121)?.close ?? 0;
  const returns = bars.slice(-61).map((bar, i, all) => i ? Math.log(bar.close / all[i - 1].close) : 0).slice(1);
  const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length ? returns.reduce((sum, x) => sum + (x - mean) ** 2, 0) / returns.length : 0;
  const volatility60 = round(Math.sqrt(variance) * Math.sqrt(252) * 100, 2);
  let peak = bars[0]?.close ?? latest.close, maxDrawdown = 0;
  for (const bar of bars) {
    peak = Math.max(peak, bar.close);
    maxDrawdown = Math.min(maxDrawdown, bar.close / peak - 1);
  }
  const trueRanges = bars.slice(-15).map((bar, i, list) => {
    const prevClose = i ? list[i - 1].close : bar.close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose));
  });
  const atr14 = trueRanges.length ? trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length : 0;
  let score = 50;
  if (latest.close > sma20) score += 10; else score -= 10;
  if (sma20 > sma60) score += 10; else score -= 10;
  if (sma60 > sma120) score += 10; else score -= 10;
  const r60 = returnPct(latest.close, base60) ?? 0;
  if (r60 > 10) score += 10; else if (r60 < -10) score -= 10;
  return {
    latest,
    sma20: round(sma20),
    sma60: round(sma60),
    sma120: round(sma120),
    return_20d_percent: returnPct(latest.close, base20),
    return_60d_percent: returnPct(latest.close, base60),
    return_120d_percent: returnPct(latest.close, base120),
    annualized_volatility_60d_percent: volatility60,
    max_drawdown_percent: round(maxDrawdown * 100, 2),
    atr14: round(atr14, 4),
    score: Math.max(0, Math.min(100, score)),
  };
}

let schemaReady = false;

export function requireDb(env: Env): D1Database {
  if (!env.DB) throw new Error("D1 儲存尚未綁定；等待 Cloudflare 自動建立 DB，或在 Worker Bindings 將 D1 綁定名稱設為 DB");
  return env.DB;
}

export async function ensureSchema(env: Env): Promise<D1Database> {
  const db = requireDb(env);
  if (schemaReady) return db;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS watchlists (
      name TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS watchlist_items (
      watchlist_name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      target_price REAL,
      stop_price REAL,
      added_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (watchlist_name, symbol)
    );
    CREATE INDEX IF NOT EXISTS idx_watchlist_items_symbol ON watchlist_items(symbol);
    CREATE TABLE IF NOT EXISTS watchlist_snapshots (
      watchlist_name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      close REAL,
      change_percent REAL,
      trade_value REAL,
      score REAL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (watchlist_name, symbol, snapshot_date)
    );
    CREATE TABLE IF NOT EXISTS stock_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      title TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stock_events_symbol_date ON stock_events(symbol, event_date);
    CREATE TABLE IF NOT EXISTS event_outcomes (
      event_id INTEGER PRIMARY KEY,
      reference_price REAL,
      return_1d REAL,
      return_5d REAL,
      return_20d REAL,
      return_60d REAL,
      mfe_20d REAL,
      mae_20d REAL,
      mfe_60d REAL,
      mae_60d REAL,
      evaluated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS portfolios (
      name TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS portfolio_positions (
      portfolio_name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      quantity REAL NOT NULL,
      avg_price REAL NOT NULL,
      stop_price REAL,
      sector TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (portfolio_name, symbol)
    );
  `);
  schemaReady = true;
  return db;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  try { return typeof value === "string" ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

export async function concurrencyMap<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try { results[index] = { status: "fulfilled", value: await fn(items[index], index) }; }
      catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  });
  await Promise.all(workers);
  return results;
}
