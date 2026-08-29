import { readFormalBlindOhlc, FORMAL_BLIND_OHLC_READER_VERSION } from "./formal-blind-ohlc-reader.ts";
import { getTwMarketCrossSection, MARKET_DATA_CROSS_SECTION_VERSION } from "./market-data-cross-section.ts";
import { createCrossAccountReadService, CROSS_ACCOUNT_READ_SERVICE_VERSION } from "./cross-account-read-service.ts";
import { readGitHubJson } from "./github-data-store.ts";

export const AUTOMATION_RESEARCH_REST_VERSION = "automation-research-rest/v1.0.0";
const ROOT = "/research/automation";
const PAGE_SIZE = 80;
const MAX_MARKET_LOOKBACK_DAYS = 14;
const FORMAL_BLIND_CANARY = Object.freeze({
  symbol: "2426",
  trade_date: "2026-08-27",
  timeframe: "1m" as const,
  decision_time: "10:00:00",
  limit: 300,
});

type AnyRecord = Record<string, any>;
type DailyManifest = {
  trade_date?: string;
  day_status?: string;
  terminal?: boolean;
  ready_layers?: number;
  expected_layers?: number;
  missing_layers?: unknown[];
  index_state?: { status?: string; completed_prefixes?: string[]; total_prefixes?: number };
};

