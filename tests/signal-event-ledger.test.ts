import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  LedgerError,
  recordLedgerEvent,
  recordSignalLedger,
} from "../src/v6/signal-event-ledger.ts";

if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: webcrypto });

class FakeStatement {
  private params: unknown[] = [];
  constructor(private readonly db: FakeD1, private readonly sql: string) {}
  bind(...params: unknown[]) { const copy = new FakeStatement(this.db, this.sql); copy.params = params; return copy; }

  async run() {
    const compact = this.sql.replace(/\s+/g, " ").trim();
    if (compact.startsWith("CREATE ")) return { success: true };
    if (compact.startsWith("INSERT OR IGNORE INTO event_ledger")) {
      const [ledger_id,event_id,event_version,symbol,event_type,event_ts_ms,available_ts_ms,source,title,payload_json,content_hash,recorded_at] = this.params;
      const key = `${event_id}\u0000${event_version}`;
      if (!this.db.events.has(key)) this.db.events.set(key, { ledger_id,event_id,event_version,symbol,event_type,event_ts_ms,available_ts_ms,source,title,payload_json,content_hash,recorded_at });
      return { success: true };
    }
    if (compact.startsWith("INSERT OR IGNORE INTO signal_ledger")) {
      const [ledger_id,signal_id,signal_version,symbol,trade_date,timeframe,side,strategy,stage,signal_ts_ms,knowledge_cutoff_ts_ms,data_watermark_ts_ms,price,atr,source,dataset_id,dataset_version,dataset_hash,event_refs_json,reason_codes_json,payload_json,content_hash,recorded_at] = this.params;
      const key = `${signal_id}\u0000${signal_version}`;
      if (!this.db.signals.has(key)) this.db.signals.set(key, { ledger_id,signal_id,signal_version,symbol,trade_date,timeframe,side,strategy,stage,signal_ts_ms,knowledge_cutoff_ts_ms,data_watermark_ts_ms,price,atr,source,dataset_id,dataset_version,dataset_hash,event_refs_json,reason_codes_json,payload_json,content_hash,recorded_at });
      return { success: true };
    }
    throw new Error(`unhandled run SQL: ${compact}`);
  }

  async first<T>() {
    const compact = this.sql.replace(/\s+/g, " ").trim();
    if (compact.includes("FROM event_ledger WHERE event_id=? AND event_version=?")) {
      return (this.db.events.get(`${this.params[0]}\u0000${this.params[1]}`) ?? null) as T | null;
    }
    if (compact.includes("FROM signal_ledger WHERE signal_id=? AND signal_version=?")) {
      return (this.db.signals.get(`${this.params[0]}\u0000${this.params[1]}`) ?? null) as T | null;
    }
    throw new Error(`unhandled first SQL: ${compact}`);
  }

  async all<T>() { return { results: [] as T[] }; }
}

class FakeD1 {
  events = new Map<string, Record<string, unknown>>();
  signals = new Map<string, Record<string, unknown>>();
  prepare(sql: string) { return new FakeStatement(this, sql); }
  async batch(statements: FakeStatement[]) { return Promise.all(statements.map((statement) => statement.run())); }
}

function env(db = new FakeD1()) { return { RESEARCH_DB: db } as unknown as Env; }
function ts(twIso: string) { return Date.parse(twIso); }

const eventBase = {
  event_id: "evt-2330-earnings-2026q2",
  event_version: "v1",
  symbol: "2330",
  event_type: "EARNINGS",
  event_ts_ms: ts("2026-08-07T14:00:00+08:00"),
  available_ts_ms: ts("2026-08-07T14:00:05+08:00"),
  source: "mops",
  title: "Q2 result",
  payload: { eps: 12.3, tags: ["q2", "official"] },
};

// Event ledger is immutable but identical retries are idempotent.
{
  const db = new FakeD1();
  const e = env(db);
  const a = await recordLedgerEvent(e, eventBase);
  const b = await recordLedgerEvent(e, { ...eventBase, payload: { tags: ["q2", "official"], eps: 12.3 } });
  assert.equal(a.ledger_id, b.ledger_id);
  assert.equal(db.events.size, 1);
  await assert.rejects(
    recordLedgerEvent(e, { ...eventBase, title: "changed without version bump" }),
    (error: unknown) => error instanceof LedgerError && error.code === "IMMUTABLE_CONFLICT",
  );
}

// Event cannot be available before it happened.
{
  await assert.rejects(
    recordLedgerEvent(env(), { ...eventBase, available_ts_ms: eventBase.event_ts_ms - 1 }),
    (error: unknown) => error instanceof LedgerError && error.code === "INVALID_EVENT_TIME",
  );
}

