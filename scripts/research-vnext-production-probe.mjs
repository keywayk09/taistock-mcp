import { pathToFileURL } from "node:url";

export const RESEARCH_VNEXT_PRODUCTION_PROBE_VERSION = "research-vnext-production-probe/v1.0.0";
export const MODERN_MCP_PROTOCOL_VERSION = "2026-07-28";
export const LEGACY_MCP_PROTOCOL_VERSION = "2025-06-18";
export const DEFAULT_PRODUCTION_ENDPOINT = "https://taistock-mcp.keywayk09.workers.dev/my-mcp";
export const PRODUCTION_CONFIRMATION = "READ_ONLY_PRODUCTION_PROBE";

const DEFAULT_EXPECTED_TOOLS = [
  "resolve_ambiguous_backtest_with_1m",
  "finalize_daily_review_run",
  "prepare_swing_selection_run",
];

const OHLC_1M_COLUMNS = [
  "symbol", "bar_time_tw", "ts_ms", "open", "high", "low", "close", "volume",
  "source", "updated_at_ms", "trade_date", "updated_at", "ingest_id", "export_batch", "export_status",
];
const SYNTHETIC_BUCKET = 1783991100000;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = stableValue(value[key]);
    return output;
  }
  return value === undefined ? null : value;
}

async function sha256Hex(value) {
  const payload = typeof value === "string" ? value : JSON.stringify(stableValue(value));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function syntheticBar(i, high, low) {
  const ts = SYNTHETIC_BUCKET + i * 60_000;
  return {
    symbol: "2330",
    bar_time_tw: `2026-07-14 09:${String(5 + i).padStart(2, "0")}:00+08:00`,
    ts_ms: String(ts),
    open: "100",
    high: String(high),
    low: String(low),
    close: "100",
    volume: "100",
    source: "fugle_intraday_1m",
    updated_at_ms: "1784017000000",
    trade_date: "2026-07-14",
    updated_at: "2026-07-14T08:00:00.000Z",
    ingest_id: `2330|${ts}`,
    export_batch: "research-vnext-production-probe",
    export_status: "verified",
  };
}

export async function buildSyntheticReplayArguments() {
  // This fixture is deliberately self-contained and reproduces the exact
  // dataset fingerprint required by the deterministic replay engine. It never
  // reads a provider, storage system, clock or Production data source.
  const bars = [syntheticBar(0, 101.6, 99.2), syntheticBar(1, 100.8, 99.4)];
  const sourceFiles = [{
    path: "data/OHLC/tw/1m/2026/07/14/2330.csv",
    sha: "a".repeat(40),
    trade_date: "2026-07-14",
  }];
  const canonicalFiles = sourceFiles.map((file) => ({
    path: file.path,
    sha: file.sha,
    trade_date: file.trade_date,
    year: null,
  }));
  const first = String(Number(bars[0].ts_ms));
  const last = String(Number(bars.at(-1).ts_ms));
  const rows = bars.map((row) => OHLC_1M_COLUMNS.map((key) => String(row[key])));
  const datasetHash = await sha256Hex({
    schema_version: "ohlc-dataset/v1",
    market: "tw-stock",
    symbol: "2330",
    timeframe: "1m",
    source: "github_historical",
    columns: [...OHLC_1M_COLUMNS],
    source_files: canonicalFiles,
    scope: { first, last, row_count: bars.length },
    rows,
  });

  const dataset = {
    schema_version: "ohlc-dataset/v1",
    dataset_id: `tw-stock:2330:1m:${first}:${last}:${bars.length}`,
    dataset_version: `sha256:${datasetHash}`,
    dataset_hash: datasetHash,
    frozen_view: true,
    complete_view: true,
    truncated: false,
    formal_research_eligible: true,
    row_count: bars.length,
    total_validated_rows: bars.length,
    source: "github_historical",
    source_files: sourceFiles,
    provenance: { market: "tw-stock", symbol: "2330", timeframe: "1m", source: "github_historical" },
  };

  const original = {
    schema_version: "diamond-backtest-result/v1",
    engine_version: "diamond-intraday-5m/v1.0.0",
    backtest_run_id: `bt:${"b".repeat(64)}`,
    deterministic: true,
    status: "OK",
    dataset_id: "research-vnext-probe-5m",
    dataset_version: `sha256:${"c".repeat(64)}`,
    dataset_hash: "c".repeat(64),
    signal_id: "research-vnext-production-probe",
    signal_version: "v1",
    symbol: "2330",
    side: "LONG",
    strategy: "research-vnext-probe",
    event: null,
    signal_ts_ms: SYNTHETIC_BUCKET - 60_000,
    parameter_version: `sha256:${"d".repeat(64)}`,
    parameter_hash: "d".repeat(64),
    parameters: {
      parameter_schema_version: "intraday-5m-parameters/v1",
      entry_rule: "NEXT_BAR_OPEN",
      stop_atr: 1,
      target_atr: 1.5,
      max_bars: 12,
      cost_rate_round_trip: 0.0004,
      tie_break: "STOP_FIRST",
      end_of_day_exit: true,
    },
    atr: 1,
    entry_ts_ms: SYNTHETIC_BUCKET,
    entry_bar_time_tw: "2026-07-14 09:05:00+08:00",
    entry_price: 100,
    stop_price: 99,
    target_price: 101.5,
    exit_ts_ms: SYNTHETIC_BUCKET,
    exit_bar_time_tw: "2026-07-14 09:05:00+08:00",
    exit_price: 99,
    exit_reason: "STOP",
    bars_held: 1,
    gross_return_pct: -1,
    cost_pct: 0.04,
    net_return_pct: -1.04,
    mfe_pct: 2,
    mae_pct: -2,
    mfe_r: 2,
    mae_r: -2,
    ambiguous_intrabar: true,
    intrabar_status: "AMBIGUOUS_INTRABAR",
    conservative_resolution: "STOP_FIRST",
    requires_1m_replay: true,
    provenance: {
      dataset_id: "research-vnext-probe-5m",
      dataset_version: `sha256:${"c".repeat(64)}`,
      dataset_hash: "c".repeat(64),
      signal_id: "research-vnext-production-probe",
      signal_version: "v1",
      parameter_version: `sha256:${"d".repeat(64)}`,
      engine_version: "diamond-intraday-5m/v1.0.0",
    },
  };

  return { original_5m_result: original, dataset_1m: dataset, bars_1m: bars };
}

function parseSse(text) {
  const payloads = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const value = line.slice(5).trim();
    if (!value || value === "[DONE]") continue;
    try { payloads.push(JSON.parse(value)); } catch { /* Ignore non-JSON SSE metadata. */ }
  }
  if (!payloads.length) throw new Error("protocol_error:sse_without_json_data");
  return payloads.at(-1);
}

