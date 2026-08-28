import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readResearchBlindOhlcFallback } from "./research-blind-ohlc-fallback";

export const FORMAL_BLIND_OHLC_READER_VERSION = "formal-blind-ohlc-reader/v1.0.0";
const DEFAULT_OHLC_BASE_URL = "https://tv-fugle-1d.keikei99887.workers.dev";

type FormalBlindArgs = {
  symbol: string;
  trade_date: string;
  timeframe: "1m" | "5m";
  decision_time: string;
  limit?: number;
};

function normalizeDecisionTime(value: string) {
  const raw = String(value || "").trim();
  return raw.length === 5 ? `${raw}:00` : raw;
}

function blocked(base: Record<string, unknown>, reason: string, receipt: unknown = null) {
  return {
    ...base,
    formal_blind_eligible: false,
    formal_research_eligible: false,
    scorecard_eligible: false,
    eligibility_reason: reason,
    canonical_verification_receipt: receipt,
    formal_reader_version: FORMAL_BLIND_OHLC_READER_VERSION,
  };
}

function receiptMatches(receipt: any, args: FormalBlindArgs) {
  return receipt?.ok === true
    && receipt?.formal_blind_eligible === true
    && String(receipt?.symbol || "") === String(args.symbol)
    && String(receipt?.timeframe || "") === String(args.timeframe)
    && String(receipt?.trade_date || "") === String(args.trade_date)
    && normalizeDecisionTime(String(receipt?.decision_time || "")) === normalizeDecisionTime(args.decision_time)
    && receipt?.cutoff?.leakage_validated === true
    && receipt?.cutoff?.prefix_completeness === true
    && receipt?.verification?.accepted_for_research === true;
}

export async function readFormalBlindOhlc(
  env: Env,
  input: FormalBlindArgs,
  fetchImpl: typeof fetch = fetch,
) {
  const fallback = await readResearchBlindOhlcFallback(env, input);
  if (fallback?.ok !== true || fallback?.leakage_validated !== true || fallback?.cutoff?.prefix_completeness !== true) {
    return blocked(fallback as Record<string, unknown>, "LOCAL_CANONICAL_CUTOFF_NOT_ELIGIBLE");
  }

  const baseUrl = String((env as any).OHLC_FORMAL_VERIFICATION_BASE_URL || DEFAULT_OHLC_BASE_URL).replace(/\/+$/, "");
  const params = new URLSearchParams({
    symbol: String(input.symbol),
    timeframe: String(input.timeframe),
    trade_date: String(input.trade_date),
    decision_time: normalizeDecisionTime(input.decision_time),
  });

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/research/formal-blind-verification?${params.toString()}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
        "User-Agent": "taistock-formal-blind-reader/1.0",
      },
    });
  } catch (error) {
    return blocked(fallback as Record<string, unknown>, `CANONICAL_VERIFICATION_HTTP_FAILED:${String((error as Error)?.message || error)}`);
  }

  const receipt = await response.json().catch(() => null);
  if (!response.ok) {
    return blocked(fallback as Record<string, unknown>, `CANONICAL_VERIFICATION_HTTP_${response.status}`, receipt);
  }
  if (!receiptMatches(receipt, input)) {
    return blocked(fallback as Record<string, unknown>, String(receipt?.eligibility_reason || receipt?.error || "CANONICAL_VERIFICATION_NOT_ELIGIBLE"), receipt);
  }

  return {
    ...fallback,
    mode: "formal_research_blind",
    source: "GITHUB_CANONICAL_SERVER_SIDE_CUTOFF_PLUS_OHLC_CANONICAL_VERIFICATION",
    formal_blind_eligible: true,
    formal_research_eligible: true,
    scorecard_eligible: true,
    eligibility_reason: "CANONICAL_OHLC_RESEARCH_GATE_VERIFIED",
    canonical_verification_receipt: receipt,
    formal_reader_version: FORMAL_BLIND_OHLC_READER_VERSION,
  };
}

const ok = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

export function registerFormalBlindOhlcReaderTool(server: McpServer, env: Env) {
  server.registerTool("read_formal_blind_ohlc", {
    description: "正式 Blind OHLC 唯讀入口。先以 canonical GitHub 1m/5m 做 server-side decision_time cutoff 與 prefix 完整性驗證，再向 OHLC canonical read_ohlc 取得不含 bars 的 official verification receipt；兩邊全部一致且 PASS 才具 FORMAL/scorecard 資格。",
    inputSchema: {
      symbol: z.string().trim().regex(/^\d{4,6}$/),
      trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      timeframe: z.enum(["1m", "5m"]),
      decision_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
      limit: z.number().int().min(1).max(2000).optional().default(300),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (args) => ok(await readFormalBlindOhlc(env, args)));
}
