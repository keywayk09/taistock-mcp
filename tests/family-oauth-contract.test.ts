import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const oauth = read("src/v6/family-oauth.ts");
const wrangler = read("wrangler.jsonc");
const deploy = read(".github/workflows/deploy-cloudflare-production.yml");
const pkg = JSON.parse(read("package.json"));

assert.equal(pkg.dependencies["@cloudflare/workers-oauth-provider"], "^0.10.2");
assert.match(oauth, /new OAuthProvider<Env>/);
assert.match(oauth, /apiRoute: "\/family-mcp"/);
assert.match(oauth, /authorizeEndpoint: "\/authorize"/);
assert.match(oauth, /tokenEndpoint: "\/oauth\/token"/);
assert.match(oauth, /clientRegistrationEndpoint: "\/oauth\/register"/);
assert.match(oauth, /clientIdMetadataDocumentEnabled: true/);
assert.match(oauth, /allowPlainPKCE: false/);
assert.match(oauth, /allowImplicitFlow: false/);
assert.match(oauth, /scopesSupported: \[FAMILY_SCOPE\]/);
assert.match(oauth, /FAMILY_OAUTH_LOGIN_SECRET \|\| env\.MOM_GPT_API_KEY/);
assert.match(oauth, /constantTimeEqual/);
assert.match(oauth, /family-oauth:loginfail/);
assert.match(oauth, /LOGIN_FAIL_MAX = 5/);
assert.match(oauth, /completeAuthorization/);
assert.match(oauth, /env\.FAMILY_MCP_OBJECT\.idFromName\("family-mcp"\)/);
assert.match(oauth, /env\.FAMILY_MCP_OBJECT\.get\(familyId\)/);
assert.doesNotMatch(oauth, /FamilyMCP\.serve\(/);
assert.match(wrangler, /global_fetch_strictly_public/);
assert.match(wrangler, /"kv_namespaces"/);
assert.match(wrangler, /"binding"\s*:\s*"OAUTH_KV"/);
assert.match(wrangler, /"class_name"\s*:\s*"FamilyMCP"[\s\S]*?"name"\s*:\s*"FAMILY_MCP_OBJECT"/);
assert.match(deploy, /Resolve or create dedicated OAuth KV/);
assert.match(deploy, /taistock-mcp-OAUTH_KV/);
assert.match(deploy, /OAUTH_KV_RESOLUTION_FAILED/);
assert.match(deploy, /refusing Production deploy/);

console.log("Family OAuth 2.1 explicit-DO/KV deployment contract tests passed");
