import { getMarketDataCaptureTradeDate } from "./market-data-capture-context";

const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const RELAY_ROOT = "https://raw.githubusercontent.com/keywayk09/taistock-mcp/market-data-relay/data/market-data/tpex-relay";

type RelayDataset = "institutional" | "margin" | "sbl_balance" | "sbl_volume";

type RelayManifest = {
  schema: "TPEX_OFFICIAL_RELAY_V2";
  trade_date: string;
  source_owner: "TPEx";
  datasets?: Partial<Record<RelayDataset, {
    source_date: string;
    row_count: number;
    sha256: string;
    endpoint: string;
    file: string;
  }>>;
};

function browserHeaders() {
  return {
    Accept: "application/json,text/plain,*/*",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    Referer: "https://www.tpex.org.tw/",
    "User-Agent": BROWSER_USER_AGENT,
  };
}

async function fetchText(url: string, label: string, init: RequestInit = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`${label}_redirect_${response.status}:${response.headers.get("location") ?? "unknown"}`);
  }
  if (!response.ok) throw new Error(`${label}_http_${response.status}:${text.slice(0, 200)}`);
  return text;
}

async function getTpexJsonAny(url: string, label: string) {
  const text = await fetchText(url, label, {
    redirect: "manual",
    headers: browserHeaders(),
  });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}_invalid_json:${text.slice(0, 200)}`);
  }
}

async function sha256Text(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

function relayDatasetFor(url: string, label: string): RelayDataset | null {
  const value = `${url} ${label}`.toLowerCase();
  if (/3insti/.test(value)) return "institutional";
  if (/mainboard_margin_balance|tpex_margin_openapi|tpex_margin\b/.test(value)) return "margin";
  if (/margin_sbl/.test(value)) return "sbl_balance";
  if (/short_sell/.test(value)) return "sbl_volume";
  return null;
}

function normalizePayloadDate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (/^20\d{2}-\d{2}-\d{2}$/.test(raw)) return raw;
  const roc = raw.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (roc) return `${Number(roc[1]) + 1911}-${roc[2]}-${roc[3]}`;
  const compact = raw.match(/^(20\d{2})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const parts = raw.match(/^(\d{2,4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
  if (parts) {
    let year = Number(parts[1]);
    if (year < 1911) year += 1911;
    return `${year}-${String(parts[2]).padStart(2, "0")}-${String(parts[3]).padStart(2, "0")}`;
  }
  return null;
}

function firstPayloadDate(body: any) {
  if (Array.isArray(body)) {
    for (const row of body) {
      const date = normalizePayloadDate(row?.Date ?? row?.date ?? row?.TradeDate ?? row?.["日期"] ?? row?.["資料日期"]);
      if (date) return date;
    }
  }
  return normalizePayloadDate(body?.date ?? body?.Date ?? body?.TradeDate ?? body?.["日期"] ?? body?.["資料日期"]);
}

function requireRequestedDate(body: any, requestedTradeDate: string, label: string) {
  const actual = firstPayloadDate(body);
  if (actual && actual !== requestedTradeDate) throw new Error(`${label}_source_date_mismatch:${actual}`);
}

async function relayTradeDate(requestedTradeDate?: string) {
  if (requestedTradeDate) return requestedTradeDate;
  const latestText = await fetchText(`${RELAY_ROOT}/latest.json`, "TPEX_RELAY_LATEST", {
    headers: { Accept: "application/json", "User-Agent": BROWSER_USER_AGENT },
  });
  let latest: any;
  try {
    latest = JSON.parse(latestText);
  } catch {
    throw new Error("TPEX_RELAY_LATEST_invalid_json");
  }
  if (latest?.schema !== "TPEX_OFFICIAL_RELAY_LATEST_V2" || !/^\d{4}-\d{2}-\d{2}$/.test(String(latest?.trade_date ?? ""))) {
    throw new Error("TPEX_RELAY_LATEST_invalid_contract");
  }
  return String(latest.trade_date);
}

async function getRelayDataset(dataset: RelayDataset, requestedTradeDate?: string) {
  const tradeDate = await relayTradeDate(requestedTradeDate);
  const base = `${RELAY_ROOT}/${tradeDate}`;
  const manifestText = await fetchText(`${base}/manifest.json`, "TPEX_RELAY_MANIFEST", {
    headers: { Accept: "application/json", "User-Agent": BROWSER_USER_AGENT },
  });
  let manifest: RelayManifest;
  try {
    manifest = JSON.parse(manifestText) as RelayManifest;
  } catch {
    throw new Error("TPEX_RELAY_MANIFEST_invalid_json");
  }
  if (manifest.schema !== "TPEX_OFFICIAL_RELAY_V2") throw new Error(`TPEX_RELAY_schema_mismatch:${String((manifest as any)?.schema ?? "missing")}`);
  if (manifest.trade_date !== tradeDate) throw new Error(`TPEX_RELAY_trade_date_mismatch:${manifest.trade_date}`);
  if (manifest.source_owner !== "TPEx") throw new Error(`TPEX_RELAY_source_owner_mismatch:${String(manifest.source_owner)}`);

  const meta = manifest.datasets?.[dataset];
  if (!meta) throw new Error(`TPEX_RELAY_dataset_missing:${dataset}`);
  if (meta.source_date !== tradeDate) throw new Error(`TPEX_RELAY_source_date_mismatch:${dataset}:${meta.source_date}`);
  if (!Number.isFinite(Number(meta.row_count)) || Number(meta.row_count) <= 0) throw new Error(`TPEX_RELAY_row_count_invalid:${dataset}`);
  if (!/^[0-9a-f]{64}$/i.test(String(meta.sha256 ?? ""))) throw new Error(`TPEX_RELAY_sha_invalid:${dataset}`);

  const payloadTextRaw = await fetchText(`${base}/${meta.file}`, `TPEX_RELAY_${dataset}`, {
    headers: { Accept: "application/json", "User-Agent": BROWSER_USER_AGENT },
  });
  const payloadText = payloadTextRaw.replace(/\s+$/, "");
  const actualSha = await sha256Text(payloadText);
  if (actualSha !== meta.sha256) throw new Error(`TPEX_RELAY_sha_mismatch:${dataset}`);

  let body: any;
  try {
    body = JSON.parse(payloadText);
  } catch {
    throw new Error(`TPEX_RELAY_${dataset}_invalid_json`);
  }
  if (!Array.isArray(body) || body.length !== Number(meta.row_count)) {
    throw new Error(`TPEX_RELAY_row_count_mismatch:${dataset}`);
  }
  return body;
}

function rocDate(tradeDate: string) {
  const [year, month, day] = tradeDate.split("-");
  return `${Number(year) - 1911}/${month}/${day}`;
}

function clean(value: unknown) {
  return String(value ?? "").replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim();
}

function numeric(value: unknown) {
  const n = Number(clean(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function legacyRows(body: any, label: string) {
  const rows = Array.isArray(body?.aaData) ? body.aaData.filter(Array.isArray) : [];
  if (!rows.length) throw new Error(`${label}_empty`);
  return rows as any[][];
}

async function getOfficialWebSblDataset(dataset: "sbl_balance" | "sbl_volume", tradeDate: string) {
  const date = encodeURIComponent(rocDate(tradeDate));
  const url = `https://www.tpex.org.tw/web/stock/margin_trading/margin_sbl/margin_sbl_result.php?l=zh-tw&o=json&d=${date}`;
  const body = await getTpexJsonAny(url, "TPEX_MARGIN_SBL_WEB_JSON");
  const rows = legacyRows(body, "TPEX_MARGIN_SBL_WEB_JSON");
  if (dataset === "sbl_balance") {
    return rows.map((row) => ({
      Date: tradeDate,
      SecuritiesCompanyCode: clean(row[0]),
      CompanyName: clean(row[1]),
      SecuritiesBorrowingBalancePreviousDay: row[8],
      SecuritiesBorrowingSale: row[9],
      SecuritiesBorrowingReturn: row[10],
      SecuritiesBorrowingAdjustment: row[11],
      SecuritiesBorrowingBalanceOfTheMarketDay: row[12],
      AvailableVolumesForSBLShortSale: row[13],
    }));
  }
  return rows.map((row) => ({
    Date: tradeDate,
    SecuritiesCompanyCode: clean(row[0]),
    CompanyName: clean(row[1]),
    SBLVolume: numeric(row[9]) / 1000,
    SBLAmount: null,
  }));
}

