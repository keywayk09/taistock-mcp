const DATE = process.env.VERIFY_DATE ?? "2026-07-31";
const SLASH_DATE = DATE.replaceAll("-", "/");
const COMPACT_DATE = DATE.replaceAll("-", "");
const timeoutMs = 30_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeout(url, init = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === attempts) return response;
      await response.arrayBuffer();
      await sleep(1_000 * attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
      await sleep(1_000 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error("fetch failed");
}

async function verifyJsonArray(label, url, minimumRows, requiredFields) {
  const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}: ${text.slice(0, 200)}`);
  const rows = JSON.parse(text);
  if (!Array.isArray(rows) || rows.length < minimumRows) throw new Error(`${label}: expected >= ${minimumRows} rows, got ${Array.isArray(rows) ? rows.length : "non-array"}`);
  const first = rows[0] ?? {};
  const matched = requiredFields.some((field) => field in first);
  if (!matched) throw new Error(`${label}: expected one of fields ${requiredFields.join(", ")}: ${text.slice(0, 500)}`);
  console.log(`PASS ${label} (${rows.length} rows)`);
}

async function verifyTwse(label, path, params, validate) {
  const url = new URL(`https://www.twse.com.tw/rwd/zh/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}: ${text.slice(0, 200)}`);
  const body = JSON.parse(text);
  if (!validate(body)) throw new Error(`${label}: schema/data validation failed: ${text.slice(0, 500)}`);
  console.log(`PASS ${label}`);
}

async function verifyTaifex(label, path, data) {
  const response = await fetchWithTimeout(`https://www.taifex.com.tw/cht/3/${path}`, {
    method: "POST",
    headers: {
      Accept: "text/csv,*/*",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams(data),
  });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const text = new TextDecoder("big5").decode(bytes);
  if (text.trimStart().startsWith("<")) throw new Error(`${label}: returned HTML instead of CSV`);
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2 || !lines[0].includes(",")) throw new Error(`${label}: invalid/empty CSV`);
  console.log(`PASS ${label} (${lines.length - 1} rows)`);
}

async function verifySitcaActiveEtfList() {
  const url = "https://www.sitca.org.tw/ROC/SITCA_ETF/etf_statement.aspx";
  const response = await fetchWithTimeout(url, { headers: { Accept: "text/html" } });
  const html = await response.text();
  if (!response.ok) throw new Error(`SITCA active ETF list: HTTP ${response.status}: ${html.slice(0, 200)}`);
  const codes = [...new Set(html.match(/\b\d{5}[AD]\b/g) ?? [])];
  if (codes.length < 20) throw new Error(`SITCA active ETF list: only ${codes.length} ETF codes parsed`);
  console.log(`PASS SITCA active ETF list (${codes.length} codes)`);
}

async function verifyFinMindActiveEtfInfo() {
  const url = new URL("https://api.finmindtrade.com/api/v4/data");
  url.searchParams.set("dataset", "TaiwanStockActiveETFInfo");
  const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`FinMind active ETF info: HTTP ${response.status}: ${text.slice(0, 200)}`);
  const body = JSON.parse(text);
  if (!Array.isArray(body?.data) || !body.data.length) throw new Error(`FinMind active ETF info: missing data: ${text.slice(0, 500)}`);
  const first = body.data[0] ?? {};
  for (const key of ["date", "stock_id", "stock_name", "category", "type"]) {
    if (!(key in first)) throw new Error(`FinMind active ETF info: missing field ${key}`);
  }
  console.log(`PASS FinMind active ETF info fallback (${body.data.length} rows)`);
}

await verifyTwse(
  "TWSE market institutional",
  "fund/BFI82U",
  { response: "json", dayDate: COMPACT_DATE, type: "day" },
  (body) => body?.stat === "OK" && Array.isArray(body?.fields) && Array.isArray(body?.data) && body.data.length > 0,
);

await verifyTwse(
  "TWSE stock institutional",
  "fund/T86",
  { response: "json", date: COMPACT_DATE, selectType: "ALLBUT0999" },
  (body) => body?.stat === "OK" && Array.isArray(body?.fields) && Array.isArray(body?.data) && body.data.length > 0,
);

await verifyTwse(
  "TWSE margin",
  "marginTrading/MI_MARGN",
  { response: "json", date: COMPACT_DATE, selectType: "ALL" },
  (body) => body?.stat === "OK" && Array.isArray(body?.tables) && body.tables.length >= 2,
);

await verifyTaifex("TAIFEX futures daily", "futDataDown", {
  down_type: "1",
  commodity_id: "TX",
  queryStartDate: SLASH_DATE,
  queryEndDate: SLASH_DATE,
});

await verifyTaifex("TAIFEX institutional general", "totalTableDateDown", {
  queryStartDate: SLASH_DATE,
  queryEndDate: SLASH_DATE,
  queryDate: SLASH_DATE,
});

await verifyTaifex("TAIFEX futures positions", "futContractsDateDown", {
  queryStartDate: SLASH_DATE,
  queryEndDate: SLASH_DATE,
  queryDate: SLASH_DATE,
});

await verifyTaifex("TAIFEX options positions", "callsAndPutsDateDown", {
  queryStartDate: SLASH_DATE,
  queryEndDate: SLASH_DATE,
  queryDate: SLASH_DATE,
});

await verifyJsonArray(
  "TWSE listed company universe",
  "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
  500,
  ["公司代號", "公司名稱", "公司簡稱"],
);
await verifyJsonArray(
  "TPEx listed company universe",
  "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O",
  300,
  ["SecuritiesCompanyCode", "CompanyName", "CompanyAbbreviation", "公司代號"],
);
await verifyJsonArray(
  "TPEx emerging company universe",
  "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_R",
  100,
  ["SecuritiesCompanyCode", "CompanyName", "CompanyAbbreviation", "公司代號"],
);

await verifySitcaActiveEtfList();
await verifyFinMindActiveEtfInfo();

console.log(`All public-source smoke tests passed for ${DATE}.`);
