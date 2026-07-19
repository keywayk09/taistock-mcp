import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

declare global {
	interface Env {
		FUGLE_API_KEY: string;
		FINMIND_TOKEN: string;
	}
}

type JsonObject = Record<string, unknown>;
type FinMindResponse = JsonObject & { data?: unknown[]; msg?: string; message?: string };
type Market = "listed" | "otc";

const FUGLE_BASE_URL = "https://api.fugle.tw/marketdata/v1.0/stock";
const FINMIND_DATA_URL = "https://api.finmindtrade.com/api/v4/data";
const FINMIND_BROKER_URL =
	"https://api.finmindtrade.com/api/v4/taiwan_stock_trading_daily_report";
const TWSE_MATERIAL_EVENTS_URL =
	"https://openapi.twse.com.tw/v1/opendata/t187ap04_L";
const TPEX_MATERIAL_EVENTS_URL =
	"https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O";

const symbolSchema = z
	.string()
	.trim()
	.min(1)
	.max(20)
	.regex(/^[0-9A-Za-z._-]+$/, "股票代碼格式不正確");

const dateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必須是 YYYY-MM-DD")
	.refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "日期無效");

function taipeiDate(daysAgo = 0): string {
	const date = new Date(Date.now() - daysAgo * 86_400_000);
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Taipei",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(date);
}

function assertDateRange(startDate: string, endDate: string): void {
	if (startDate > endDate) throw new Error("start_date 不可晚於 end_date");
}

function asRecord(value: unknown): JsonObject {
	return value !== null && typeof value === "object" ? (value as JsonObject) : {};
}

function asNumber(value: unknown): number {
	const number = Number(value);
	return Number.isFinite(number) ? number : 0;
}

function jsonText(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function toolSuccess(value: unknown) {
	return { content: [{ type: "text" as const, text: jsonText(value) }] };
}

function toolFailure(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return {
		isError: true,
		content: [{ type: "text" as const, text: `查詢失敗：${message}` }],
	};
}

async function fetchJson(
	url: string | URL,
	init: RequestInit,
	source: string,
): Promise<unknown> {
	const response = await fetch(url, init);
	const rawText = await response.text();
	let body: unknown = rawText;

	if (rawText) {
		try {
			body = JSON.parse(rawText);
		} catch {
			// Keep raw text for upstream error reporting.
		}
	}

	if (!response.ok) {
		const record = asRecord(body);
		const upstreamMessage =
			record.message ?? record.msg ?? record.error ?? rawText.slice(0, 500);
		throw new Error(`${source} HTTP ${response.status}: ${String(upstreamMessage)}`);
	}
	return body;
}

function dataArray(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	const record = asRecord(value);
	return Array.isArray(record.data) ? record.data : [];
}

async function fetchFugle(
	path: string,
	apiKey: string,
	query: Record<string, string | undefined> = {},
): Promise<unknown> {
	if (!apiKey) throw new Error("Cloudflare Secret FUGLE_API_KEY 尚未設定");
	const url = new URL(`${FUGLE_BASE_URL}${path}`);
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined && value !== "") url.searchParams.set(key, value);
	}
	return fetchJson(
		url,
		{ headers: { Accept: "application/json", "X-API-KEY": apiKey } },
		"富果",
	);
}

async function fetchFinMindDataset(
	dataset: string,
	params: Record<string, string | undefined>,
	token: string,
): Promise<FinMindResponse> {
	if (!token) throw new Error("Cloudflare Secret FINMIND_TOKEN 尚未設定");
	const url = new URL(FINMIND_DATA_URL);
	url.searchParams.set("dataset", dataset);
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== "") url.searchParams.set(key, value);
	}
	const body = (await fetchJson(
		url,
		{
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${token}`,
			},
		},
		"FinMind",
	)) as FinMindResponse;
	if (!Array.isArray(body.data)) {
		throw new Error(
			`FinMind 回傳格式異常：${String(body.msg ?? body.message ?? "缺少 data 欄位")}`,
		);
	}
	return body;
}

async function fetchFinMindBroker(
	symbol: string,
	date: string,
	token: string,
): Promise<FinMindResponse> {
	if (!token) throw new Error("Cloudflare Secret FINMIND_TOKEN 尚未設定");
	const url = new URL(FINMIND_BROKER_URL);
	url.searchParams.set("data_id", symbol);
	url.searchParams.set("date", date);
	const body = (await fetchJson(
		url,
		{
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${token}`,
			},
		},
		"FinMind 分點",
	)) as FinMindResponse;
	if (!Array.isArray(body.data)) {
		throw new Error(
			`FinMind 分點回傳格式異常：${String(body.msg ?? body.message ?? "缺少 data 欄位")}`,
		);
	}
	return body;
}

