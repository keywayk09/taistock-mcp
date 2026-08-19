import {
  normalizeTradeDate,
  normalizeTwseInstitutional,
  normalizeTwseMargin,
  type InstitutionalRow,
  type MarginRow,
  type TwMarketDataKind,
} from "./tw-market-data";
import { ensureTwMarketDataD1Schema } from "./tw-market-data-d1";

const VERSION = "diamond-tw-market-data/v1.1.1-d1";
const TWSE_T86 = "https://www.twse.com.tw/rwd/zh/fund/T86";
const TWSE_MARGIN = "https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN";
const FETCH_TIMEOUT_MS = 12_000;

type OfficialRow = InstitutionalRow | MarginRow;

type ListedJob = {
  kind: TwMarketDataKind;
  source: string;
};

const JOBS: ListedJob[] = [
  { kind: "institutional", source: "TWSE_T86" },
  { kind: "margin", source: "TWSE_MI_MARGN" },
];

function compactDate(date: string) {
  return date.replace(/-/g, "");
}

function rec(value: unknown): Record<string, any> {
  return value !== null && typeof value === "object" ? value as Record<string, any> : {};
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source).sort().map((key) => [key, stableValue(source[key])]));
  }
  return value === undefined ? null : value;
}

async function sha256(value: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(stableValue(value))),
  );
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function fetchJson(url: URL, label: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Diamond-Market-Data-D1/1.1",
      },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${label}_http_${response.status}:${text.slice(0, 180)}`);
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`${label}_invalid_json:${text.slice(0, 180)}`);
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${label}_timeout_${FETCH_TIMEOUT_MS}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchListed(job: ListedJob, tradeDate: string) {
  if (job.kind === "institutional") {
    const url = new URL(TWSE_T86);
    url.searchParams.set("date", compactDate(tradeDate));
    url.searchParams.set("selectType", "ALLBUT0999");
    url.searchParams.set("response", "json");
    const body = await fetchJson(url, "TWSE_T86");
    const sourceDate = normalizeTradeDate(rec(body).date);
    const rows = normalizeTwseInstitutional(body, tradeDate);
    return { sourceDate, rows };
  }

  const url = new URL(TWSE_MARGIN);
  url.searchParams.set("date", compactDate(tradeDate));
  url.searchParams.set("selectType", "ALL");
  url.searchParams.set("response", "json");
  const body = await fetchJson(url, "TWSE_MI_MARGN");
  const sourceDate = normalizeTradeDate(rec(body).date);
  const rows = normalizeTwseMargin(body, tradeDate);
  return { sourceDate, rows };
}

async function archiveReady(env: Env, input: {
  trade_date: string;
  kind: TwMarketDataKind;
  source: string;
  rows: OfficialRow[];
}) {
  const rows = [...input.rows].sort((a, b) => a.symbol.localeCompare(b.symbol));
  if (!rows.length) throw new Error(`official_rows_empty:${input.kind}:listed:${input.trade_date}`);
  const content = {
    schema_version: VERSION,
    trade_date: input.trade_date,
    market: "listed",
    kind: input.kind,
    source: input.source,
    rows,
  };
  const hash = await sha256(content);
  const datasetVersion = `sha256:${hash}`;
  const existing = await env.RESEARCH_DB.prepare(
    `SELECT dataset_version FROM tw_market_data_snapshot_d1 WHERE dataset_version=?`
  ).bind(datasetVersion).first<any>();
  if (existing) return { dataset_version: datasetVersion, idempotent: true };

  for (let i = 0; i < rows.length; i += 100) {
    const statements = rows.slice(i, i + 100).map((row) => env.RESEARCH_DB.prepare(
      `INSERT OR IGNORE INTO tw_market_data_row_d1(dataset_version,symbol,payload_json) VALUES(?,?,?)`
    ).bind(datasetVersion, row.symbol, JSON.stringify(row)));
    await env.RESEARCH_DB.batch(statements);
  }

  const capturedAt = new Date().toISOString();
  await env.RESEARCH_DB.prepare(`INSERT INTO tw_market_data_snapshot_d1(
    dataset_version,trade_date,market,kind,source,source_date_verified,row_count,status,content_sha256,captured_at,error
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(
    datasetVersion,
    input.trade_date,
    "listed",
    input.kind,
    input.source,
    1,
    rows.length,
    "READY",
    hash,
    capturedAt,
    null,
  ).run();
  return { dataset_version: datasetVersion, captured_at: capturedAt, idempotent: false };
}

async function archiveFailure(env: Env, input: {
  trade_date: string;
  kind: TwMarketDataKind;
  source: string;
  error: string;
}) {
  const capturedAt = new Date().toISOString();
  const content = {
    schema_version: VERSION,
    trade_date: input.trade_date,
    market: "listed",
    kind: input.kind,
    source: input.source,
    status: "DEGRADED",
    error: input.error,
    captured_at: capturedAt,
  };
  const hash = await sha256(content);
  const datasetVersion = `failure:${hash}`;
  await env.RESEARCH_DB.prepare(`INSERT OR IGNORE INTO tw_market_data_snapshot_d1(
    dataset_version,trade_date,market,kind,source,source_date_verified,row_count,status,content_sha256,captured_at,error
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(
    datasetVersion,
    input.trade_date,
    "listed",
    input.kind,
    input.source,
    0,
    0,
    "DEGRADED",
    hash,
    capturedAt,
    input.error,
  ).run();
  return { dataset_version: datasetVersion, captured_at: capturedAt };
}

export async function runTwseMarketDataCapture(env: Env, tradeDate: string) {
  await ensureTwMarketDataD1Schema(env);
  const results: any[] = [];
  for (const job of JOBS) {
    try {
      const fetched = await fetchListed(job, tradeDate);
      if (fetched.sourceDate !== tradeDate) {
        throw new Error(`${job.source}_source_date_mismatch:expected=${tradeDate}:actual=${fetched.sourceDate ?? "unknown"}`);
      }
      const archived = await archiveReady(env, {
        trade_date: tradeDate,
        kind: job.kind,
        source: job.source,
        rows: fetched.rows,
      });
      results.push({
        kind: job.kind,
        market: "listed",
        status: "READY",
        rows: fetched.rows.length,
        source: job.source,
        ...archived,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let receipt: any = null;
      try {
        receipt = await archiveFailure(env, {
          trade_date: tradeDate,
          kind: job.kind,
          source: job.source,
          error: message,
        });
      } catch (receiptError) {
        receipt = { receipt_error: receiptError instanceof Error ? receiptError.message : String(receiptError) };
      }
      results.push({
        kind: job.kind,
        market: "listed",
        status: "DEGRADED",
        rows: 0,
        source: job.source,
        error: message,
        ...receipt,
      });
    }
  }
  return {
    ok: true,
    version: VERSION,
    mode: "TWSE_ONLY_CAPTURE",
    trade_date: tradeDate,
    blocking: false,
    market_data_failure_blocks_ohlc: false,
    results,
  };
}
