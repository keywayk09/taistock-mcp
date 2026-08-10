import { fugle, rec } from "../v6/common";

const MIS_URL = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function probeMisOtc() {
  try {
    const url = new URL(MIS_URL);
    url.searchParams.set("ex_ch", "otc_3105.tw|otc_6488.tw|otc_8299.tw");
    url.searchParams.set("json", "1");
    url.searchParams.set("delay", "0");
    url.searchParams.set("_", String(Date.now()));
    const response = await fetch(url, {
      headers: {
        Accept: "application/json,text/plain,*/*",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        Referer: "https://mis.twse.com.tw/stock/index.jsp",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
      },
    });
    const text = await response.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch {}
    const rows = Array.isArray(body?.msgArray) ? body.msgArray : [];
    return {
      ok: response.ok && rows.length > 0,
      http_status: response.status,
      row_count: rows.length,
      symbols: rows.map((row: any) => String(row.c ?? "")).filter(Boolean),
      sample_keys: Object.keys(rows[0] ?? {}).slice(0, 30),
      rtcode: body?.rtcode ?? null,
      rtmessage: body?.rtmessage ?? null,
      body_prefix: body ? null : text.slice(0, 160),
    };
  } catch (error) {
    return { ok: false, http_status: null, row_count: 0, symbols: [], sample_keys: [], error: errorText(error) };
  }
}

async function probeFugleHistory(env: Env) {
  try {
    const body = await fugle(env, "/historical/candles/3105", {
      from: "2026-04-01",
      to: "2026-08-08",
      timeframe: "D",
      adjusted: "false",
      fields: "open,high,low,close,volume,turnover,change",
      sort: "asc",
    });
    const root = rec(body);
    const rows = Array.isArray(root.data) ? root.data : [];
    return {
      ok: rows.length >= 60,
      row_count: rows.length,
      market: root.market ?? null,
      exchange: root.exchange ?? null,
      timeframe: root.timeframe ?? null,
      sample_keys: Object.keys(rec(rows[0])).slice(0, 20),
    };
  } catch (error) {
    return { ok: false, row_count: 0, error: errorText(error) };
  }
}

async function probeD1Universe(env: Env) {
  if (!env.DB) return { ok: false, error: "DB binding unavailable" };
  try {
    const schema = await env.DB.prepare("PRAGMA table_info(global_companies)").all<any>();
    const columns = (schema.results ?? []).map((row: any) => String(row.name ?? "")).filter(Boolean);
    let twCount: number | null = null;
    let sample: Record<string, unknown>[] = [];
    try {
      const countResult = await env.DB.prepare("SELECT COUNT(*) AS n FROM global_companies WHERE country = 'TW' AND status = 'active'").first<any>();
      twCount = Number(countResult?.n ?? 0);
    } catch {}
    try {
      const sampleResult = await env.DB.prepare("SELECT * FROM global_companies WHERE country = 'TW' AND status = 'active' LIMIT 3").all<any>();
      sample = (sampleResult.results ?? []).map((row: any) => Object.fromEntries(
        Object.entries(row).filter(([key]) => /ticker|symbol|exchange|market|country|industry|name|status/i.test(key)),
      ));
    } catch {}
    return {
      ok: columns.length > 0,
      columns,
      active_tw_count: twCount,
      sample,
    };
  } catch (error) {
    return { ok: false, columns: [], active_tw_count: null, sample: [], error: errorText(error) };
  }
}

export async function probeFamilyAlternativeDataPaths(env: Env) {
  const [mis, fugleHistory, d1Universe] = await Promise.all([
    probeMisOtc(),
    probeFugleHistory(env),
    probeD1Universe(env),
  ]);
  return {
    checked_at: new Date().toISOString(),
    mis_otc: mis,
    fugle_historical_otc: fugleHistory,
    d1_universe: d1Universe,
  };
}
