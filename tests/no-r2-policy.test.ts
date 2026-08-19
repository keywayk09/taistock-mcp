import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const forbidden = [
  /RESEARCH_BUCKET/,
  /R2Bucket/,
  /\"r2_buckets\"/,
  /\br2_key\b/,
  /taistock-research-data/,
];

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes:true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const targets = [
  ...walk(path.join(root, "src")).filter((file) => /\.(ts|jsonc)$/.test(file)),
  ...walk(path.join(root, "migrations")).filter((file) => /\.(sql|ts)$/.test(file)),
  path.join(root, "wrangler.jsonc"),
];

for (const file of targets) {
  const content = fs.readFileSync(file, "utf8");
  for (const pattern of forbidden) {
    assert.doesNotMatch(content, pattern, `Permanent no-R2 policy violated by ${path.relative(root, file)}: ${pattern}`);
  }
}

const wrangler = fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8");
assert.match(wrangler, /D1 only for Diamond persistence; R2 is forbidden/);
assert.match(wrangler, /"exports"\s*:\s*\{/);
assert.match(wrangler, /"MyMCP"\s*:\s*\{[\s\S]*?"type"\s*:\s*"durable-object"[\s\S]*?"storage"\s*:\s*"sqlite"/);
assert.doesNotMatch(wrangler, /"migrations"\s*:/, "Legacy Durable Object migration tags must not return; production uses declarative exports");
assert.match(wrangler, /production deploys must use `wrangler deploy`/);

const p18 = fs.readFileSync(path.join(root, "docs/p18-official-market-data.md"), "utf8");
assert.match(p18, /R2 禁止使用/);
assert.match(p18, /不得因功能擴充重新引入 R2/);

console.log("Permanent no-R2 and Durable Object deploy policy tests passed");
