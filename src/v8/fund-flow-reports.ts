import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fail, ok, taipeiDate, type Obj } from "../v6/common";

const USER_AGENT = "taistock-mcp/8.5 (+https://github.com/keywayk09/taistock-mcp)";
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

type InstitutionalRow = {
  market: "TWSE" | "TPEx";
  symbol: string;
  name: string;
  foreign_net_shares: number;
  trust_net_shares: number;
  dealer_net_shares: number;
  total_net_shares: number;
  raw: Obj;
};

type MarginRow = {
  market: "TWSE" | "TPEx";
  symbol: string;
  name: string;
  margin_change: number | null;
  margin_balance: number | null;
  short_change: number | null;
  short_balance: number | null;
  raw: Obj;
};

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function compactDate(date: string) {
  return date.replaceAll("-", "");
}

function rocSlashDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return `${year - 1911}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

function numberValue(value: unknown): number {
  const normalized = String(value ?? "").replaceAll(",", "").replaceAll(" ", "").trim();
  const parsed = Number(normalized || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  const normalized = String(value ?? "").replaceAll(",", "").replaceAll(" ", "").trim();
  if (!normalized || normalized === "-") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function textValue(row: Obj, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function findKey(row: Obj, terms: string[], excludes: string[] = []) {
  return Object.keys(row).find((key) => terms.every((term) => key.includes(term)) && excludes.every((term) => !key.includes(term)));
}

function numberByTerms(row: Obj, alternatives: string[][], excludes: string[] = []) {
  for (const terms of alternatives) {
    const key = findKey(row, terms, excludes);
    if (key) return numberValue(row[key]);
  }
  return 0;
}

function nullableByTerms(row: Obj, alternatives: string[][], excludes: string[] = []) {
  for (const terms of alternatives) {
    const key = findKey(row, terms, excludes);
    if (key) return nullableNumber(row[key]);
  }
  return null;
}

function rowsFromTable(body: any): Obj[] {
  if (Array.isArray(body)) return body as Obj[];
  if (Array.isArray(body?.data) && Array.isArray(body?.fields)) {
    return body.data.map((values: unknown[]) => Object.fromEntries(body.fields.map((field: string, index: number) => [String(field).trim(), values[index]])));
  }
  const table = Array.isArray(body?.tables) ? body.tables.find((item: any) => Array.isArray(item?.data) && Array.isArray(item?.fields)) : null;
  if (table) return table.data.map((values: unknown[]) => Object.fromEntries(table.fields.map((field: string, index: number) => [String(field).trim(), values[index]])));
  if (Array.isArray(body?.aaData)) {
    const fields = Array.isArray(body?.fields) ? body.fields : [];
    if (fields.length) return body.aaData.map((values: unknown[]) => Object.fromEntries(fields.map((field: string, index: number) => [String(field).trim(), values[index]])));
    return body.aaData.map((values: unknown[]) => ({
      代號: values[0], 名稱: values[1],
      外資買進: values[2], 外資賣出: values[3], 外資買賣超: values[4],
      外資自營商買進: values[5], 外資自營商賣出: values[6], 外資自營商買賣超: values[7],
      外資及陸資買進: values[8], 外資及陸資賣出: values[9], 外資及陸資買賣超: values[10],
      投信買進: values[11], 投信賣出: values[12], 投信買賣超: values[13],
      自營商自行買賣買進: values[14], 自營商自行買賣賣出: values[15], 自營商自行買賣買賣超: values[16],
      自營商避險買進: values[17], 自營商避險賣出: values[18], 自營商避險買賣超: values[19],
      自營商買賣超: values[22], 三大法人買賣超: values[23],
    }));
  }
  return [];
}

async function fetchJson(url: URL) {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url.hostname}${url.pathname} HTTP ${response.status}: ${text.slice(0, 180)}`);
  if (text.trimStart().startsWith("<")) throw new Error(`${url.hostname}${url.pathname} 回傳 HTML，不是 JSON`);
  try { return JSON.parse(text); } catch { throw new Error(`${url.hostname}${url.pathname} 回傳無效 JSON`); }
}