function recentRows(rows: unknown[], limit: number): unknown[] {
	return rows.length <= limit ? rows : rows.slice(rows.length - limit);
}

function firstText(row: JsonObject, keys: string[]): string {
	for (const key of keys) {
		const value = row[key];
		if (value !== undefined && value !== null && String(value).trim() !== "") {
			return String(value).trim();
		}
	}
	return "";
}

function normalizeMaterialEvent(item: unknown, market: Market) {
	const row = asRecord(item);
	return {
		market,
		company_code: firstText(row, ["公司代號", "公司代碼", "SecuritiesCompanyCode", "stock_id"]),
		company_name: firstText(row, ["公司名稱", "CompanyName", "stock_name"]),
		report_date: firstText(row, ["出表日期", "資料日期", "date"]),
		publish_date: firstText(row, ["發言日期", "申報日期", "publish_date"]),
		publish_time: firstText(row, ["發言時間", "申報時間", "publish_time"]),
		subject: firstText(row, ["主旨", "Subject", "title"]),
		clause: firstText(row, ["符合條款", "條款", "clause"]),
		event_date: firstText(row, ["事實發生日", "event_date"]),
		description: firstText(row, ["說明", "Description", "content"]),
		raw: row,
	};
}

async function fetchMaterialEvents(market: Market): Promise<ReturnType<typeof normalizeMaterialEvent>[]> {
	const url = market === "listed" ? TWSE_MATERIAL_EVENTS_URL : TPEX_MATERIAL_EVENTS_URL;
	const source = market === "listed" ? "證交所重大訊息" : "櫃買中心重大訊息";
	const body = await fetchJson(url, { headers: { Accept: "application/json" } }, source);
	return dataArray(body).map((item) => normalizeMaterialEvent(item, market));
}

function fulfilledValue<T>(result: PromiseSettledResult<T>): T | null {
	return result.status === "fulfilled" ? result.value : null;
}

function rejectedReason(result: PromiseSettledResult<unknown>): string | null {
	if (result.status !== "rejected") return null;
	return result.reason instanceof Error ? result.reason.message : String(result.reason);
}

export class MyMCP extends McpAgent<Env> {
	server = new McpServer({ name: "Taiwan Stock AI", version: "3.0.0" });

