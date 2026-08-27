import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const oauth = fs.readFileSync(path.join(root, "src/v6/family-oauth.ts"), "utf8");
const ownerOAuth = fs.readFileSync(path.join(root, "src/v6/owner-oauth.ts"), "utf8");
const indexV6 = fs.readFileSync(path.join(root, "src/index-v6.ts"), "utf8");
const broker = fs.readFileSync(path.join(root, "src/v6/mcp-access-broker.ts"), "utf8");
const ownerContent = fs.readFileSync(path.join(root, "src/v6/owner-content-handler.ts"), "utf8");

// OWNER_PROTECTED_SURFACE_V2
// One OAuthProvider must protect all three MCP API ingress routes. The provider
// package supports multi-handler `apiHandlers`; leaving Owner routes only in the
// default public app handler would allow bearer validation to be bypassed.
assert.match(oauth, /apiHandlers\s*:\s*\{/);
assert.doesNotMatch(oauth, /apiRoute\s*:\s*["']\/family-mcp["']/);
assert.match(oauth, /["']\/family-mcp["']\s*:\s*familyApiHandler/);
assert.match(oauth, /["']\/my-mcp["']\s*:\s*ownerApiHandler/);
assert.match(oauth, /["']\/mcp["']\s*:\s*ownerApiHandler/);

// OAuthProvider validates bearer token + audience. Application handlers must
// still enforce role/tenancy and effective scope before the broker can delegate
// to Owner or Family content.
assert.match(oauth, /ownerApiHandler/);
assert.match(oauth, /role\s*!==\s*["']owner["']/);
assert.match(oauth, /userId\s*!==\s*["']owner["']/);
assert.match(oauth, /familyApiHandler/);
assert.match(oauth, /role\s*!==\s*["']family["']/);
assert.match(oauth, /userId\s*!==\s*["']family["']/);
assert.match(oauth, /requireEffectiveScope\s*\(\s*request\s*,\s*env\s*,\s*OWNER_SCOPE\s*\)/);
assert.match(oauth, /requireEffectiveScope\s*\(\s*request\s*,\s*env\s*,\s*FAMILY_SCOPE\s*\)/);

// The public endpoint ABI stays frozen. Routing now belongs to the relay rather
// than index-v6.ts; the content adapter owns MyMCP only after OAuth authorization.
assert.match(indexV6, /mcp_endpoint:\s*["']\/my-mcp["']/);
assert.match(indexV6, /legacy_mcp_endpoint:\s*["']\/mcp["']/);
assert.match(broker, /pathname === ["']\/my-mcp["'] \|\| pathname === ["']\/mcp["']/);
assert.match(broker, /ownerContentHandler\.fetch\(request, env, ctx\)/);
assert.match(ownerContent, /MyMCP\.serve\(pathname\)\.fetch\(request, env, ctx\)/);
assert.doesNotMatch(indexV6, /\/owner-mcp-v\d+/);
assert.doesNotMatch(broker, /\/owner-mcp-v\d+/);

// Shared authorization server, separate grants/resources.
assert.match(oauth, /scopesSupported\s*:\s*\[FAMILY_SCOPE, OWNER_SCOPE\]/);
assert.match(oauth, /isOwnerAuthorizeRequest/);
assert.match(oauth, /handleOwnerAuthorize/);

// PATH_SCOPED_CHALLENGE_SCOPE_V1
assert.match(oauth, /scopesSupported\s*:\s*\[FAMILY_SCOPE, OWNER_SCOPE\]/);
assert.doesNotMatch(oauth, /scopes_supported\s*:\s*\[FAMILY_SCOPE, OWNER_SCOPE\]/);

// OWNER_EFFECTIVE_SCOPE_V1
assert.match(oauth, /OAUTH_PROVIDER\.unwrapToken\s*\(/);
assert.match(oauth, /effectiveToken[^;]*\.scope[\s\S]*includes\s*\(\s*requiredScope\s*\)/);

// OWNER_DCR_AUTH_COMPAT_V1
assert.match(ownerOAuth, /client_secret_basic/);
assert.match(ownerOAuth, /client_secret_post/);
assert.match(ownerOAuth, /Boolean\(stored\.clientSecret\)/);

console.log("Owner OAuth protected MCP surface + relay/content boundary contract passed");
