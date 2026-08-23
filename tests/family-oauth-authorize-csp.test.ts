import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const oauth = fs.readFileSync(path.join(root, "src/v6/family-oauth.ts"), "utf8");

const expected = "content-security-policy\": \"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://chatgpt.com https://chat.openai.com; base-uri 'none'; frame-ancestors 'none'\"";

assert.ok(oauth.includes(expected), "Family OAuth authorize CSP must allow the trusted ChatGPT HTTPS callbacks after same-origin form POST");
assert.ok(!oauth.includes("form-action 'self'; base-uri 'none'; frame-ancestors 'none'"), "self-only form-action reintroduces the Chrome OAuth callback redirect stall");
assert.match(oauth, /TRUSTED_CHATGPT_HOSTS = new Set\(\["chatgpt\.com", "chat\.openai\.com"\]\)/);
assert.match(oauth, /redirect\.protocol !== "https:"/);
assert.match(oauth, /frame-ancestors 'none'/);
assert.match(oauth, /default-src 'none'/);

console.log("Family OAuth authorize CSP callback compatibility test passed");
