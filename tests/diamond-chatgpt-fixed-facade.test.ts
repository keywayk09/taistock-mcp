import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/diamond-chatgpt-fixed-facade-v20260802.json"), "utf8")) as {
  schema:string;
  source_commit:string;
  tool_count:number;
  tool_names:string[];
};

assert.equal(fixture.schema, "DIAMOND_CHATGPT_FIXED_FACADE_V1");
assert.equal(fixture.source_commit, "9e85592aa8e78a9afbbb246ee1fee2553c2d8187");
assert.equal(fixture.tool_count, 79);
assert.equal(fixture.tool_names.length, 79);
assert.equal(new Set(fixture.tool_names).size, 79);

const captured:string[] = [];
const capturedResources:{name:string;uri:string}[] = [];
const fakeServer = {
  registerTool(name:string){ captured.push(name); },
  registerResource(name:string, uri:string){ capturedResources.push({ name, uri }); },
};
const cjsRequire = createRequire(import.meta.url) as NodeJS.Require & { extensions:Record<string,(module:unknown,filename:string)=>void> };
const nodeModule = cjsRequire("node:module") as { _load:(request:string,parent:unknown,isMain:boolean)=>unknown };
const previousTsLoader = cjsRequire.extensions[".ts"];
const originalLoad = nodeModule._load;
class StubMcpAgent {}
class StubMcpServer { registerTool(){} registerResource(){} }

cjsRequire.extensions[".ts"] = (module:unknown, filename:string) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, esModuleInterop:true, moduleResolution:ts.ModuleResolutionKind.Node10 },
    fileName:filename,
    reportDiagnostics:false,
  }).outputText;
  (module as {_compile(code:string,filename:string):void})._compile(output, filename);
};
nodeModule._load = function(request:string,parent:unknown,isMain:boolean){
  if(request === "@modelcontextprotocol/sdk/server/mcp.js") return { McpServer:StubMcpServer };
  if(request === "agents/mcp") return { McpAgent:StubMcpAgent };
  if(request.startsWith("cloudflare:")) return {};
  return originalLoad.call(this, request, parent, isMain);
};

let compatNames:string[] = [];
let tryCompat:((request:Request,env:Env)=>Promise<Response|null>) | null = null;
try {
  const { MyMCP } = cjsRequire("../src/v6/owner-content-handler.ts") as { MyMCP:{prototype:{init:()=>Promise<void>}} };
  const compat = cjsRequire("../src/v6/diamond-fixed-facade-compat.ts") as {
    DIAMOND_FIXED_FACADE_COMPAT_TOOL_NAMES:readonly string[];
    tryHandleDiamondFixedFacadeCompatCall:(request:Request,env:Env)=>Promise<Response|null>;
  };
  compatNames = [...compat.DIAMOND_FIXED_FACADE_COMPAT_TOOL_NAMES];
  tryCompat = compat.tryHandleDiamondFixedFacadeCompatCall;
  await MyMCP.prototype.init.call({ server:fakeServer, env:{} as Env } as any);
} finally {
  nodeModule._load = originalLoad;
  if(previousTsLoader) cjsRequire.extensions[".ts"] = previousTsLoader;
  else delete cjsRequire.extensions[".ts"];
}

assert.equal(captured.length, 123, "modern Owner tools/list inventory must remain 123; compatibility aliases must not be registered");
assert.equal(new Set(captured).size, captured.length, "Owner runtime must never double-register a tool name");
assert.deepEqual(capturedResources, [{ name:"first_party_intelligence_registry", uri:"first-party-intelligence://registry" }], "static first-party metadata must be an MCP resource, not a 124th tool");
assert.equal(compatNames.length, 39, "frozen facade interceptor must contain exactly the 39 names absent from modern runtime");
assert.equal(new Set(compatNames).size, 39, "compatibility names must be unique");

const live = new Set(captured);
const missing = fixture.tool_names.filter((name) => !live.has(name));
assert.deepEqual([...missing].sort(), [...compatNames].sort(), "historical 79 facade gap must be covered exactly by the compatibility interceptor");
assert.ok(fixture.tool_names.every((name) => live.has(name) || compatNames.includes(name)), "every frozen ChatGPT tool must be callable through modern registration or compatibility interception");

assert.ok(tryCompat, "compatibility tools/call interceptor must be exported");
const legacyCall = new Request("https://taistock-mcp.example/my-mcp", {
  method:"POST",
  headers:{ "content-type":"application/json", "mcp-session-id":"compat-test-session" },
  body:JSON.stringify({ jsonrpc:"2.0", id:79, method:"tools/call", params:{ name:"add_industry_evidence", arguments:{ evidence_id:"legacy" } } }),
});
const legacyResponse = await tryCompat!(legacyCall, {} as Env);
assert.ok(legacyResponse, "missing frozen tool call must be intercepted before modern MCP runtime");
assert.equal(legacyResponse!.status, 200);
assert.equal(legacyResponse!.headers.get("mcp-session-id"), "compat-test-session");
const legacyRpc = await legacyResponse!.json() as any;
assert.equal(legacyRpc.jsonrpc, "2.0");
assert.equal(legacyRpc.id, 79);
assert.equal(legacyRpc.result?.content?.[0]?.type, "text");
const legacyPayload = JSON.parse(String(legacyRpc.result.content[0].text));
assert.equal(legacyPayload.status, "LEGACY_COMPATIBILITY_RETAINED_FAIL_CLOSED");
assert.equal(legacyPayload.legacy_tool, "add_industry_evidence");
assert.equal(legacyPayload.production_mutation, "NONE");

const modernCall = new Request("https://taistock-mcp.example/my-mcp", {
  method:"POST",
  headers:{ "content-type":"application/json" },
  body:JSON.stringify({ jsonrpc:"2.0", id:80, method:"tools/call", params:{ name:"get_quote", arguments:{ symbol:"2330" } } }),
});
assert.equal(await tryCompat!(modernCall, {} as Env), null, "modern registered tools must bypass legacy interceptor");

const compatPath = path.join(root, "src/v6/diamond-fixed-facade-compat.ts");
const compatSource = fs.readFileSync(compatPath, "utf8");
assert.doesNotMatch(compatSource, /\bD1Database\b|env\.DB\b|\.prepare\(/, "fixed facade compat must not restore D1 app persistence");
assert.doesNotMatch(compatSource, /\bR2Bucket\b/, "fixed facade compat must not introduce R2 app persistence");
assert.match(compatSource, /method !== "tools\/call"/, "compatibility adapter must intercept only tools/call");

console.log(JSON.stringify({
  schema:"DIAMOND_CHATGPT_FIXED_FACADE_TEST_V1",
  status:"PASS",
  frozen_tools:79,
  modern_owner_tools:123,
  static_resources:capturedResources.length,
  compatibility_intercepts:39,
  production_mutation:"NONE",
}, null, 2));
