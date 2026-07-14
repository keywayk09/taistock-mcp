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

type FinMindResponse = JsonObject & {
	data?: unknown[];
	msg?: string;
	message?: string;
};

const FUGLE_BASE_URL = "https://api.fugle.tw/marketdata/v1.0/stock";
const FINMIND_DATA_URL = "https://api.finmindtrade.com/api/v4/data";
const FINMIND_BROKER_URL =
	"https://api.finmindtrade.com/api/v4/taiwan_stock_trading_daily_report";

const symbolSchema = z
	.string()
	.trim()
	.min(1)
	.max(20)
	.regex(/^[0-9A-Za-z._-]+$/, "股票代碼格式不正確");

const dateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必須是 YYYY-MM-DD")
	.refine(
		(value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
		"日期無效",
	);

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
	if (startDate > endDate) {
		throw new Error("start_date 不可晚於 end_date");
	}
}

function asRecord(value: unknown): JsonObject {
	return value !== null && typeof value === "object"
		? (value as JsonObject)
		: {};
}

function asNumber(value: unknown): number {
	const number = Number(value);
	return Number.isFinite(number) ? number : 0;
}

function jsonText(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function toolSuccess(value: unknown) {
	return {
		content: [{ type: "text" as const, text: jsonText(value) }],
	};
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
			// Keep the original text for a useful upstream error message.
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
		{
			headers: {
				Accept: "application/json",
				"X-API-KEY": apiKey,
			},
		},
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

export class MyMCP extends McpAgent<Env> {
	server = new McpServer({
		name: "Taiwan Stock AI",
		version: "2.0.0",
	});

	async init() {
		this.server.registerTool(
			"get_quote",
			{
				description:
					"使用富果 Fugle 查詢台股即時報價、開高低收、成交量、內外盤與最佳五檔。唯讀工具。",
				inputSchema: {
					symbol: symbolSchema.describe("台股代碼，例如 2330、2388"),
					type: z
						.enum(["normal", "oddlot"])
						.optional()
						.default("normal")
						.describe("normal 為整股；oddlot 為盤中零股"),
				},
			},
			async ({ symbol, type }) => {
				try {
					const data = await fetchFugle(
						`/intraday/quote/${encodeURIComponent(symbol)}`,
						this.env.FUGLE_API_KEY,
						{ type: type === "oddlot" ? "oddlot" : undefined },
					);
					return toolSuccess({
						source: "Fugle",
						retrieved_at: new Date().toISOString(),
						data,
					});
				} catch (error) {
					return toolFailure(error);
				}
			},
		);

		this.server.registerTool(
			"get_intraday_candles",
			{
				description:
					"使用富果 Fugle 查詢台股當日日內 K 線。支援 1、3、5、10、15、30、60 分 K。唯讀工具。",
				inputSchema: {
					symbol: symbolSchema.describe("台股代碼，例如 2330"),
					timeframe: z
						.enum(["1", "3", "5", "10", "15", "30", "60"])
						.optional()
						.default("5")
						.describe("K 線分鐘週期"),
					sort: z.enum(["asc", "desc"]).optional().default("asc"),
					type: z.enum(["normal", "oddlot"]).optional().default("normal"),
					last_n: z
						.number()
						.int()
						.min(1)
						.max(500)
						.optional()
						.default(100)
						.describe("最多回傳幾根 K 棒"),
				},
			},
			async ({ symbol, timeframe, sort, type, last_n }) => {
				try {
					const raw = await fetchFugle(
						`/intraday/candles/${encodeURIComponent(symbol)}`,
						this.env.FUGLE_API_KEY,
						{
							timeframe,
							sort,
							type: type === "oddlot" ? "oddlot" : undefined,
						},
					);
					const result = asRecord(raw);
					const rows = Array.isArray(result.data) ? result.data : [];
					const selected =
						sort === "desc" ? rows.slice(0, last_n) : rows.slice(-last_n);
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
				description:
					"使用 FinMind 查詢台股日 K、成交量與成交金額。資料通常於交易日收盤後更新。唯讀工具。",
				inputSchema: {
					symbol: symbolSchema.describe("台股代碼，例如 2330"),
					start_date: dateSchema.optional().describe("起始日期 YYYY-MM-DD"),
					end_date: dateSchema.optional().describe("結束日期 YYYY-MM-DD"),
					limit: z
						.number()
						.int()
						.min(1)
						.max(500)
						.optional()
						.default(120),
				},
			},
			async ({ symbol, start_date, end_date, limit }) => {
				try {
					const startDate = start_date ?? taipeiDate(180);
					const endDate = end_date ?? taipeiDate();
					assertDateRange(startDate, endDate);
					const result = await fetchFinMindDataset(
						"TaiwanStockPrice",
						{
							data_id: symbol,
							start_date: startDate,
							end_date: endDate,
						},
						this.env.FINMIND_TOKEN,
					);
					const rows = recentRows(result.data ?? [], limit);
					return toolSuccess({
						source: "FinMind",
						dataset: "TaiwanStockPrice",
						symbol,
						start_date: startDate,
						end_date: endDate,
						row_count: rows.length,
						data: rows,
					});
				} catch (error) {
					return toolFailure(error);
				}
			},
		);

		this.server.registerTool(
			"get_institutional",
			{
				description:
					"使用 FinMind 查詢個股外資、投信、自營商等法人買進、賣出與買賣超。唯讀工具。",
				inputSchema: {
					symbol: symbolSchema.describe("台股代碼，例如 2330"),
					start_date: dateSchema.optional(),
					end_date: dateSchema.optional(),
					limit_days: z
						.number()
						.int()
						.min(1)
						.max(120)
						.optional()
						.default(20),
				},
			},
			async ({ symbol, start_date, end_date, limit_days }) => {
				try {
					const startDate = start_date ?? taipeiDate(45);
					const endDate = end_date ?? taipeiDate();
					assertDateRange(startDate, endDate);
					const result = await fetchFinMindDataset(
						"TaiwanStockInstitutionalInvestorsBuySell",
						{
							data_id: symbol,
							start_date: startDate,
							end_date: endDate,
						},
						this.env.FINMIND_TOKEN,
					);

					const normalized = (result.data ?? []).map((item) => {
						const row = asRecord(item);
						const buy = asNumber(row.buy);
						const sell = asNumber(row.sell);
						return { ...row, net: buy - sell };
					});
					const allDates = [
						...new Set(normalized.map((row) => String(row.date ?? ""))),
					]
						.filter(Boolean)
						.sort();
					const selectedDates = new Set(allDates.slice(-limit_days));
					const rows = normalized.filter((row) =>
						selectedDates.has(String(row.date ?? "")),
					);

					return toolSuccess({
						source: "FinMind",
						dataset: "TaiwanStockInstitutionalInvestorsBuySell",
						symbol,
						start_date: startDate,
						end_date: endDate,
						trading_days: selectedDates.size,
						data: rows,
					});
				} catch (error) {
					return toolFailure(error);
				}
			},
		);

		this.server.registerTool(
			"get_margin",
			{
				description:
					"使用 FinMind 查詢個股融資、融券買賣及餘額變化。唯讀工具。",
				inputSchema: {
					symbol: symbolSchema.describe("台股代碼，例如 2330"),
					start_date: dateSchema.optional(),
					end_date: dateSchema.optional(),
					limit: z
						.number()
						.int()
						.min(1)
						.max(250)
						.optional()
						.default(30),
				},
			},
			async ({ symbol, start_date, end_date, limit }) => {
				try {
					const startDate = start_date ?? taipeiDate(60);
					const endDate = end_date ?? taipeiDate();
					assertDateRange(startDate, endDate);
					const result = await fetchFinMindDataset(
						"TaiwanStockMarginPurchaseShortSale",
						{
							data_id: symbol,
							start_date: startDate,
							end_date: endDate,
						},
						this.env.FINMIND_TOKEN,
					);

					const normalized = (result.data ?? []).map((item) => {
						const row = asRecord(item);
						return {
							...row,
							margin_balance_change:
								asNumber(row.MarginPurchaseTodayBalance) -
								asNumber(row.MarginPurchaseYesterdayBalance),
							short_balance_change:
								asNumber(row.ShortSaleTodayBalance) -
								asNumber(row.ShortSaleYesterdayBalance),
						};
					});
					const rows = recentRows(normalized, limit);
					return toolSuccess({
						source: "FinMind",
						dataset: "TaiwanStockMarginPurchaseShortSale",
						symbol,
						start_date: startDate,
						end_date: endDate,
						row_count: rows.length,
						data: rows,
					});
				} catch (error) {
					return toolFailure(error);
				}
			},
		);

		this.server.registerTool(
			"get_broker_chips",
			{
				description:
					"使用 FinMind 查詢單一交易日的個股券商分點，彙總主要淨買進與淨賣出分點。此資料集需要 FinMind sponsor 權限。唯讀工具。",
				inputSchema: {
					symbol: symbolSchema.describe("台股代碼，例如 2330"),
					date: dateSchema.describe("交易日期 YYYY-MM-DD；單次只能查一天"),
					top_n: z
						.number()
						.int()
						.min(1)
						.max(50)
						.optional()
						.default(20),
				},
			},
			async ({ symbol, date, top_n }) => {
				try {
					const result = await fetchFinMindBroker(
						symbol,
						date,
						this.env.FINMIND_TOKEN,
					);
					const rows = result.data ?? [];
					const grouped = new Map<
						string,
						{
							securities_trader_id: string;
							securities_trader: string;
							buy_shares: number;
							sell_shares: number;
							buy_value: number;
							sell_value: number;
						}
					>();

					for (const item of rows) {
						const row = asRecord(item);
						const id = String(row.securities_trader_id ?? "unknown");
						const name = String(row.securities_trader ?? id);
						const key = `${id}|${name}`;
						const current = grouped.get(key) ?? {
							securities_trader_id: id,
							securities_trader: name,
							buy_shares: 0,
							sell_shares: 0,
							buy_value: 0,
							sell_value: 0,
						};
						const price = asNumber(row.price);
						const buy = asNumber(row.buy);
						const sell = asNumber(row.sell);
						current.buy_shares += buy;
						current.sell_shares += sell;
						current.buy_value += price * buy;
						current.sell_value += price * sell;
						grouped.set(key, current);
					}

					const summary = [...grouped.values()].map((row) => {
						const netShares = row.buy_shares - row.sell_shares;
						return {
							securities_trader_id: row.securities_trader_id,
							securities_trader: row.securities_trader,
							buy_shares: row.buy_shares,
							sell_shares: row.sell_shares,
							net_shares: netShares,
							buy_lots: Number((row.buy_shares / 1000).toFixed(2)),
							sell_lots: Number((row.sell_shares / 1000).toFixed(2)),
							net_lots: Number((netShares / 1000).toFixed(2)),
							avg_buy_price:
								row.buy_shares > 0
									? Number((row.buy_value / row.buy_shares).toFixed(4))
									: null,
							avg_sell_price:
								row.sell_shares > 0
									? Number((row.sell_value / row.sell_shares).toFixed(4))
									: null,
						};
					});

					const topNetBuyers = summary
						.filter((row) => row.net_shares > 0)
						.sort((a, b) => b.net_shares - a.net_shares)
						.slice(0, top_n);
					const topNetSellers = summary
						.filter((row) => row.net_shares < 0)
						.sort((a, b) => a.net_shares - b.net_shares)
						.slice(0, top_n);
					const totalBuy = summary.reduce((sum, row) => sum + row.buy_shares, 0);
					const totalSell = summary.reduce(
						(sum, row) => sum + row.sell_shares,
						0,
					);

					return toolSuccess({
						source: "FinMind",
						dataset: "TaiwanStockTradingDailyReport",
						symbol,
						date,
						raw_row_count: rows.length,
						broker_count: summary.length,
						total_buy_shares: totalBuy,
						total_sell_shares: totalSell,
						top_net_buyers: topNetBuyers,
						top_net_sellers: topNetSellers,
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

		if (url.pathname === "/mcp") {
			return MyMCP.serve("/mcp").fetch(request, env, ctx);
		}

		if (url.pathname === "/" || url.pathname === "/health") {
			return Response.json({
				service: "Taiwan Stock AI MCP",
				status: "ok",
				version: "2.0.0",
				mcp_endpoint: "/mcp",
			});
		}

		return new Response("Not found", { status: 404 });
	},
};
