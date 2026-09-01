export const RESEARCH_VNEXT_DO_DEPLOYMENT_POLICY = Object.freeze({
  schema: "RESEARCH_VNEXT_DO_DEPLOYMENT_POLICY_V1",
  versions_upload: "BLOCKED_WHILE_DURABLE_OBJECT_EXPORTS_PRESENT",
  gradual_deployment: "BLOCKED_WHILE_DURABLE_OBJECT_EXPORTS_PRESENT",
  lifecycle_deploy: "WRANGLER_DEPLOY_REQUIRED",
  remove_exports_automatically: false,
  protected_exports: Object.freeze(["MyMCP", "FamilyMCP"]),
  zero_traffic_candidate_validation: "BLOCKED_PENDING_COMPATIBLE_DEPLOYMENT_DESIGN",
  production_mutation: "NONE",
} as const);
