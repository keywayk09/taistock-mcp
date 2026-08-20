const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function browserHeaders() {
  return {
    Accept: "application/json,text/plain,*/*",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    Referer: "https://www.tpex.org.tw/",
    "User-Agent": BROWSER_USER_AGENT,
  };
}

async function getTpexJsonAny(url: string, label: string) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: browserHeaders(),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${label}_http_${response.status}:${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}_invalid_json:${text.slice(0, 200)}`);
  }
}

export async function getTpexJson(url: string, label: string) {
  const body = await getTpexJsonAny(url, label);
  if (!Array.isArray(body) || !body.length) throw new Error(`${label}_empty`);
  return body;
}

function rocDate(tradeDate: string) {
  const [year, month, day] = tradeDate.split("-");
  return `${Number(year) - 1911}/${month}/${day}`;
}

function clean(value: unknown) {
  return String(value ?? "").replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim();
}

function legacyRows(body: any, label: string) {
  const rows = Array.isArray(body?.aaData) ? body.aaData.filter(Array.isArray) : [];
  if (!rows.length) throw new Error(`${label}_empty`);
  return rows as any[][];
}

/**
 * TPEx OpenAPI redirects Cloudflare Worker egress to /errors in some periods.
 * Keep OpenAPI first, then fall back to TPEx's own official website JSON endpoint.
 * The fallback is normalized into the same object vocabulary consumed by the
 * canonical semantic normalizer; no second persistence location is introduced.
 */
export async function getTpexInstitutionalPayload(tradeDate: string) {
  const directUrl = "https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading";
  try {
    return await getTpexJson(directUrl, "TPEX_3INSTI_OPENAPI");
  } catch (directError) {
    const date = encodeURIComponent(rocDate(tradeDate));
    const legacyUrl = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&se=EW&t=D&d=${date}&s=0,asc`;
    const body = await getTpexJsonAny(legacyUrl, "TPEX_3INSTI_WEB_JSON");
    const rows = legacyRows(body, "TPEX_3INSTI_WEB_JSON");
    return rows.map((row) => ({
      Date: tradeDate,
      "證券代號": clean(row[0]),
      "證券名稱": clean(row[1]),
      // Legacy aaData columns: foreign total net=10, trust net=13,
      // dealer total net=22, three-institution total net=23.
      "外資及陸資買賣超股數": row[10],
      "投信買賣超股數": row[13],
      "自營商買賣超股數": row[22],
      "三大法人買賣超股數": row[23],
      _transport: "TPEX_OFFICIAL_WEB_JSON",
      _direct_error: directError instanceof Error ? directError.message.slice(0, 240) : String(directError).slice(0, 240),
    }));
  }
}

export async function getTpexMarginPayload(tradeDate: string) {
  const directUrl = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance";
  try {
    return await getTpexJson(directUrl, "TPEX_MARGIN_OPENAPI");
  } catch (directError) {
    const date = encodeURIComponent(rocDate(tradeDate));
    const legacyUrl = `https://www.tpex.org.tw/web/stock/margin_trading/margin_balance/margin_bal_result.php?l=zh-tw&o=json&d=${date}&s=0,asc`;
    const body = await getTpexJsonAny(legacyUrl, "TPEX_MARGIN_WEB_JSON");
    const rows = legacyRows(body, "TPEX_MARGIN_WEB_JSON");
    return rows.map((row) => ({
      Date: tradeDate,
      "證券代號": clean(row[0]),
      "證券名稱": clean(row[1]),
      // Official legacy table order: margin prev/buy/sell/repay/balance,
      // then credit metadata, then short prev/sell/buy/repay/balance.
      "融資前日餘額": row[2],
      "融資今日餘額": row[6],
      "融券前日餘額": row[10],
      "融券今日餘額": row[14],
      _transport: "TPEX_OFFICIAL_WEB_JSON",
      _direct_error: directError instanceof Error ? directError.message.slice(0, 240) : String(directError).slice(0, 240),
    }));
  }
}
