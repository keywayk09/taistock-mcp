import {
  getMarketDataStatus as getMarketDataStatusBase,
  marketDataPhaseForCron,
  runMarketDataPipeline as runMarketDataPipelineBase,
  type MarketDataPhase,
} from "./market-data-pipeline";

declare global {
  interface Env {
    GITHUB_TOKEN?: string;
  }
}

type MarketDataCompatEnv = Env & {
  MARKET_DATA_GITHUB_TOKEN?: string;
};

/**
 * Public Cloudflare secret contract for Diamond Market Data V1.
 *
 * Use the same secret name as the OHLC worker: GITHUB_TOKEN.
 * Cloudflare secrets are worker-scoped, so taistock-mcp still needs its own
 * GITHUB_TOKEN binding even when tv-fugle-1d already has one.
 *
 * The V1 collector currently retains the legacy internal field name. This
 * adapter maps that internal read to GITHUB_TOKEN without requiring a risky
 * whole-file credential refactor before shadow validation.
 */
function marketDataEnv(env: Env): Env {
  const sharedToken = env.GITHUB_TOKEN;
  return new Proxy(env as MarketDataCompatEnv, {
    get(target, property, receiver) {
      if (property === "MARKET_DATA_GITHUB_TOKEN") return sharedToken;
      return Reflect.get(target, property, receiver);
    },
  }) as Env;
}

export { marketDataPhaseForCron };
export type { MarketDataPhase };

export async function getMarketDataStatus(env: Env, tradeDate?: string) {
  const status = await getMarketDataStatusBase(marketDataEnv(env), tradeDate);
  return {
    ...status,
    github_secret_name: "GITHUB_TOKEN",
  };
}

export async function runMarketDataPipeline(
  env: Env,
  phase: MarketDataPhase,
  scheduledAt = new Date(),
) {
  const result = await runMarketDataPipelineBase(marketDataEnv(env), phase, scheduledAt);
  if (result.status !== "PENDING_SECRET") return result;
  return {
    ...result,
    error: "GITHUB_TOKEN 尚未設定；Diamond Market Data V1 與 OHLC 使用相同 secret 名稱，但各 Worker 仍需各自綁定該 secret",
  };
}