function parseBody(text, contentType) {
  if (!text) return null;
  if (/text\/event-stream/i.test(contentType || "") || /^\s*(event:|data:)/m.test(text)) return parseSse(text);
  try { return JSON.parse(text); } catch {
    throw new Error("protocol_error:response_is_not_json_or_sse");
  }
}

function rpcErrorMessage(payload) {
  const error = payload?.error;
  if (!error) return null;
  const code = error.code === undefined ? "" : `${error.code}:`;
  return `${code}${String(error.message ?? "json_rpc_error")}`;
}

async function postRpc({ endpoint, bearerToken, protocolVersion, sessionId, method, params, id, notification = false }) {
  const headers = {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    "mcp-protocol-version": protocolVersion,
    "mcp-method": method,
  };
  if (bearerToken) headers.authorization = `Bearer ${bearerToken}`;
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const body = notification
    ? { jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) }
    : { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Error(`protocol_transport_error:${error instanceof Error ? error.message : String(error)}`);
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = parseBody(text, response.headers.get("content-type")); }
    catch (error) {
      if (!response.ok) throw new Error(`http_${response.status}:${text.slice(0, 200)}`);
      throw error;
    }
  }

  if (!response.ok) {
    const detail = rpcErrorMessage(payload) ?? text.slice(0, 200) ?? response.statusText;
    throw new Error(`http_${response.status}:${detail}`);
  }
  const rpcError = rpcErrorMessage(payload);
  if (rpcError) throw new Error(`json_rpc_error:${rpcError}`);

  return {
    payload,
    sessionId: response.headers.get("mcp-session-id") || sessionId || null,
    status: response.status,
  };
}