	async init() {
		this.server.registerTool(
			"get_quote",
			{
				description: "使用富果 Fugle 查詢台股即時報價、開高低收、成交量、內外盤與最佳五檔。唯讀工具。",
				inputSchema: {
					symbol: symbolSchema.describe("台股代碼，例如 2330、2388"),
					type: z.enum(["normal", "oddlot"]).optional().default("normal"),
				},
			},
			async ({ symbol, type }) => {
				try {
					const data = await fetchFugle(
						`/intraday/quote/${encodeURIComponent(symbol)}`,
						this.env.FUGLE_API_KEY,
						{ type: type === "oddlot" ? "oddlot" : undefined },
					);
					return toolSuccess({ source: "Fugle", retrieved_at: new Date().toISOString(), data });
				} catch (error) {
					return toolFailure(error);
				}
			},
		);

		this.server.registerTool(
			"get_intraday_candles",
			{
				description: "使用富果 Fugle 查詢台股當日日內 K 線。支援 1、3、5、10、15、30、60 分 K。唯讀工具。",
				inputSchema: {
					symbol: symbolSchema,
					timeframe: z.enum(["1", "3", "5", "10", "15", "30", "60"]).optional().default("5"),
					sort: z.enum(["asc", "desc"]).optional().default("asc"),
					type: z.enum(["normal", "oddlot"]).optional().default("normal"),
					last_n: z.number().int().min(1).max(500).optional().default(100),
				},
			},
			async ({ symbol, timeframe, sort, type, last_n }) => {
				try {
					const raw = await fetchFugle(
						`/intraday/candles/${encodeURIComponent(symbol)}`,
						this.env.FUGLE_API_KEY,
						{ timeframe, sort, type: type === "oddlot" ? "oddlot" : undefined },
					);
					const result = asRecord(raw);
					const rows = Array.isArray(result.data) ? result.data : [];
					const selected = sort === "desc" ? rows.slice(0, last_n) : rows.slice(-last_n);
					return toolSuccess({
						source: "Fugle",
						retrieved_at: new Date().toISOString(),
						...result,
						returned_bars: selected.length,
						data: selected,
					});
				} catch (error) {
					return toolFailure(error);
				}
			},
		);

		this.server.registerTool(
			"get_daily_price",
			{
				description: "使用 FinMind 查詢台股日 K、成交量與成交金額。唯讀工具。",
				inputSchema: {
					symbol: symbolSchema,
					start_date: dateSchema.optional(),
					end_date: dateSchema.optional(),
					limit: z.number().int().min(1).max(500).optional().default(120),
				},
			},
			async ({ symbol, start_date, end_date, limit }) => {
				try {
					const startDate = start_date ?? taipeiDate(180);
					const endDate = end_date ?? taipeiDate();
					assertDateRange(startDate, endDate);
					const result = await fetchFinMindDataset(
						"TaiwanStockPrice",
						{ data_id: symbol, start_date: startDate, end_date: endDate },
						this.env.FINMIND_TOKEN,
					);
					const rows = recentRows(result.data ?? [], limit);
					return toolSuccess({ source: "FinMind", dataset: "TaiwanStockPrice", symbol, start_date: startDate, end_date: endDate, row_count: rows.length, data: rows });
				} catch (error) {
					return toolFailure(error);
				}
			},
		);

		this.server.registerTool(
			"get_institutional",
			{
				description: "使用 FinMind 查詢個股外資、投信、自營商買進、賣出與買賣超。唯讀工具。",
				inputSchema: {
					symbol: symbolSchema,
					start_date: dateSchema.optional(),
					end_date: dateSchema.optional(),
					limit_days: z.number().int().min(1).max(120).optional().default(20),
				},
			},
			async ({ symbol, start_date, end_date, limit_days }) => {
				try {
					const startDate = start_date ?? taipeiDate(45);
					const endDate = end_date ?? taipeiDate();
					assertDateRange(startDate, endDate);
					const result = await fetchFinMindDataset(
						"TaiwanStockInstitutionalInvestorsBuySell",
						{ data_id: symbol, start_date: startDate, end_date: endDate },
						this.env.FINMIND_TOKEN,
					);
					const normalized = (result.data ?? []).map((item) => {
						const row = asRecord(item);
						return { ...row, net: asNumber(row.buy) - asNumber(row.sell) };
					});
					const dates = [...new Set(normalized.map((row) => String(row.date ?? "")))].filter(Boolean).sort();
					const selectedDates = new Set(dates.slice(-limit_days));
					const rows = normalized.filter((row) => selectedDates.has(String(row.date ?? "")));
					return toolSuccess({ source: "FinMind", dataset: "TaiwanStockInstitutionalInvestorsBuySell", symbol, start_date: startDate, end_date: endDate, trading_days: selectedDates.size, data: rows });
				} catch (error) {
					return toolFailure(error);
				}
			},
		);

		this.server.registerTool(
			"get_margin",
			{
				description: "使用 FinMind 查詢個股融資、融券買賣與餘額變化。唯讀工具。",
				inputSchema: {
					symbol: symbolSchema,
					start_date: dateSchema.optional(),
					end_date: dateSchema.optional(),
					limit: z.number().int().min(1).max(250).optional().default(30),
				},
			},
			async ({ symbol, start_date, end_date, limit }) => {
				try {
					const startDate = start_date ?? taipeiDate(60);
					const endDate = end_date ?? taipeiDate();
					assertDateRange(startDate, endDate);
					const result = await fetchFinMindDataset(
						"TaiwanStockMarginPurchaseShortSale",
						{ data_id: symbol, start_date: startDate, end_date: endDate },
						this.env.FINMIND_TOKEN,
					);
					const rows = recentRows(
						(result.data ?? []).map((item) => {
							const row = asRecord(item);
							return {
								...row,
								margin_balance_change: asNumber(row.MarginPurchaseTodayBalance) - asNumber(row.MarginPurchaseYesterdayBalance),
								short_balance_change: asNumber(row.ShortSaleTodayBalance) - asNumber(row.ShortSaleYesterdayBalance),
							};
						}),
						limit,
					);
					return toolSuccess({ source: "FinMind", dataset: "TaiwanStockMarginPurchaseShortSale", symbol, start_date: startDate, end_date: endDate, row_count: rows.length, data: rows });
				} catch (error) {
					return toolFailure(error);
				}
			},
		);

		this.server.registerTool(
			"get_broker_chips",
			{
				description: "使用 FinMind 查詢單一交易日的個股券商分點並彙總淨買賣。需要對應 FinMind 權限。唯讀工具。",
				inputSchema: {
					symbol: symbolSchema,
					date: dateSchema,
					top_n: z.number().int().min(1).max(50).optional().default(20),
				},
			},
			async ({ symbol, date, top_n }) => {
				try {
					const result = await fetchFinMindBroker(symbol, date, this.env.FINMIND_TOKEN);
					const grouped = new Map<string, { id: string; name: string; buy: number; sell: number; buyValue: number; sellValue: number }>();
					for (const item of result.data ?? []) {
						const row = asRecord(item);
						const id = String(row.securities_trader_id ?? "unknown");
						const name = String(row.securities_trader ?? id);
						const key = `${id}|${name}`;
						const current = grouped.get(key) ?? { id, name, buy: 0, sell: 0, buyValue: 0, sellValue: 0 };
						const price = asNumber(row.price);
						const buy = asNumber(row.buy);
						const sell = asNumber(row.sell);
						current.buy += buy;
						current.sell += sell;
						current.buyValue += price * buy;
						current.sellValue += price * sell;
						grouped.set(key, current);
					}
					const summary = [...grouped.values()].map((row) => ({
						securities_trader_id: row.id,
						securities_trader: row.name,
						buy_shares: row.buy,
						sell_shares: row.sell,
						net_shares: row.buy - row.sell,
						net_lots: Number(((row.buy - row.sell) / 1000).toFixed(2)),
						avg_buy_price: row.buy > 0 ? Number((row.buyValue / row.buy).toFixed(4)) : null,
						avg_sell_price: row.sell > 0 ? Number((row.sellValue / row.sell).toFixed(4)) : null,
					}));
					return toolSuccess({
						source: "FinMind",
						dataset: "TaiwanStockTradingDailyReport",
						symbol,
						date,
						broker_count: summary.length,
						top_net_buyers: summary.filter((row) => row.net_shares > 0).sort((a, b) => b.net_shares - a.net_shares).slice(0, top_n),
						top_net_sellers: summary.filter((row) => row.net_shares < 0).sort((a, b) => a.net_shares - b.net_shares).slice(0, top_n),
					});
				} catch (error) {
					return toolFailure(error);
				}
			},
		);

		this.server.registerTool(
			"get_stock_news",
			{
				description: "使用 FinMind TaiwanStockNews 查詢指定個股、指定日期的相關新聞。FinMind 此資料集單次只提供一天。唯讀工具。",
				inputSchema: {
					symbol: symbolSchema,
					date: dateSchema.optional().describe("新聞日期，預設台灣當日"),
					limit: z.number().int().min(1).max(100).optional().default(30),
				},
			},
			async ({ symbol, date, limit }) => {
				try {
					const queryDate = date ?? taipeiDate();
					const result = await fetchFinMindDataset(
						"TaiwanStockNews",
						{ data_id: symbol, start_date: queryDate },
						this.env.FINMIND_TOKEN,
					);
					const rows = (result.data ?? []).slice(0, limit).map((item) => {
						const row = asRecord(item);
						return {
							date: row.date,
							stock_id: row.stock_id,
							title: row.title,
							source: row.source,
							link: row.link,
							description: row.description,
						};
					});
					return toolSuccess({ source: "FinMind", dataset: "TaiwanStockNews", symbol, date: queryDate, row_count: rows.length, data: rows });
				} catch (error) {
					return toolFailure(error);
				}
			},
		);

		this.server.registerTool(
			"get_material_events",
			{
				description: "查詢證交所或櫃買中心官方每日重大訊息，並依股票代碼篩選。唯讀工具。",
				inputSchema: {
					symbol: symbolSchema,
					market: z.enum(["auto", "listed", "otc"]).optional().default("auto"),
					limit: z.number().int().min(1).max(100).optional().default(30),
				},
			},
			async ({ symbol, market, limit }) => {
				try {
					const markets: Market[] = market === "auto" ? ["listed", "otc"] : [market];
					const settled = await Promise.allSettled(markets.map((item) => fetchMaterialEvents(item)));
					const rows = settled
						.flatMap((result) => fulfilledValue(result) ?? [])
						.filter((row) => row.company_code === symbol)
						.slice(0, limit);
					const errors = settled.map(rejectedReason).filter((value): value is string => Boolean(value));
					return toolSuccess({
						source: "TWSE/TPEx OpenAPI",
						symbol,
						markets_checked: markets,
						row_count: rows.length,
						partial_errors: errors,
						data: rows,
					});
				} catch (error) {
					return toolFailure(error);
				}
			},
		);

		this.server.registerTool(
			"explain_price_move",
			{
				description: "一次整理個股即時報價、5 分 K、近期日 K、當日新聞與官方重大訊息，提供給模型判斷異動原因。工具只彙整證據，不保證單一事件具有因果關係。唯讀工具。",
				inputSchema: {
					symbol: symbolSchema,
					date: dateSchema.optional().describe("事件與新聞日期，預設台灣當日"),
					market: z.enum(["auto", "listed", "otc"]).optional().default("auto"),
				},
			},
			async ({ symbol, date, market }) => {
				try {
					const queryDate = date ?? taipeiDate();
					const markets: Market[] = market === "auto" ? ["listed", "otc"] : [market];
					const [quoteResult, candlesResult, dailyResult, newsResult, ...eventResults] = await Promise.allSettled([
						fetchFugle(`/intraday/quote/${encodeURIComponent(symbol)}`, this.env.FUGLE_API_KEY),
						fetchFugle(`/intraday/candles/${encodeURIComponent(symbol)}`, this.env.FUGLE_API_KEY, { timeframe: "5", sort: "asc" }),
						fetchFinMindDataset("TaiwanStockPrice", { data_id: symbol, start_date: taipeiDate(20), end_date: queryDate }, this.env.FINMIND_TOKEN),
						fetchFinMindDataset("TaiwanStockNews", { data_id: symbol, start_date: queryDate }, this.env.FINMIND_TOKEN),
						...markets.map((item) => fetchMaterialEvents(item)),
					]);

					const quote = fulfilledValue(quoteResult);
					const candlesRaw = fulfilledValue(candlesResult);
					const candlesRecord = asRecord(candlesRaw);
					const candles = Array.isArray(candlesRecord.data) ? candlesRecord.data.slice(-60) : [];
					const daily = fulfilledValue(dailyResult);
					const news = fulfilledValue(newsResult);
					const events = eventResults
						.flatMap((result) => fulfilledValue(result) ?? [])
						.filter((row) => row.company_code === symbol)
						.slice(0, 30);
					const errors = [quoteResult, candlesResult, dailyResult, newsResult, ...eventResults]
						.map(rejectedReason)
						.filter((value): value is string => Boolean(value));

					return toolSuccess({
						symbol,
						date: queryDate,
						retrieved_at: new Date().toISOString(),
						caution: "以下為資料證據彙整。新聞或重訊與價格同時出現，不等於已證明因果關係。",
						quote,
						intraday_5m_candles: candles,
						recent_daily_prices: daily?.data ? recentRows(daily.data, 20) : [],
						stock_news: news?.data ? news.data.slice(0, 30) : [],
						material_events: events,
						partial_errors: errors,
					});
				} catch (error) {
					return toolFailure(error);
				}
			},
		);
	}
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);
		if (url.pathname === "/mcp") return MyMCP.serve("/mcp").fetch(request, env, ctx);
		if (url.pathname === "/" || url.pathname === "/health") {
			return Response.json({
				service: "Taiwan Stock AI MCP",
				status: "ok",
				version: "3.0.0",
				mcp_endpoint: "/mcp",
				tools: 9,
			});
		}
		return new Response("Not found", { status: 404 });
	},
};
