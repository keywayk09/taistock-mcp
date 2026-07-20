import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  arr,
  concurrencyMap,
  dateSchema,
  ensureSchema,
  fail,
  fetchJson,
  finmind,
  fugle,
  normalizeDailyBars,
  normalizeQuote,
  num,
  ok,
  parseJson,
  rec,
  returnPct,
  round,
  stockSchema,
  taipeiDate,
  technicalSummary,
  watchlistNameSchema,
  type DailyBar,
  type Obj,
} from "./common";

const FINMIND_START_3Y = () => taipeiDate(1_150);
const TWSE_EVENTS = "https://openapi.twse.com.tw/v1/opendata/t187ap04_L";
const TPEX_EVENTS = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O";
const CBC_FX_DAILY = "https://cpx.cbc.gov.tw/api/OpenData/FTDOpenData_Day";

function nowIso() { return new Date().toISOString(); }
function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function errorText(reason: unknown) { return reason instanceof Error ? reason.message : String(reason); }
function pick(o: Obj, keys: string[]) {
  for (const key of keys) if (o[key] != null && String(o[key]).trim()) return String(o[key]).trim();
  return "";
}
function rowSymbol(row: unknown) {
  return pick(rec(row), ["公司代號", "公司代碼", "證券代號", "證券代碼", "stock_id", "symbol"]).replace(/\s/g, "");
}
function eventRows(body: unknown, symbol: string) {
  return arr(body).filter((x) => rowSymbol(x) === symbol);
}

async function fetchOfficialEvents(symbol: string) {
  const settled = await Promise.allSettled([
    fetchJson(TWSE_EVENTS, { headers: { Accept: "application/json" } }, "TWSE重大訊息"),
    fetchJson(TPEX_EVENTS, { headers: { Accept: "application/json" } }, "TPEx重大訊息"),
  ]);
  const data: any[] = [], errors: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      data.push(...eventRows(result.value.body, symbol).map((row) => ({ market: index ? "otc" : "listed", ...row })));
    } else errors.push(errorText(result.reason));
  });
  return { data, errors };
}

function revenueLatest(rows: any[]) {
  const sorted = rows.map((x) => ({
    ...x,
    revenue: num(x.revenue),
    revenue_year: num(x.revenue_year),
    revenue_month: num(x.revenue_month),
  })).sort((a, b) => a.revenue_year * 100 + a.revenue_month - (b.revenue_year * 100 + b.revenue_month));
  const latest = sorted.at(-1);
  if (!latest) return null;
  const prev = sorted.at(-2);
  const lastYear = sorted.find((x) => x.revenue_year === latest.revenue_year - 1 && x.revenue_month === latest.revenue_month);
  return {
    ...latest,
    mom_percent: prev ? returnPct(latest.revenue, prev.revenue) : null,
    yoy_percent: lastYear ? returnPct(latest.revenue, lastYear.revenue) : null,
  };
}

