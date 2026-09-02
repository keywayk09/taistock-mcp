import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const targetEntry = String(process.env.TARGET_ENTRY || "src/v6/owner-content-handler.ts");
const expectedCount = Number(process.env.EXPECTED_COUNT || "0");
const captured: string[] = [];

const fakeServer = {
  registerTool(name: string) {
    captured.push(name);
    return undefined;
  },
};

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
  if (request === "@modelcontextprotocol/sdk/server/mcp.js") return { McpServer: StubMcpServer };
  if (request === "agents/mcp") return { McpAgent: StubMcpAgent };
  if (request.startsWith("cloudflare:")) return {};
  return originalLoad.call(this, request, parent, isMain);
};

try {
  const { MyMCP: OwnerMCP } = cjsRequire(path.join(root, targetEntry)) as {
    MyMCP: { prototype: { init: () => Promise<void> } };
  };
  await OwnerMCP.prototype.init.call({ server: fakeServer, env: {} as Env } as any);
} finally {
  nodeModule._load = originalLoad;
  if (previousTsLoader) cjsRequire.extensions[".ts"] = previousTsLoader;
  else delete cjsRequire.extensions[".ts"];
}

assert.equal(new Set(captured).size, captured.length, "captured tool names must be unique");
const names = [...captured].sort((a, b) => a.localeCompare(b));
console.log(`DIAMOND_FIXED_ABI_ORACLE=${JSON.stringify({ targetEntry, count: names.length, names })}`);
if (expectedCount > 0) assert.equal(names.length, expectedCount, `expected ${expectedCount} tools, got ${names.length}`);