const signalTs = ts("2026-08-07T14:05:00+08:00");
const signalBase = {
  signal_id: "sig-2330-v55-001",
  signal_version: "V55-10-dev1",
  symbol: "2330",
  trade_date: "2026-08-07",
  timeframe: "5m",
  side: "LONG" as const,
  strategy: "V55",
  stage: "COMMITTED",
  signal_ts_ms: signalTs,
  knowledge_cutoff_ts_ms: signalTs,
  data_watermark_ts_ms: ts("2026-08-07T14:00:00+08:00"),
  price: 100,
  atr: 2,
  source: "diamond-signal-engine",
  dataset_id: "tw-stock:2330:5m:1:2:2",
  dataset_hash: "a".repeat(64),
  dataset_version: `sha256:${"a".repeat(64)}`,
  reason_codes: ["TREND", "VOLUME"],
  payload: { score: 0.82 },
};

// A valid signal can reference only an event that was available by its knowledge cutoff.
{
  const db = new FakeD1();
  const e = env(db);
  await recordLedgerEvent(e, eventBase);
  const a = await recordSignalLedger(e, { ...signalBase, event_refs: [{ event_id: eventBase.event_id, event_version: eventBase.event_version }] });
  const b = await recordSignalLedger(e, { ...signalBase, reason_codes: ["VOLUME", "TREND", "VOLUME"], event_refs: [{ event_id: eventBase.event_id, event_version: eventBase.event_version }] });
  assert.equal(a.ledger_id, b.ledger_id, "reason code order/duplicates must not drift signal identity");
  assert.equal(db.signals.size, 1);
  assert.equal(a.referenced_events.length, 1);

  await assert.rejects(
    recordSignalLedger(e, { ...signalBase, payload: { score: 0.83 } }),
    (error: unknown) => error instanceof LedgerError && error.code === "IMMUTABLE_CONFLICT",
  );
}

// Knowledge-cutoff ordering is a hard anti-lookahead gate.
{
  await assert.rejects(
    recordSignalLedger(env(), { ...signalBase, data_watermark_ts_ms: signalTs + 1 }),
    (error: unknown) => error instanceof LedgerError && error.code === "LOOKAHEAD_BIAS",
  );
  await assert.rejects(
    recordSignalLedger(env(), { ...signalBase, knowledge_cutoff_ts_ms: signalTs + 1 }),
    (error: unknown) => error instanceof LedgerError && error.code === "LOOKAHEAD_BIAS",
  );
}

// Future event information cannot be linked into an earlier signal.
{
  const db = new FakeD1();
  const e = env(db);
  const future = { ...eventBase, event_id: "evt-future", event_ts_ms: signalTs + 1_000, available_ts_ms: signalTs + 2_000 };
  await recordLedgerEvent(e, future);
  await assert.rejects(
    recordSignalLedger(e, { ...signalBase, event_refs: [{ event_id: "evt-future", event_version: "v1" }] }),
    (error: unknown) => error instanceof LedgerError && error.code === "LOOKAHEAD_BIAS",
  );
}

// Missing event reference fails closed instead of silently dropping provenance.
{
  await assert.rejects(
    recordSignalLedger(env(), { ...signalBase, event_refs: [{ event_id: "missing", event_version: "v1" }] }),
    (error: unknown) => error instanceof LedgerError && error.code === "EVENT_REF_NOT_FOUND",
  );
}

// Signal date and timestamp must agree in Asia/Taipei.
{
  await assert.rejects(
    recordSignalLedger(env(), { ...signalBase, trade_date: "2026-08-08" }),
    (error: unknown) => error instanceof LedgerError && error.code === "TRADE_DATE_MISMATCH",
  );
}

// Dataset provenance is all-or-none and hash/version must match P2 contract.
{
  await assert.rejects(
    recordSignalLedger(env(), { ...signalBase, dataset_hash: null }),
    (error: unknown) => error instanceof LedgerError && error.code === "INVALID_DATASET_REFERENCE",
  );
  await assert.rejects(
    recordSignalLedger(env(), { ...signalBase, dataset_version: `sha256:${"b".repeat(64)}` }),
    (error: unknown) => error instanceof LedgerError && error.code === "INVALID_DATASET_REFERENCE",
  );
}

// Source-level invariants: P4 ledger is append-only and does not write OHLC.
{
  const moduleSource = await readFile(new URL("../src/v6/signal-event-ledger.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../migrations/0002_signal_event_ledger.sql", import.meta.url), "utf8");
  assert.doesNotMatch(moduleSource, /\bUPDATE\s+signal_ledger\b/i);
  assert.doesNotMatch(moduleSource, /\bUPDATE\s+event_ledger\b/i);
  assert.doesNotMatch(moduleSource, /\bDELETE\s+FROM\s+(signal_ledger|event_ledger)\b/i);
  assert.doesNotMatch(moduleSource, /OHLC|ohlc.*INSERT|write.*ohlc/i, "ledger module must not become an OHLC writer");
  assert.match(moduleSource, /data_watermark_ts_ms > knowledge_cutoff_ts_ms \|\| knowledge_cutoff_ts_ms > signal_ts_ms/);
  assert.match(moduleSource, /event_available_ts_ms/);
  assert.match(migration, /UNIQUE \(signal_id, signal_version\)/);
  assert.match(migration, /UNIQUE \(event_id, event_version\)/);
}

console.log("Signal/Event Ledger immutability and knowledge-cutoff tests passed.");