async function fetchTwseInstitutional(date: string): Promise<InstitutionalRow[]> {
  const url = new URL("https://www.twse.com.tw/rwd/zh/fund/T86");
  url.searchParams.set("response", "json");
  url.searchParams.set("date", compactDate(date));
  url.searchParams.set("selectType", "ALLBUT0999");
  const body = await fetchJson(url);
  if (body?.stat !== "OK") return [];
  return rowsFromTable(body).map((raw) => ({
    market: "TWSE" as const,
    symbol: textValue(raw, ["證券代號", "代號"]),
    name: textValue(raw, ["證券名稱", "名稱"]),
    foreign_net_shares: numberByTerms(raw, [["外資及陸資", "買賣超"], ["外資", "買賣超"]], ["自營商"]),
    trust_net_shares: numberByTerms(raw, [["投信", "買賣超"]]),
    dealer_net_shares: numberByTerms(raw, [["自營商", "買賣超"]], ["自行買賣", "避險"]),
    total_net_shares: numberByTerms(raw, [["三大法人", "買賣超"]]),
    raw,
  })).filter((row) => row.symbol);
}

async function fetchTpexInstitutional(date: string): Promise<InstitutionalRow[]> {
  const url = new URL("https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php");
  url.searchParams.set("l", "zh-tw");
  url.searchParams.set("o", "json");
  url.searchParams.set("d", rocSlashDate(date));
  url.searchParams.set("s", "0,asc");
  const body = await fetchJson(url);
  return rowsFromTable(body).map((raw) => ({
    market: "TPEx" as const,
    symbol: textValue(raw, ["代號", "證券代號"]),
    name: textValue(raw, ["名稱", "證券名稱"]),
    foreign_net_shares: numberByTerms(raw, [["外資及陸資", "買賣超"], ["外資", "買賣超"]], ["自營商"]),
    trust_net_shares: numberByTerms(raw, [["投信", "買賣超"]]),
    dealer_net_shares: numberByTerms(raw, [["自營商", "買賣超"]], ["自行買賣", "避險"]),
    total_net_shares: numberByTerms(raw, [["三大法人", "買賣超"]]),
    raw,
  })).filter((row) => row.symbol);
}

async function fetchTwseMargin(date: string): Promise<MarginRow[]> {
  const url = new URL("https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN");
  url.searchParams.set("response", "json");
  url.searchParams.set("date", compactDate(date));
  url.searchParams.set("selectType", "ALL");
  const body = await fetchJson(url);
  if (body?.stat !== "OK") return [];
  const table = Array.isArray(body?.tables) ? body.tables[1] : null;
  const rows = table ? rowsFromTable({ fields: table.fields, data: table.data }) : [];
  return rows.map((raw) => ({
    market: "TWSE" as const,
    symbol: textValue(raw, ["股票代號", "證券代號", "代號"]),
    name: textValue(raw, ["股票名稱", "證券名稱", "名稱"]),
    margin_change: nullableByTerms(raw, [["融資", "今日餘額"]]) !== null && nullableByTerms(raw, [["融資", "前日餘額"]]) !== null
      ? (nullableByTerms(raw, [["融資", "今日餘額"]]) as number) - (nullableByTerms(raw, [["融資", "前日餘額"]]) as number) : null,
    margin_balance: nullableByTerms(raw, [["融資", "今日餘額"]]),
    short_change: nullableByTerms(raw, [["融券", "今日餘額"]]) !== null && nullableByTerms(raw, [["融券", "前日餘額"]]) !== null
      ? (nullableByTerms(raw, [["融券", "今日餘額"]]) as number) - (nullableByTerms(raw, [["融券", "前日餘額"]]) as number) : null,
    short_balance: nullableByTerms(raw, [["融券", "今日餘額"]]),
    raw,
  })).filter((row) => row.symbol);
}

