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

assert.equal(pkg.dependencies["@cloudflare/workers-oauth-provider"], "0.10.3");
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
assert.match(oauth, /FamilyMCP\.serve\("\/family-mcp", \{ binding: "FAMILY_MCP_OBJECT" \}\)/);
assert.match(oauth, /refusing to fall back to the full MCP_OBJECT namespace/);
assert.doesNotMatch(oauth, /binding: "MCP_OBJECT"/);

// Stale ChatGPT Plugin/MCP and Custom GPT Action recovery must stay narrow.
assert.match(oauth, /CHATGPT_CONNECTOR_CALLBACK_PATH/);
assert.match(oauth, /CHATGPT_LEGACY_CONNECTOR_CALLBACK_PATH/);
assert.match(oauth, /CHATGPT_ACTION_CALLBACK_PATH/);
assert.match(oauth, /TRUSTED_CHATGPT_HOSTS = new Set\(\["chatgpt\.com", "chat\.openai\.com"\]\)/);
assert.match(oauth, /OAUTH_SCOPE_TOKEN/);
assert.match(oauth, /MAX_RECOVERY_SCOPE_TOKENS = 24/);
assert.match(oauth, /MAX_RECOVERY_SCOPE_LENGTH = 2_048/);
assert.match(oauth, /ACTION_RECOVERY_COMPAT_SCOPES = new Set\(\[FAMILY_SCOPE, "offline_access"\]\)/);
assert.match(oauth, /function validConnectorRequestedScopes/);
assert.match(oauth, /TRUSTED_CHATGPT_HOSTS\.has\(redirect\.hostname\)/);
assert.match(oauth, /kind === "connector"/);
assert.match(oauth, /kind === "gpt_action"/);
assert.match(oauth, /code_challenge_method/);
assert.match(oauth, /method !== "S256"/);
assert.match(oauth, /PKCE_S256_CHALLENGE/);
assert.match(oauth, /validConnectorRequestedScopes\(rawScope, scopes\)/);
assert.match(oauth, /scopes\.some\(\(scope\) => !ACTION_RECOVERY_COMPAT_SCOPES\.has\(scope\)\)/);
assert.match(oauth, /new URL\(resourceRaw\)\.origin !== url\.origin/);
assert.match(oauth, /missingRecoverableChatGptClient/);
assert.match(oauth, /registerRecoveredChatGptClient/);
assert.match(oauth, /recoveredClientKey/);
assert.match(oauth, /`client:\$\{clientId\}`/);
assert.match(oauth, /pendingActionKey/);
assert.match(oauth, /family-oauth:action-bootstrap/);
assert.match(oauth, /ACTION_SECRET_BOOTSTRAP_TTL_SECONDS = 10 \* 60/);
assert.match(oauth, /tokenEndpointAuthMethod: candidate\.kind === "gpt_action" \? "client_secret_post" : "none"/);
assert.match(oauth, /authMethodExplicit: true/);
assert.match(oauth, /grantTypes: \["authorization_code", "refresh_token"\]/);
assert.match(oauth, /ChatGPT Family Plugin \/ MCP App/);
assert.match(oauth, /ChatGPT Family Action/);
assert.match(oauth, /Storage format is pinned to @cloudflare\/workers-oauth-provider 0\.10\.3/);
assert.doesNotMatch(oauth, /OAUTH_PROVIDER\.createClient/);

// Connector request scopes are compatibility metadata only. Even if ChatGPT
// asks for OIDC, offline, MCP or other syntactically-valid scopes,
// reconstructed authorization and issued permissions remain only Family read.
assert.match(oauth, /scope: \[FAMILY_SCOPE\]/);
assert.match(oauth, /const grantedScopes = oauthRequest\.scope\.filter\(\(scope\) => scope === FAMILY_SCOPE\)/);
assert.doesNotMatch(oauth, /scope: \[FAMILY_SCOPE, "offline_access"\]/);
assert.match(oauth, /These names are deliberately/);
assert.match(oauth, /completeAuthorization\(\{/);

// Invalid-client diagnostics are intentionally categorical only: no raw
// client_id, redirect URI, state or resource value is echoed back.
assert.match(oauth, /function safeAuthDiagnostic/);
assert.match(oauth, /FAM-OAUTH-DIAG/);
assert.match(oauth, /redirect=\$\{redirectMode\}@\$\{redirectHost\}/);
assert.match(oauth, /scope=\$\{scopeMode\}/);
assert.match(oauth, /resource=\$\{resource\}/);
assert.match(oauth, /authorizationErrorResponse\(error, request\)/);

// Custom GPT Actions are confidential OAuth clients. The original registry can
// be lost while ChatGPT still retains the client_id/client_secret. Recovery must
// learn the secret only during the exact one-time authorization-code exchange,
// then store only the SHA-256 hash expected by workers-oauth-provider.
assert.match(oauth, /prepareActionSecretBootstrap/);
assert.match(oauth, /decodeBasicClientAuth/);
assert.match(oauth, /client_secret_basic/);
assert.match(oauth, /client_secret_post/);
assert.match(oauth, /sha256Hex/);
assert.match(oauth, /crypto\.subtle\.digest\("SHA-256"/);
assert.match(oauth, /constantTimeEqual\(code, pending\.authorizationCode\)/);
assert.match(oauth, /equivalentActionRedirect/);
assert.match(oauth, /stored\.clientSecret = await sha256Hex\(presented\.clientSecret\)/);
assert.match(oauth, /delete stored\.recoveryKind/);
assert.match(oauth, /rollbackPreparedTokenBootstrap/);
assert.match(oauth, /if \(response\.ok\)/);
assert.match(oauth, /env\.OAUTH_KV\.delete\(prepared\.pendingKey\)/);

// An unauthenticated stale-client GET may render the Family login form, but it
// must not write client metadata. Registration only happens after the Family
// secret has passed constant-time validation on POST.
const getRecovery = oauth.indexOf("Do not mutate OAuth client state on an unauthenticated GET");
const secretValidation = oauth.indexOf("validateLoginSecret(", oauth.indexOf('if (request.method === "POST")'));
const registerRecovery = oauth.indexOf("registerRecoveredChatGptClient(recovery, env)");
assert.ok(getRecovery >= 0);
assert.ok(secretValidation >= 0);
assert.ok(registerRecovery > secretValidation);
assert.match(oauth, /if \(!constantTimeEqual\(supplied, loginSecret\(env\)\)\)/);
assert.match(oauth, /OAUTH_KV\.put\(key, JSON\.stringify\(stored\)\)/);
assert.match(oauth, /OAUTH_KV\.delete\(recoveredClientKey\(recovery\.clientId\)\)/);

assert.match(wrangler, /global_fetch_strictly_public/);
assert.match(wrangler, /"kv_namespaces"/);
assert.match(wrangler, /"binding"\s*:\s*"OAUTH_KV"/);
assert.match(wrangler, /"class_name"\s*:\s*"FamilyMCP"[\s\S]*?"name"\s*:\s*"FAMILY_MCP_OBJECT"/);
assert.match(deploy, /Resolve or create dedicated OAuth KV/);
assert.match(deploy, /taistock-mcp-OAUTH_KV/);
assert.match(deploy, /OAUTH_KV_RESOLUTION_FAILED/);
assert.match(deploy, /refusing Production deploy/);

console.log("Family OAuth Plugin/MCP DCR + Custom GPT Action recovery contract tests passed");
