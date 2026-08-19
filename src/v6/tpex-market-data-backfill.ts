import {
  normalizeTradeDate,
  normalizeTpexInstitutional,
  normalizeTpexMargin,
  type InstitutionalRow,
  type MarginRow,
  type TwMarketDataKind,
} from "./tw-market-data";
import { ensureTwMarketDataD1Schema } from "./tw-market-data-d1";
import { fetchTpexOfficialPayload } from "./tpex-official-relay";

const VERSION = "diamond-tw-market-data/v1.1.2-d1";

type OfficialRow = InstitutionalRow | MarginRow;

type BackfillJob = {
  kind: TwMarketDataKind;
  label: string;
  failureSource: string;
};

const JOBS: BackfillJob[] = [
  {
    kind: "institutional",
    label: "TPEX_3INSTI",
    failureSource: "TPEX_3INSTI_DAILY_TRADING",
  },
  {
    kind: "margin",
    label: "TPEX_MARGIN",
    failureSource: "TPEX_MAINBOARD_MARGIN_BALANCE",
  },
];

function rec(value: unknown): Record<string, any> {
  return value !== null && typeof value === "object" ? value as Record<string, any> : {};
}

function sourceDateFromBody(body: unknown): string | null {
  const root = rec(body);
  const direct = normalizeTradeDate(root.date ?? root.Date ?? root["資料日期"] ?? root["日期"]);
  if (direct) return direct;
  const rows = Array.isArray(body) ? body : Array.isArray(root.data) ? root.data : [];
  for (const value of rows) {
    const row = rec(value);
    const date = normalizeTradeDate(row.Date ?? row.date ?? row["資料日期"] ?? row["日期"] ?? row.TradeDate);
    if (date) return date;
  }
  return null;
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

async function archiveReady(env: Env, input: {
  trade_date: string;
  kind: TwMarketDataKind;
  source: string;
  rows: OfficialRow[];
}) {
  const rows = [...input.rows].sort((a, b) => a.symbol.localeCompare(b.symbol));
  if (!rows.length) throw new Error(`official_rows_empty:${input.kind}:otc:${input.trade_date}`);
  const content = {
    schema_version: VERSION,
    trade_date: input.trade_date,
    market: "otc",
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
    "otc",
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
    market: "otc",
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
    "otc",
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

export async function runTpexMarketDataBackfill(env: Env, tradeDate: string) {
  await ensureTwMarketDataD1Schema(env);
  const results: any[] = [];
  for (const job of JOBS) {
    try {
      const fetched = await fetchTpexOfficialPayload(job.kind, tradeDate);
      const sourceDate = sourceDateFromBody(fetched.body);
      if (sourceDate !== tradeDate) {
        throw new Error(`${job.label}_source_date_mismatch:expected=${tradeDate}:actual=${sourceDate ?? "unknown"}`);
      }
      const rows = job.kind === "institutional"
        ? normalizeTpexInstitutional(fetched.body, tradeDate)
        : normalizeTpexMargin(fetched.body, tradeDate);
      const archived = await archiveReady(env, {
        trade_date: tradeDate,
        kind: job.kind,
        source: fetched.source,
        rows,
      });
      results.push({
        kind: job.kind,
        market: "otc",
        status: "READY",
        rows: rows.length,
        source: fetched.source,
        transport: fetched.transport,
        direct_error: fetched.direct_error,
        relay_sha256: "relay_sha256" in fetched ? fetched.relay_sha256 : null,
        ...archived,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let receipt: any = null;
      try {
        receipt = await archiveFailure(env, {
          trade_date: tradeDate,
          kind: job.kind,
          source: job.failureSource,
          error: message,
        });
      } catch (receiptError) {
        receipt = { receipt_error: receiptError instanceof Error ? receiptError.message : String(receiptError) };
      }
      results.push({
        kind: job.kind,
        market: "otc",
        status: "DEGRADED",
        rows: 0,
        source: job.failureSource,
        error: message,
        ...receipt,
      });
    }
  }
  return {
    ok: true,
    version: VERSION,
    mode: "TPEX_ONLY_BACKFILL_WITH_OFFICIAL_RELAY",
    trade_date: tradeDate,
    blocking: false,
    market_data_failure_blocks_ohlc: false,
    results,
  };
}
