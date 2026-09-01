export const RESEARCH_VNEXT_COMPAT_CUTOVER_VERSION =
  "research-vnext-compat-cutover/v1.0.0" as const;

export type ResearchVNextCompatCapability =
  | "review.summary"
  | "swing.rank"
  | "replay.resolve";

type GatewaySuccess = {
  ok: true;
  capability: string;
  value: unknown;
};

type GatewayFailure = {
  ok: false;
  capability: string;
  error: {
    code: string;
    message: string;
  };
};

type CompatGateway = {
  invoke(capability: string, input: unknown): Promise<GatewaySuccess | GatewayFailure>;
};

export type ResearchVNextCompatCutoverOptions = {
  loadGateway?: () => CompatGateway | Promise<CompatGateway>;
};

type LegacyFallback<T> = () => T | Promise<T>;

async function defaultLoadGateway(): Promise<CompatGateway> {
  const module = await import("./research-gateway.ts");
  return module.createResearchVNextGateway() as CompatGateway;
}

export function createResearchVNextCompatCutover(
  options: ResearchVNextCompatCutoverOptions = {},
) {
  const loader = options.loadGateway ?? defaultLoadGateway;
  let gatewayPromise: Promise<CompatGateway> | null = null;

  function loadGateway(): Promise<CompatGateway> {
    if (!gatewayPromise) gatewayPromise = Promise.resolve().then(() => loader());
    return gatewayPromise;
  }

  async function invokeWithFallback<T>(
    capability: ResearchVNextCompatCapability,
    input: unknown,
    legacyFallback: LegacyFallback<T>,
  ): Promise<T> {
    try {
      const gateway = await loadGateway();
      const result = await gateway.invoke(capability, input);
      if (result.ok) return result.value as T;
    } catch {
      // The migration lane is availability-safe: the proven Legacy path stays
      // available until Production cutover and post-deploy validation finish.
    }
    return await legacyFallback();
  }

  return {
    contract() {
      return {
        schema: "RESEARCH_VNEXT_COMPAT_CUTOVER_CONTRACT_V1" as const,
        version: RESEARCH_VNEXT_COMPAT_CUTOVER_VERSION,
        runtime_mode: "COMPAT_CUTOVER_UNREGISTERED" as const,
        reasoning_owner: "GPT" as const,
        vnext_role: "PRIMARY_DETERMINISTIC" as const,
        legacy_role: "FALLBACK_ONLY" as const,
        eligible_capabilities: [
          "review.summary",
          "swing.rank",
          "replay.resolve",
        ] as const,
        loader: "LAZY_CACHED" as const,
        direct_provider_access: "FORBIDDEN" as const,
        ohlc_write: "FORBIDDEN" as const,
        automatic_strategy_promotion: "FORBIDDEN" as const,
        public_abi_change: "FORBIDDEN" as const,
      };
    },

    reviewSummary<T>(rows: unknown[], legacyFallback: LegacyFallback<T>) {
      return invokeWithFallback<T>("review.summary", { rows }, legacyFallback);
    },

    swingRank<T>(
      signals: unknown[],
      limit: number,
      legacyFallback: LegacyFallback<T>,
    ) {
      return invokeWithFallback<T>(
        "swing.rank",
        { signals, limit },
        legacyFallback,
      );
    },

    replayResolve<T>(input: unknown, legacyFallback: LegacyFallback<T>) {
      return invokeWithFallback<T>(
        "replay.resolve",
        { input },
        legacyFallback,
      );
    },
  };
}
