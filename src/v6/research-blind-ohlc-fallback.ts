import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readGitHubText, sha256Hex } from "./github-data-store.ts";

export const RESEARCH_BLIND_OHLC_FALLBACK_VERSION = "research-blind-ohlc-fallback/v1.0.1";

type Row = Record<string, string | number | null>;

function csvLine(line: string) {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) { out.push(cell); cell = ""; }
    else cell += ch;
  }
  out.push(cell);
  return out;
}

function scalar(value: string): string | number | null {
  const text = value.trim();
  if (!text) return null;
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(text)) {
    const n = Number(text);
    if (Number.isFinite(n)) return n;
  }
  return text;
}

function parseCsv(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return { headers: [] as string[], rows: [] as Row[] };
  const headers = csvLine(lines[0]).map((x) => x.trim());
  const rows = lines.slice(1).map((line) => {
    const values = csvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, scalar(values[index] ?? "")])) as Row;
  });
  return { headers, rows };
}

function expectedSlots(timeframe: "1m" | "5m", tradeDate: string) {
  const step = timeframe === "5m" ? 5 : 1;
  const end = timeframe === "5m" ? 13 * 60 + 20 : 13 * 60 + 24;
  const slots: Array<{ label: string; ts: number; closeTs: number }> = [];
  for (let minute = 9 * 60; minute <= end; minute += step) {
    const hh = String(Math.floor(minute / 60)).padStart(2, "0");
    const mm = String(minute % 60).padStart(2, "0");
    const ts = Date.parse(`${tradeDate}T${hh}:${mm}:00+08:00`);
    slots.push({ label: `${hh}:${mm}`, ts, closeTs: ts + step * 60_000 });
  }
  const auction = Date.parse(`${tradeDate}T13:30:00+08:00`);
  slots.push({ label: "13:30", ts: auction, closeTs: auction });
  return slots;
}

