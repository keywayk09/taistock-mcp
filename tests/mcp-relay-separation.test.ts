import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(path, "utf8");

const entry = read("src/index-v6.ts");
const broker = read("src/v6/mcp-access-broker.ts");
const familyOAuth = read("src/v6/family-oauth.ts");
const ownerOAuth = read("src/v6/owner-oauth.ts");
const familyContent = read("src/v6/family-mcp.ts");
const ownerLiveTools = read("src/v6/shared-stock-market-context-tools.ts");

// MCP_RELAY_SEPARATION_V3
// Freeze the known-good Production boundary after Owner OAuth + real MCP E2E PASS:
// public ABI -> access broker/relay -> Owner/Family content runtime.
// Future OAuth/ChatGPT compatibility changes must not require edits to the
// Diamond or Family content implementations.

// Layer A: OAuth must not directly own or instantiate content runtimes.
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

// Layer B: the composition root may wire one broker, but must not know every
// OAuth compatibility shim individually.
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

// Layer C: Owner content must now be a first-class injected handler, exactly
// like Family content. The public entrypoint must not own the Diamond runtime.
assert.doesNotMatch(
  entry,
  /class\s+MyMCP\s+extends|MyMCP\.serve\(/,
  "index-v6.ts still directly owns/serves the Owner content runtime",
);
assert.match(
  entry,
  /ownerContentHandler/,
  "index-v6.ts must inject an Owner content handler into the relay",
);
assert.match(
  broker,
  /ownerContentHandler/,
  "MCP access broker must accept the Owner content handler explicitly",
);
assert.match(
  familyOAuth,
  /ownerContentHandler\.fetch\(/,
  "Owner OAuth authorization must delegate to the Owner content handler, not the public app handler",
);

// Layer D: content implementations must never depend on OAuth/ChatGPT details.
for (const [name, source] of [
  ["Family content", familyContent],
  ["Owner live tools", ownerLiveTools],
] as const) {
  assert.doesNotMatch(
    source,
    /workers-oauth-provider|OAuthProvider|redirect_uri|code_challenge|token_endpoint_auth_method/,
    `${name} leaked OAuth protocol concerns`,
  );
}

// Frozen public ABI. These are external contracts and must not drift.
assert.match(entry, /url\.pathname === "\/my-mcp"|canonical.*\/my-mcp|mcp_endpoint:\s*"\/my-mcp"/);
assert.match(entry, /legacy_mcp_endpoint:\s*"\/mcp"|\/mcp/);
assert.match(entry, /endpoint:\s*"\/family-mcp"/);

// Owner/Family authority names are also frozen across the extraction.
assert.match(ownerOAuth, /OWNER_SCOPE = "owner:full"/);
assert.match(familyOAuth, /FAMILY_SCOPE = "family:read"/);

console.log("MCP relay separation + Owner/Family content boundary contract passed");
