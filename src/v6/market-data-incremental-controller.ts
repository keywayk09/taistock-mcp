import { getMarketDataCapturePolicy } from "./market-data-capture-context.ts";

export type MarketDataKind = "institutional" | "margin" | "securities_lending" | "sbl_short_sale";
export type MarketSide = "listed" | "otc";
export type MarketLayerStatus = "READY" | "PENDING" | "ERROR";

export type MarketLayerIdentity = { kind: MarketDataKind; market: MarketSide };
export type MarketManifestLayer = MarketLayerIdentity & {
  status: MarketLayerStatus;
  source: string | null;
  row_count: number;
  dataset_version: string | null;
  content_sha256: string | null;
  snapshot_path: string | null;
  raw_paths: string[];
  captured_at: string | null;
  error: string | null;
  attempts: number;
  first_attempt_at: string | null;
  last_attempt_at: string | null;
  next_retry_at: string | null;
};

export type TradingCalendarEntry = {
  date: string;
  name: string;
  description: string;
  open: boolean;
};

export type TradingDayOverride = {
  status: "OPEN" | "CLOSED";
  reason?: string;
  source?: string;
};

export type TradingDayGate = {
  status: "OPEN_EXPECTED" | "CLOSED_WEEKEND" | "CLOSED_SCHEDULED" | "CLOSED_EMERGENCY" | "UNKNOWN";
  terminal: boolean;
  reason: string;
  evidence: {
    source: string;
    verified: boolean;
    detail?: string | null;
  };
};

export const EXPECTED_MARKET_DATA_LAYERS: MarketLayerIdentity[] = [
  { kind: "institutional", market: "listed" },
  { kind: "institutional", market: "otc" },
  { kind: "margin", market: "listed" },
  { kind: "margin", market: "otc" },
  { kind: "securities_lending", market: "listed" },
  { kind: "securities_lending", market: "otc" },
  { kind: "sbl_short_sale", market: "listed" },
  { kind: "sbl_short_sale", market: "otc" },
];

export function marketLayerKey(layer: MarketLayerIdentity) {
  return `${layer.kind}-${layer.market}`;
}

export function parseCsvLine(line: string) {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === "," && !quoted) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

function looksOpenEvent(text: string) {
  return /開始交易|最後交易|補行交易|恢復交易|照常交易|開始買賣/.test(text);
}

