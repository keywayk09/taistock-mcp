import { fugle, normalizeQuote } from "./common.ts";
import { fetchJin10OwnerData } from "./jin10-owner-tools.ts";

type Jin10EntityResolution = {
  source: "caller" | "fugle-quote" | "unresolved";
  symbol: string | null;
  company_name: string | null;
  numeric_symbol_suppressed: boolean;
  error?: string | null;
};

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
  query_keywords?: string[];
  entity_resolution?: Jin10EntityResolution;
};

// Jin10's search corpus is Simplified Chinese. Taiwan provider names are
// commonly Traditional Chinese, so a literal query such as 台積電 can return
// zero rows even when the corpus contains 台积电. Keep this conversion local to
// the Jin10 provider facade: it does not alter the public Diamond ABI or the
// canonical Taiwan company name returned to callers.
const JIN10_SIMPLIFIED_CHAR_MAP: Record<string, string> = {
  "積": "积", "電": "电", "聯": "联", "發": "发", "鴻": "鸿", "國": "国",
  "華": "华", "廣": "广", "長": "长", "榮": "荣", "寶": "宝", "統": "统",
  "達": "达", "創": "创", "緯": "纬", "穎": "颖", "碩": "硕", "啟": "启",
  "亞": "亚", "麗": "丽", "漢": "汉", "勝": "胜", "豐": "丰", "遠": "远",
  "興": "兴", "業": "业", "環": "环", "應": "应", "製": "制", "藥": "药",
  "學": "学", "鋼": "钢", "鐵": "铁", "銀": "银", "證": "证", "資": "资",
  "訊": "讯", "網": "网", "圓": "圆", "氣": "气", "綠": "绿", "機": "机",
  "車": "车", "運": "运", "輸": "输", "設": "设", "營": "营", "壽": "寿",
  "險": "险", "儲": "储", "記": "记", "憶": "忆", "體": "体", "導": "导",
  "臺": "台", "灣": "湾", "實": "实", "際": "际", "開": "开", "關": "关",
  "貿": "贸", "易": "易", "農": "农", "產": "产", "礦": "矿", "紡": "纺",
  "織": "织", "紙": "纸", "膠": "胶", "塑": "塑", "樹": "树", "橡": "橡",
  "醫": "医", "療": "疗", "衛": "卫", "生": "生", "飛": "飞", "龍": "龙",
  "鳳": "凤", "馬": "马", "萬": "万", "億": "亿", "強": "强", "傑": "杰",
  "東": "东", "陽": "阳", "陰": "阴", "燁": "烨", "煒": "炜", "燦": "灿",
  "燈": "灯", "聲": "声", "樂": "乐", "時": "时", "維": "维", "誠": "诚",
  "義": "义", "順": "顺", "益": "益", "泰": "泰", "儀": "仪", "廠": "厂",
};

function toJin10SearchKeyword(value: string) {
  return [...String(value || "").trim()].map((char) => JIN10_SIMPLIFIED_CHAR_MAP[char] ?? char).join("");
}

function safeItems(result: any) {
  return result?.ok === true && Array.isArray(result?.items) ? result.items : [];
}

function safeError(result: any) {
  if (result?.ok === true) return null;
  return String(result?.error || "JIN10_UNAVAILABLE").slice(0, 300);
}

function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error ?? "UNKNOWN"))
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .slice(0, 240);
}

function isNumericTwSymbol(value: string) {
  return /^\d{4,6}$/.test(value);
}

