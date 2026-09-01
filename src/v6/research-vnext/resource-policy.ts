export const RESEARCH_VNEXT_RESOURCE_POLICY_VERSION =
  "research-vnext-resource-policy/v1.0.0" as const;

export type ResearchVNextResourcePolicy = {
  maxInputBytes: number;
  maxArrayItems: number;
  maxObjectKeys: number;
  maxDepth: number;
  maxNodes: number;
};

export type ResearchVNextResourceStats = {
  bytes: number;
  nodes: number;
  max_depth: number;
};

export class ResearchVNextResourceError extends Error {
  readonly code: "RESOURCE_LIMIT" | "INVALID_RESOURCE_SHAPE";
  readonly detail?: Record<string, unknown>;

  constructor(
    code: "RESOURCE_LIMIT" | "INVALID_RESOURCE_SHAPE",
    message: string,
    detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ResearchVNextResourceError";
    this.code = code;
    this.detail = detail;
  }
}

export const DEFAULT_RESEARCH_VNEXT_RESOURCE_POLICY: ResearchVNextResourcePolicy = Object.freeze({
  maxInputBytes: 2_000_000,
  maxArrayItems: 25_000,
  maxObjectKeys: 2_000,
  maxDepth: 32,
  maxNodes: 100_000,
});

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveResearchVNextResourcePolicy(
  overrides: Partial<ResearchVNextResourcePolicy> = {},
): ResearchVNextResourcePolicy {
  return {
    maxInputBytes: positiveInteger(overrides.maxInputBytes, DEFAULT_RESEARCH_VNEXT_RESOURCE_POLICY.maxInputBytes),
    maxArrayItems: positiveInteger(overrides.maxArrayItems, DEFAULT_RESEARCH_VNEXT_RESOURCE_POLICY.maxArrayItems),
    maxObjectKeys: positiveInteger(overrides.maxObjectKeys, DEFAULT_RESEARCH_VNEXT_RESOURCE_POLICY.maxObjectKeys),
    maxDepth: positiveInteger(overrides.maxDepth, DEFAULT_RESEARCH_VNEXT_RESOURCE_POLICY.maxDepth),
    maxNodes: positiveInteger(overrides.maxNodes, DEFAULT_RESEARCH_VNEXT_RESOURCE_POLICY.maxNodes),
  };
}

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function resourceLimit(
  message: string,
  field: keyof ResearchVNextResourcePolicy,
  observed: number,
  limit: number,
): never {
  throw new ResearchVNextResourceError("RESOURCE_LIMIT", message, {
    field,
    observed,
    limit,
  });
}

/**
 * Measure only JSON-like structural cost. This policy intentionally knows
 * nothing about market semantics, providers, strategies, or GPT reasoning.
 */
export function assertResearchVNextResourceBudget(
  value: unknown,
  overrides: Partial<ResearchVNextResourcePolicy> = {},
): ResearchVNextResourceStats {
  const policy = resolveResearchVNextResourcePolicy(overrides);
  const active = new WeakSet<object>();
  let bytes = 0;
  let nodes = 0;
  let maxDepthSeen = 0;

  function addBytes(amount: number): void {
    bytes += amount;
    if (bytes > policy.maxInputBytes) {
      resourceLimit("Research VNext input byte budget exceeded", "maxInputBytes", bytes, policy.maxInputBytes);
    }
  }

  function visit(current: unknown, depth: number): void {
    if (depth > policy.maxDepth) {
      resourceLimit("Research VNext input depth budget exceeded", "maxDepth", depth, policy.maxDepth);
    }
    maxDepthSeen = Math.max(maxDepthSeen, depth);
    nodes += 1;
    if (nodes > policy.maxNodes) {
      resourceLimit("Research VNext input node budget exceeded", "maxNodes", nodes, policy.maxNodes);
    }

    if (current === null) {
      addBytes(4);
      return;
    }

    switch (typeof current) {
      case "string":
        addBytes(encodedBytes(JSON.stringify(current)));
        return;
      case "number":
        addBytes(encodedBytes(Number.isFinite(current) ? String(current) : "null"));
        return;
      case "boolean":
        addBytes(current ? 4 : 5);
        return;
      case "undefined":
        addBytes(4);
        return;
      case "bigint":
      case "function":
      case "symbol":
        throw new ResearchVNextResourceError(
          "INVALID_RESOURCE_SHAPE",
          `Research VNext input contains non-serializable ${typeof current}`,
        );
      case "object":
        break;
      default:
        throw new ResearchVNextResourceError(
          "INVALID_RESOURCE_SHAPE",
          "Research VNext input contains unsupported value",
        );
    }

    const object = current as object;
    if (active.has(object)) {
      throw new ResearchVNextResourceError(
        "INVALID_RESOURCE_SHAPE",
        "Research VNext input contains a circular reference",
      );
    }
    active.add(object);

    try {
      if (Array.isArray(current)) {
        if (current.length > policy.maxArrayItems) {
          resourceLimit(
            "Research VNext array item budget exceeded",
            "maxArrayItems",
            current.length,
            policy.maxArrayItems,
          );
        }
        addBytes(2);
        for (let index = 0; index < current.length; index += 1) {
          if (index > 0) addBytes(1);
          visit(current[index], depth + 1);
        }
        return;
      }

      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new ResearchVNextResourceError(
          "INVALID_RESOURCE_SHAPE",
          "Research VNext input must contain only plain objects and arrays",
        );
      }

      const source = current as Record<string, unknown>;
      const keys = Object.keys(source).sort();
      if (keys.length > policy.maxObjectKeys) {
        resourceLimit(
          "Research VNext object key budget exceeded",
          "maxObjectKeys",
          keys.length,
          policy.maxObjectKeys,
        );
      }

      addBytes(2);
      for (let index = 0; index < keys.length; index += 1) {
        if (index > 0) addBytes(1);
        const key = keys[index];
        addBytes(encodedBytes(JSON.stringify(key)) + 1);
        visit(source[key], depth + 1);
      }
    } finally {
      active.delete(object);
    }
  }

  visit(value, 0);
  return { bytes, nodes, max_depth: maxDepthSeen };
}
