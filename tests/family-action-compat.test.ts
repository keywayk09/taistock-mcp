import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("src/v6/family-action-compat.ts", "utf8");
const entry = fs.readFileSync("src/index-v6.ts", "utf8");

assert.match(route, /\/api\/family\/query/);
assert.match(route, /MOM_GPT_API_KEY/);
assert.match(route, /bearerAuthorized/);
assert.match(route, /runFamilyActionCompatQuery/);
assert.match(route, /getTwMarketChipSummaryPublished/);
assert.match(route, /calendar_days:\s*180/);
assert.match(route, /formal_ohlc:\s*false/);
assert.match(route, /writes_allowed:\s*false/);
assert.match(route, /\/family-openapi\.json/);
assert.match(route, /\/privacy/);
assert.doesNotMatch(route, /env\.DB|D1Database|INSERT\s|UPDATE\s|DELETE\s/i);
assert.match(entry, /handleFamilyActionCompat\(request, env, url\)/);
assert.match(entry, /family_read_only_action:\s*"\/api\/family\/query"/);

console.log("PASS legacy Family Custom GPT Action restored on modern read-only plane");
