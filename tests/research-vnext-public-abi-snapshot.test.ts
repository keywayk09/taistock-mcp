import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { z } from "zod";

type CapturedTool = {
  name: string;
  config: Record<string, unknown>;
};

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

function canonicalize(value: unknown): CanonicalValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return String(value);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function isZodSchema(value: unknown): value is z.ZodType {
  return Boolean(value && typeof value === "object" && "safeParse" in value && typeof (value as { safeParse?: unknown }).safeParse === "function");
}

function toJsonSchema(raw: unknown): CanonicalValue | null {
  if (raw === undefined || raw === null) return null;
  const schema = isZodSchema(raw)
    ? raw
    : z.object(raw as Record<string, z.ZodType>);
  return canonicalize(z.toJSONSchema(schema));
}

const captured: CapturedTool[] = [];
const fakeServer = {
  registerTool(name: string, config: Record<string, unknown>) {
    captured.push({ name, config });
    return undefined;
  },
};

// The repository intentionally uses extensionless TypeScript imports in the
// existing Owner runtime. Node's strip-types runner does not resolve them as
// ESM. A test-local CJS loader lets the untouched internal TS graph resolve.
// External MCP runtime classes are stubbed only so Node does not bridge ESM
// package loaders; they do not contribute tool names or schemas to this probe.
const cjsRequire = createRequire(import.meta.url) as NodeJS.Require & {
  extensions: Record<string, (module: unknown, filename: string) => void>;
};
const nodeModule = cjsRequire("node:module") as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const previousTsLoader = cjsRequire.extensions[".ts"];
const originalLoad = nodeModule._load;

class StubMcpAgent {}
class StubMcpServer {
  registerTool() {
    return undefined;
  }
}

cjsRequire.extensions[".ts"] = (module: unknown, filename: string) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.Node10,
    },
    fileName: filename,
    reportDiagnostics: false,
  }).outputText;
  (module as { _compile(code: string, filename: string): void })._compile(output, filename);
};

nodeModule._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "@modelcontextprotocol/sdk/server/mcp.js") {
    return { McpServer: StubMcpServer };
  }
  if (request === "agents/mcp") {
    return { McpAgent: StubMcpAgent };
  }
  return originalLoad.call(this, request, parent, isMain);
};

try {
  const { MyMCP: OwnerMCP } = cjsRequire("../src/v6/owner-content-handler.ts") as {
    MyMCP: { prototype: { init: () => Promise<void> } };
  };

  // Exercise the real Owner init/registration graph without starting a Worker
  // or invoking any registered handler. Keep the TS loader active because the
  // Owner graph contains a lazy Family registration import during init().
  await OwnerMCP.prototype.init.call({
    server: fakeServer,
    env: {} as Env,
  } as any);
} finally {
  nodeModule._load = originalLoad;
  if (previousTsLoader) cjsRequire.extensions[".ts"] = previousTsLoader;
  else delete cjsRequire.extensions[".ts"];
}

assert.ok(captured.length > 0, "Owner init must register at least one MCP tool");
const names = captured.map((tool) => tool.name);
assert.equal(new Set(names).size, names.length, "Owner public tool names must be unique after frozen-name suppression");

const ownerSource = read("src/v6/owner-content-handler.ts");
const identityMatch = ownerSource.match(/server\s*=\s*new\s+McpServer\(\{\s*name:\s*"([^"]+)",\s*version:\s*"([^"]+)"\s*\}\)/);
assert.ok(identityMatch, "Owner MCP server identity must remain explicit and machine-readable");

const tools = captured
  .map(({ name, config }) => {
    const inputSchema = toJsonSchema(config.inputSchema ?? {});
    const outputSchema = config.outputSchema === undefined ? null : toJsonSchema(config.outputSchema);
    const visibleMetadata = {
      title: config.title ?? null,
      description: config.description ?? null,
      input_schema: inputSchema,
      output_schema: outputSchema,
      annotations: canonicalize(config.annotations ?? null),
      _meta: canonicalize(config._meta ?? null),
    };
    return {
      name,
      description_sha256: sha256(config.description ?? null),
      input_schema_sha256: sha256(inputSchema),
      output_schema_sha256: sha256(outputSchema),
      metadata_sha256: sha256(visibleMetadata),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const publicIngressSource = read("tests/public-ingress-freeze.test.ts");
for (const required of ["/my-mcp", "/mcp", "/family-mcp", "owner:full", "family:read"]) {
  assert.ok(publicIngressSource.includes(required), `public ingress/OAuth freeze must retain ${required}`);
}

const isolationWorkflow = read(".github/workflows/research-vnext-isolation-gate.yml");
const isolationDomains = ["VNEXT", "FAMILY", "MARKET_DATA", "FORMAL_BLIND", "OWNER_OPS", "BUNDLE"] as const;
for (const domain of isolationDomains) {
  assert.ok(isolationWorkflow.includes(domain), `isolation gate must retain ${domain}`);
}

const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
const scripts = packageJson.scripts ?? {};
assert.match(scripts["test:ops-contracts"] ?? "", /public-ingress-freeze\.test\.ts/);
assert.match(scripts["test:ops-contracts"] ?? "", /owner-live-tool-exposure\.test\.ts/);
assert.match(scripts["test:ops-contracts"] ?? "", /owner-oauth-/);
assert.ok(scripts["test:family-selection"], "Family regression script must remain present");
assert.ok(scripts["test:market-data"], "Market Data regression script must remain present");
assert.match(scripts["test:research"] ?? "", /test:formal-blind-ohlc/);
assert.match(scripts["test:research"] ?? "", /test:ops-contracts/);

const actual = canonicalize({
  schema: "RESEARCH_VNEXT_PUBLIC_ABI_SNAPSHOT_V1",
  owner_identity: {
    name: identityMatch[1],
    version: identityMatch[2],
  },
  owner_tool_count: tools.length,
  owner_tool_names: tools.map((tool) => tool.name),
  owner_tools: tools,
  owner_abi_sha256: sha256(tools),
  public_ingress: {
    owner: ["/my-mcp", "/mcp"],
    family: ["/family-mcp"],
    owner_scope: "owner:full",
    family_scope: "family:read",
  },
  regression_guards: {
    isolation_domains: [...isolationDomains],
    family: "test:family-selection",
    market_data: "test:market-data",
    formal_blind: "test:formal-blind-ohlc",
    owner_ops: "test:ops-contracts",
    bundle: "wrangler deploy --dry-run",
  },
});

// The valid RED run must reach this line and print the exact semantic snapshot
// before failing solely because the fixture does not yet exist.
console.log(`ACTUAL_PUBLIC_ABI_SNAPSHOT=${JSON.stringify(actual)}`);

const fixturePath = path.join(root, "tests/fixtures/research-vnext-public-abi-snapshot.json");
const expected = canonicalize(JSON.parse(fs.readFileSync(fixturePath, "utf8")));
assert.deepEqual(actual, expected, "public MCP ABI drifted from the frozen pre-cutover snapshot");

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_PUBLIC_ABI_SNAPSHOT_TEST_V1",
  status: "PASS",
  owner_tool_count: tools.length,
  owner_abi_sha256: (actual as Record<string, unknown>).owner_abi_sha256,
  production_registration: "LEGACY_UNCHANGED",
}, null, 2));