function itemTimestamp(item: any) {
  const value = String(item?.time ?? item?.pub_time ?? item?.date ?? "");
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function dedupeAndSort(items: unknown[]) {
  const unique = new Map<string, any>();
  for (const raw of items) {
    const item = raw as any;
    const key = String(item?.id ?? `${item?.time ?? item?.pub_time ?? ""}|${item?.title ?? ""}|${item?.summary ?? item?.content ?? ""}`);
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].sort((a, b) => itemTimestamp(b) - itemTimestamp(a));
}

/**
 * Resolve Taiwan numeric stock codes to a company entity before searching
 * Jin10. Pure numeric keyword search is intentionally forbidden because values
 * such as 2330 also occur in prices, quantities, index levels and addresses.
 */
async function resolveStockEntityKeywords(env: Env, keywords: string[]) {
  const cleaned = [...new Set(keywords.map((x) => String(x || "").trim()).filter(Boolean))].slice(0, 4);
  const numeric = cleaned.find(isNumericTwSymbol) ?? null;
  const textual = cleaned.filter((keyword) => !isNumericTwSymbol(keyword));

  if (textual.length) {
    return {
      queryKeywords: [...new Set(textual.map(toJin10SearchKeyword).filter(Boolean))].slice(0, 2),
      resolution: {
        source: "caller" as const,
        symbol: numeric,
        company_name: textual[0] ?? null,
        numeric_symbol_suppressed: Boolean(numeric),
      },
    };
  }

  if (!numeric) {
    return {
      queryKeywords: [...new Set(cleaned.map(toJin10SearchKeyword).filter(Boolean))].slice(0, 2),
      resolution: {
        source: "caller" as const,
        symbol: cleaned[0] ?? null,
        company_name: null,
        numeric_symbol_suppressed: false,
      },
    };
  }

  try {
    const quote = normalizeQuote(
      await fugle(env, `/intraday/quote/${encodeURIComponent(numeric)}`),
      numeric,
    );
    const name = String(quote.name || "").trim();
    if (!name || name === numeric) {
      return {
        queryKeywords: [],
        resolution: {
          source: "unresolved" as const,
          symbol: numeric,
          company_name: null,
          numeric_symbol_suppressed: true,
          error: "FUGLE_QUOTE_MISSING_COMPANY_NAME",
        },
      };
    }
    return {
      queryKeywords: [toJin10SearchKeyword(name)],
      resolution: {
        source: "fugle-quote" as const,
        symbol: numeric,
        company_name: name,
        numeric_symbol_suppressed: true,
      },
    };
  } catch (error) {
    return {
      queryKeywords: [],
      resolution: {
        source: "unresolved" as const,
        symbol: numeric,
        company_name: null,
        numeric_symbol_suppressed: true,
        error: errorText(error),
      },
    };
  }
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
    flash: dedupeAndSort(safeItems(flash)).slice(0, bounded),
    news: [],
    calendar: dedupeAndSort(safeItems(calendar)).slice(0, bounded),
    partial_errors: [safeError(flash), safeError(calendar)].filter(Boolean) as string[],
  };
}

/**
 * Internal-only event/news context for existing stock facades such as
 * get_stock_news and explain_price_move. Numeric Taiwan symbols are resolved
 * to a company name before Jin10 search to prevent numeric false positives.
 */
export async function loadJin10StockEventContext(env: Env, keywords: string[], limit = 10): Promise<Jin10FacadeResult> {
  const bounded = Math.max(1, Math.min(20, Math.trunc(limit || 10)));
  const { queryKeywords, resolution } = await resolveStockEntityKeywords(env, keywords);
  if (!queryKeywords.length) {
    const detail = resolution.error ? `:${resolution.error}` : "";
    return {
      ok: false,
      provider: "jin10-mcp",
      mode: "stock_events",
      read_only: true,
      persistence: "NONE",
      flash: [],
      news: [],
      calendar: [],
      query_keywords: [],
      entity_resolution: resolution,
      partial_errors: [`JIN10_ENTITY_NAME_UNRESOLVED${detail}`],
    };
  }

  const calls = queryKeywords.flatMap((keyword) => [
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
    ok: results.some((result: any) => result?.ok === true),
    provider: "jin10-mcp",
    mode: "stock_events",
    read_only: true,
    persistence: "NONE",
    flash: dedupeAndSort(flash).slice(0, bounded),
    news: dedupeAndSort(news).slice(0, bounded),
    calendar: [],
    query_keywords: queryKeywords,
    entity_resolution: resolution,
    partial_errors: errors,
  };
}