export async function getTpexJson(url: string, label: string) {
  const requestedTradeDate = getMarketDataCaptureTradeDate();
  try {
    const body = await getTpexJsonAny(url, label);
    if (!Array.isArray(body) || !body.length) throw new Error(`${label}_empty`);
    if (requestedTradeDate) requireRequestedDate(body, requestedTradeDate, label);
    return body;
  } catch (directError) {
    const dataset = relayDatasetFor(url, label);
    if (!dataset) throw directError;
    try {
      const relay = await getRelayDataset(dataset, requestedTradeDate ?? undefined);
      if (requestedTradeDate) requireRequestedDate(relay, requestedTradeDate, `TPEX_RELAY_${dataset}`);
      return relay;
    } catch (relayError) {
      if (requestedTradeDate && (dataset === "sbl_balance" || dataset === "sbl_volume")) {
        try {
          return await getOfficialWebSblDataset(dataset, requestedTradeDate);
        } catch (webError) {
          const direct = directError instanceof Error ? directError.message : String(directError);
          const relay = relayError instanceof Error ? relayError.message : String(relayError);
          const web = webError instanceof Error ? webError.message : String(webError);
          throw new Error(`${label}_all_transports_failed:direct=${direct.slice(0, 160)};relay=${relay.slice(0, 160)};web=${web.slice(0, 160)}`);
        }
      }
      const direct = directError instanceof Error ? directError.message : String(directError);
      const relay = relayError instanceof Error ? relayError.message : String(relayError);
      throw new Error(`${label}_direct_failed:${direct.slice(0, 220)};relay_failed:${relay.slice(0, 220)}`);
    }
  }
}

