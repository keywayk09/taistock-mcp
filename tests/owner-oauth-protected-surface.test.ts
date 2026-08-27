import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const oauth = fs.readFileSync(path.join(root, "src/v6/family-oauth.ts"), "utf8");
const indexV6 = fs.readFileSync(path.join(root, "src/index-v6.ts"), "utf8");

// OWNER_PROTECTED_SURFACE_V1
// One OAuthProvider must protect all three MCP API ingress routes. The provider
// package supports multi-handler `apiHandlers`; leaving Owner routes only in the
// default app handler means bearer validation can be bypassed entirely.
assert.match(oauth, /apiHandlers\s*:\s*\{/);
assert.doesNotMatch(oauth, /apiRoute\s*:\s*["']\/family-mcp["']/);
assert.match(oauth, /["']\/family-mcp["']\s*:\s*familyApiHandler/);
assert.match(oauth, /["']\/my-mcp["']\s*:\s*ownerApiHandler/);
assert.match(oauth, /["']\/mcp["']\s*:\s*ownerApiHandler/);

// OAuthProvider validates bearer token + audience. Application handlers must
// still enforce role/tenancy. This blocks legacy/unbound Family tokens from ever
// reaching the Owner MCP even if a token lacks an audience from an old grant.
assert.match(oauth, /ownerApiHandler/);
assert.match(oauth, /role\s*!==\s*["']owner["']/);
assert.match(oauth, /userId\s*!==\s*["']owner["']/);
assert.match(oauth, /familyApiHandler/);
assert.match(oauth, /role\s*!==\s*["']family["']/);
assert.match(oauth, /userId\s*!==\s*["']family["']/);

// The public endpoint ABI stays frozen. Runtime protection must happen in the
// OAuth adapter rather than moving or renaming the MCP endpoints.
assert.match(indexV6, /url\.pathname === ["']\/my-mcp["']/);
assert.match(indexV6, /url\.pathname === ["']\/mcp["']/);
assert.doesNotMatch(indexV6, /\/owner-mcp-v\d+/);

// Shared authorization server, separate grants/resources.
assert.match(oauth, /scopesSupported\s*:\s*\[FAMILY_SCOPE, OWNER_SCOPE\]/);
assert.match(oauth, /isOwnerAuthorizeRequest/);
assert.match(oauth, /handleOwnerAuthorize/);

console.log("Owner OAuth protected MCP surface contract passed");