function normalizeCalendarDate(text: string, yearHint?: string | number) {
  const gregorian = text.match(/\b(20\d{2})[-\/.年](\d{1,2})[-\/.月](\d{1,2})(?:日)?\b/);
  if (gregorian) {
    return `${gregorian[1]}-${gregorian[2].padStart(2, "0")}-${gregorian[3].padStart(2, "0")}`;
  }

  const roc = text.match(/(?:民國)?\s*(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (roc) {
    const year = Number(roc[1]) + 1911;
    return `${year}-${roc[2].padStart(2, "0")}-${roc[3].padStart(2, "0")}`;
  }

  const monthDay = text.match(/(?:^|\s)(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (monthDay && yearHint) {
    const year = Number(yearHint);
    if (Number.isFinite(year) && year >= 2000 && year <= 2100) {
      return `${year}-${monthDay[1].padStart(2, "0")}-${monthDay[2].padStart(2, "0")}`;
    }
  }

  return null;
}

export function parseTwseHolidayCsv(text: string, yearHint?: string | number): TradingCalendarEntry[] {
  const entries: TradingCalendarEntry[] = [];
  const seen = new Set<string>();
  for (const rawLine of String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const cells = parseCsvLine(line);
    const joined = cells.join(" ");
    const date = normalizeCalendarDate(joined, yearHint);
    if (!date) continue;
    const dateCell = cells.find((cell) => normalizeCalendarDate(cell, yearHint) === date) ?? "";
    const nonDateCells = cells.filter((cell) => cell && cell !== dateCell);
    const name = nonDateCells[0] ?? "";
    const description = nonDateCells.slice(1).join(" ");
    const key = `${date}|${name}|${description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ date, name, description, open: looksOpenEvent(`${name} ${description}`) });
  }
  return entries.sort((a, b) => a.date.localeCompare(b.date));
}

function dayOfWeekUtc(tradeDate: string) {
  const d = new Date(`${tradeDate}T00:00:00Z`);
  return Number.isFinite(d.getTime()) ? d.getUTCDay() : -1;
}

export function classifyTradingDay(input: {
  tradeDate: string;
  calendarEntries?: TradingCalendarEntry[];
  calendarVerified?: boolean;
  override?: TradingDayOverride | null;
}): TradingDayGate {
  const override = input.override;
  if (override?.status === "CLOSED") {
    return {
      status: "CLOSED_EMERGENCY",
      terminal: true,
      reason: override.reason || "official_emergency_closure_override",
      evidence: { source: override.source || "MARKET_CALENDAR_OVERRIDE", verified: true, detail: override.reason || null },
    };
  }
  if (override?.status === "OPEN") {
    return {
      status: "OPEN_EXPECTED",
      terminal: false,
      reason: override.reason || "official_open_override",
      evidence: { source: override.source || "MARKET_CALENDAR_OVERRIDE", verified: true, detail: override.reason || null },
    };
  }

  const entries = (input.calendarEntries || []).filter((entry) => entry.date === input.tradeDate);
  if (input.calendarVerified && entries.length) {
    if (entries.some((entry) => entry.open)) {
      return {
        status: "OPEN_EXPECTED",
        terminal: false,
        reason: "official_calendar_open_event",
        evidence: { source: "TWSE_HOLIDAY_SCHEDULE", verified: true, detail: entries.map((x) => x.name).join(" | ") },
      };
    }
    return {
      status: "CLOSED_SCHEDULED",
      terminal: true,
      reason: "official_calendar_closed",
      evidence: { source: "TWSE_HOLIDAY_SCHEDULE", verified: true, detail: entries.map((x) => x.name).join(" | ") },
    };
  }

  const dow = dayOfWeekUtc(input.tradeDate);
  if (dow === 0 || dow === 6) {
    return {
      status: "CLOSED_WEEKEND",
      terminal: true,
      reason: "weekend",
      evidence: { source: "WEEKDAY_RULE", verified: true, detail: null },
    };
  }

  return {
    status: "OPEN_EXPECTED",
    terminal: false,
    reason: input.calendarVerified ? "weekday_not_listed_in_official_holiday_schedule" : "weekday_fail_open_calendar_unavailable",
    evidence: { source: input.calendarVerified ? "TWSE_HOLIDAY_SCHEDULE" : "WEEKDAY_RULE", verified: Boolean(input.calendarVerified), detail: null },
  };
}

export function nextRetryAt(nowIso: string, minutes = 10) {
  const d = new Date(nowIso);
  if (!Number.isFinite(d.getTime())) throw new Error(`invalid retry base time: ${nowIso}`);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString();
}

export function makePendingLayer(identity: MarketLayerIdentity, nowIso: string, input: {
  source?: string | null;
  error?: string | null;
  previous?: MarketManifestLayer | null;
  status?: "PENDING" | "ERROR";
  retryMinutes?: number;
} = {}): MarketManifestLayer {
  const previous = input.previous ?? null;
  return {
    ...identity,
    status: input.status ?? "PENDING",
    source: input.source ?? previous?.source ?? null,
    row_count: 0,
    dataset_version: null,
    content_sha256: null,
    snapshot_path: null,
    raw_paths: [],
    captured_at: null,
    error: input.error ?? null,
    attempts: Number(previous?.attempts || 0) + 1,
    first_attempt_at: previous?.first_attempt_at || nowIso,
    last_attempt_at: nowIso,
    next_retry_at: nextRetryAt(nowIso, input.retryMinutes ?? 10),
  };
}

export function mergeReadyMonotonic(existing: MarketManifestLayer | null | undefined, incoming: MarketManifestLayer) {
  if (existing?.status === "READY") return existing;
  return incoming;
}

export function dueLayerKeys(existingLayers: MarketManifestLayer[] | undefined, nowIso: string) {
  const existing = new Map((existingLayers || []).map((layer) => [marketLayerKey(layer), layer]));
  const now = new Date(nowIso).getTime();
  const policy = getMarketDataCapturePolicy();
  const allowed = policy.allowedKinds?.length ? new Set(policy.allowedKinds) : null;
  const checkpointStart = policy.checkpointStartedAt ? new Date(policy.checkpointStartedAt).getTime() : null;

  return EXPECTED_MARKET_DATA_LAYERS.filter((identity) => {
    if (allowed && !allowed.has(identity.kind)) return false;
    const layer = existing.get(marketLayerKey(identity));
    if (layer?.status === "READY") return false;

    // During a DAILY checkpoint window, a missing layer may be attempted at
    // most once in that checkpoint. Later 5-minute wakes only continue units
    // that have not yet been attempted since checkpointStartedAt.
    if (checkpointStart != null && layer?.last_attempt_at) {
      const lastAttempt = new Date(layer.last_attempt_at).getTime();
      if (Number.isFinite(lastAttempt) && lastAttempt >= checkpointStart) return false;
    }

    if (!layer) return true;
    if (!layer.next_retry_at) return true;
    const next = new Date(layer.next_retry_at).getTime();
    return !Number.isFinite(next) || next <= now;
  }).map(marketLayerKey);
}

export function summarizeDay(layers: MarketManifestLayer[]) {
  const ready = layers.filter((layer) => layer.status === "READY").length;
  return {
    ready_layers: ready,
    expected_layers: EXPECTED_MARKET_DATA_LAYERS.length,
    terminal: ready === EXPECTED_MARKET_DATA_LAYERS.length,
    day_status: ready === EXPECTED_MARKET_DATA_LAYERS.length ? "COMPLETE" as const : "PARTIAL" as const,
    missing_layers: layers.filter((layer) => layer.status !== "READY").map(marketLayerKey),
  };
}