async function modernSession(endpoint, bearerToken) {
  const listed = await postRpc({
    endpoint,
    bearerToken,
    protocolVersion: MODERN_MCP_PROTOCOL_VERSION,
    method: "tools/list",
    params: {},
    id: 1,
  });
  const tools = listed.payload?.result?.tools;
  if (!Array.isArray(tools)) throw new Error("protocol_error:modern_tools_list_missing");
  return {
    protocol_lane: "MODERN_2026",
    protocolVersion: MODERN_MCP_PROTOCOL_VERSION,
    sessionId: null,
    tools,
    nextId: 2,
  };
}

async function legacySession(endpoint, bearerToken) {
  const initialized = await postRpc({
    endpoint,
    bearerToken,
    protocolVersion: LEGACY_MCP_PROTOCOL_VERSION,
    method: "initialize",
    params: {
      protocolVersion: LEGACY_MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "research-vnext-production-probe", version: RESEARCH_VNEXT_PRODUCTION_PROBE_VERSION },
    },
    id: 1,
  });
  const sessionId = initialized.sessionId;
  if (!sessionId) throw new Error("protocol_error:legacy_initialize_missing_session_id");
  const negotiated = String(initialized.payload?.result?.protocolVersion || LEGACY_MCP_PROTOCOL_VERSION);

  await postRpc({
    endpoint,
    bearerToken,
    protocolVersion: negotiated,
    sessionId,
    method: "notifications/initialized",
    params: {},
    notification: true,
  });

  const listed = await postRpc({
    endpoint,
    bearerToken,
    protocolVersion: negotiated,
    sessionId,
    method: "tools/list",
    params: {},
    id: 2,
  });
  const tools = listed.payload?.result?.tools;
  if (!Array.isArray(tools)) throw new Error("protocol_error:legacy_tools_list_missing");
  return {
    protocol_lane: "LEGACY_2025_SESSION",
    protocolVersion: negotiated,
    sessionId,
    tools,
    nextId: 3,
  };
}

async function callTool({ endpoint, bearerToken, context, name, arguments: args }) {
  const response = await postRpc({
    endpoint,
    bearerToken,
    protocolVersion: context.protocolVersion,
    sessionId: context.sessionId,
    method: "tools/call",
    params: { name, arguments: args },
    id: context.nextId++,
  });
  if (response.payload?.result?.isError === true) throw new Error(`tool_error:${name}`);
  return { status: "PASS" };
}

function normalizeEndpoint(value) {
  const url = new URL(String(value));
  if (!/^https?:$/.test(url.protocol)) throw new Error("endpoint_must_use_http_or_https");
  return url.toString();
}

