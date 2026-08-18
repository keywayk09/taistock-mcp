import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

const familyRead = read("src/v10/family-read-api-v1.ts");
const wrapper = read("src/market-data-production-entry.ts");
const oauthEntry = read("src/oauth-entry.ts");

assert.match(familyRead, /family-read-api\/v1\.0\.0/);
assert.match(familyRead, /resolveFamilyReadIdentity/);
assert.match(familyRead, /constantTimeEqual/);
assert.match(familyRead, /classifyFamilyReadIntent/);
assert.match(familyRead, /runFamilyStockSelection/);
assert.match(familyRead, /runFamilyQuery/);
assert.match(familyRead, /\/api\/family\/read/);
assert.match(familyRead, /canonical_market_data/);
assert.match(familyRead, /data\/market\/tw\/daily/);
assert.match(familyRead, /institutional\.json/);
assert.match(familyRead, /margin\.json/);
assert.match(familyRead, /events\.json/);
assert.match(familyRead, /manifest\.json/);
assert.match(familyRead, /PENDING_GITHUB_TOKEN/);
assert.match(familyRead, /prohibited_actions/);
assert.match(familyRead, /market-data ingestion/);
assert.match(familyRead, /research write/);
assert.match(familyRead, /strategy promotion/);
assert.match(familyRead, /order placement/);
assert.doesNotMatch(familyRead, /method:\s*["'](?:PUT|PATCH|DELETE)["']/i);
assert.doesNotMatch(familyRead, /github.*(?:write|put)/i);

// Shared Custom GPT lane uses a GPT-level read credential, not a per-person identity.
assert.match(wrapper, /TAISTOCK_GPT_READ_KEY/);
assert.match(wrapper, /sharedGptActionAuthorized/);
assert.match(wrapper, /taistock-gpt-read/);
assert.match(wrapper, /taistock_custom_gpt/);
assert.match(wrapper, /sharedGptReadEnv/);
assert.match(wrapper, /property === "SISTER_GPT_API_KEY"/);
assert.match(wrapper, /return sharedKey/);
assert.match(wrapper, /媽媽|Mother stays on \/family-mcp/);
assert.doesNotMatch(wrapper, /MOM_GPT_API_KEY/);
assert.match(wrapper, /familyReadOpenApiSchema/);
assert.match(wrapper, /handleFamilyReadApi/);
assert.match(wrapper, /\/family-openapi\.json/);
assert.match(wrapper, /url\.pathname === "\/api\/family\/read"/);
assert.match(wrapper, /if \(!sharedGptActionAuthorized/);
assert.match(wrapper, /normalizeSharedGptResponse/);
assert.match(wrapper, /identity = "shared_gpt"/);
assert.match(wrapper, /return productionEntry\.fetch/);
const gateIndex = wrapper.indexOf('if (url.pathname === "/api/family/read")');
const readIndex = wrapper.indexOf("const familyRead = await handleFamilyReadApi");
assert.ok(gateIndex >= 0 && readIndex > gateIndex, "shared GPT auth gate must run before Family Read handler");

// Mother remains on OAuth family role with read-only scope.
assert.match(oauthEntry, /"\/family-mcp": FamilyMCP\.serve/);
assert.match(oauthEntry, /type OAuthRole = "owner" \| "family"/);
assert.match(oauthEntry, /role === "owner"\s*\? \["taistock\.read", "taistock\.admin"\]\s*:\s*\["taistock\.read"\]/);
assert.match(oauthEntry, /userId: role === "owner" \? "taistock-owner" : "taistock-family"/);

console.log("Family access model passed: shared 台股引擎 Action + mother OAuth Family MCP");
