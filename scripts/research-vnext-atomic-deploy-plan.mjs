import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const RESEARCH_VNEXT_ATOMIC_DEPLOY_PLAN_VERSION = "research-vnext-atomic-deploy-plan/v1.0.0";

function sha256(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

function fail(message) {
  throw new Error(`atomic_deploy_plan_invalid:${message}`);
}

function validateExistingKvId(oauthKvId) {
  const value = String(oauthKvId ?? "").trim();
  if (!/^[0-9a-fA-F]{32}$/.test(value)) {
    fail("oauth_kv_id_must_be_exactly_32_hex_characters");
  }
  return value.toLowerCase();
}

function assertSourceContract(sourceConfig) {
  if (typeof sourceConfig !== "string" || sourceConfig.length < 100) {
    fail("source_config_missing");
  }

  const worker = sourceConfig.match(/"name"\s*:\s*"([^"]+)"/)?.[1] ?? "";
  if (worker !== "taistock-mcp") fail(`unexpected_worker_name:${worker || "missing"}`);

  const oauthMatches = [...sourceConfig.matchAll(/\{\s*"binding"\s*:\s*"OAUTH_KV"[\s\S]*?\}/g)];
  if (oauthMatches.length !== 1) fail(`oauth_kv_binding_count:${oauthMatches.length}`);
  if (/"id"\s*:/.test(oauthMatches[0][0])) fail("source_oauth_kv_binding_already_has_id");

  const triggerMatches = [...sourceConfig.matchAll(/\n\t"triggers"\s*:\s*\{[\s\S]*?\n\t\},/g)];
  if (triggerMatches.length !== 1) fail(`trigger_block_count:${triggerMatches.length}`);
  if (!/"crons"\s*:\s*\["\*\/5 \* \* \* \*"\]/.test(triggerMatches[0][0])) {
    fail("unexpected_source_cron_contract");
  }

  if (/"migrations"\s*:/.test(sourceConfig)) fail("legacy_migrations_forbidden");

  const exportsBlock = sourceConfig.match(/\n\t"exports"\s*:\s*\{[\s\S]*?\n\t\},\n\t"durable_objects"/)?.[0] ?? "";
  if (!exportsBlock) fail("durable_object_exports_missing");

  for (const durableClass of ["MyMCP", "FamilyMCP"]) {
    const liveSqlitePattern = new RegExp(
      `"${durableClass}"\\s*:\\s*\\{\\s*"type"\\s*:\\s*"durable-object",\\s*"storage"\\s*:\\s*"sqlite"\\s*\\}`,
    );
    if (!liveSqlitePattern.test(exportsBlock)) {
      fail(`protected_export_contract:${durableClass}`);
    }
  }

  const bindingContracts = [
    ["MyMCP", "MCP_OBJECT"],
    ["FamilyMCP", "FAMILY_MCP_OBJECT"],
  ];
  for (const [className, bindingName] of bindingContracts) {
    const pattern = new RegExp(
      `"class_name"\\s*:\\s*"${className}"[\\s\\S]*?"name"\\s*:\\s*"${bindingName}"`,
    );
    if (!pattern.test(sourceConfig)) fail(`durable_object_binding_contract:${className}`);
  }

  return {
    worker,
    triggerBlock: triggerMatches[0][0],
    exportsBlock,
  };
}

export function buildAtomicDeployPlan({ sourceConfig, oauthKvId }) {
  const source = String(sourceConfig ?? "");
  const { worker, triggerBlock, exportsBlock } = assertSourceContract(source);
  const existingKvId = validateExistingKvId(oauthKvId);

  let configText = source.replace(
    /"binding"\s*:\s*"OAUTH_KV"/,
    `"binding": "OAUTH_KV",\n\t\t\t"id": "${existingKvId}"`,
  );
  if (configText === source) fail("oauth_kv_injection_failed");
  if ((configText.match(new RegExp(existingKvId, "g")) ?? []).length !== 1) {
    fail("oauth_kv_id_not_injected_exactly_once");
  }

  configText = configText.replace(triggerBlock, "");
  if (/"triggers"\s*:/.test(configText)) fail("trigger_block_removal_failed");
  if (/"crons"\s*:\s*\[\s*\]/.test(configText)) fail("empty_crons_forbidden");
  if (!configText.includes(exportsBlock)) fail("protected_exports_changed");
  if (/"migrations"\s*:/.test(configText)) fail("legacy_migrations_introduced");

  for (const [className, bindingName] of [
    ["MyMCP", "MCP_OBJECT"],
    ["FamilyMCP", "FAMILY_MCP_OBJECT"],
  ]) {
    const pattern = new RegExp(
      `"class_name"\\s*:\\s*"${className}"[\\s\\S]*?"name"\\s*:\\s*"${bindingName}"`,
    );
    if (!pattern.test(configText)) fail(`durable_object_binding_changed:${className}`);
  }

  const receipt = Object.freeze({
    schema: "RESEARCH_VNEXT_ATOMIC_DEPLOY_PLAN_RECEIPT_V1",
    version: RESEARCH_VNEXT_ATOMIC_DEPLOY_PLAN_VERSION,
    status: "READY_FOR_DRY_RUN_ONLY",
    worker_name: worker,
    oauth_kv_binding: "OAUTH_KV",
    oauth_kv_id_validated: true,
    cron_in_source: true,
    triggers_in_deploy_config: false,
    crons_empty_array_in_deploy_config: false,
    protected_exports: Object.freeze(["MyMCP", "FamilyMCP"]),
    exports_preserved: true,
    migrations_present: false,
    deployment_mode: "ATOMIC_IMMEDIATE_100_PERCENT",
    phase_authorization: "DRY_RUN_ONLY",
    production_deploy_authorized: false,
    trigger_mutation_intent: "NONE",
    resource_provisioning: "DISABLED",
    production_mutation: "NONE",
    source_sha256: sha256(source),
    deploy_config_sha256: sha256(configText),
  });

  return { configText, receipt };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) fail(`unexpected_argument:${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) fail(`missing_value:${key}`);
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

export function runAtomicDeployPlanCli({ argv = process.argv.slice(2), env = process.env } = {}) {
  const args = parseArgs(argv);
  const sourcePath = args.source;
  const configOut = args["config-out"];
  const receiptOut = args["receipt-out"];
  if (!sourcePath || !configOut || !receiptOut) {
    fail("required_args:--source,--config-out,--receipt-out");
  }

  const sourceConfig = fs.readFileSync(sourcePath, "utf8");
  const { configText, receipt } = buildAtomicDeployPlan({
    sourceConfig,
    oauthKvId: env.RESEARCH_VNEXT_OAUTH_KV_ID,
  });

  fs.mkdirSync(path.dirname(configOut), { recursive: true });
  fs.mkdirSync(path.dirname(receiptOut), { recursive: true });
  fs.writeFileSync(configOut, configText, "utf8");
  fs.writeFileSync(receiptOut, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  return receipt;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    runAtomicDeployPlanCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
