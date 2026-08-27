import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFamilyOAuthPublicClientCompatWrapper } from "../src/v6/family-oauth-public-client-compat.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const indexV6 = read("src/index-v6.ts");
const familyOAuth = read("src/v6/family-oauth.ts");
const ORIGIN = "https://taistock-mcp.keywayk09.workers.dev";
const ctx = {} as ExecutionContext;
const env = {} as Env;

// PUBLIC_INGRESS_CONTRACT_V1
// External MCP endpoints are ABI. Runtime/tool implementations may change, but
// these public paths and their identities may not drift.
assert.match(indexV6, /url\.pathname === "\/my-mcp"/);
assert.match(indexV6, /endpoint: "\/family-mcp"/);
assert.match(familyOAuth, /FamilyMCP\.serve\("\/family-mcp"/);

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

// Owner/root identities can never be claimed by Family discovery. This is the
// regression that failed before the stable adapter was introduced.
for (const pathname of [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/my-mcp",
  "/.well-known/oauth-protected-resource/mcp",
]) {
  const response = await wrapper.fetch(new Request(`${ORIGIN}${pathname}`), env, ctx);
  assert.equal(response.status, 404, `${pathname} must not resolve as Family metadata`);
}

// The runtime content behind /my-mcp and /family-mcp is intentionally not named
// in this contract. That is the adapter rule: implementation versions/classes
// may change while the public ingress remains stable.
assert.doesNotMatch(indexV6, /mcp_endpoint:\s*"\/v\d+/);
assert.doesNotMatch(indexV6, /endpoint:\s*"\/family-v\d+/);

console.log("Public ingress freeze contract passed");
