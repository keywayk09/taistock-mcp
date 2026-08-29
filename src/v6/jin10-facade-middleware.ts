import { loadJin10MarketBriefContext, loadJin10StockEventContext } from "./jin10-facade-provider.ts";

export const JIN10_FACADE_TOOL_NAMES = new Set([
  "get_stock_news",
  "explain_price_move",
  "get_daily_market_brief",
]);

const JIN10_FACADE_BUDGET_MS = 5_000;

type FacadeMode = "market_brief" | "stock_events";

function redactError(error: unknown) {
  return (error instanceof Error ? error.message : String(error ?? "JIN10_UNAVAILABLE"))
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .slice(0, 300);
}

function unavailable(mode: FacadeMode, error: unknown) {
  return {
    ok: false,
    provider: "jin10-mcp",
    mode,
    read_only: true,
    persistence: "NONE",
    flash: [],
    news: [],
    calendar: [],
    partial_errors: [redactError(error)],
  };
}

function hasJin10Token(env: Env) {
  return Boolean(String((env as any)?.JIN10_MCP_TOKEN || "").trim());
}

async function withFacadeBudget<T>(promise: Promise<T>, mode: FacadeMode): Promise<T | ReturnType<typeof unavailable>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<ReturnType<typeof unavailable>>((resolve) => {
        timer = setTimeout(() => resolve(unavailable(mode, "JIN10_FACADE_TIMEOUT")), JIN10_FACADE_BUDGET_MS);
      }),
    ]);
  } catch (error) {
    return unavailable(mode, error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function loadFacadeContext(env: Env, toolName: string, input: any) {
  const mode: FacadeMode = toolName === "get_daily_market_brief" ? "market_brief" : "stock_events";
  if (!hasJin10Token(env)) return unavailable(mode, "JIN10_MCP_TOKEN_NOT_CONFIGURED");

  if (mode === "market_brief") {
    const topN = Number.isFinite(Number(input?.top_n)) ? Number(input.top_n) : 10;
    return withFacadeBudget(loadJin10MarketBriefContext(env, topN), mode);
  }

  const symbol = String(input?.symbol || "").trim();
  if (!symbol) return unavailable(mode, "JIN10_SYMBOL_REQUIRED");
  const limit = toolName === "get_stock_news" && Number.isFinite(Number(input?.limit))
    ? Number(input.limit)
    : 10;
  return withFacadeBudget(loadJin10StockEventContext(env, [symbol], limit), mode);
}

function attachContext(baseResult: any, jin10Context: any) {
  if (!baseResult) return baseResult;

  // Preserve the base provider's error semantics, but never discard evidence
  // already fetched from Jin10. This makes the facade fail-open in both
  // directions: Jin10 cannot break the base tool, and a base-provider failure
  // cannot suppress Jin10 context.
  if (baseResult.isError === true) {
    const content = Array.isArray(baseResult.content) ? [...baseResult.content] : [];
    content.push({
      type: "text",
      text: JSON.stringify({ jin10_context: jin10Context }, null, 2),
    });
    const structuredContent = baseResult.structuredContent && typeof baseResult.structuredContent === "object" && !Array.isArray(baseResult.structuredContent)
      ? { ...baseResult.structuredContent, jin10_context: jin10Context }
      : { jin10_context: jin10Context };
    return { ...baseResult, content, structuredContent };
  }

  let changed = false;
  let content = baseResult.content;
  if (Array.isArray(content)) {
    const index = content.findIndex((item: any) => item?.type === "text" && typeof item?.text === "string");
    if (index >= 0) {
      try {
        const parsed = JSON.parse(content[index].text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const next = [...content];
          next[index] = { ...content[index], text: JSON.stringify({ ...parsed, jin10_context: jin10Context }, null, 2) };
          content = next;
          changed = true;
        }
      } catch {
        // Preserve non-JSON MCP text exactly; never break an existing tool result.
      }
    }
  }

  let structuredContent = baseResult.structuredContent;
  if (structuredContent && typeof structuredContent === "object" && !Array.isArray(structuredContent)) {
    structuredContent = { ...structuredContent, jin10_context: jin10Context };
    changed = true;
  }

  return changed ? { ...baseResult, content, structuredContent } : baseResult;
}

/**
 * Registration-time Owner middleware. It wraps only already-existing Diamond
 * facade handlers; tool names, descriptions and input schemas pass through
 * untouched. No MCP action is registered by this module.
 */
export function registerToolThroughJin10Facade(
  originalRegisterTool: (...args: any[]) => any,
  server: any,
  env: Env,
  name: string,
  args: any[],
) {
  if (!JIN10_FACADE_TOOL_NAMES.has(name)) {
    return originalRegisterTool.call(server, name, ...args);
  }

  const handlerIndex = args.length - 1;
  const handler = args[handlerIndex];
  if (typeof handler !== "function") {
    return originalRegisterTool.call(server, name, ...args);
  }

  const wrappedHandler = async (...handlerArgs: any[]) => {
    const input = handlerArgs[0] ?? {};
    const jin10Promise = loadFacadeContext(env, name, input);
    const basePromise = Promise.resolve(handler(...handlerArgs));
    const [baseResult, jin10Context] = await Promise.all([basePromise, jin10Promise]);
    return attachContext(baseResult, jin10Context);
  };

  const nextArgs = [...args];
  nextArgs[handlerIndex] = wrappedHandler;
  return originalRegisterTool.call(server, name, ...nextArgs);
}