function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value); }
function validRevision(value: string) { return /^[0-9a-f]{40}$/i.test(value); }
function validSymbol(value: string) { return /^\d{4,6}$/.test(value); }
function validDecisionTime(value: string) { return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value); }
function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function subtractDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}
function taipeiDate(ms = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ms));
}
function manifestPath(date: string) {
  const [year, month, day] = date.split("-");
  return `data/market-data/daily/${year}/${month}/${day}/manifest.json`;
}
function manifestReady(value: DailyManifest | null, date: string) {
  const prefixes = value?.index_state?.completed_prefixes ?? [];
  return value?.trade_date === date
    && value?.day_status === "COMPLETE"
    && Number(value?.ready_layers) === Number(value?.expected_layers)
    && Number(value?.expected_layers) === 8
    && Array.isArray(value?.missing_layers)
    && value!.missing_layers!.length === 0
    && value?.index_state?.status === "READY"
    && ["0","1","2","3","4","5","6","7","8","9"].every((prefix) => prefixes.includes(prefix));
}
function pinnedEnv(env: Env, revision: string): Env {
  return { ...(env as any), GITHUB_DATA_BRANCH: revision } as Env;
}
function esc(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function commonHeaders(contentType: string) {
  return {
    "content-type": contentType,
    "cache-control": "no-store, max-age=0",
    "x-robots-tag": "noindex, nofollow, noarchive",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value, null, 2), { status, headers: commonHeaders("application/json; charset=utf-8") });
}
function html(title: string, body: string, status = 200) {
  return new Response(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body><h1>${esc(title)}</h1>${body}</body></html>`, {
    status, headers: commonHeaders("text/html; charset=utf-8"),
  });
}
function blocked(error: string, extra: AnyRecord = {}) {
  return json({ ok: false, blocked: true, bridge_version: AUTOMATION_RESEARCH_REST_VERSION, error, ...extra });
}
function queryHref(path: string, params: Record<string, string | number | null | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined) query.set(key, String(value));
  return `${ROOT}${path}?${query.toString()}`;
}

async function latestCompleteMarketDate(env: Env, startDate = taipeiDate()) {
  for (let offset = 0; offset < MAX_MARKET_LOOKBACK_DAYS; offset += 1) {
    const date = subtractDays(startDate, offset);
    const read = await readGitHubJson<DailyManifest>(env, manifestPath(date));
    if (read.exists && manifestReady(read.value, date)) return { date, manifest_sha: read.sha };
  }
  return null;
}

function compactBlindResult(result: AnyRecord) {
  return {
    ok: result.ok === true,
    blocked: result.blocked === true,
    bridge_version: AUTOMATION_RESEARCH_REST_VERSION,
    formal_reader_version: result.formal_reader_version ?? FORMAL_BLIND_OHLC_READER_VERSION,
    market: result.market ?? "tw-stock",
    symbol: result.symbol ?? null,
    trade_date: result.trade_date ?? null,
    timeframe: result.timeframe ?? null,
    mode: result.mode ?? null,
    source: result.source ?? null,
    source_sha: result.source_sha ?? null,
    dataset_id: result.dataset_id ?? null,
    dataset_version: result.dataset_version ?? null,
    dataset_hash: result.dataset_hash ?? null,
    row_count: result.row_count ?? 0,
    returned: result.returned ?? 0,
    cutoff: result.cutoff ?? null,
    leakage_validated: result.leakage_validated === true,
    formal_blind_eligible: result.formal_blind_eligible === true,
    formal_research_eligible: result.formal_research_eligible === true,
    scorecard_eligible: result.scorecard_eligible === true,
    eligibility_reason: result.eligibility_reason ?? result.error ?? null,
    canonical_verification_receipt: result.canonical_verification_receipt ?? null,
    rows: Array.isArray(result.rows) ? result.rows : [],
  };
}

async function routeFormalBlind(env: Env, url: URL) {
  const symbol = String(url.searchParams.get("symbol") ?? "").trim();
  const tradeDate = String(url.searchParams.get("trade_date") ?? "").trim();
  const timeframe = String(url.searchParams.get("timeframe") ?? "1m").trim();
  const decisionTime = String(url.searchParams.get("decision_time") ?? "").trim();
  const limit = clampInt(url.searchParams.get("limit"), 300, 1, 600);
  if (!validSymbol(symbol)) return blocked("INVALID_SYMBOL");
  if (!validDate(tradeDate)) return blocked("INVALID_TRADE_DATE");
  if (timeframe !== "1m" && timeframe !== "5m") return blocked("INVALID_TIMEFRAME");
  if (!validDecisionTime(decisionTime)) return blocked("INVALID_DECISION_TIME");
  const result = await readFormalBlindOhlc(env, {
    symbol, trade_date: tradeDate, timeframe: timeframe as "1m" | "5m", decision_time: decisionTime, limit,
  });
  return json(compactBlindResult(result as AnyRecord));
}

async function routeFormalBlindCanary(env: Env) {
  const result = await readFormalBlindOhlc(env, FORMAL_BLIND_CANARY);
  const compact = compactBlindResult(result as AnyRecord);
  return json({ ...compact, canary: true, policy: "NO_MODEL_SIDE_SLICE;SERVER_SIDE_CUTOFF_ONLY" });
}

async function routeMarketLatest(env: Env) {
  const latest = await latestCompleteMarketDate(env);
  if (!latest) return blocked("NO_COMPLETE_MARKET_DATA_IN_LOOKBACK_WINDOW");
  const probe = await getTwMarketCrossSection(env, { as_of: latest.date, prefix: "0", limit: 1, calendar_days: 20 }) as AnyRecord;
  const revision = String(probe.source_revision ?? "");
  if (probe.formal_research_eligible !== true || !validRevision(revision)) {
    return blocked("LATEST_MARKET_DATA_NOT_FORMAL", { as_of: latest.date, source_revision: revision || null, probe_gate: probe.data_gate ?? null });
  }
  const links = ["0","1","2","3","4","5","6","7","8","9"].map((prefix) => {
    const href = queryHref("/market", { as_of: latest.date, source_revision: revision, prefix, page: 1 });
    return `<li><a href="${esc(href)}">prefix ${prefix}</a></li>`;
  }).join("");
  return html("Automation Market Data", `<p>formal_research_eligible=true</p><p>as_of=${esc(latest.date)}</p><p>source_revision=${esc(revision)}</p><p>manifest_sha=${esc(latest.manifest_sha)}</p><ul>${links}</ul>`);
}

function metric(row: AnyRecord, path: string) {
  let value: any = row;
  for (const key of path.split(".")) value = value?.[key];
  return value === null || value === undefined ? "" : String(value);
}

async function routeMarket(env: Env, url: URL) {
  const asOf = String(url.searchParams.get("as_of") ?? "").trim();
  const revision = String(url.searchParams.get("source_revision") ?? "").trim();
  const prefix = String(url.searchParams.get("prefix") ?? "").trim();
  const page = clampInt(url.searchParams.get("page"), 1, 1, 50);
  if (!validDate(asOf)) return blocked("INVALID_AS_OF");
  if (!validRevision(revision)) return blocked("INVALID_SOURCE_REVISION");
  if (!/^[0-9]$/.test(prefix)) return blocked("INVALID_PREFIX");

  const result = await getTwMarketCrossSection(pinnedEnv(env, revision), {
    as_of: asOf, prefix, limit: 2500, calendar_days: 20,
  }) as AnyRecord;
  if (String(result.source_revision ?? "").toLowerCase() !== revision.toLowerCase()) {
    return blocked("SOURCE_REVISION_MISMATCH", { requested: revision, actual: result.source_revision ?? null });
  }
  if (result.formal_research_eligible !== true) {
    return blocked("MARKET_DATA_NOT_FORMAL", { as_of: asOf, source_revision: revision, prefix, data_gate: result.data_gate ?? null, scan: result.scan ?? null });
  }

  const symbols = Array.isArray(result.symbols) ? result.symbols : [];
  const start = (page - 1) * PAGE_SIZE;
  const pageRows = symbols.slice(start, start + PAGE_SIZE);
  const rows = pageRows.map((row: AnyRecord) => {
    const ohlc = queryHref("/ohlc-1d", { symbol: row.symbol, as_of: asOf, source_revision: revision, limit: 220 });
    return `<tr><td><a href="${esc(ohlc)}">${esc(row.symbol)}</a></td><td>${esc(row.name)}</td><td>${esc(row.market)}</td><td>${esc(row.data_as_of)}</td><td>${esc(metric(row,"institutional.net_1d"))}</td><td>${esc(metric(row,"institutional.net_3d"))}</td><td>${esc(metric(row,"institutional.net_5d"))}</td><td>${esc(metric(row,"margin.margin_change_1d"))}</td><td>${esc(metric(row,"margin.margin_change_3d"))}</td><td>${esc(metric(row,"margin.margin_change_5d"))}</td><td>${esc(metric(row,"securities_lending.net_borrowed_1d"))}</td><td>${esc(metric(row,"sbl_short_sale.sold_1d"))}</td></tr>`;
  }).join("");
  const prev = page > 1 ? `<a href="${esc(queryHref("/market", { as_of: asOf, source_revision: revision, prefix, page: page - 1 }))}">上一頁</a>` : "";
  const next = start + PAGE_SIZE < symbols.length ? `<a href="${esc(queryHref("/market", { as_of: asOf, source_revision: revision, prefix, page: page + 1 }))}">下一頁</a>` : "";
  return html(`Market prefix ${prefix} page ${page}`, `<p>formal_research_eligible=true</p><p>source_revision=${esc(revision)}</p><p>symbols=${esc(symbols.length)} page_size=${PAGE_SIZE}</p><p>${prev} ${next}</p><table border="1"><thead><tr><th>symbol</th><th>name</th><th>market</th><th>as_of</th><th>inst1</th><th>inst3</th><th>inst5</th><th>margin1</th><th>margin3</th><th>margin5</th><th>lend1</th><th>sbl1</th></tr></thead><tbody>${rows}</tbody></table><p>${prev} ${next}</p>`);
}

async function routeOhlc1d(env: Env, url: URL) {
  const symbol = String(url.searchParams.get("symbol") ?? "").trim();
  const asOf = String(url.searchParams.get("as_of") ?? "").trim();
  const revision = String(url.searchParams.get("source_revision") ?? "").trim();
  const limit = clampInt(url.searchParams.get("limit"), 220, 20, 420);
  if (!validSymbol(symbol)) return blocked("INVALID_SYMBOL");
  if (!validDate(asOf)) return blocked("INVALID_AS_OF");
  if (!validRevision(revision)) return blocked("INVALID_SOURCE_REVISION");

  const service = createCrossAccountReadService(pinnedEnv(env, revision));
  const result = await service.readOhlc({ symbol, timeframe: "1d", from: subtractDays(asOf, 560), to: asOf, limit }) as AnyRecord;
  if (result.ok !== true || result.formal_research_eligible !== true) {
    return blocked("OHLC_1D_NOT_FORMAL", { symbol, as_of: asOf, source_revision: revision, reader_error: result.error ?? result.data_status ?? null });
  }
  const provenanceRevision = String(result.provenance?.branch ?? "");
  if (provenanceRevision.toLowerCase() !== revision.toLowerCase()) {
    return blocked("OHLC_SOURCE_REVISION_MISMATCH", { requested: revision, actual: provenanceRevision || null });
  }
  return json({
    ok: true,
    blocked: false,
    bridge_version: AUTOMATION_RESEARCH_REST_VERSION,
    reader_version: CROSS_ACCOUNT_READ_SERVICE_VERSION,
    symbol,
    as_of: asOf,
    source_revision: revision,
    data_status: result.data_status,
    formal_research_eligible: true,
    verification_level: result.verification_level,
    dataset_id: result.dataset_id,
    dataset_version: result.dataset_version,
    dataset_hash: result.dataset_hash,
    provenance: result.provenance,
    row_count: result.row_count,
    returned: result.returned,
    rows: result.rows,
  });
}

function rootPage() {
  return html("TaiStock Automation Research Bridge", `
    <p>version=${esc(AUTOMATION_RESEARCH_REST_VERSION)}</p>
    <p>READ ONLY. This transport does not write research artifacts and does not replace locked research rules.</p>
    <ul>
      <li><a href="${ROOT}/health">bridge health</a></li>
      <li><a href="${ROOT}/formal-blind-canary">formal Blind canary</a></li>
      <li><a href="${ROOT}/market-latest">latest COMPLETE market-data revision</a></li>
    </ul>
    <p>Formal Blind template: ${esc(`${ROOT}/formal-blind?symbol=2330&trade_date=YYYY-MM-DD&timeframe=1m&decision_time=HH:MM:SS&limit=300`)}</p>
    <p>The automation remains responsible for frozen-universe, immutable receipt ordering, create-only persistence, STOCK/TXF separation, and all locked review semantics.</p>
  `);
}

export async function handleAutomationResearchRest(request: Request, env: Env, url = new URL(request.url)): Promise<Response | null> {
  if (!url.pathname.startsWith(ROOT)) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return json({ ok: false, blocked: true, error: "METHOD_NOT_ALLOWED" }, 405);

  let response: Response;
  try {
    if (url.pathname === ROOT || url.pathname === `${ROOT}/`) response = rootPage();
    else if (url.pathname === `${ROOT}/health`) response = json({
      ok: true,
      read_only: true,
      version: AUTOMATION_RESEARCH_REST_VERSION,
      formal_blind_reader: FORMAL_BLIND_OHLC_READER_VERSION,
      market_cross_section_reader: MARKET_DATA_CROSS_SECTION_VERSION,
      stock_ohlc_reader: CROSS_ACCOUNT_READ_SERVICE_VERSION,
      persistence: "NONE",
      arbitrary_path_access: false,
      arbitrary_url_access: false,
      writer_routes: false,
    });
    else if (url.pathname === `${ROOT}/formal-blind-canary`) response = await routeFormalBlindCanary(env);
    else if (url.pathname === `${ROOT}/formal-blind`) response = await routeFormalBlind(env, url);
    else if (url.pathname === `${ROOT}/market-latest`) response = await routeMarketLatest(env);
    else if (url.pathname === `${ROOT}/market`) response = await routeMarket(env, url);
    else if (url.pathname === `${ROOT}/ohlc-1d`) response = await routeOhlc1d(env, url);
    else response = json({ ok: false, blocked: true, error: "NOT_FOUND" }, 404);
  } catch (error) {
    response = blocked("BRIDGE_INTERNAL_FAIL_CLOSED", { detail: error instanceof Error ? error.message : String(error) });
  }

  if (request.method === "HEAD") return new Response(null, { status: response.status, headers: response.headers });
  return response;
}