function metricName(row: Obj) {
  return `${String(row.type ?? "")} ${String(row.origin_name ?? "")} ${String(row.name ?? "")}`.toLowerCase();
}
function selectMetric(rows: any[], aliases: string[]) {
  const lowered = aliases.map((x) => x.toLowerCase());
  const row = rows.find((x) => lowered.some((alias) => metricName(rec(x)).includes(alias)));
  return row ? num(row.value) : null;
}
function periodRows(rows: any[], date: string) { return rows.filter((x) => String(x.date ?? "") === date); }
function financialPeriods(income: any[], balance: any[], cash: any[]) {
  return [...new Set([...income, ...balance, ...cash].map((x) => String(x.date ?? "")))].filter(Boolean).sort();
}
function accountingSummary(income: any[], balance: any[], cash: any[]) {
  const dates = financialPeriods(income, balance, cash).slice(-6);
  const periods = dates.map((date) => {
    const inc = periodRows(income, date), bal = periodRows(balance, date), cf = periodRows(cash, date);
    const revenue = selectMetric(inc, ["operatingrevenue", "revenue", "營業收入"]);
    const gross = selectMetric(inc, ["grossprofit", "營業毛利"]);
    const operating = selectMetric(inc, ["operatingincome", "profitlossfromoperating", "營業利益"]);
    const net = selectMetric(inc, ["incomeaftertaxes", "netincome", "本期淨利", "本期稅後淨利"]);
    const nonOperating = selectMetric(inc, ["nonoperatingincome", "營業外收入", "營業外收支"]);
    const assets = selectMetric(bal, ["totalassets", "資產總額"]);
    const liabilities = selectMetric(bal, ["totalliabilities", "負債總額"]);
    const currentLiabilities = selectMetric(bal, ["currentliabilities", "流動負債"]);
    const inventory = selectMetric(bal, ["inventory", "存貨"]);
    const receivables = selectMetric(bal, ["accountsreceivable", "應收帳款"]);
    const cashFlow = selectMetric(cf, ["cashflowsfromoperatingactivities", "netcashflowsfromusedinoperatingactivities", "營業活動之淨現金流"]);
    const capex = selectMetric(cf, ["purchaseofpropertyplantandequipment", "取得不動產、廠房及設備"]);
    return {
      date, revenue, gross_profit: gross, operating_income: operating, net_income: net, non_operating_income: nonOperating,
      gross_margin_percent: revenue && gross != null ? round(gross / revenue * 100) : null,
      operating_margin_percent: revenue && operating != null ? round(operating / revenue * 100) : null,
      net_margin_percent: revenue && net != null ? round(net / revenue * 100) : null,
      total_assets: assets, total_liabilities: liabilities, current_liabilities: currentLiabilities,
      debt_ratio_percent: assets && liabilities != null ? round(liabilities / assets * 100) : null,
      inventory, accounts_receivable: receivables, operating_cash_flow: cashFlow, capex,
      free_cash_flow_estimate: cashFlow != null && capex != null ? cashFlow + capex : null,
    };
  });
  const latest = periods.at(-1), previous = periods.at(-2);
  const flags: { severity: "low" | "medium" | "high"; message: string }[] = [];
  if (latest && previous) {
    const revenueGrowth = latest.revenue != null && previous.revenue ? returnPct(latest.revenue, previous.revenue) : null;
    const receivableGrowth = latest.accounts_receivable != null && previous.accounts_receivable ? returnPct(latest.accounts_receivable, previous.accounts_receivable) : null;
    const inventoryGrowth = latest.inventory != null && previous.inventory ? returnPct(latest.inventory, previous.inventory) : null;
    if (revenueGrowth != null && revenueGrowth > 0 && latest.operating_cash_flow != null && previous.operating_cash_flow != null && latest.operating_cash_flow < previous.operating_cash_flow) flags.push({ severity: "high", message: "營收成長但營業現金流惡化" });
    if (receivableGrowth != null && revenueGrowth != null && receivableGrowth > revenueGrowth + 15) flags.push({ severity: "high", message: "應收帳款增速明顯高於營收" });
    if (inventoryGrowth != null && revenueGrowth != null && inventoryGrowth > revenueGrowth + 20) flags.push({ severity: "high", message: "存貨增速明顯高於營收" });
    if (latest.net_income != null && latest.net_income > 0 && (latest.free_cash_flow_estimate ?? 0) < 0) flags.push({ severity: "high", message: "帳面獲利為正但自由現金流為負" });
    if (latest.gross_margin_percent != null && previous.gross_margin_percent != null && latest.gross_margin_percent < previous.gross_margin_percent - 3) flags.push({ severity: "medium", message: "毛利率較前期下降超過3個百分點" });
    if (latest.non_operating_income != null && latest.net_income && Math.abs(latest.non_operating_income / latest.net_income) >= 0.5) flags.push({ severity: "medium", message: "營業外收益占淨利比重偏高" });
  }
  if ((latest?.debt_ratio_percent ?? 0) >= 70) flags.push({ severity: "high", message: "負債比高於70%" });
  if ((latest?.operating_cash_flow ?? 0) < 0) flags.push({ severity: "medium", message: "最新一期營業現金流為負" });
  const riskScore = Math.min(100, flags.reduce((sum, x) => sum + (x.severity === "high" ? 25 : x.severity === "medium" ? 12 : 5), 0));
  return { latest: latest ?? null, previous: previous ?? null, periods, flags, risk_score: riskScore, quality: riskScore >= 60 ? "weak" : riskScore >= 30 ? "mixed" : "healthy" };
}

function eventOutcome(bars: DailyBar[]) {
  const reference = bars[0]?.close ?? 0;
  const at = (days: number) => bars[Math.min(days, bars.length - 1)]?.close ?? null;
  const window = (days: number) => bars.slice(0, Math.min(days + 1, bars.length));
  const excursion = (days: number) => {
    const rows = window(days);
    if (!reference || !rows.length) return { mfe: null, mae: null };
    const high = Math.max(...rows.map((x) => x.high));
    const low = Math.min(...rows.map((x) => x.low));
    return { mfe: returnPct(high, reference), mae: returnPct(low, reference) };
  };
  return {
    reference_price: reference || null,
    return_1d: at(1) ? returnPct(at(1)!, reference) : null,
    return_5d: at(5) ? returnPct(at(5)!, reference) : null,
    return_20d: at(20) ? returnPct(at(20)!, reference) : null,
    return_60d: at(60) ? returnPct(at(60)!, reference) : null,
    mfe_20d: excursion(20).mfe,
    mae_20d: excursion(20).mae,
    mfe_60d: excursion(60).mfe,
    mae_60d: excursion(60).mae,
  };
}

function correlation(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (n < 5) return null;
  const x = a.slice(-n), y = b.slice(-n);
  const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; cov += dx * dy; vx += dx * dx; vy += dy * dy; }
  return vx && vy ? round(cov / Math.sqrt(vx * vy), 3) : null;
}
function logReturns(bars: DailyBar[]) { return bars.slice(1).map((x, i) => Math.log(x.close / bars[i].close)); }

async function loadWatchlist(env: Env, name: string) {
  const db = await ensureSchema(env);
  const list = await db.prepare("SELECT * FROM watchlists WHERE name = ?").bind(name).first<any>();
  if (!list) throw new Error(`找不到觀察清單：${name}`);
  const items = await db.prepare("SELECT * FROM watchlist_items WHERE watchlist_name = ? ORDER BY added_at").bind(name).all<any>();
  return { ...list, items: items.results.map((x: any) => ({ ...x, tags: parseJson<string[]>(x.tags_json, []) })) };
}

async function scanSymbols(env: Env, symbols: string[], includeSwingScore: boolean) {
  const settled = await concurrencyMap(symbols, 5, async (symbol) => {
    const quote = normalizeQuote(await fugle(env, `/intraday/quote/${encodeURIComponent(symbol)}`), symbol);
    if (!includeSwingScore) return { ...quote, swing: null };
    const daily = normalizeDailyBars(await finmind(env, "TaiwanStockPrice", { data_id: symbol, start_date: taipeiDate(240), end_date: taipeiDate() }));
    return { ...quote, swing: technicalSummary(daily) };
  });
  const data: any[] = [], errors: any[] = [];
  settled.forEach((result, i) => result.status === "fulfilled" ? data.push(result.value) : errors.push({ symbol: symbols[i], error: errorText(result.reason) }));
  return { data, errors };
}