export async function probeMcpEndpoint(options = {}) {
  const endpoint = normalizeEndpoint(options.endpoint);
  const bearerToken = String(options.bearerToken || "");
  const expectedTools = Array.isArray(options.expectedTools) && options.expectedTools.length
    ? [...new Set(options.expectedTools.map(String))]
    : [...DEFAULT_EXPECTED_TOOLS];

  let context;
  let modernFailure = null;
  try {
    context = await modernSession(endpoint, bearerToken);
  } catch (error) {
    modernFailure = error instanceof Error ? error.message : String(error);
    try {
      context = await legacySession(endpoint, bearerToken);
    } catch (legacyError) {
      const legacyMessage = legacyError instanceof Error ? legacyError.message : String(legacyError);
      throw new Error(`protocol_negotiation_failed:modern=${modernFailure};legacy=${legacyMessage}`);
    }
  }

  const visibleTools = context.tools.map((tool) => String(tool?.name ?? "")).filter(Boolean).sort();
  const missingTools = expectedTools.filter((name) => !visibleTools.includes(name));
  if (missingTools.length) throw new Error(`missing_expected_tools:${missingTools.join(",")}`);

  const calls = {};
  if (options.callReplay === true) {
    calls.resolve_ambiguous_backtest_with_1m = await callTool({
      endpoint,
      bearerToken,
      context,
      name: "resolve_ambiguous_backtest_with_1m",
      arguments: await buildSyntheticReplayArguments(),
    });
  }
  if (options.callReview === true) {
    const tradeDate = String(options.reviewTradeDate || options.swingTradeDate || "2026-08-31");
    calls.finalize_daily_review_run = await callTool({
      endpoint,
      bearerToken,
      context,
      name: "finalize_daily_review_run",
      arguments: { trade_date: tradeDate, stock_cases: [], txf_cases: [], persist_experiment: false },
    });
  }
  if (options.swingTradeDate) {
    const tradeDate = String(options.swingTradeDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) throw new Error("invalid_swing_trade_date");
    calls.prepare_swing_selection_run = await callTool({
      endpoint,
      bearerToken,
      context,
      name: "prepare_swing_selection_run",
      arguments: { trade_date: tradeDate, limit: 1, min_score: 0, max_horizon_days: 1 },
    });
  }

  return {
    schema: "RESEARCH_VNEXT_PRODUCTION_PROBE_RECEIPT_V1",
    probe_version: RESEARCH_VNEXT_PRODUCTION_PROBE_VERSION,
    status: "PASS",
    protocol_lane: context.protocol_lane,
    negotiated_protocol_version: context.protocolVersion,
    endpoint_origin: new URL(endpoint).origin,
    expected_tools: expectedTools,
    visible_expected_tools: expectedTools.filter((name) => visibleTools.includes(name)),
    missing_tools: missingTools,
    calls,
    bearer_token_present: Boolean(bearerToken),
    production_mutation: "NONE",
  };
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function redact(text, secret) {
  if (!secret) return String(text);
  return String(text).split(secret).join("[REDACTED]");
}

export async function runCli(env = process.env) {
  const endpoint = normalizeEndpoint(env.RESEARCH_VNEXT_PROBE_ENDPOINT || DEFAULT_PRODUCTION_ENDPOINT);
  const production = new URL(endpoint).origin === new URL(DEFAULT_PRODUCTION_ENDPOINT).origin;
  if (production && env.RESEARCH_VNEXT_PROBE_CONFIRMATION !== PRODUCTION_CONFIRMATION) {
    throw new Error(`production_confirmation_required:${PRODUCTION_CONFIRMATION}`);
  }

  const receipt = await probeMcpEndpoint({
    endpoint,
    bearerToken: env.RESEARCH_VNEXT_PROBE_TOKEN || "",
    expectedTools: DEFAULT_EXPECTED_TOOLS,
    callReview: truthy(env.RESEARCH_VNEXT_CALL_REVIEW),
    callReplay: truthy(env.RESEARCH_VNEXT_CALL_REPLAY),
    swingTradeDate: env.RESEARCH_VNEXT_SWING_TRADE_DATE || undefined,
  });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const secret = process.env.RESEARCH_VNEXT_PROBE_TOKEN || "";
  runCli().catch((error) => {
    process.stderr.write(`${redact(error instanceof Error ? error.message : String(error), secret)}\n`);
    process.exitCode = 1;
  });
}
