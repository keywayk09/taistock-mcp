import { runSmartFamilyAnalysis } from "./family-analysis";
import { familyOpenApiV2 } from "./family-openapi-v2";
import { familyResearchDirective } from "./family-research-policy";
import { runFamilySwingScreenV2 } from "./family-stock-selection-v2";

type RuntimeFamilyEnv = Env & { MOM_GPT_API_KEY?: string };

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  };
}

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left), b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function authorized(request: Request, env: RuntimeFamilyEnv) {
  const expected = String(env.MOM_GPT_API_KEY ?? "").trim();
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") && constantTimeEqual(header.slice(7), expected);
}

async function readBody(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 32_000) throw new Error("payload_too_large");
  const value = await request.json();
  return value !== null && typeof value === "object" ? value as Record<string, any> : {};
}

function validSymbol(value: unknown) {
  const symbol = String(value ?? "").trim();
  return /^\d{4,6}$/.test(symbol) ? symbol : null;
}

function validDate(value: unknown) {
  const date = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function handleFamilySmartRest(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname === "/family-openapi.json") return json(familyOpenApiV2(url.origin));

  const familyPaths = new Set([
    "/api/family/analyze",
    "/api/family/compare",
    "/api/family/screen",
    "/api/family/status",
  ]);
  if (!familyPaths.has(url.pathname)) return null;

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  if (!authorized(request, env as RuntimeFamilyEnv)) {
    return json({ error: "unauthorized" }, 401, { "www-authenticate": 'Bearer realm="taistock-family"', ...cors() });
  }

  if (url.pathname === "/api/family/status") {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, { allow: "GET, OPTIONS", ...cors() });
    return json({
      ok: true,
      service: "Taiwan Stock AI Family Read-Only API",
      version: "family-rest/v2.1.0",
      capabilities: {
        single_stock: "FIXED_11_POINT_PLUS_OPEN_WORLD_RESEARCH",
        compare_2_to_5: "SAME_11_POINT_EVIDENCE_MODEL",
        swing_screen: "V2_FULL_SNAPSHOT_PREFILTER_BOUNDED_DEEP_SCAN",
        realtime: "FUGLE_PRIMARY_WHEN_AVAILABLE",
        web_research: "OPEN_WORLD_AUTONOMOUS_NOT_FIXED_SITES_OR_KEYWORDS",
        formal_chip: "PUBLISHED_GENERATION_ONLY",
        formal_ohlc: "OHLC_MCP_ONLY",
      },
      research_policy: familyResearchDirective([]),
      endpoints: ["/api/family/analyze", "/api/family/compare", "/api/family/screen", "/api/family/query"],
      read_only: true,
    }, 200, cors());
  }

  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST, OPTIONS", ...cors() });

  let body: Record<string, any>;
  try { body = await readBody(request); }
  catch (error) {
    const message = errorText(error);
    return json({ error: message === "payload_too_large" ? "payload_too_large" : "invalid_json" }, message === "payload_too_large" ? 413 : 400, cors());
  }

  try {
    if (url.pathname === "/api/family/analyze") {
      const symbol = validSymbol(body.symbol);
      if (!symbol) return json({ error: "invalid_symbol" }, 400, cors());
      return json(await runSmartFamilyAnalysis(env, { symbols: [symbol], as_of_date: validDate(body.as_of_date) }), 200, cors());
    }

    if (url.pathname === "/api/family/compare") {
      if (!Array.isArray(body.symbols)) return json({ error: "symbols_required" }, 400, cors());
      const rawSymbols = body.symbols.map((value: unknown) => String(value ?? "").trim());
      const symbols = [...new Set(rawSymbols.map(validSymbol).filter((value): value is string => Boolean(value)))];
      if (symbols.length < 2 || symbols.length > 5 || symbols.length !== rawSymbols.length) {
        return json({ error: "symbols_must_be_2_to_5_unique_valid_codes" }, 400, cors());
      }
      return json(await runSmartFamilyAnalysis(env, { symbols, as_of_date: validDate(body.as_of_date) }), 200, cors());
    }

    const mode = ["stable", "balanced", "aggressive"].includes(String(body.mode)) ? body.mode as "stable" | "balanced" | "aggressive" : "balanced";
    const topN = Number.isFinite(Number(body.top_n)) ? Math.max(1, Math.min(10, Math.floor(Number(body.top_n)))) : 5;
    const result = await runFamilySwingScreenV2(env, { mode, top_n: topN });
    return json({ ...result, open_world_research: familyResearchDirective(result.candidates?.map((row: any) => String(row.symbol)) ?? []) }, 200, cors());
  } catch (error) {
    return json({ error: "family_request_failed", message: errorText(error) }, 500, cors());
  }
}