async function getExactRelayOrOfficialWeb(
  dataset: "institutional" | "margin",
  tradeDate: string,
  directError: unknown,
) {
  try {
    return await getRelayDataset(dataset, tradeDate);
  } catch (relayError) {
    try {
      const date = encodeURIComponent(rocDate(tradeDate));
      if (dataset === "institutional") {
        const legacyUrl = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&se=EW&t=D&d=${date}&s=0,asc`;
        const body = await getTpexJsonAny(legacyUrl, "TPEX_3INSTI_WEB_JSON");
        const rows = legacyRows(body, "TPEX_3INSTI_WEB_JSON");
        return rows.map((row) => ({
          Date: tradeDate,
          "證券代號": clean(row[0]),
          "證券名稱": clean(row[1]),
          "外資及陸資買賣超股數": row[10],
          "投信買賣超股數": row[13],
          "自營商買賣超股數": row[22],
          "三大法人買賣超股數": row[23],
        }));
      }

      const legacyUrl = `https://www.tpex.org.tw/web/stock/margin_trading/margin_balance/margin_bal_result.php?l=zh-tw&o=json&d=${date}&s=0,asc`;
      const body = await getTpexJsonAny(legacyUrl, "TPEX_MARGIN_WEB_JSON");
      const rows = legacyRows(body, "TPEX_MARGIN_WEB_JSON");
      return rows.map((row) => ({
        Date: tradeDate,
        "證券代號": clean(row[0]),
        "證券名稱": clean(row[1]),
        "融資前日餘額": row[2],
        "融資今日餘額": row[6],
        "融券前日餘額": row[10],
        "融券今日餘額": row[14],
      }));
    } catch (webError) {
      const direct = directError instanceof Error ? directError.message : String(directError);
      const relay = relayError instanceof Error ? relayError.message : String(relayError);
      const web = webError instanceof Error ? webError.message : String(webError);
      throw new Error(`TPEX_${dataset}_all_transports_failed:direct=${direct.slice(0, 180)};relay=${relay.slice(0, 180)};web=${web.slice(0, 180)}`);
    }
  }
}

export async function getTpexInstitutionalPayload(tradeDate: string) {
  const directUrl = "https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading";
  try {
    const body = await getTpexJsonAny(directUrl, "TPEX_3INSTI_OPENAPI");
    if (!Array.isArray(body) || !body.length) throw new Error("TPEX_3INSTI_OPENAPI_empty");
    requireRequestedDate(body, tradeDate, "TPEX_3INSTI_OPENAPI");
    return body;
  } catch (directError) {
    return getExactRelayOrOfficialWeb("institutional", tradeDate, directError);
  }
}

export async function getTpexMarginPayload(tradeDate: string) {
  const directUrl = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance";
  try {
    const body = await getTpexJsonAny(directUrl, "TPEX_MARGIN_OPENAPI");
    if (!Array.isArray(body) || !body.length) throw new Error("TPEX_MARGIN_OPENAPI_empty");
    requireRequestedDate(body, tradeDate, "TPEX_MARGIN_OPENAPI");
    return body;
  } catch (directError) {
    return getExactRelayOrOfficialWeb("margin", tradeDate, directError);
  }
}
