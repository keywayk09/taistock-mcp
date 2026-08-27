import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFamilyOAuthPublicClientCompatWrapper } from "../src/v6/family-oauth-public-client-compat.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const indexV6 = read("src/index-v6.ts");
const familyContent = read("src/v6/family-content-handler.ts");
const ORIGIN = "https://taistock-mcp.keywayk09.workers.dev";
const ctx = {} as ExecutionContext;
const env = {} as Env;

// PUBLIC_INGRESS_CONTRACT_V1
// External MCP endpoints are ABI. Runtime/tool implementations may change, but
// these public paths and their role identities may not drift.
assert.match(indexV6, /url\.pathname === "\/my-mcp"/);
assert.match(indexV6, /endpoint: "\/family-mcp"/);
assert.match(familyContent, /FamilyMCP\.serve\("\/family-mcp"/);

const wrapper = createFamilyOAuthPublicClientCompatWrapper({
  async fetch() {
    return new Response("inner", { status: 418 });
  },
});

// Family metadata is path-scoped to the frozen /family-mcp public ABI.
{
  const response = await wrapper.fetch(
    new Request(`${ORIGIN}/.well-known/oauth-protected-resource/family-mcp`),
    env,
    ctx,
  );
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.resource, `${ORIGIN}/family-mcp`);
  assert.deepEqual(body.scopes_supported, ["family:read"]);
}

// Owner metadata is independently path-scoped. Family changes may never claim
// /my-mcp or the retained /mcp alias.
for (const [metadataPath, resourcePath] of [
  ["/.well-known/oauth-protected-resource/my-mcp", "/my-mcp"],
  ["/.well-known/oauth-protected-resource/mcp", "/mcp"],
] as const) {
  const response = await wrapper.fetch(new Request(`${ORIGIN}${metadataPath}`), env, ctx);
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.resource, `${ORIGIN}${resourcePath}`);
  assert.deepEqual(body.scopes_supported, ["owner:full"]);
  assert.notEqual(body.resource, `${ORIGIN}/family-mcp`);
}

// Worker-root has no implicit role. Owner is explicit; omitted-resource legacy
// compatibility belongs only to the Family authorization flow.
{
  const response = await wrapper.fetch(
    new Request(`${ORIGIN}/.well-known/oauth-protected-resource`),
    env,
    ctx,
  );
  assert.equal(response.status, 404);
}

// Runtime content behind /my-mcp and /family-mcp is intentionally not named in
// this contract. That is the adapter rule: implementations may change while
// public ingress remains stable.
assert.doesNotMatch(indexV6, /mcp_endpoint:\s*"\/v\d+/);
assert.doesNotMatch(indexV6, /endpoint:\s*"\/family-v\d+/);

console.log("Public ingress freeze contract passed");
