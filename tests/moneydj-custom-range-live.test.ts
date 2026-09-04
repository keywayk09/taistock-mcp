import assert from "node:assert/strict";

const AS_OF = "2026-09-03";
const SYMBOL = "2330";
const WINDOWS = [1, 5, 10, 20, 60] as const;

function shiftDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function isWeekend(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function rocDateToIso(value: string) {
  const text = String(value ?? "").trim();
  assert.match(text, /^\d{7}$/);
  const year = Number(text.slice(0, 3)) + 1911;
  return `${year}-${text.slice(3, 5)}-${text.slice(5, 7)}`;
}

function textOf(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function decodeHtml(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  const charset = contentType.match(/charset\s*=\s*[\"']?([^;\s\"']+)/i)?.[1]?.toLowerCase() ?? "utf-8";
  const normalized = charset === "cp950" || charset === "950" || charset === "big-5" ? "big5" : charset;
  const bytes = await response.arrayBuffer();
  return new TextDecoder(normalized).decode(bytes);
}

async function loadClosedWeekdays() {
  const response = await fetch("https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule", {
    headers: { Accept: "application/json", "User-Agent": "taistock-moneydj-live-diagnostic/1.0" },
  });
  assert.equal(response.ok, true, `TWSE holiday schedule HTTP ${response.status}`);
  const rows = await response.json() as Array<Record<string, string>>;
  const closed = new Set<string>();
  for (const row of rows) {
    const name = String(row.Name ?? "");
    const date = rocDateToIso(row.Date);
    if (isWeekend(date)) continue;
    if (/開始交易日|最後交易日/.test(name)) continue;
    closed.add(date);
  }
  return closed;
}

function nthTradingDayStart(asOf: string, tradingDays: number, closed: Set<string>) {
  let cursor = asOf;
  let seen = 0;
  for (let guard = 0; guard < 500; guard += 1) {
    if (!isWeekend(cursor) && !closed.has(cursor)) {
      seen += 1;
      if (seen === tradingDays) return cursor;
    }
    cursor = shiftDays(cursor, -1);
  }
  throw new Error(`unable_to_resolve_${tradingDays}d_start`);
}

async function fetchRange(start: string, end: string) {
  const url = `https://www.moneydj.com/z/zc/zco/zco.djhtm?a=${SYMBOL}&e=${start}&f=${end}`;
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml,*/*",
      "User-Agent": "Diamond-Broker-Ranked-Live-Diagnostic/1.0",
    },
  });
  assert.equal(response.ok, true, `MoneyDJ ${start}..${end} HTTP ${response.status}`);
  const html = await decodeHtml(response);
  const text = textOf(html);
  const updated = text.match(/最後更新日\s*[：:]?\s*((?:\d{4}[\/-])?\d{1,2}[\/-]\d{1,2})/)?.[1] ?? null;
  const totals = text.match(/合計買超張數\s*([\d,]+).*?合計賣超張數\s*([\d,]+)/);
  assert.ok(updated, `last updated date missing for ${start}..${end}`);
  assert.ok(totals, `ranked totals missing for ${start}..${end}`);
  assert.match(text, /券商分點-進出明細/);
  return {
    start,
    end,
    updated,
    buy_total: Number(totals![1].replace(/,/g, "")),
    sell_total: Number(totals![2].replace(/,/g, "")),
    first_500_chars: text.slice(0, 500),
  };
}

const closed = await loadClosedWeekdays();
const observations: Record<string, Awaited<ReturnType<typeof fetchRange>>> = {};
for (const days of WINDOWS) {
  const start = nthTradingDayStart(AS_OF, days, closed);
  observations[`${days}D`] = await fetchRange(start, AS_OF);
}

for (const days of WINDOWS) {
  const row = observations[`${days}D`];
  assert.ok(row.updated === "2026/09/03" || row.updated === "2026-09-03", `${days}D updated=${row.updated}`);
}

assert.match(observations["1D"].first_500_chars, /凱基-台北/);
assert.match(observations["1D"].first_500_chars, /700/);

const signatures = new Set(WINDOWS.map((days) => {
  const row = observations[`${days}D`];
  return `${row.buy_total}:${row.sell_total}`;
}));
assert.ok(signatures.size >= 4, `custom ranges did not produce distinct interval rankings: ${JSON.stringify(observations)}`);

console.log("MONEYDJ_CUSTOM_RANGE_LIVE_OK", JSON.stringify(observations, null, 2));
