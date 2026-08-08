export const SIGNAL_EVENT_LEDGER_SCHEMA_VERSION = "signal-event-ledger/v1";

const LEDGER_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS event_ledger (
    ledger_id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    event_version TEXT NOT NULL,
    symbol TEXT,
    event_type TEXT NOT NULL,
    event_ts_ms INTEGER NOT NULL,
    available_ts_ms INTEGER NOT NULL,
    source TEXT NOT NULL,
    title TEXT,
    payload_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    UNIQUE (event_id, event_version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_event_ledger_symbol_time ON event_ledger(symbol, available_ts_ms)`,
  `CREATE INDEX IF NOT EXISTS idx_event_ledger_type_time ON event_ledger(event_type, available_ts_ms)`,
  `CREATE TABLE IF NOT EXISTS signal_ledger (
    ledger_id TEXT PRIMARY KEY,
    signal_id TEXT NOT NULL,
    signal_version TEXT NOT NULL,
    symbol TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    side TEXT NOT NULL,
    strategy TEXT NOT NULL,
    stage TEXT NOT NULL,
    signal_ts_ms INTEGER NOT NULL,
    knowledge_cutoff_ts_ms INTEGER NOT NULL,
    data_watermark_ts_ms INTEGER NOT NULL,
    price REAL,
    atr REAL,
    source TEXT NOT NULL,
    dataset_id TEXT,
    dataset_version TEXT,
    dataset_hash TEXT,
    event_refs_json TEXT NOT NULL,
    reason_codes_json TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    UNIQUE (signal_id, signal_version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_signal_ledger_date_symbol ON signal_ledger(trade_date, symbol, signal_ts_ms)`,
  `CREATE INDEX IF NOT EXISTS idx_signal_ledger_strategy ON signal_ledger(strategy, trade_date, signal_ts_ms)`,
  `CREATE INDEX IF NOT EXISTS idx_signal_ledger_stage ON signal_ledger(stage, trade_date, signal_ts_ms)`,
] as const;

export type LedgerEventRef = {
  event_id: string;
  event_version: string;
};

export type RecordEventInput = {
  event_id: string;
  event_version: string;
  symbol?: string | null;
  event_type: string;
  event_ts_ms: number;
  available_ts_ms: number;
  source: string;
  title?: string | null;
  payload?: Record<string, unknown>;
};

export type RecordSignalInput = {
  signal_id: string;
  signal_version: string;
  symbol: string;
  trade_date: string;
  timeframe: string;
  side: "LONG" | "SHORT" | "NEUTRAL";
  strategy: string;
  stage: string;
  signal_ts_ms: number;
  knowledge_cutoff_ts_ms: number;
  data_watermark_ts_ms: number;
  price?: number | null;
  atr?: number | null;
  source: string;
  dataset_id?: string | null;
  dataset_version?: string | null;
  dataset_hash?: string | null;
  event_refs?: LedgerEventRef[];
  reason_codes?: string[];
  payload?: Record<string, unknown>;
};

export class LedgerError extends Error {
  readonly code: string;
  readonly detail?: Record<string, unknown>;

  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
    this.detail = detail;
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) output[key] = stableValue(source[key]);
    return output;
  }
  if (value === undefined) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function requiredText(value: unknown, field: string, max = 200): string {
  const text = String(value ?? "").trim();
  if (!text) throw new LedgerError("INVALID_INPUT", `${field} is required`);
  if (text.length > max) throw new LedgerError("INVALID_INPUT", `${field} is too long`);
  return text;
}

function optionalSymbol(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const symbol = String(value).trim();
  if (!/^\d{4,6}$/.test(symbol)) throw new LedgerError("INVALID_INPUT", "symbol must be 4-6 digits");
  return symbol;
}

function requiredSymbol(value: unknown): string {
  const symbol = optionalSymbol(value);
  if (!symbol) throw new LedgerError("INVALID_INPUT", "symbol is required");
  return symbol;
}

function positiveInteger(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new LedgerError("INVALID_INPUT", `${field} must be a positive safe integer`);
  return number;
}

function optionalFinite(value: unknown, field: string, positive = false): number | null {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new LedgerError("INVALID_INPUT", `${field} must be finite`);
  if (positive && number <= 0) throw new LedgerError("INVALID_INPUT", `${field} must be > 0`);
  return number;
}

function taipeiDateFromEpoch(tsMs: number): string {
  // Taiwan has no DST; adding UTC+8 before slicing is deterministic and never consults the runtime clock.
  return new Date(tsMs + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function normalizeTradeDate(value: unknown): string {
  const date = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new LedgerError("INVALID_INPUT", "trade_date must be YYYY-MM-DD");
  return date;
}

function canonicalEventRefs(refs: LedgerEventRef[] | undefined): LedgerEventRef[] {
  const map = new Map<string, LedgerEventRef>();
  for (const raw of refs ?? []) {
    const event_id = requiredText(raw?.event_id, "event_refs.event_id", 240);
    const event_version = requiredText(raw?.event_version, "event_refs.event_version", 160);
    const key = `${event_id}\u0000${event_version}`;
    map.set(key, { event_id, event_version });
  }
  return Array.from(map.values()).sort((a, b) => `${a.event_id}\u0000${a.event_version}`.localeCompare(`${b.event_id}\u0000${b.event_version}`));
}

function canonicalReasonCodes(codes: string[] | undefined): string[] {
  return Array.from(new Set((codes ?? []).map((code) => requiredText(code, "reason_code", 120)))).sort();
}

function validateDatasetReference(input: RecordSignalInput) {
  const values = [input.dataset_id, input.dataset_version, input.dataset_hash];
  const count = values.filter((value) => value !== undefined && value !== null && String(value).trim() !== "").length;
  if (count === 0) return { dataset_id: null, dataset_version: null, dataset_hash: null };
  if (count !== 3) throw new LedgerError("INVALID_DATASET_REFERENCE", "dataset_id, dataset_version and dataset_hash must be supplied together");
  const dataset_id = requiredText(input.dataset_id, "dataset_id", 500);
  const dataset_version = requiredText(input.dataset_version, "dataset_version", 80);
  const dataset_hash = requiredText(input.dataset_hash, "dataset_hash", 64);
  if (!/^sha256:[0-9a-f]{64}$/.test(dataset_version) || !/^[0-9a-f]{64}$/.test(dataset_hash) || dataset_version !== `sha256:${dataset_hash}`) {
    throw new LedgerError("INVALID_DATASET_REFERENCE", "dataset_version/hash must be the P2 SHA-256 pair");
  }
  return { dataset_id, dataset_version, dataset_hash };
}

export async function ensureSignalEventLedgerSchema(env: Env): Promise<void> {
  if (!env.RESEARCH_DB) throw new LedgerError("RESEARCH_DB_UNAVAILABLE", "RESEARCH_DB binding is required");
  const statements = LEDGER_SCHEMA_STATEMENTS.map((sql) => env.RESEARCH_DB.prepare(sql));
  await env.RESEARCH_DB.batch(statements);
}

export async function recordLedgerEvent(env: Env, raw: RecordEventInput) {
  await ensureSignalEventLedgerSchema(env);
  const event_id = requiredText(raw.event_id, "event_id", 240);
  const event_version = requiredText(raw.event_version, "event_version", 160);
  const symbol = optionalSymbol(raw.symbol);
  const event_type = requiredText(raw.event_type, "event_type", 120);
  const event_ts_ms = positiveInteger(raw.event_ts_ms, "event_ts_ms");
  const available_ts_ms = positiveInteger(raw.available_ts_ms, "available_ts_ms");
  if (available_ts_ms < event_ts_ms) {
    throw new LedgerError("INVALID_EVENT_TIME", "available_ts_ms cannot be earlier than event_ts_ms", { event_ts_ms, available_ts_ms });
  }
  const source = requiredText(raw.source, "source", 160);
  const title = raw.title === undefined || raw.title === null ? null : String(raw.title).trim().slice(0, 1000);
  const payload = stableValue(raw.payload ?? {}) as Record<string, unknown>;
  const canonical = { schema_version: SIGNAL_EVENT_LEDGER_SCHEMA_VERSION, event_id, event_version, symbol, event_type, event_ts_ms, available_ts_ms, source, title, payload };
  const content_hash = await sha256Hex(stableJson(canonical));
  const ledger_id = `evt:${content_hash}`;
  const recorded_at = new Date().toISOString();

  await env.RESEARCH_DB.prepare(`
    INSERT OR IGNORE INTO event_ledger
      (ledger_id,event_id,event_version,symbol,event_type,event_ts_ms,available_ts_ms,source,title,payload_json,content_hash,recorded_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(ledger_id, event_id, event_version, symbol, event_type, event_ts_ms, available_ts_ms, source, title, stableJson(payload), content_hash, recorded_at).run();

  const existing = await env.RESEARCH_DB.prepare(`SELECT * FROM event_ledger WHERE event_id=? AND event_version=?`).bind(event_id, event_version).first<Record<string, unknown>>();
  if (!existing) throw new LedgerError("LEDGER_WRITE_FAILED", "event ledger row was not persisted");
  if (String(existing.content_hash) !== content_hash) {
    throw new LedgerError("IMMUTABLE_CONFLICT", "event_id + event_version already exists with different immutable content", { event_id, event_version, existing_content_hash: existing.content_hash, incoming_content_hash: content_hash });
  }
  return { ok: true, immutable: true, idempotent: String(existing.ledger_id) === ledger_id, ledger_id, content_hash, event_id, event_version, recorded_at: existing.recorded_at };
}

async function validateReferencedEvents(env: Env, refs: LedgerEventRef[], knowledgeCutoff: number) {
  const resolved: Array<{ event_id: string; event_version: string; available_ts_ms: number; ledger_id: string }> = [];
  for (const ref of refs) {
    const row = await env.RESEARCH_DB.prepare(`
      SELECT ledger_id,event_id,event_version,available_ts_ms FROM event_ledger WHERE event_id=? AND event_version=?
    `).bind(ref.event_id, ref.event_version).first<Record<string, unknown>>();
    if (!row) throw new LedgerError("EVENT_REF_NOT_FOUND", "referenced event is not present in immutable event ledger", ref);
    const available = Number(row.available_ts_ms);
    if (!Number.isSafeInteger(available) || available > knowledgeCutoff) {
      throw new LedgerError("LOOKAHEAD_BIAS", "referenced event was not available by signal knowledge cutoff", {
        ...ref,
        event_available_ts_ms: row.available_ts_ms,
        knowledge_cutoff_ts_ms: knowledgeCutoff,
      });
    }
    resolved.push({ event_id: ref.event_id, event_version: ref.event_version, available_ts_ms: available, ledger_id: String(row.ledger_id) });
  }
  return resolved;
}

export async function recordSignalLedger(env: Env, raw: RecordSignalInput) {
  await ensureSignalEventLedgerSchema(env);
  const signal_id = requiredText(raw.signal_id, "signal_id", 240);
  const signal_version = requiredText(raw.signal_version, "signal_version", 160);
  const symbol = requiredSymbol(raw.symbol);
  const trade_date = normalizeTradeDate(raw.trade_date);
  const timeframe = requiredText(raw.timeframe, "timeframe", 32);
  const side = String(raw.side ?? "").toUpperCase();
  if (!["LONG", "SHORT", "NEUTRAL"].includes(side)) throw new LedgerError("INVALID_INPUT", "side must be LONG, SHORT or NEUTRAL");
  const strategy = requiredText(raw.strategy, "strategy", 200);
  const stage = requiredText(raw.stage, "stage", 120);
  const signal_ts_ms = positiveInteger(raw.signal_ts_ms, "signal_ts_ms");
  const knowledge_cutoff_ts_ms = positiveInteger(raw.knowledge_cutoff_ts_ms, "knowledge_cutoff_ts_ms");
  const data_watermark_ts_ms = positiveInteger(raw.data_watermark_ts_ms, "data_watermark_ts_ms");
  if (data_watermark_ts_ms > knowledge_cutoff_ts_ms || knowledge_cutoff_ts_ms > signal_ts_ms) {
    throw new LedgerError("LOOKAHEAD_BIAS", "required ordering is data_watermark <= knowledge_cutoff <= signal timestamp", { data_watermark_ts_ms, knowledge_cutoff_ts_ms, signal_ts_ms });
  }
  if (taipeiDateFromEpoch(signal_ts_ms) !== trade_date) {
    throw new LedgerError("TRADE_DATE_MISMATCH", "trade_date must match signal timestamp in Asia/Taipei", { trade_date, signal_taipei_date: taipeiDateFromEpoch(signal_ts_ms) });
  }
  const price = optionalFinite(raw.price, "price", true);
  const atr = optionalFinite(raw.atr, "atr", true);
  const source = requiredText(raw.source, "source", 160);
  const dataset = validateDatasetReference(raw);
  const event_refs = canonicalEventRefs(raw.event_refs);
  const resolved_events = await validateReferencedEvents(env, event_refs, knowledge_cutoff_ts_ms);
  const reason_codes = canonicalReasonCodes(raw.reason_codes);
  const payload = stableValue(raw.payload ?? {}) as Record<string, unknown>;

  const canonical = {
    schema_version: SIGNAL_EVENT_LEDGER_SCHEMA_VERSION,
    signal_id,
    signal_version,
    symbol,
    trade_date,
    timeframe,
    side,
    strategy,
    stage,
    signal_ts_ms,
    knowledge_cutoff_ts_ms,
    data_watermark_ts_ms,
    price,
    atr,
    source,
    ...dataset,
    event_refs,
    reason_codes,
    payload,
  };
  const content_hash = await sha256Hex(stableJson(canonical));
  const ledger_id = `sig:${content_hash}`;
  const recorded_at = new Date().toISOString();

  await env.RESEARCH_DB.prepare(`
    INSERT OR IGNORE INTO signal_ledger
      (ledger_id,signal_id,signal_version,symbol,trade_date,timeframe,side,strategy,stage,signal_ts_ms,knowledge_cutoff_ts_ms,data_watermark_ts_ms,price,atr,source,dataset_id,dataset_version,dataset_hash,event_refs_json,reason_codes_json,payload_json,content_hash,recorded_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    ledger_id, signal_id, signal_version, symbol, trade_date, timeframe, side, strategy, stage,
    signal_ts_ms, knowledge_cutoff_ts_ms, data_watermark_ts_ms, price, atr, source,
    dataset.dataset_id, dataset.dataset_version, dataset.dataset_hash,
    stableJson(event_refs), stableJson(reason_codes), stableJson(payload), content_hash, recorded_at,
  ).run();

  const existing = await env.RESEARCH_DB.prepare(`SELECT * FROM signal_ledger WHERE signal_id=? AND signal_version=?`).bind(signal_id, signal_version).first<Record<string, unknown>>();
  if (!existing) throw new LedgerError("LEDGER_WRITE_FAILED", "signal ledger row was not persisted");
  if (String(existing.content_hash) !== content_hash) {
    throw new LedgerError("IMMUTABLE_CONFLICT", "signal_id + signal_version already exists with different immutable content", { signal_id, signal_version, existing_content_hash: existing.content_hash, incoming_content_hash: content_hash });
  }
  return {
    ok: true,
    immutable: true,
    idempotent: String(existing.ledger_id) === ledger_id,
    ledger_id,
    content_hash,
    signal_id,
    signal_version,
    knowledge_cutoff_ts_ms,
    data_watermark_ts_ms,
    referenced_events: resolved_events,
    recorded_at: existing.recorded_at,
  };
}

function parseJsonField(value: unknown, fallback: unknown) {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function hydrateSignal(row: Record<string, unknown> | null) {
  if (!row) return null;
  return {
    ...row,
    event_refs: parseJsonField(row.event_refs_json, []),
    reason_codes: parseJsonField(row.reason_codes_json, []),
    payload: parseJsonField(row.payload_json, {}),
  };
}

function hydrateEvent(row: Record<string, unknown> | null) {
  if (!row) return null;
  return { ...row, payload: parseJsonField(row.payload_json, {}) };
}

export async function getSignalLedger(env: Env, signalId: string, signalVersion?: string) {
  await ensureSignalEventLedgerSchema(env);
  const id = requiredText(signalId, "signal_id", 240);
  if (signalVersion) {
    const row = await env.RESEARCH_DB.prepare(`SELECT * FROM signal_ledger WHERE signal_id=? AND signal_version=?`).bind(id, signalVersion).first<Record<string, unknown>>();
    return hydrateSignal(row);
  }
  const row = await env.RESEARCH_DB.prepare(`SELECT * FROM signal_ledger WHERE signal_id=? ORDER BY recorded_at DESC LIMIT 1`).bind(id).first<Record<string, unknown>>();
  return hydrateSignal(row);
}

export async function getEventLedger(env: Env, eventId: string, eventVersion?: string) {
  await ensureSignalEventLedgerSchema(env);
  const id = requiredText(eventId, "event_id", 240);
  if (eventVersion) {
    const row = await env.RESEARCH_DB.prepare(`SELECT * FROM event_ledger WHERE event_id=? AND event_version=?`).bind(id, eventVersion).first<Record<string, unknown>>();
    return hydrateEvent(row);
  }
  const row = await env.RESEARCH_DB.prepare(`SELECT * FROM event_ledger WHERE event_id=? ORDER BY recorded_at DESC LIMIT 1`).bind(id).first<Record<string, unknown>>();
  return hydrateEvent(row);
}

export async function listSignalLedger(env: Env, filters: { trade_date?: string; symbol?: string; strategy?: string; stage?: string; limit?: number }) {
  await ensureSignalEventLedgerSchema(env);
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (filters.trade_date) { clauses.push("trade_date=?"); values.push(normalizeTradeDate(filters.trade_date)); }
  if (filters.symbol) { clauses.push("symbol=?"); values.push(requiredSymbol(filters.symbol)); }
  if (filters.strategy) { clauses.push("strategy=?"); values.push(requiredText(filters.strategy, "strategy", 200)); }
  if (filters.stage) { clauses.push("stage=?"); values.push(requiredText(filters.stage, "stage", 120)); }
  const limit = Math.max(1, Math.min(500, Number(filters.limit ?? 100)));
  values.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await env.RESEARCH_DB.prepare(`SELECT * FROM signal_ledger ${where} ORDER BY signal_ts_ms, signal_id, signal_version LIMIT ?`).bind(...values).all<Record<string, unknown>>();
  return result.results.map((row) => hydrateSignal(row));
}

export async function listEventLedger(env: Env, filters: { symbol?: string; event_type?: string; available_before_ts_ms?: number; limit?: number }) {
  await ensureSignalEventLedgerSchema(env);
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (filters.symbol) { clauses.push("symbol=?"); values.push(requiredSymbol(filters.symbol)); }
  if (filters.event_type) { clauses.push("event_type=?"); values.push(requiredText(filters.event_type, "event_type", 120)); }
  if (filters.available_before_ts_ms) { clauses.push("available_ts_ms<=?"); values.push(positiveInteger(filters.available_before_ts_ms, "available_before_ts_ms")); }
  const limit = Math.max(1, Math.min(500, Number(filters.limit ?? 100)));
  values.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await env.RESEARCH_DB.prepare(`SELECT * FROM event_ledger ${where} ORDER BY available_ts_ms, event_id, event_version LIMIT ?`).bind(...values).all<Record<string, unknown>>();
  return result.results.map((row) => hydrateEvent(row));
}