async function marketBreadth(env: Env) {
  const settled = await Promise.allSettled(["TSE", "OTC"].map(async (market) => {
    const root = rec(await fugle(env, `/snapshot/quotes/${market}`, { type: "COMMONSTOCK" }));
    const rows = arr(root.data).map((x) => normalizeQuote(x, String(rec(x).symbol ?? ""))).filter((x) => x.close > 0);
    return { market, rows };
  }));
  const rows: any[] = [], errors: string[] = [];
  settled.forEach((r) => r.status === "fulfilled" ? rows.push(...r.value.rows) : errors.push(errorText(r.reason)));
  const advancers = rows.filter((x) => x.change_percent > 0).length;
  const decliners = rows.filter((x) => x.change_percent < 0).length;
  return {
    stocks: rows.length,
    advancers,
    decliners,
    advance_decline_ratio: decliners ? round(advancers / decliners, 3) : null,
    total_trade_value: rows.reduce((s, x) => s + num(x.trade_value), 0),
    top_gainers: [...rows].sort((a, b) => b.change_percent - a.change_percent).slice(0, 10),
    top_value: [...rows].sort((a, b) => b.trade_value - a.trade_value).slice(0, 10),
    errors,
  };
}

export function registerAdvancedTools(server: McpServer, env: Env) {
  const watchItem = z.object({
    symbol: stockSchema,
    note: z.string().max(500).optional().default(""),
    tags: z.array(z.string().max(30)).max(20).optional().default([]),
    target_price: z.number().positive().optional(),
    stop_price: z.number().positive().optional(),
  });

  server.registerTool("save_watchlist", {
    description: "建立或更新永久觀察清單，資料儲存在Cloudflare D1，跨聊天與裝置保留。",
    inputSchema: {
      name: watchlistNameSchema.optional().default("我的觀察清單"),
      description: z.string().max(500).optional().default(""),
      mode: z.enum(["merge", "replace"]).optional().default("merge"),
      items: z.array(watchItem).min(1).max(300),
    },
  }, async ({ name, description, mode, items }) => {
    try {
      const db = await ensureSchema(env), now = nowIso();
      await db.prepare("INSERT INTO watchlists(name,description,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET description=excluded.description,updated_at=excluded.updated_at").bind(name, description, now, now).run();
      if (mode === "replace") await db.prepare("DELETE FROM watchlist_items WHERE watchlist_name = ?").bind(name).run();
      const statements = items.map((item: { symbol: string; note: string; tags: string[]; target_price?: number; stop_price?: number }) => db.prepare("INSERT INTO watchlist_items(watchlist_name,symbol,note,tags_json,target_price,stop_price,added_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(watchlist_name,symbol) DO UPDATE SET note=excluded.note,tags_json=excluded.tags_json,target_price=excluded.target_price,stop_price=excluded.stop_price,updated_at=excluded.updated_at").bind(name, item.symbol, item.note, JSON.stringify(item.tags), item.target_price ?? null, item.stop_price ?? null, now, now));
      await db.batch(statements);
      return ok({ storage: "Cloudflare D1", name, mode, saved: items.length, watchlist: await loadWatchlist(env, name) });
    } catch (e) { return fail(e); }
  });

  server.registerTool("get_watchlist", {
    description: "讀取永久觀察清單。",
    inputSchema: { name: watchlistNameSchema.optional().default("我的觀察清單") },
  }, async ({ name }) => { try { return ok({ storage: "Cloudflare D1", watchlist: await loadWatchlist(env, name) }); } catch (e) { return fail(e); } });

  server.registerTool("remove_watchlist_items", {
    description: "從永久觀察清單移除股票。",
    inputSchema: { name: watchlistNameSchema.optional().default("我的觀察清單"), symbols: z.array(stockSchema).min(1).max(300) },
  }, async ({ name, symbols }) => {
    try {
      const db = await ensureSchema(env);
      await db.batch(symbols.map((symbol: string) => db.prepare("DELETE FROM watchlist_items WHERE watchlist_name = ? AND symbol = ?").bind(name, symbol)));
      return ok({ name, removed: symbols, watchlist: await loadWatchlist(env, name) });
    } catch (e) { return fail(e); }
  });

  server.registerTool("scan_saved_watchlist", {
    description: "掃描D1中的觀察清單，依即時強弱、成交值或波段分數排序，並保存每日快照。",
    inputSchema: {
      name: watchlistNameSchema.optional().default("我的觀察清單"),
      rank_by: z.enum(["change_percent", "trade_value", "trade_volume", "intraday_position", "swing_score"]).optional().default("change_percent"),
      include_swing_score: z.boolean().optional().default(false),
      top_n: z.number().int().min(1).max(100).optional().default(30),
    },
  }, async ({ name, rank_by, include_swing_score, top_n }) => {
    try {
      const list = await loadWatchlist(env, name), symbols = list.items.map((x: any) => String(x.symbol));
      const scanned = await scanSymbols(env, symbols, include_swing_score || rank_by === "swing_score");
      const score = (x: any) => rank_by === "swing_score" ? num(x.swing?.score) : num(x[rank_by]);
      scanned.data.sort((a, b) => score(b) - score(a));
      const db = await ensureSchema(env), date = taipeiDate(), now = nowIso();
      await db.batch(scanned.data.map((x) => db.prepare("INSERT INTO watchlist_snapshots(watchlist_name,symbol,snapshot_date,close,change_percent,trade_value,score,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(watchlist_name,symbol,snapshot_date) DO UPDATE SET close=excluded.close,change_percent=excluded.change_percent,trade_value=excluded.trade_value,score=excluded.score,payload_json=excluded.payload_json,created_at=excluded.created_at").bind(name, x.symbol, date, x.close, x.change_percent, x.trade_value, x.swing?.score ?? null, JSON.stringify(x), now)));
      return ok({ name, snapshot_date: date, rank_by, requested: symbols.length, data: scanned.data.slice(0, top_n), partial_errors: scanned.errors });
    } catch (e) { return fail(e); }
  });

  server.registerTool("get_watchlist_changes", {
    description: "比較觀察清單最近兩個交易日快照，找出排名、漲跌幅與波段分數變化。",
    inputSchema: { name: watchlistNameSchema.optional().default("我的觀察清單") },
  }, async ({ name }) => {
    try {
      const db = await ensureSchema(env);
      const dates = await db.prepare("SELECT DISTINCT snapshot_date FROM watchlist_snapshots WHERE watchlist_name = ? ORDER BY snapshot_date DESC LIMIT 2").bind(name).all<any>();
      if (dates.results.length < 2) throw new Error("至少需要在兩個不同日期執行 scan_saved_watchlist 才能比較變化");
      const [latestDate, previousDate] = dates.results.map((x: any) => String(x.snapshot_date));
      const rows = await db.prepare("SELECT * FROM watchlist_snapshots WHERE watchlist_name = ? AND snapshot_date IN (?,?)").bind(name, latestDate, previousDate).all<any>();
      const map = new Map<string, any>();
      for (const row of rows.results) { const current = map.get(row.symbol) ?? {}; current[row.snapshot_date] = row; map.set(row.symbol, current); }
      const changes = [...map.entries()].map(([symbol, value]) => {
        const a = value[latestDate], b = value[previousDate];
        return { symbol, latest: a ?? null, previous: b ?? null, close_change_percent: a && b ? returnPct(num(a.close), num(b.close)) : null, score_change: a && b ? round(num(a.score) - num(b.score)) : null, trade_value_change_percent: a && b ? returnPct(num(a.trade_value), num(b.trade_value)) : null };
      }).sort((a, b) => num(b.score_change) - num(a.score_change));
      return ok({ name, latest_date: latestDate, previous_date: previousDate, changes });
    } catch (e) { return fail(e); }
  });

  server.registerTool("record_stock_event", {
    description: "把策略訊號、財報、營收、法說或其他事件永久寫入事件資料庫。",
    inputSchema: { symbol: stockSchema, event_type: z.string().trim().min(1).max(80), event_date: dateSchema.optional(), source: z.string().max(80).optional().default("manual"), title: z.string().max(500).optional().default(""), payload: z.record(z.string(), z.unknown()).optional().default({}) },
  }, async ({ symbol, event_type, event_date, source, title, payload }) => {
    try {
      const db = await ensureSchema(env), date = event_date ?? taipeiDate();
      const result = await db.prepare("INSERT INTO stock_events(symbol,event_type,event_date,source,title,payload_json,created_at) VALUES(?,?,?,?,?,?,?)").bind(symbol, event_type, date, source, title, JSON.stringify(payload), nowIso()).run();
      return ok({ stored: true, event_id: Number(result.meta.last_row_id ?? 0), symbol, event_type, event_date: date });
    } catch (e) { return fail(e); }
  });

  server.registerTool("list_stock_events", {
    description: "查詢永久事件資料庫。",
    inputSchema: { symbol: stockSchema.optional(), event_type: z.string().max(80).optional(), limit: z.number().int().min(1).max(500).optional().default(100) },
  }, async ({ symbol, event_type, limit }) => {
    try {
      const db = await ensureSchema(env);
      const clauses: string[] = [], values: any[] = [];
      if (symbol) { clauses.push("e.symbol = ?"); values.push(symbol); }
      if (event_type) { clauses.push("e.event_type = ?"); values.push(event_type); }
      values.push(limit);
      const sql = `SELECT e.*,o.reference_price,o.return_1d,o.return_5d,o.return_20d,o.return_60d,o.mfe_20d,o.mae_20d,o.mfe_60d,o.mae_60d FROM stock_events e LEFT JOIN event_outcomes o ON o.event_id=e.id ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY e.event_date DESC,e.id DESC LIMIT ?`;
      const result = await db.prepare(sql).bind(...values).all<any>();
      return ok({ data: result.results.map((x: any) => ({ ...x, payload: parseJson(x.payload_json, {}) })) });
    } catch (e) { return fail(e); }
  });

  server.registerTool("evaluate_event_outcomes", {
    description: "計算事件後1/5/20/60日報酬及MFE/MAE，寫回事件資料庫。",
    inputSchema: { event_id: z.number().int().positive().optional(), symbol: stockSchema.optional(), limit: z.number().int().min(1).max(30).optional().default(10), overwrite: z.boolean().optional().default(false) },
  }, async ({ event_id, symbol, limit, overwrite }) => {
    try {
      const db = await ensureSchema(env), clauses: string[] = [], values: any[] = [];
      if (event_id) { clauses.push("e.id = ?"); values.push(event_id); }
      if (symbol) { clauses.push("e.symbol = ?"); values.push(symbol); }
      if (!overwrite) clauses.push("o.event_id IS NULL");
      values.push(limit);
      const events = await db.prepare(`SELECT e.* FROM stock_events e LEFT JOIN event_outcomes o ON o.event_id=e.id ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY e.event_date LIMIT ?`).bind(...values).all<any>();
      const settled = await concurrencyMap(events.results, 3, async (event: any) => {
        const rows = normalizeDailyBars(await finmind(env, "TaiwanStockPrice", { data_id: event.symbol, start_date: event.event_date, end_date: addDays(event.event_date, 120) }));
        if (!rows.length) throw new Error(`${event.symbol} 在事件日期後沒有日K`);
        const outcome = eventOutcome(rows);
        await db.prepare("INSERT INTO event_outcomes(event_id,reference_price,return_1d,return_5d,return_20d,return_60d,mfe_20d,mae_20d,mfe_60d,mae_60d,evaluated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET reference_price=excluded.reference_price,return_1d=excluded.return_1d,return_5d=excluded.return_5d,return_20d=excluded.return_20d,return_60d=excluded.return_60d,mfe_20d=excluded.mfe_20d,mae_20d=excluded.mae_20d,mfe_60d=excluded.mfe_60d,mae_60d=excluded.mae_60d,evaluated_at=excluded.evaluated_at").bind(event.id, outcome.reference_price, outcome.return_1d, outcome.return_5d, outcome.return_20d, outcome.return_60d, outcome.mfe_20d, outcome.mae_20d, outcome.mfe_60d, outcome.mae_60d, nowIso()).run();
        return { event_id: event.id, symbol: event.symbol, event_type: event.event_type, ...outcome };
      });
      return ok({ requested: events.results.length, results: settled.map((x, i) => x.status === "fulfilled" ? x.value : { event_id: events.results[i]?.id, error: errorText(x.reason) }) });
    } catch (e) { return fail(e); }
  });

  server.registerTool("find_event_patterns", {
    description: "依事件類型統計樣本數、正報酬率、平均報酬與MFE/MAE。",
    inputSchema: { symbol: stockSchema.optional(), min_samples: z.number().int().min(1).max(100).optional().default(3) },
  }, async ({ symbol, min_samples }) => {
    try {
      const db = await ensureSchema(env);
      const result = symbol
        ? await db.prepare("SELECT e.event_type,COUNT(*) samples,AVG(o.return_5d) avg_return_5d,AVG(o.return_20d) avg_return_20d,AVG(o.return_60d) avg_return_60d,AVG(o.mfe_20d) avg_mfe_20d,AVG(o.mae_20d) avg_mae_20d,100.0*SUM(CASE WHEN o.return_20d>0 THEN 1 ELSE 0 END)/COUNT(*) positive_20d_rate FROM stock_events e JOIN event_outcomes o ON o.event_id=e.id WHERE e.symbol=? GROUP BY e.event_type HAVING COUNT(*)>=? ORDER BY avg_return_20d DESC").bind(symbol, min_samples).all<any>()
        : await db.prepare("SELECT e.event_type,COUNT(*) samples,AVG(o.return_5d) avg_return_5d,AVG(o.return_20d) avg_return_20d,AVG(o.return_60d) avg_return_60d,AVG(o.mfe_20d) avg_mfe_20d,AVG(o.mae_20d) avg_mae_20d,100.0*SUM(CASE WHEN o.return_20d>0 THEN 1 ELSE 0 END)/COUNT(*) positive_20d_rate FROM stock_events e JOIN event_outcomes o ON o.event_id=e.id GROUP BY e.event_type HAVING COUNT(*)>=? ORDER BY avg_return_20d DESC").bind(min_samples).all<any>();
      return ok({ symbol: symbol ?? "all", data: result.results });
    } catch (e) { return fail(e); }
  });

  server.registerTool("compare_peer_strength", {
    description: "比較同產業股票的20/60/120日強度、波動率、營收年增與綜合排名。",
    inputSchema: { symbol: stockSchema, max_peers: z.number().int().min(3).max(20).optional().default(10) },
  }, async ({ symbol, max_peers }) => {
    try {
      const info = await finmind(env, "TaiwanStockInfo", {});
      const target = info.find((x: any) => String(x.stock_id) === symbol);
      if (!target) throw new Error("TaiwanStockInfo 找不到該股票");
      const sector = String(target.industry_category ?? "");
      const peers = info.filter((x: any) => String(x.industry_category ?? "") === sector && /^\d{4,6}$/.test(String(x.stock_id))).slice(0, max_peers);
      if (!peers.some((x: any) => String(x.stock_id) === symbol)) peers.unshift(target);
      const selected = peers.slice(0, max_peers);
      const settled = await concurrencyMap(selected, 4, async (peer: any) => {
        const code = String(peer.stock_id);
        const [prices, revenue] = await Promise.all([
          finmind(env, "TaiwanStockPrice", { data_id: code, start_date: taipeiDate(420), end_date: taipeiDate() }),
          finmind(env, "TaiwanStockMonthRevenue", { data_id: code, start_date: taipeiDate(500) }),
        ]);
        const tech = technicalSummary(normalizeDailyBars(prices));
        const rev = revenueLatest(revenue);
        const score = round(num(tech.score) * 0.7 + Math.max(0, Math.min(100, 50 + num(rev?.yoy_percent))) * 0.3);
        return { symbol: code, name: peer.stock_name ?? "", sector, technical: tech, revenue: rev, composite_score: score };
      });
      const data = settled.flatMap((x) => x.status === "fulfilled" ? [x.value] : []).sort((a, b) => b.composite_score - a.composite_score).map((x, i) => ({ rank: i + 1, ...x }));
      return ok({ target: symbol, sector, peer_count: data.length, target_rank: data.find((x) => x.symbol === symbol)?.rank ?? null, data, partial_errors: settled.flatMap((x, i) => x.status === "rejected" ? [{ symbol: selected[i]?.stock_id, error: errorText(x.reason) }] : []) });
    } catch (e) { return fail(e); }
  });

  server.registerTool("get_macro_risk_dashboard", {
    description: "整合央行美元兌台幣、上市櫃市場廣度與成交值，判斷出口股與整體波段風險。",
    inputSchema: {},
  }, async () => {
    try {
      const [fx, breadth] = await Promise.allSettled([
        fetchJson(CBC_FX_DAILY, { headers: { Accept: "application/json" } }, "央行匯率"),
        marketBreadth(env),
      ]);
      const errors: string[] = [];
      if (fx.status === "rejected") errors.push(errorText(fx.reason));
      if (breadth.status === "rejected") errors.push(errorText(breadth.reason));
      const fxRows = fx.status === "fulfilled" ? arr(fx.value.body) : [];
      const sortedFx = fxRows.map((x) => ({ date: pick(rec(x), ["Date", "date", "日期"]), rate: num(rec(x).Rate ?? rec(x).rate ?? rec(x)["新臺幣對美元收盤匯率"] ?? rec(x)["收盤匯率"]) })).filter((x) => x.date && x.rate).sort((a, b) => a.date.localeCompare(b.date));
      const latest = sortedFx.at(-1), base20 = sortedFx.at(-21), base60 = sortedFx.at(-61);
      const fxTrend20 = latest && base20 ? returnPct(latest.rate, base20.rate) : null;
      const fxTrend60 = latest && base60 ? returnPct(latest.rate, base60.rate) : null;
      const b = breadth.status === "fulfilled" ? breadth.value : null;
      const regime = !b ? "unknown" : (b.advance_decline_ratio ?? 1) >= 1.5 ? "risk_on" : (b.advance_decline_ratio ?? 1) <= 0.67 ? "risk_off" : "mixed";
      return ok({ source: ["Central Bank OpenData", "Fugle market snapshot"], retrieved_at: nowIso(), usd_twd: { latest: latest ?? null, change_20d_percent: fxTrend20, change_60d_percent: fxTrend60, interpretation: fxTrend20 != null && fxTrend20 > 2 ? "台幣偏貶，出口族群匯率環境相對有利，但須留意外資流出風險。" : fxTrend20 != null && fxTrend20 < -2 ? "台幣偏升，出口族群可能面臨匯率壓力，外資資金面可能相對改善。" : "匯率變動溫和。" }, market: b, regime, partial_errors: errors });
    } catch (e) { return fail(e); }
  });

  server.registerTool("detect_accounting_red_flags", {
    description: "偵測營收與現金流背離、應收、存貨、營業外收益、負債及自由現金流風險。",
    inputSchema: { symbol: stockSchema, start_date: dateSchema.optional() },
  }, async ({ symbol, start_date }) => {
    try {
      const start = start_date ?? FINMIND_START_3Y();
      const settled = await Promise.allSettled([
        finmind(env, "TaiwanStockFinancialStatements", { data_id: symbol, start_date: start }),
        finmind(env, "TaiwanStockBalanceSheet", { data_id: symbol, start_date: start }),
        finmind(env, "TaiwanStockCashFlowsStatement", { data_id: symbol, start_date: start }),
      ]);
      const errors = settled.flatMap((x) => x.status === "rejected" ? [errorText(x.reason)] : []);
      return ok({ symbol, start_date: start, ...accountingSummary(settled[0].status === "fulfilled" ? settled[0].value : [], settled[1].status === "fulfilled" ? settled[1].value : [], settled[2].status === "fulfilled" ? settled[2].value : []), partial_errors: errors });
    } catch (e) { return fail(e); }
  });

  server.registerTool("get_capital_structure_events", {
    description: "整理現增、私募、減資、分割、庫藏股、可轉債與股利等可能稀釋或改變股本的事件。",
    inputSchema: { symbol: stockSchema, start_date: dateSchema.optional(), limit: z.number().int().min(1).max(100).optional().default(50) },
  }, async ({ symbol, start_date, limit }) => {
    try {
      const start = start_date ?? taipeiDate(1_100);
      const [events, dividends] = await Promise.allSettled([
        fetchOfficialEvents(symbol),
        finmind(env, "TaiwanStockDividend", { data_id: symbol, start_date: start }),
      ]);
      const keywords = /現金增資|現增|私募|減資|分割|面額變更|庫藏股|可轉換公司債|可轉債|CB|員工認股|限制員工權利|股本|除權|除息/;
      const material = events.status === "fulfilled" ? events.value.data.filter((x: any) => keywords.test(JSON.stringify(x))).slice(0, limit) : [];
      const errors = [events, dividends].flatMap((x) => x.status === "rejected" ? [errorText(x.reason)] : []);
      if (events.status === "fulfilled") errors.push(...events.value.errors);
      return ok({ source: ["TWSE/TPEx material events", "FinMind dividend"], symbol, start_date: start, capital_events: material, dividends: dividends.status === "fulfilled" ? dividends.value.slice(-20) : [], risk_notes: material.map((x: any) => pick(rec(x), ["主旨", "subject", "說明", "description"])).filter(Boolean), partial_errors: errors });
    } catch (e) { return fail(e); }
  });

  server.registerTool("calculate_position_size", {
    description: "依帳戶資金、進場價、停損價與單筆風險比例計算台股合理股數。",
    inputSchema: { account_value: z.number().positive(), entry_price: z.number().positive(), stop_price: z.number().positive(), risk_percent: z.number().positive().max(10).optional().default(1), max_position_percent: z.number().positive().max(100).optional().default(20), round_lot_only: z.boolean().optional().default(false) },
  }, async ({ account_value, entry_price, stop_price, risk_percent, max_position_percent, round_lot_only }) => {
    try {
      const riskPerShare = Math.abs(entry_price - stop_price);
      if (!riskPerShare) throw new Error("進場價不可等於停損價");
      const riskBudget = account_value * risk_percent / 100;
      const maxCapital = account_value * max_position_percent / 100;
      const byRisk = Math.floor(riskBudget / riskPerShare), byCapital = Math.floor(maxCapital / entry_price);
      let shares = Math.min(byRisk, byCapital);
      if (round_lot_only) shares = Math.floor(shares / 1000) * 1000;
      return ok({ account_value, risk_budget: round(riskBudget), max_position_capital: round(maxCapital), risk_per_share: round(riskPerShare, 4), shares, lots: round(shares / 1000, 3), position_value: round(shares * entry_price), maximum_planned_loss: round(shares * riskPerShare), binding_constraint: byRisk <= byCapital ? "risk_budget" : "max_position_percent" });
    } catch (e) { return fail(e); }
  });

  const positionSchema = z.object({ symbol: stockSchema, quantity: z.number().positive(), avg_price: z.number().positive(), stop_price: z.number().positive().optional(), sector: z.string().max(80).optional().default(""), note: z.string().max(500).optional().default("") });

  server.registerTool("save_portfolio", {
    description: "建立或更新永久持股組合，供集中度、相關性與停損風險分析。",
    inputSchema: { name: z.string().trim().min(1).max(50).optional().default("我的持股"), mode: z.enum(["merge", "replace"]).optional().default("merge"), positions: z.array(positionSchema).min(1).max(100) },
  }, async ({ name, mode, positions }) => {
    try {
      const db = await ensureSchema(env), now = nowIso();
      await db.prepare("INSERT INTO portfolios(name,created_at,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET updated_at=excluded.updated_at").bind(name, now, now).run();
      if (mode === "replace") await db.prepare("DELETE FROM portfolio_positions WHERE portfolio_name=?").bind(name).run();
      await db.batch(positions.map((x: { symbol: string; quantity: number; avg_price: number; stop_price?: number; sector: string; note: string }) => db.prepare("INSERT INTO portfolio_positions(portfolio_name,symbol,quantity,avg_price,stop_price,sector,note,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(portfolio_name,symbol) DO UPDATE SET quantity=excluded.quantity,avg_price=excluded.avg_price,stop_price=excluded.stop_price,sector=excluded.sector,note=excluded.note,updated_at=excluded.updated_at").bind(name, x.symbol, x.quantity, x.avg_price, x.stop_price ?? null, x.sector, x.note, now)));
      return ok({ name, mode, saved: positions.length });
    } catch (e) { return fail(e); }
  });

  server.registerTool("analyze_portfolio_risk", {
    description: "分析永久持股組合的市值集中度、產業集中、停損損失、波動率與股票相關性。",
    inputSchema: { name: z.string().trim().min(1).max(50).optional().default("我的持股"), lookback_days: z.number().int().min(30).max(250).optional().default(120) },
  }, async ({ name, lookback_days }) => {
    try {
      const db = await ensureSchema(env);
      const result = await db.prepare("SELECT * FROM portfolio_positions WHERE portfolio_name=? ORDER BY symbol").bind(name).all<any>();
      if (!result.results.length) throw new Error(`持股組合「${name}」尚無資料`);
      const settled = await concurrencyMap(result.results, 4, async (position: any) => {
        const bars = normalizeDailyBars(await finmind(env, "TaiwanStockPrice", { data_id: position.symbol, start_date: taipeiDate(lookback_days * 2), end_date: taipeiDate() })).slice(-lookback_days);
        const latest = bars.at(-1)?.close ?? num(position.avg_price);
        const marketValue = latest * num(position.quantity);
        return { ...position, latest_price: latest, market_value: marketValue, unrealized_return_percent: returnPct(latest, num(position.avg_price)), stop_loss_amount: position.stop_price ? Math.max(0, latest - num(position.stop_price)) * num(position.quantity) : null, technical: technicalSummary(bars), returns: logReturns(bars) };
      });
      const positions = settled.flatMap((x) => x.status === "fulfilled" ? [x.value] : []);
      const total = positions.reduce((sum, x) => sum + x.market_value, 0);
      const enriched = positions.map((x) => ({ ...x, weight_percent: total ? round(x.market_value / total * 100) : 0 }));
      const sectorMap = new Map<string, number>();
      enriched.forEach((x) => sectorMap.set(x.sector || "未分類", (sectorMap.get(x.sector || "未分類") ?? 0) + x.market_value));
      const correlations: any[] = [];
      for (let i = 0; i < enriched.length; i++) for (let j = i + 1; j < enriched.length; j++) correlations.push({ a: enriched[i].symbol, b: enriched[j].symbol, correlation: correlation(enriched[i].returns, enriched[j].returns) });
      const highCorr = correlations.filter((x) => num(x.correlation) >= 0.75);
      return ok({ name, total_market_value: round(total), positions: enriched.map(({ returns, ...x }) => x), sector_concentration: [...sectorMap.entries()].map(([sector, value]) => ({ sector, market_value: round(value), weight_percent: total ? round(value / total * 100) : 0 })).sort((a, b) => b.market_value - a.market_value), correlations, risk_flags: [enriched.some((x) => x.weight_percent >= 30) ? "單一個股權重超過30%" : null, [...sectorMap.values()].some((x) => total && x / total >= 0.5) ? "單一產業權重超過50%" : null, highCorr.length ? `存在${highCorr.length}組高度相關持股` : null].filter(Boolean), partial_errors: settled.flatMap((x, i) => x.status === "rejected" ? [{ symbol: result.results[i]?.symbol, error: errorText(x.reason) }] : []) });
    } catch (e) { return fail(e); }
  });

  server.registerTool("get_daily_market_brief", {
    description: "產生盤前、盤中或盤後摘要資料：市場廣度、觀察清單強弱、事件與風險。",
    inputSchema: { phase: z.enum(["pre_market", "intraday", "post_market"]).optional().default("post_market"), watchlist_name: watchlistNameSchema.optional().default("我的觀察清單"), top_n: z.number().int().min(3).max(30).optional().default(10) },
  }, async ({ phase, watchlist_name, top_n }) => {
    try {
      const [breadth, list] = await Promise.allSettled([marketBreadth(env), loadWatchlist(env, watchlist_name)]);
      const errors: string[] = [];
      if (breadth.status === "rejected") errors.push(errorText(breadth.reason));
      if (list.status === "rejected") errors.push(errorText(list.reason));
      const symbols = list.status === "fulfilled" ? list.value.items.map((x: any) => String(x.symbol)) : [];
      const scan = symbols.length ? await scanSymbols(env, symbols, false) : { data: [], errors: [] };
      const db = await ensureSchema(env);
      const recentEvents = await db.prepare("SELECT * FROM stock_events WHERE event_date >= ? ORDER BY event_date DESC,id DESC LIMIT 50").bind(taipeiDate(7)).all<any>();
      const strongest = [...scan.data].sort((a, b) => b.change_percent - a.change_percent).slice(0, top_n);
      const weakest = [...scan.data].sort((a, b) => a.change_percent - b.change_percent).slice(0, top_n);
      return ok({ phase, date: taipeiDate(), generated_at: nowIso(), market: breadth.status === "fulfilled" ? breadth.value : null, watchlist: { name: watchlist_name, count: symbols.length, strongest, weakest, volume_leaders: [...scan.data].sort((a, b) => b.trade_value - a.trade_value).slice(0, top_n) }, recent_stored_events: recentEvents.results.map((x: any) => ({ ...x, payload: parseJson(x.payload_json, {}) })), partial_errors: [...errors, ...scan.errors.map((x: any) => `${x.symbol}: ${x.error}`)] });
    } catch (e) { return fail(e); }
  });

  server.registerTool("get_data_health", {
    description: "檢查富果、FinMind、證交所、櫃買、央行與D1的連線、延遲及最新資料日期。",
    inputSchema: { test_symbol: stockSchema.optional().default("2330") },
  }, async ({ test_symbol }) => {
    try {
      const checks = [
        { name: "D1", run: async () => { const started = Date.now(); const db = await ensureSchema(env); const row = await db.prepare("SELECT datetime('now') now").first<any>(); return { latency_ms: Date.now() - started, latest: row?.now ?? null }; } },
        { name: "Fugle", run: async () => { const started = Date.now(); const q = normalizeQuote(await fugle(env, `/intraday/quote/${test_symbol}`), test_symbol); return { latency_ms: Date.now() - started, latest: q.last_updated, symbol: q.symbol }; } },
        { name: "FinMind", run: async () => { const started = Date.now(); const rows = await finmind(env, "TaiwanStockPrice", { data_id: test_symbol, start_date: taipeiDate(14), end_date: taipeiDate() }); return { latency_ms: Date.now() - started, latest: rows.at(-1)?.date ?? null, rows: rows.length }; } },
        { name: "TWSE", run: async () => { const r = await fetchJson("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL", { headers: { Accept: "application/json" } }, "TWSE"); return { latency_ms: r.latency_ms, rows: arr(r.body).length }; } },
        { name: "TPEx", run: async () => { const r = await fetchJson("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes", { headers: { Accept: "application/json" } }, "TPEx"); return { latency_ms: r.latency_ms, rows: arr(r.body).length }; } },
        { name: "CBC", run: async () => { const r = await fetchJson(CBC_FX_DAILY, { headers: { Accept: "application/json" } }, "CBC"); return { latency_ms: r.latency_ms, rows: arr(r.body).length }; } },
      ];
      const settled = await Promise.allSettled(checks.map((x) => x.run()));
      const data = settled.map((x, i) => x.status === "fulfilled" ? { source: checks[i].name, status: "ok", ...x.value } : { source: checks[i].name, status: "error", error: errorText(x.reason) });
      return ok({ checked_at: nowIso(), overall: data.every((x) => x.status === "ok") ? "healthy" : data.some((x) => x.status === "ok") ? "degraded" : "down", data });
    } catch (e) { return fail(e); }
  });
}
