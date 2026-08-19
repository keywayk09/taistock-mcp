export type TpexRelayKind = "institutional" | "margin";

const DIRECT_ENDPOINTS: Record<TpexRelayKind, string> = {
  institutional: "https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading",
  margin: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance",
};

const RELAY_ROOT = "https://raw.githubusercontent.com/keywayk09/taistock-mcp/market-data-relay/data/market-data/tpex-relay";
const DIRECT_TIMEOUT_MS = 10_000;
const RELAY_TIMEOUT_MS = 10_000;

function browserHeaders() {
  return {
    Accept: "application/json,text/plain,*/*",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    Referer: "https://www.tpex.org.tw/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  };
}

async function sha256Text(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function fetchTextWithTimeout(url: string, timeoutMs: number, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`http_${response.status}:${text.slice(0, 180)}`);
    return text;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`timeout_${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text: string, label: string) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}_invalid_json:${text.slice(0, 180)}`);
  }
}

async function fetchDirect(kind: TpexRelayKind) {
  const endpoint = DIRECT_ENDPOINTS[kind];
  const text = await fetchTextWithTimeout(endpoint, DIRECT_TIMEOUT_MS, {
    headers: browserHeaders(),
  });
  const body = parseJson(text, `TPEX_${kind}_direct`);
  if (!Array.isArray(body) || !body.length) throw new Error(`TPEX_${kind}_direct_empty`);
  return {
    body,
    source: kind === "institutional" ? "TPEX_3INSTI_DAILY_TRADING" : "TPEX_MAINBOARD_MARGIN_BALANCE",
    transport: "TPEX_DIRECT" as const,
    direct_error: null,
  };
}

async function fetchRelay(kind: TpexRelayKind, tradeDate: string, directError: string) {
  const base = `${RELAY_ROOT}/${tradeDate}`;
  const manifestText = await fetchTextWithTimeout(`${base}/manifest.json`, RELAY_TIMEOUT_MS, {
    headers: { Accept: "application/json" },
  });
  const manifest = parseJson(manifestText, "TPEX_RELAY_manifest") as any;
  if (manifest?.schema !== "TPEX_OFFICIAL_RELAY_V1") throw new Error(`relay_schema_mismatch:${String(manifest?.schema ?? "missing")}`);
  if (manifest?.trade_date !== tradeDate) throw new Error(`relay_trade_date_mismatch:expected=${tradeDate}:actual=${String(manifest?.trade_date ?? "missing")}`);
  if (manifest?.source_owner !== "TPEx") throw new Error(`relay_source_owner_mismatch:${String(manifest?.source_owner ?? "missing")}`);

  const meta = manifest?.datasets?.[kind];
  if (!meta || typeof meta !== "object") throw new Error(`relay_dataset_missing:${kind}`);
  if (meta.source_date !== tradeDate) throw new Error(`relay_source_date_mismatch:${kind}:${String(meta.source_date ?? "missing")}`);
  if (!Number.isFinite(Number(meta.row_count)) || Number(meta.row_count) <= 0) throw new Error(`relay_row_count_invalid:${kind}`);
  if (!/^[0-9a-f]{64}$/i.test(String(meta.sha256 ?? ""))) throw new Error(`relay_sha_invalid:${kind}`);

  const file = kind === "institutional" ? "institutional.json" : "margin.json";
  if (meta.file !== file) throw new Error(`relay_file_mismatch:${kind}:${String(meta.file ?? "missing")}`);
  const payloadTextRaw = await fetchTextWithTimeout(`${base}/${file}`, RELAY_TIMEOUT_MS, {
    headers: { Accept: "application/json" },
  });
  const payloadText = payloadTextRaw.replace(/\s+$/, "");
  const actualSha = await sha256Text(payloadText);
  if (actualSha !== String(meta.sha256)) throw new Error(`relay_sha_mismatch:${kind}:expected=${meta.sha256}:actual=${actualSha}`);
  const body = parseJson(payloadText, `TPEX_RELAY_${kind}`);
  if (!Array.isArray(body) || body.length !== Number(meta.row_count)) {
    throw new Error(`relay_row_count_mismatch:${kind}:expected=${meta.row_count}:actual=${Array.isArray(body) ? body.length : -1}`);
  }

  return {
    body,
    source: kind === "institutional" ? "TPEX_3INSTI_DAILY_TRADING_GITHUB_RELAY" : "TPEX_MAINBOARD_MARGIN_BALANCE_GITHUB_RELAY",
    transport: "GITHUB_OFFICIAL_RELAY" as const,
    direct_error: directError,
    relay_sha256: actualSha,
    relay_captured_at: manifest?.captured_at_utc ?? null,
  };
}

export async function fetchTpexOfficialPayload(kind: TpexRelayKind, tradeDate: string) {
  try {
    return await fetchDirect(kind);
  } catch (error) {
    const directError = error instanceof Error ? error.message : String(error);
    try {
      return await fetchRelay(kind, tradeDate, directError);
    } catch (relayError) {
      const relayMessage = relayError instanceof Error ? relayError.message : String(relayError);
      throw new Error(`tpex_direct_failed:${directError};tpex_relay_failed:${relayMessage}`);
    }
  }
}

export const TPEX_OFFICIAL_RELAY_CONTRACT = {
  schema: "TPEX_OFFICIAL_RELAY_V1",
  source_owner: "TPEx",
  persistence: "D1_ONLY",
  relay_branch: "market-data-relay",
  relay_repository: "keywayk09/taistock-mcp",
  r2_usage: "FORBIDDEN",
  ohlc_usage: "FORBIDDEN",
} as const;