async function fetchTpexMargin(date: string): Promise<MarginRow[]> {
  const url = new URL("https://www.tpex.org.tw/web/stock/margin_trading/margin_balance/margin_bal_result.php");
  url.searchParams.set("l", "zh-tw");
  url.searchParams.set("o", "json");
  url.searchParams.set("d", rocSlashDate(date));
  const body = await fetchJson(url);
  return rowsFromTable(body).map((raw) => ({
    market: "TPEx" as const,
    symbol: textValue(raw, ["代號", "證券代號"]),
    name: textValue(raw, ["名稱", "證券名稱"]),
    margin_change: nullableByTerms(raw, [["融資", "增減"], ["融資", "差額"]]),
    margin_balance: nullableByTerms(raw, [["融資", "餘額"]]),
    short_change: nullableByTerms(raw, [["融券", "增減"], ["融券", "差額"]]),
    short_balance: nullableByTerms(raw, [["融券", "餘額"]]),
    raw,
  })).filter((row) => row.symbol);
}

function isOrdinaryStock(row: { symbol: string; name: string }) {
  const symbol = row.symbol.trim();
  const name = row.name.trim();
  if (!/^\d{4}$/.test(symbol)) return false;
  if (/(ETF|ETN|指數|債|正2|反1|槓桿|期貨|權證)/i.test(name)) return false;
  return true;
}

function ranked(rows: InstitutionalRow[], key: "foreign_net_shares" | "trust_net_shares", direction: "buy" | "sell", topN: number) {
  const filtered = rows.filter(isOrdinaryStock).filter((row) => direction === "buy" ? row[key] > 0 : row[key] < 0);
  filtered.sort((a, b) => direction === "buy" ? b[key] - a[key] : a[key] - b[key]);
  return filtered.slice(0, topN).map((row, index) => ({
    rank: index + 1,
    market: row.market,
    symbol: row.symbol,
    name: row.name,
    shares: row[key],
    lots: Math.round(row[key] / 1000),
  }));
}

function formatRanking(title: string, rows: Array<{ rank: number; symbol: string; name: string; lots: number; market: string }>) {
  return `${title}：\n${rows.map((row) => `${row.rank}. ${row.symbol} ${row.name} ${row.lots >= 0 ? "+" : ""}${row.lots.toLocaleString("zh-TW")}張（${row.market}）`).join("\n")}`;
}

function reportCard(prefix: "🟢" | "🔻", index: number, title: string, representatives: string[], observation: string) {
  return `${prefix}卡片${index}｜${title}\n代表股：${representatives.join("、") || "資料不足"}\n籌碼：依同日官方法人排行整理，詳細張數見上方排行榜。\n反人性：需搭配當日價格、成交量與是否追高／殺低判斷。\n評分：★★★☆☆\n操作建議👉先觀察隔日是否延續法人同向買賣超，不因單日排行直接追價或放空。\n族群＆個股現象：${observation}\n解讀：此卡為同日資金集中度分組，不以媒體搜尋或其他日期補值。\n延續性觀察：追蹤次一交易日法人方向、量價與族群擴散。`;
}

async function resolveInstitutionalDate(requestedDate: string, fallbackDays: number) {
  const errors: string[] = [];
  for (let offset = 0; offset <= fallbackDays; offset++) {
    const candidate = shiftDate(requestedDate, -offset);
    const settled = await Promise.allSettled([fetchTwseInstitutional(candidate), fetchTpexInstitutional(candidate)]);
    const twse = settled[0].status === "fulfilled" ? settled[0].value : [];
    const tpex = settled[1].status === "fulfilled" ? settled[1].value : [];
    if (settled[0].status === "rejected") errors.push(`${candidate} TWSE: ${String(settled[0].reason)}`);
    if (settled[1].status === "rejected") errors.push(`${candidate} TPEx: ${String(settled[1].reason)}`);
    if (twse.length && tpex.length) return { resolvedDate: candidate, twse, tpex, errors };
    errors.push(`${candidate}: TWSE=${twse.length}列，TPEx=${tpex.length}列，未達雙市場完整條件`);
  }
  throw new Error(`指定日與回退${fallbackDays}日內，未取得TWSE與TPEx同日完整法人資料。${errors.slice(-6).join("；")}`);
}

