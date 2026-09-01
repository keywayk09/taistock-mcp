export const RESEARCH_VNEXT_ISOLATION_MANIFEST = Object.freeze({
  schema: "RESEARCH_VNEXT_ISOLATION_MANIFEST_V1" as const,
  version: "research-vnext-isolation/v1.0.0" as const,
  runtime_mode: "SHADOW_UNREGISTERED" as const,
  production_registration: "DISABLED" as const,
  owner_abi: "UNCHANGED" as const,
  reasoning_owner: "GPT" as const,
  direct_provider_access: "FORBIDDEN" as const,
  ohlc_write: "FORBIDDEN" as const,
  automatic_strategy_promotion: "FORBIDDEN" as const,
  allowed_shared_dependencies: [
    "src/v6/deterministic-backtester.ts",
    "src/v6/github-data-store.ts",
  ] as const,
  regression_domains: [
    "VNEXT",
    "FAMILY",
    "MARKET_DATA",
    "FORMAL_BLIND",
    "OWNER_OPS",
    "BUNDLE",
  ] as const,
});
