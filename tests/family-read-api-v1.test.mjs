import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

const familyRead = read("src/v10/family-read-api-v1.ts");
const wrapper = read("src/market-data-production-entry.ts");

assert.match(familyRead, /family-read-api\/v1\.0\.0/);
assert.match(familyRead, /MOM_GPT_API_KEY/);
assert.match(familyRead, /SISTER_GPT_API_KEY/);
assert.match(familyRead, /MCP_API_KEY/);
assert.match(familyRead, /resolveFamilyReadIdentity/);
assert.match(familyRead, /constantTimeEqual/);
assert.match(familyRead, /classifyFamilyReadIntent/);
assert.match(familyRead, /runFamilyStockSelection/);
assert.match(familyRead, /runFamilyQuery/);
assert.match(familyRead, /\/api\/family\/read/);
assert.match(familyRead, /Taiwan Stock AI Family Read API V1/);
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

assert.match(wrapper, /familyReadOpenApiSchema/);
assert.match(wrapper, /handleFamilyReadApi/);
assert.match(wrapper, /\/family-openapi\.json/);
assert.match(wrapper, /const familyRead = await handleFamilyReadApi/);
assert.match(wrapper, /if \(familyRead\) return familyRead/);
assert.match(wrapper, /return productionEntry\.fetch/);

console.log("Family Read API V1 read-only shared-access contract passed");
