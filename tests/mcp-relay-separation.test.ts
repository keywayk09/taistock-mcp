import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(path, "utf8");

const entry = read("src/index-v6.ts");
const composition = read("src/v6/mcp-runtime-composition.ts");
const broker = read("src/v6/mcp-access-broker.ts");
const familyOAuth = read("src/v6/family-oauth.ts");
const ownerOAuth = read("src/v6/owner-oauth.ts");
const familyContent = read("src/v6/family-mcp.ts");
const ownerContent = read("src/v6/owner-content-handler.ts");
const ownerLiveTools = read("src/v6/shared-stock-market-context-tools.ts");

// MCP_RELAY_SEPARATION_V4
// Frozen architecture:
// public interface -> composition root -> access broker/relay -> Owner/Family content.
// Future OAuth/ChatGPT interface changes must not require the public entrypoint to
// know concrete Diamond/Family content implementations.

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

// Layer B: the public entrypoint is interface-only. It may call one composition
// root, but must not wire concrete content handlers or the broker itself.
for (const forbidden of [
  "family-oauth-legacy-endpoints",
  "family-oauth-public-client-compat",
  "family-oauth-token-recovery",
  "family-content-handler",
  "owner-content-handler",
  "mcp-access-broker",
] as const) {
  assert.doesNotMatch(
    entry,
    new RegExp(forbidden),
    `index-v6.ts is still coupled to MCP implementation ${forbidden}`,
  );
}
assert.doesNotMatch(entry, /familyContentHandler|ownerContentHandler|createMcpAccessBroker/);
assert.match(entry, /createComposedMcpRuntime\(publicAppHandler\)/);
assert.match(entry, /mcpRuntime\.fetch\(request, env, ctx\)/);

// Layer C: one explicit composition root is the only module that knows both the
// broker and concrete content handlers.
assert.match(composition, /createMcpAccessBroker/);
assert.match(composition, /familyContentHandler/);
assert.match(composition, /ownerContentHandler/);
assert.match(
  composition,
  /createMcpAccessBroker\([\s\S]*publicAppHandler[\s\S]*ownerContentHandler[\s\S]*familyContentHandler[\s\S]*\)/,
  "composition root must wire public -> broker -> Owner/Family content",
);
assert.doesNotMatch(
  composition,
  /redirect_uri|code_challenge|token_endpoint_auth_method|register(?:Advanced|Research|Stable|Shared|TwMarketData)/,
  "composition root must remain wiring-only",
);

// Layer D: Owner content is a first-class injected handler, exactly like Family
// content. The public entrypoint must not own or serve the Diamond runtime.
assert.doesNotMatch(
  entry,
  /class\s+MyMCP\s+extends|MyMCP\.serve\(/,
  "index-v6.ts still directly owns/serves the Owner content runtime",
);
assert.match(broker, /ownerContentHandler/);
assert.match(
  broker,
  /ownerContentHandler\.fetch\(request, env, ctx\)/,
  "MCP relay must hand authorized Owner requests to Owner content",
);
assert.match(ownerContent, /class\s+MyMCP\s+extends/);
assert.match(ownerContent, /MyMCP\.serve\(pathname\)/);

// Layer E: content implementations must never depend on OAuth/ChatGPT details.
for (const [name, source] of [
  ["Family content", familyContent],
  ["Owner content", ownerContent],
  ["Owner live tools", ownerLiveTools],
] as const) {
  assert.doesNotMatch(
    source,
    /workers-oauth-provider|OAuthProvider|redirect_uri|code_challenge|token_endpoint_auth_method/,
    `${name} leaked OAuth protocol concerns`,
  );
}

// Frozen public ABI. These are external contracts and must not drift.
assert.match(entry, /mcp_endpoint:\s*"\/my-mcp"/);
assert.match(entry, /legacy_mcp_endpoint:\s*"\/mcp"/);
assert.match(entry, /endpoint:\s*"\/family-mcp"/);
assert.match(broker, /pathname === "\/my-mcp" \|\| pathname === "\/mcp"/);

// Owner/Family authority names are also frozen across the extraction.
assert.match(ownerOAuth, /OWNER_SCOPE = "owner:full"/);
assert.match(familyOAuth, /FAMILY_SCOPE = "family:read"/);

console.log("MCP interface/composition/relay/content separation contract passed");
