const DATE = process.env.VERIFY_DATE ?? "2026-07-31";
const SLASH_DATE = DATE.replaceAll("-", "/");
const COMPACT_DATE = DATE.replaceAll("-", "");
const timeoutMs = 30_000;

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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

console.log(`All public-source smoke tests passed for ${DATE}.`);
