import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(path, "utf8");

const entry = read("src/index-v6.ts");
const familyOAuth = read("src/v6/family-oauth.ts");
const ownerOAuth = read("src/v6/owner-oauth.ts");
const familyContent = read("src/v6/family-mcp.ts");
const ownerLiveTools = read("src/v6/shared-stock-market-context-tools.ts");

// MCP_RELAY_SEPARATION_V1
// Goal: protocol/auth changes may change the interface + relay layers without
// forcing edits to the Diamond/Family content implementations.
//
// Layer rule A: OAuth must not directly own or instantiate content runtimes.
// Access control should accept/invoke injected handlers instead of importing
// FamilyMCP/MyMCP tool implementations directly.
assert.doesNotMatch(
  familyOAuth,
  /import\s+\{\s*FamilyMCP\s*\}\s+from\s+["']\.\/family-mcp["']/,
  "Family OAuth is still directly coupled to the Family content runtime",
);
assert.doesNotMatch(
  familyOAuth,
  /FamilyMCP\.serve\(/,
  "Family OAuth must not directly serve the Family content runtime",
);
assert.doesNotMatch(
  ownerOAuth,
  /MyMCP\.serve\(|register(?:Advanced|Research|Stable|Shared|TwMarketData)/,
  "Owner OAuth must remain protocol/auth only",
);

// Layer rule B: the composition root may wire the relay, but it must not know
// each OAuth compatibility shim individually. Those shims belong behind one
// relay/broker adapter so future OAuth changes stay out of the content entry.
for (const oauthShim of [
  "family-oauth-legacy-endpoints",
  "family-oauth-public-client-compat",
  "family-oauth-token-recovery",
] as const) {
  assert.doesNotMatch(
    entry,
    new RegExp(oauthShim),
    `index-v6.ts is still coupled to OAuth shim ${oauthShim}`,
  );
}

// Layer rule C: content implementations must never depend on OAuth/ChatGPT
// connector protocol details. These should already pass before the refactor and
// remain permanent regression fences afterwards.
for (const [name, source] of [
  ["Family content", familyContent],
  ["Owner live tools", ownerLiveTools],
] as const) {
  assert.doesNotMatch(source, /workers-oauth-provider|OAuthProvider|redirect_uri|code_challenge|token_endpoint_auth_method/,
    `${name} leaked OAuth protocol concerns`);
}

// Frozen public ABI remains unchanged during and after the relay extraction.
assert.match(entry, /url\.pathname === "\/my-mcp"/);
assert.match(entry, /url\.pathname === "\/mcp"/);
assert.match(entry, /endpoint:\s*"\/family-mcp"/);

console.log("MCP relay separation contract passed");
