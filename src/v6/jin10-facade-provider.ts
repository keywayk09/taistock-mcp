import { fetchJin10OwnerData } from "./jin10-owner-tools.ts";

type Jin10FacadeResult = {
  ok: boolean;
  provider: "jin10-mcp";
  mode: "market_brief" | "stock_events";
  read_only: true;
  persistence: "NONE";
  flash: unknown[];
  news: unknown[];
  calendar: unknown[];
  partial_errors: string[];
};

function safeItems(result: any) {
  return result?.ok === true && Array.isArray(result?.items) ? result.items : [];
}

function safeError(result: any) {
  if (result?.ok === true) return null;
  const message = String(result?.error || "JIN10_UNAVAILABLE").slice(0, 300);
  return message;
}

/**
 * Internal-only Jin10 market context for an existing facade tool such as
 * get_daily_market_brief. This module registers no MCP tool and therefore does
 * not change the public ChatGPT tool schema/snapshot.
 */
export async function loadJin10MarketBriefContext(env: Env, limit = 10): Promise<Jin10FacadeResult> {
  const bounded = Math.max(1, Math.min(20, Math.trunc(limit || 10)));
  const [flash, calendar] = await Promise.all([
    fetchJin10OwnerData(env, { tool: "list_flash", limit: bounded }),
    fetchJin10OwnerData(env, { tool: "list_calendar", limit: bounded }),
  ]);
  return {
    ok: flash.ok === true || calendar.ok === true,
    provider: "jin10-mcp",
    mode: "market_brief",
    read_only: true,
    persistence: "NONE",
    flash: safeItems(flash),
    news: [],
    calendar: safeItems(calendar),
    partial_errors: [safeError(flash), safeError(calendar)].filter(Boolean) as string[],
  };
}

/**
 * Internal-only event/news context for existing stock facades such as
 * get_stock_news and explain_price_move. Caller may pass symbol and company
 * name; both are searched without adding any new public MCP action.
 */
export async function loadJin10StockEventContext(env: Env, keywords: string[], limit = 10): Promise<Jin10FacadeResult> {
  const bounded = Math.max(1, Math.min(20, Math.trunc(limit || 10)));
  const cleaned = [...new Set(keywords.map((x) => String(x || "").trim()).filter(Boolean))].slice(0, 2);
  if (!cleaned.length) {
    return { ok: false, provider: "jin10-mcp", mode: "stock_events", read_only: true, persistence: "NONE", flash: [], news: [], calendar: [], partial_errors: ["JIN10_KEYWORD_REQUIRED"] };
  }

  const calls = cleaned.flatMap((keyword) => [
    fetchJin10OwnerData(env, { tool: "search_flash", arguments: { keyword }, limit: bounded }),
    fetchJin10OwnerData(env, { tool: "search_news", arguments: { keyword }, limit: bounded }),
  ]);
  const results = await Promise.all(calls);
  const flash: unknown[] = [];
  const news: unknown[] = [];
  const errors: string[] = [];
  results.forEach((result: any, index) => {
    const isFlash = index % 2 === 0;
    if (result?.ok === true) (isFlash ? flash : news).push(...safeItems(result));
    else {
      const error = safeError(result);
      if (error) errors.push(error);
    }
  });

  return {
    ok: flash.length > 0 || news.length > 0,
    provider: "jin10-mcp",
    mode: "stock_events",
    read_only: true,
    persistence: "NONE",
    flash: flash.slice(0, bounded),
    news: news.slice(0, bounded),
    calendar: [],
    partial_errors: errors,
  };
}
