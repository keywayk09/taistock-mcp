import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const oauth = read("src/v6/family-oauth.ts");
const wrangler = read("wrangler.jsonc");
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
assert.match(oauth, /FamilyMCP\.serve\("\/family-mcp"\)/);
assert.match(wrangler, /global_fetch_strictly_public/);

console.log("Family OAuth 2.1 contract tests passed");
