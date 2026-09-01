import {
  ResearchVNextResourceError,
  assertResearchVNextResourceBudget,
  type ResearchVNextResourcePolicy,
} from "./resource-policy.ts";

export const RESEARCH_VNEXT_GATEWAY_VERSION =
  "research-vnext-gateway/v1.0.0" as const;

export type ResearchVNextGatewayCapability =
  | "review.summary"
  | "swing.rank"
  | "swing.outcomes"
  | "replay.resolve";

export type ResearchVNextGatewayErrorCode =
  | "UNKNOWN_CAPABILITY"
  | "CAPABILITY_FAILED"
  | "TIMEOUT"
  | "RESOURCE_LIMIT";

export type ResearchVNextGatewayResult =
  | {
      ok: true;
      capability: ResearchVNextGatewayCapability;
      value: unknown;
    }
  | {
      ok: false;
      capability: string;
      error: {
        code: ResearchVNextGatewayErrorCode;
        message: string;
      };
    };

type ResearchVNextGatewayFacade = {
  contract(): unknown;
  summarizeReviewEvidence(rows: any[]): unknown;
  rankSwingEvidence(signals: any[], limit?: number): unknown;
  summarizeSwingOutcomes(results: any[]): unknown;
  resolveSelective1mReplay(input: any): unknown | Promise<unknown>;
  memory: unknown;
};

export type ResearchVNextGatewayOptions = {
  timeoutMs?: number;
  maxErrorMessageChars?: number;
  resourcePolicy?: Partial<ResearchVNextResourcePolicy>;
  loadFacade?: () =>
    | ResearchVNextGatewayFacade
    | Promise<ResearchVNextGatewayFacade>;
};

class ResearchVNextGatewayTimeoutError extends Error {
  constructor() {
    super("Research VNext capability timed out");
    this.name = "ResearchVNextGatewayTimeoutError";
  }
}

const CAPABILITIES = new Set<ResearchVNextGatewayCapability>([
  "review.summary",
  "swing.rank",
  "swing.outcomes",
  "replay.resolve",
]);

function positiveInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function boundedMessage(error: unknown, maxChars: number): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Research VNext capability failed";
  const normalized = String(raw || "Research VNext capability failed");
  return normalized.slice(0, maxChars);
}

async function defaultLoadFacade(): Promise<ResearchVNextGatewayFacade> {
  const module = await import("./shadow-facade.ts");
  return module.createResearchVNextShadowFacade() as unknown as ResearchVNextGatewayFacade;
}

function requiredArray(input: Record<string, unknown>, field: string): any[] {
  const value = input[field];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value;
}

function recordInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("gateway input must be an object");
  }
  return input as Record<string, unknown>;
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ResearchVNextGatewayTimeoutError()), timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createResearchVNextGateway(
  options: ResearchVNextGatewayOptions = {},
) {
  const timeoutMs = positiveInteger(options.timeoutMs, 5_000, 1, 60_000);
  const maxErrorMessageChars = positiveInteger(
    options.maxErrorMessageChars,
    240,
    32,
    2_000,
  );
  const resourcePolicy = options.resourcePolicy ?? {};
  const loader = options.loadFacade ?? defaultLoadFacade;
  let facadePromise: Promise<ResearchVNextGatewayFacade> | null = null;

  function loadFacade(): Promise<ResearchVNextGatewayFacade> {
    if (!facadePromise) facadePromise = Promise.resolve().then(() => loader());
    return facadePromise;
  }

  async function dispatch(
    capability: ResearchVNextGatewayCapability,
    rawInput: unknown,
  ): Promise<unknown> {
    const input = recordInput(rawInput);
    const facade = await loadFacade();

    switch (capability) {
      case "review.summary":
        return facade.summarizeReviewEvidence(requiredArray(input, "rows"));
      case "swing.rank": {
        const signals = requiredArray(input, "signals");
        const rawLimit = input.limit;
        const limit = rawLimit === undefined ? 10 : Number(rawLimit);
        if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("limit must be a positive integer");
        return facade.rankSwingEvidence(signals, limit);
      }
      case "swing.outcomes":
        return facade.summarizeSwingOutcomes(requiredArray(input, "results"));
      case "replay.resolve":
        return facade.resolveSelective1mReplay(input.input);
    }
  }

  return {
    contract() {
      return {
        schema: "RESEARCH_VNEXT_GATEWAY_CONTRACT_V1" as const,
        version: RESEARCH_VNEXT_GATEWAY_VERSION,
        runtime_mode: "SHADOW_UNREGISTERED" as const,
        production_registration: "DISABLED" as const,
        reasoning_owner: "GPT" as const,
        loader: "LAZY_CACHED" as const,
        failure_containment: "PER_CALL" as const,
        direct_provider_access: "FORBIDDEN" as const,
        automatic_strategy_promotion: "FORBIDDEN" as const,
      };
    },

    async invoke(capability: string, input: unknown): Promise<ResearchVNextGatewayResult> {
      if (!CAPABILITIES.has(capability as ResearchVNextGatewayCapability)) {
        return {
          ok: false,
          capability,
          error: {
            code: "UNKNOWN_CAPABILITY",
            message: boundedMessage(`Unknown Research VNext capability: ${capability}`, maxErrorMessageChars),
          },
        };
      }

      const knownCapability = capability as ResearchVNextGatewayCapability;
      try {
        assertResearchVNextResourceBudget(input, resourcePolicy);
        const value = await withTimeout(
          Promise.resolve().then(() => dispatch(knownCapability, input)),
          timeoutMs,
        );
        return { ok: true, capability: knownCapability, value };
      } catch (error) {
        const code: ResearchVNextGatewayErrorCode =
          error instanceof ResearchVNextGatewayTimeoutError
            ? "TIMEOUT"
            : error instanceof ResearchVNextResourceError && error.code === "RESOURCE_LIMIT"
              ? "RESOURCE_LIMIT"
              : "CAPABILITY_FAILED";
        return {
          ok: false,
          capability,
          error: {
            code,
            message: boundedMessage(error, maxErrorMessageChars),
          },
        };
      }
    },
  };
}