function rowTs(row: Row) {
  const direct = Number(row.ts_ms ?? 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const raw = String(row.bar_time_tw ?? "").trim();
  return raw ? Date.parse(raw.replace(" ", "T") + "+08:00") : NaN;
}

function rowTradeDate(row: Row) {
  const explicit = String(row.trade_date ?? "").trim();
  if (explicit) return explicit;
  const barTime = String(row.bar_time_tw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}(?:\s|T)/.test(barTime) ? barTime.slice(0, 10) : "";
}

function coreValid(row: Row) {
  const o = Number(row.open), h = Number(row.high), l = Number(row.low), c = Number(row.close), v = Number(row.volume ?? 0);
  return [o, h, l, c, v].every(Number.isFinite) && v >= 0 && h >= Math.max(o, l, c) && l <= Math.min(o, h, c);
}

function fail(error: string, extra: Record<string, unknown> = {}) {
  return {
    ok: false,
    blocked: true,
    read_only: true,
    data_status: "DATA_INCOMPLETE",
    error,
    leakage_validated: false,
    formal_blind_eligible: false,
    rows: [],
    bars: [],
    fallback_version: RESEARCH_BLIND_OHLC_FALLBACK_VERSION,
    ...extra,
  };
}

export async function readResearchBlindOhlcFallback(env: Env, input: {
  symbol: string;
  trade_date: string;
  timeframe: "1m" | "5m";
  decision_time: string;
  limit?: number;
}) {
  const symbol = String(input.symbol).trim();
  const tradeDate = String(input.trade_date).trim();
  const timeframe = input.timeframe;
  const rawDecision = String(input.decision_time).trim();
  const decisionTime = rawDecision.length === 5 ? `${rawDecision}:00` : rawDecision;
  const cutoffTs = Date.parse(`${tradeDate}T${decisionTime}+08:00`);
  if (!Number.isFinite(cutoffTs)) return fail("INVALID_DECISION_TIME");

  const [year, month, day] = tradeDate.split("-");
  const path = `data/OHLC/tw/${timeframe}/${year}/${month}/${day}/${symbol}.csv`;
  const file = await readGitHubText(env, path);
  if (!file.exists || !file.value || !file.sha) return fail("CANONICAL_OHLC_NOT_FOUND", { path });

  const parsed = parseCsv(file.value);
  // 1m canonical files carry an explicit trade_date column. Derived 5m canonical
  // files are date-partitioned by path and carry the date in bar_time_tw instead.
  // Treat both schemas as canonical, but still bind every accepted row to the
  // requested trade date before cutoff validation.
  const required = ["symbol", "bar_time_tw", "ts_ms", "open", "high", "low", "close", "volume"];
  const missingHeaders = required.filter((header) => !parsed.headers.includes(header));
  if (missingHeaders.length) return fail("SCHEMA_MISMATCH", { path, missing_headers: missingHeaders });

  const sourceRows = parsed.rows.filter((row) => String(row.symbol ?? "") === symbol && rowTradeDate(row) === tradeDate);
  const slots = expectedSlots(timeframe, tradeDate);
  const slotByTs = new Map(slots.map((slot) => [slot.ts, slot]));
  const closedExpected = slots.filter((slot) => slot.closeTs <= cutoffTs);

  let invalid = 0;
  let duplicates = 0;
  let nonMonotonic = 0;
  let previous = 0;
  const seen = new Set<number>();
  const prefix: Row[] = [];
  for (const row of sourceRows) {
    const ts = rowTs(row);
    if (!Number.isFinite(ts) || ts <= 0 || !slotByTs.has(ts) || !coreValid(row)) { invalid += 1; continue; }
    if (seen.has(ts)) { duplicates += 1; continue; }
    seen.add(ts);
    if (previous && ts < previous) nonMonotonic += 1;
    previous = ts;
    const slot = slotByTs.get(ts)!;
    if (slot.closeTs <= cutoffTs) prefix.push(row);
  }

  if (invalid || duplicates || nonMonotonic) {
    return fail("CORRUPTED_PREFIX_SOURCE", { path, invalid_ohlc_or_slot_count: invalid, duplicate_count: duplicates, non_monotonic_count: nonMonotonic });
  }

  const prefixTs = new Set(prefix.map(rowTs));
  const missing = closedExpected.filter((slot) => !prefixTs.has(slot.ts));
  if (missing.length) {
    return fail("CUTOFF_PREFIX_INCOMPLETE", {
      path,
      cutoff: { trade_date: tradeDate, decision_time: decisionTime, cutoff_ts_ms: cutoffTs, timezone: "Asia/Taipei" },
      expected_bar_count: closedExpected.length,
      actual_expected_bar_count: closedExpected.filter((slot) => prefixTs.has(slot.ts)).length,
      missing_slot_count: missing.length,
      missing_slots: missing.slice(0, 80).map((slot) => slot.label),
    });
  }

  const maxReturnedTs = prefix.length ? Math.max(...prefix.map(rowTs)) : null;
  const maxReturnedCloseTs = prefix.length ? Math.max(...prefix.map((row) => slotByTs.get(rowTs(row))!.closeTs)) : null;
  const leakageValidated = maxReturnedCloseTs === null || maxReturnedCloseTs <= cutoffTs;
  if (!leakageValidated) return fail("CUTOFF_LEAKAGE_VALIDATION_FAILED", { path, max_returned_close_ts_ms: maxReturnedCloseTs, cutoff_ts_ms: cutoffTs });

  const limit = Math.max(1, Math.min(2_000, Math.trunc(Number(input.limit ?? 300) || 300)));
  const rows = prefix.slice(-limit);
  const logical = JSON.stringify(rows);
  const datasetHash = await sha256Hex(logical);

  return {
    ok: true,
    blocked: false,
    read_only: true,
    data_status: "OK",
    market: "tw-stock",
    symbol,
    trade_date: tradeDate,
    timeframe,
    mode: "research_blind_fallback",
    source: "GITHUB_CANONICAL_SERVER_SIDE_CUTOFF",
    path,
    source_sha: file.sha,
    dataset_id: `blind-fallback:${symbol}:${timeframe}:${tradeDate}:${decisionTime}`,
    dataset_version: `github:${file.sha}`,
    dataset_hash: datasetHash,
    row_count: prefix.length,
    returned: rows.length,
    cutoff: {
      enabled: true,
      trade_date: tradeDate,
      decision_time: decisionTime,
      cutoff_ts_ms: cutoffTs,
      timezone: "Asia/Taipei",
      expected_bar_count: closedExpected.length,
      actual_expected_bar_count: closedExpected.length,
      missing_slot_count: 0,
      max_returned_ts_ms: maxReturnedTs,
      max_returned_close_ts_ms: maxReturnedCloseTs,
      leakage_validated: true,
      prefix_completeness: true,
    },
    leakage_validated: true,
    // Important: the cross-account fallback cannot read OHLC STATE_KV official_verified receipts.
    // It is safe for replay/development but never self-promotes into formal evidence.
    formal_blind_eligible: false,
    formal_research_eligible: false,
    eligibility_reason: "OHLC_OFFICIAL_VERIFICATION_RECEIPT_NOT_AVAILABLE_CROSS_ACCOUNT",
    scorecard_eligible: false,
    rows,
    bars: rows,
    fallback_version: RESEARCH_BLIND_OHLC_FALLBACK_VERSION,
  };
}

const ok = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

export function registerResearchBlindOhlcFallbackTool(server: McpServer, env: Env) {
  server.registerTool("read_blind_ohlc_fallback", {
    description: "研究備援唯讀工具。伺服器直接讀 canonical GitHub 1m/5m OHLC，回傳前依 decision_time 硬切且驗證已關閉 prefix 完整性；不具 OHLC STATE_KV official_verified 證據，因此永遠不自動取得 FORMAL/scorecard 資格。",
    inputSchema: {
      symbol: z.string().trim().regex(/^\d{4,6}$/),
      trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      timeframe: z.enum(["1m", "5m"]),
      decision_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
      limit: z.number().int().min(1).max(2000).optional().default(300),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => ok(await readResearchBlindOhlcFallback(env, args)));
}