async function resolveMarginDate(requestedDate: string, fallbackDays: number) {
  const errors: string[] = [];
  for (let offset = 0; offset <= fallbackDays; offset++) {
    const candidate = shiftDate(requestedDate, -offset);
    const settled = await Promise.allSettled([fetchTwseMargin(candidate), fetchTpexMargin(candidate)]);
    const twse = settled[0].status === "fulfilled" ? settled[0].value : [];
    const tpex = settled[1].status === "fulfilled" ? settled[1].value : [];
    if (settled[0].status === "rejected") errors.push(`${candidate} TWSE: ${String(settled[0].reason)}`);
    if (settled[1].status === "rejected") errors.push(`${candidate} TPEx: ${String(settled[1].reason)}`);
    if (twse.length && tpex.length) return { resolvedDate: candidate, rows: [...twse, ...tpex], errors };
    errors.push(`${candidate}: TWSE=${twse.length}列，TPEx=${tpex.length}列，融資融券尚未完整`);
  }
  throw new Error(`指定日與回退${fallbackDays}日內，未取得TWSE與TPEx同日完整融資融券資料。${errors.slice(-6).join("；")}`);
}

export function registerFundFlowReportTools(server: McpServer) {
  server.registerTool("generate_daily_fund_flow_reports", {
    description: "約18:00後使用。一次抓取同交易日TWSE上市與TPEx上櫃個股法人資料，排除ETF後產出資金流入與資金流出兩份固定TXT；不等待晚間融資融券。",
    inputSchema: {
      date: dateSchema.optional().default(taipeiDate()),
      fallback_days: z.number().int().min(0).max(10).optional().default(5),
      top_n: z.number().int().min(10).max(30).optional().default(10),
    },
  }, async ({ date, fallback_days, top_n }) => {
    try {
      const resolved = await resolveInstitutionalDate(date, fallback_days);
      const rows = [...resolved.twse, ...resolved.tpex];
      const foreignBuy = ranked(rows, "foreign_net_shares", "buy", top_n);
      const foreignSell = ranked(rows, "foreign_net_shares", "sell", top_n);
      const trustBuy = ranked(rows, "trust_net_shares", "buy", top_n);
      const trustSell = ranked(rows, "trust_net_shares", "sell", top_n);
      if ([foreignBuy, foreignSell, trustBuy, trustSell].some((list) => list.length < 10)) throw new Error("同日官方資料已取得，但至少一項法人排行榜不足10檔，拒絕產生不完整報告");
      const dayTitle = resolved.resolvedDate.replaceAll("-", "/");
      const inflowCards = Array.from({ length: 5 }, (_, index) => reportCard("🟢", index + 1, `資金流入第${index + 1}群`, [foreignBuy[index]?.symbol, trustBuy[index]?.symbol].filter(Boolean), "外資與投信買超排行依序配對，供後續加入產業映射與量價確認。"));
      const outflowCards = Array.from({ length: 5 }, (_, index) => reportCard("🔻", index + 1, `資金流出第${index + 1}群`, [foreignSell[index]?.symbol, trustSell[index]?.symbol].filter(Boolean), "外資與投信賣超排行依序配對，供後續加入產業映射與量價確認。"));
      const header = `資料日期：requested_date=${date}；resolved_date=${resolved.resolvedDate}\n官方來源：TWSE T86＋TPEx 三大法人買賣明細\n上市筆數：${resolved.twse.length}；上櫃筆數：${resolved.tpex.length}\n`;
      const inflowTxt = `${dayTitle} 台股資金流入\n\n${header}\n${formatRanking("外資買超前十（排除ETF）", foreignBuy)}\n\n${formatRanking("投信買超前十（排除ETF）", trustBuy)}\n\n${inflowCards.join("\n\n")}`;
      const outflowTxt = `${dayTitle} 台股資金流出\n\n${header}\n${formatRanking("外資賣超前十（排除ETF）", foreignSell)}\n\n${formatRanking("投信賣超前十（排除ETF）", trustSell)}\n\n${outflowCards.join("\n\n")}`;
      return ok({
        service: "daily_fund_flow_reports",
        read_only: true,
        requested_date: date,
        resolved_date: resolved.resolvedDate,
        complete: true,
        files: [
          { filename: `${resolved.resolvedDate} 台股資金流入.txt`, content: inflowTxt },
          { filename: `${resolved.resolvedDate} 台股資金流出.txt`, content: outflowTxt },
        ],
        rankings: { foreign_buy: foreignBuy, foreign_sell: foreignSell, trust_buy: trustBuy, trust_sell: trustSell },
        source_counts: { twse: resolved.twse.length, tpex: resolved.tpex.length },
        partial_errors: resolved.errors,
        note: "法人資金流向與晚間融資融券已拆開；此工具不查融資融券。",
      });
    } catch (error) { return fail(error); }
  });

  server.registerTool("generate_daily_margin_report", {
    description: "約21:00至22:00後使用。獨立抓取同交易日TWSE與TPEx融資融券資料，不重做或覆蓋已完成的資金流入／流出報告。",
    inputSchema: {
      date: dateSchema.optional().default(taipeiDate()),
      fallback_days: z.number().int().min(0).max(5).optional().default(0),
      top_n: z.number().int().min(10).max(30).optional().default(10),
    },
  }, async ({ date, fallback_days, top_n }) => {
    try {
      const resolved = await resolveMarginDate(date, fallback_days);
      const ordinary = resolved.rows.filter(isOrdinaryStock);
      const sortNullable = (key: "margin_change" | "short_change", descending: boolean) => ordinary.filter((row) => row[key] !== null).sort((a, b) => descending ? (b[key] as number) - (a[key] as number) : (a[key] as number) - (b[key] as number)).slice(0, top_n);
      const marginIncrease = sortNullable("margin_change", true);
      const marginDecrease = sortNullable("margin_change", false);
      const shortIncrease = sortNullable("short_change", true);
      const shortDecrease = sortNullable("short_change", false);
      const formatMargin = (title: string, list: MarginRow[], key: "margin_change" | "short_change") => `${title}：\n${list.map((row, index) => `${index + 1}. ${row.symbol} ${row.name} ${(row[key] ?? 0) >= 0 ? "+" : ""}${Number(row[key] ?? 0).toLocaleString("zh-TW")}張（${row.market}）`).join("\n")}`;
      const cards = Array.from({ length: 5 }, (_, index) => `🟡卡片${index + 1}｜資券觀察第${index + 1}群\n代表股：${[marginIncrease[index]?.symbol, marginDecrease[index]?.symbol, shortIncrease[index]?.symbol].filter(Boolean).join("、")}\n融資：詳見融資增加／減少排行與官方餘額。\n融券：詳見融券增加／減少排行與官方餘額。\n停券/回補：需搭配停券公告與次日回補變化確認。\n反人性：融資增加不等於看多，融券增加也不等於必然軋空。\n評分：★★★☆☆\n操作建議👉搭配價格、成交量及法人方向後再決定。\n延續性觀察：追蹤次日資券變化與量價是否延續。`);
      const content = `${resolved.resolvedDate.replaceAll("-", "/")} 台股融資融券觀察\n\n資料狀態：requested_date=${date}；resolved_date=${resolved.resolvedDate}\n官方來源：TWSE MI_MARGN＋TPEx 融資融券餘額\n以下採用同日實際資料，不沿用前一交易日。\n\n${formatMargin("融資增加前十", marginIncrease, "margin_change")}\n\n${formatMargin("融資減少前十", marginDecrease, "margin_change")}\n\n${formatMargin("融券增加前十", shortIncrease, "short_change")}\n\n${formatMargin("融券減少前十", shortDecrease, "short_change")}\n\n${cards.join("\n\n")}`;
      return ok({
        service: "daily_margin_report",
        read_only: true,
        requested_date: date,
        resolved_date: resolved.resolvedDate,
        complete: true,
        file: { filename: `${resolved.resolvedDate} 台股融資融券觀察.txt`, content },
        rankings: { margin_increase: marginIncrease, margin_decrease: marginDecrease, short_increase: shortIncrease, short_decrease: shortDecrease },
        partial_errors: resolved.errors,
        note: "此工具與法人資金流向分開執行；預設不回退日期，避免用前一日冒充。",
      });
    } catch (error) { return fail(error); }
  });
}
