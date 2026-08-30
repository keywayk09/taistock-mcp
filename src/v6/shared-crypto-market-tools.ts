import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const SHARED_CRYPTO_TOOL_NAMES = [
  "get_crypto_engine_status",
  "get_crypto_candidates",
  "get_crypto_deep_probe",
] as const;

const DEFAULT_CRYPTO_ENGINE_BASE_URL = "https://tv-crypto-engine.keikei99887.workers.dev";

const out = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

function cryptoBaseUrl(env: Env) {
  const configured = String((env as any).CRYPTO_ENGINE_BASE_URL || "").trim();
  return (configured || DEFAULT_CRYPTO_ENGINE_BASE_URL).replace(/\/+$/, "");
}

async function fetchCryptoJson(env: Env, pathname: string, searchParams?: URLSearchParams) {
  const url = new URL(`${cryptoBaseUrl(env)}${pathname}`);
  if (searchParams) url.search = searchParams.toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), 20_000);
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent": "taistock-mcp/shared-crypto-read-plane",
      },
      signal: controller.signal,
    });

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = { error: "crypto_engine_non_json_response" };
    }

    return {
      ok: response.ok,
      http_status: response.status,
      source: "tv-crypto-engine",
      read_only: true,
      endpoint: pathname,
      payload,
    };
  } catch (error) {
    return {
      ok: false,
      http_status: null,
      source: "tv-crypto-engine",
      read_only: true,
      endpoint: pathname,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function registerSharedCryptoMarketTools(server: McpServer, env: Env) {
  server.registerTool("get_crypto_engine_status", {
    description: "讀取中央幣圈引擎健康狀態與目前可用選幣模式。唯讀、不下單、不改參數、不寫入市場資料。",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => out(await fetchCryptoJson(env, "/health")));

  server.registerTool("get_crypto_candidates", {
    description: "從中央幣圈引擎即時取得做多/做空候選。profile=stable_quality 是原本較穩健、流動性與跨交易所品質優先的選幣；profile=volatile 是妖幣/高波動模式，專找較小、波動正在放大的標的，並細分順勢追、回踩量縮、整理待突破、擠壓加速。使用者說『穩定幣/穩一點』時用 stable_quality；說『妖幣/小幣/波動大』時用 volatile。這裡的穩定幣是交易風格稱呼，不是 USDT/USDC stablecoin。唯讀，不代表自動進場訊號。",
    inputSchema: {
      profile: z.enum(["stable_quality", "volatile"]).optional().default("stable_quality"),
      setup: z.enum(["all", "trend_follow", "pullback_contraction", "consolidation", "squeeze"]).optional().default("all"),
      per_side: z.number().int().min(1).max(3).optional().default(3),
      light_limit: z.number().int().min(6).max(50).optional().default(30),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ profile, setup, per_side, light_limit }) => {
    const params = new URLSearchParams({
      profile: String(profile),
      setup: String(setup),
      per_side: String(per_side),
      light_limit: String(light_limit),
    });
    return out(await fetchCryptoJson(env, "/market/candidate-scan", params));
  });

  server.registerTool("get_crypto_deep_probe", {
    description: "對指定1到6個幣做中央幣圈引擎Deep Probe，讀取Bybit/Gate 5m價格、15m本地聚合、成交量、OI與Price×OI regime。唯讀，不建立部位。",
    inputSchema: {
      symbols: z.array(z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9]+$/)).min(1).max(6),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ symbols }) => {
    const normalized = [...new Set(symbols.map((value) => value.toUpperCase().replace(/USDT$/, "")))];
    const params = new URLSearchParams({ symbols: normalized.join(",") });
    return out(await fetchCryptoJson(env, "/market/deep-probe", params));
  });
}
