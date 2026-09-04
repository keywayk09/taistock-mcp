import { pathToFileURL } from "node:url";

export const BROKER_PRODUCTION_PROBE_VERSION = "broker-production-readonly-probe/v1.0.0";
export const MODERN_MCP_PROTOCOL_VERSION = "2026-07-28";
export const LEGACY_MCP_PROTOCOL_VERSION = "2025-06-18";
export const DEFAULT_PRODUCTION_ENDPOINT = "https://taistock-mcp.keywayk09.workers.dev/my-mcp";
export const PRODUCTION_CONFIRMATION = "READ_ONLY_PRODUCTION_PROBE";
export const DEFAULT_BROKER_SYMBOL = "2317";
export const DEFAULT_BROKER_DATE = "2026-09-04";
export const EXPECTED_WINDOWS = Object.freeze([1, 5, 10, 20, 60]);

function parseSse(text) {
  const payloads = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const value = line.slice(5).trim();
    if (!value || value === "[DONE]") continue;
    try { payloads.push(JSON.parse(value)); } catch { /* ignore metadata */ }
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

async function postRpc({ fetcher, endpoint, bearerToken, protocolVersion, sessionId, method, params, id, notification = false }) {
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
    response = await fetcher(endpoint, {
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
  };
}

async function modernSession(fetcher, endpoint, bearerToken) {
  const listed = await postRpc({
    fetcher,
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

async function legacySession(fetcher, endpoint, bearerToken) {
  const initialized = await postRpc({
    fetcher,
    endpoint,
    bearerToken,
    protocolVersion: LEGACY_MCP_PROTOCOL_VERSION,
    method: "initialize",
    params: {
      protocolVersion: LEGACY_MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "broker-production-readonly-probe", version: BROKER_PRODUCTION_PROBE_VERSION },
    },
    id: 1,
  });
  const sessionId = initialized.sessionId;
  if (!sessionId) throw new Error("protocol_error:legacy_initialize_missing_session_id");
  const negotiated = String(initialized.payload?.result?.protocolVersion || LEGACY_MCP_PROTOCOL_VERSION);
  await postRpc({
    fetcher,
    endpoint,
    bearerToken,
    protocolVersion: negotiated,
    sessionId,
    method: "notifications/initialized",
    params: {},
    notification: true,
  });
  const listed = await postRpc({
    fetcher,
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

function normalizeEndpoint(value) {
  const url = new URL(String(value));
  if (!/^https?:$/.test(url.protocol)) throw new Error("endpoint_must_use_http_or_https");
  return url.toString();
}

function parseToolPayload(result) {
  if (result?.isError === true) throw new Error("tool_error:get_broker_chips");
  const content = Array.isArray(result?.content) ? result.content : [];
  for (const item of content) {
    if (item?.type !== "text" || typeof item.text !== "string") continue;
    try {
      const parsed = JSON.parse(item.text);
      if (parsed && typeof parsed === "object") return parsed;
    } catch { /* try next text item */ }
  }
  throw new Error("broker_tool_payload_missing_json_text");
}

function isReady(status) {
  return status === "READY" || status === "READY_EMPTY";
}

export function validateBrokerPayload(payload, { symbol, date, requireAllWindowsReady = true } = {}) {
  if (!payload || typeof payload !== "object") throw new Error("broker_payload_not_object");
  if (String(payload.symbol ?? "") !== String(symbol ?? "")) throw new Error("broker_symbol_mismatch");
  if (String(payload.date ?? "") !== String(date ?? "")) throw new Error("broker_date_mismatch");
  if (payload.previous_day_substitution !== false) throw new Error("broker_previous_day_substitution_forbidden");
  if (payload.missing_branch_means_zero !== false) throw new Error("broker_missing_branch_zero_forbidden");

  const evidence = payload.broker_evidence_contract ?? {};
  const multi = payload.multi_window ?? {};
  if (evidence.same_provider_required !== true || multi.same_provider_required !== true) throw new Error("broker_same_provider_contract_missing");
  if (evidence.same_requested_as_of_required !== true || multi.same_requested_as_of_required !== true) throw new Error("broker_same_as_of_contract_missing");
  if (evidence.cross_source_backfill_allowed !== false || multi.cross_source_backfill_allowed !== false) throw new Error("broker_cross_source_backfill_must_be_false");
  if (evidence.cross_provider_window_mixing !== false || multi.cross_provider_window_mixing !== false) throw new Error("broker_cross_provider_window_mixing_must_be_false");
  if (evidence.broker_identity_attribution_allowed !== false) throw new Error("broker_identity_attribution_must_be_false");
  if (evidence.window_comparison_semantics !== "NESTED_WINDOWS_SAME_END_DATE_NOT_TIME_SERIES") throw new Error("broker_window_semantics_mismatch");

  const requestedWindows = Array.isArray(multi.requested_windows) ? multi.requested_windows.map(Number) : [];
  if (JSON.stringify(requestedWindows) !== JSON.stringify(EXPECTED_WINDOWS)) throw new Error("broker_requested_windows_mismatch");
  const canonicalProviderId = String(multi.canonical_provider_id ?? payload.provider_id ?? "");
  if (!canonicalProviderId) throw new Error("broker_canonical_provider_missing");
  if (String(payload.provider_id ?? "") !== canonicalProviderId) throw new Error("broker_top_level_provider_mismatch");

  const summary = {
    "1D": {
      status: String(payload.status ?? "UNAVAILABLE"),
      provider_id: canonicalProviderId,
      source_date: payload.source_date ?? null,
      source_date_verified: payload.source_date_verified === true,
      source_range_verified: payload.source_date_verified === true,
      error: payload.error ?? null,
    },
  };
  const windows = multi.windows && typeof multi.windows === "object" ? multi.windows : {};
  for (const days of [5, 10, 20, 60]) {
    const key = `${days}D`;
    const row = windows[key];
    if (!row || typeof row !== "object") throw new Error(`broker_window_missing:${key}`);
    if (String(row.provider_id ?? "") !== canonicalProviderId) throw new Error(`broker_window_provider_mismatch:${key}`);
    const status = String(row.status ?? "UNAVAILABLE");
    if (isReady(status)) {
      if (String(row.source_date ?? "") !== String(date)) throw new Error(`broker_window_source_date_mismatch:${key}`);
      if (row.source_date_verified !== true) throw new Error(`broker_window_source_date_unverified:${key}`);
      if (row.source_range_verified !== true) throw new Error(`broker_window_range_unverified:${key}`);
    }
    summary[key] = {
      status,
      provider_id: row.provider_id ?? null,
      source_date: row.source_date ?? null,
      source_date_verified: row.source_date_verified === true,
      source_range_verified: row.source_range_verified === true,
      requested_range_start: row.requested_range_start ?? null,
      requested_range_end: row.requested_range_end ?? null,
      error: row.error ?? null,
    };
  }

  if (isReady(summary["1D"].status)) {
    if (String(summary["1D"].source_date ?? "") !== String(date)) throw new Error("broker_1d_source_date_mismatch");
    if (summary["1D"].source_date_verified !== true) throw new Error("broker_1d_source_date_unverified");
  }
  const readyCount = Object.values(summary).filter((row) => isReady(row.status)).length;
  if (requireAllWindowsReady && readyCount !== EXPECTED_WINDOWS.length) {
    throw new Error(`broker_not_all_windows_ready:${readyCount}/${EXPECTED_WINDOWS.length}`);
  }

  return {
    status: requireAllWindowsReady ? "PASS" : readyCount > 0 ? "PASS" : "FAIL",
    requested_windows: [...EXPECTED_WINDOWS],
    ready_window_count: readyCount,
    all_windows_ready: readyCount === EXPECTED_WINDOWS.length,
    canonical_provider_id: canonicalProviderId,
    canonical_provider_name: multi.canonical_provider_name ?? payload.provider ?? null,
    bundle_status: multi.status ?? null,
    bundle_failover_used: multi.bundle_failover_used === true,
    same_provider_required: true,
    same_requested_as_of_required: true,
    cross_source_backfill_allowed: false,
    cross_provider_window_mixing: false,
    broker_identity_attribution_allowed: false,
    window_comparison_semantics: "NESTED_WINDOWS_SAME_END_DATE_NOT_TIME_SERIES",
    windows: summary,
  };
}

export async function probeBrokerMcpEndpoint(options = {}) {
  const endpoint = normalizeEndpoint(options.endpoint || DEFAULT_PRODUCTION_ENDPOINT);
  const bearerToken = String(options.bearerToken || "");
  const fetcher = options.fetcher || fetch;
  const symbol = String(options.symbol || DEFAULT_BROKER_SYMBOL);
  const date = String(options.date || DEFAULT_BROKER_DATE);
  if (!/^\d{4,6}$/.test(symbol)) throw new Error("invalid_broker_symbol");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("invalid_broker_date");

  let context;
  let modernFailure = null;
  try {
    context = await modernSession(fetcher, endpoint, bearerToken);
  } catch (error) {
    modernFailure = error instanceof Error ? error.message : String(error);
    try {
      context = await legacySession(fetcher, endpoint, bearerToken);
    } catch (legacyError) {
      const legacyMessage = legacyError instanceof Error ? legacyError.message : String(legacyError);
      throw new Error(`protocol_negotiation_failed:modern=${modernFailure};legacy=${legacyMessage}`);
    }
  }

  const visibleTools = context.tools.map((tool) => String(tool?.name ?? "")).filter(Boolean);
  if (!visibleTools.includes("get_broker_chips")) throw new Error("missing_expected_tool:get_broker_chips");
  const called = await postRpc({
    fetcher,
    endpoint,
    bearerToken,
    protocolVersion: context.protocolVersion,
    sessionId: context.sessionId,
    method: "tools/call",
    params: { name: "get_broker_chips", arguments: { symbol, date, top_n: 20 } },
    id: context.nextId++,
  });
  const payload = parseToolPayload(called.payload?.result);
  const validation = validateBrokerPayload(payload, {
    symbol,
    date,
    requireAllWindowsReady: options.requireAllWindowsReady !== false,
  });
  return {
    schema: "BROKER_PRODUCTION_READONLY_PROBE_RECEIPT_V1",
    probe_version: BROKER_PRODUCTION_PROBE_VERSION,
    status: validation.status,
    protocol_lane: context.protocol_lane,
    negotiated_protocol_version: context.protocolVersion,
    endpoint_origin: new URL(endpoint).origin,
    symbol,
    date,
    expected_tool: "get_broker_chips",
    bearer_token_present: Boolean(bearerToken),
    production_mutation: "NONE",
    ...validation,
  };
}

function redact(text, secret) {
  if (!secret) return String(text);
  return String(text).split(secret).join("[REDACTED]");
}

export async function runCli(env = process.env) {
  const endpoint = normalizeEndpoint(env.BROKER_PROBE_ENDPOINT || DEFAULT_PRODUCTION_ENDPOINT);
  const production = new URL(endpoint).origin === new URL(DEFAULT_PRODUCTION_ENDPOINT).origin;
  if (production && env.BROKER_PROBE_CONFIRMATION !== PRODUCTION_CONFIRMATION) {
    throw new Error(`production_confirmation_required:${PRODUCTION_CONFIRMATION}`);
  }
  const receipt = await probeBrokerMcpEndpoint({
    endpoint,
    bearerToken: env.BROKER_PROBE_TOKEN || "",
    symbol: env.BROKER_PROBE_SYMBOL || DEFAULT_BROKER_SYMBOL,
    date: env.BROKER_PROBE_DATE || DEFAULT_BROKER_DATE,
    requireAllWindowsReady: true,
  });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const secret = process.env.BROKER_PROBE_TOKEN || "";
  runCli().catch((error) => {
    process.stderr.write(`${redact(error instanceof Error ? error.message : String(error), secret)}\n`);
    process.exitCode = 1;
  });
}
