import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && /\.(?:ts|tsx|js|mjs)$/.test(entry.name) ? [full] : [];
  });
}

const runtimeFiles = walk("src");
const dangerousZodSubpaths = runtimeFiles.flatMap((file) => {
  const source = fs.readFileSync(file, "utf8");
  return /from\s+["']zod\/(?:v3|v4\/core)["']|import\s+["']zod\/(?:v3|v4\/core)["']/.test(source) ? [file] : [];
});
assert.deepEqual(
  dangerousZodSubpaths,
  [],
  `Worker source must not bypass the canonical Zod v4 entry via v3/core internals: ${dangerousZodSubpaths.join(", ")}`,
);

const tsconfig = JSON.parse(fs.readFileSync("tsconfig.json", "utf8"));
assert.equal(tsconfig.compilerOptions?.baseUrl, ".", "tsconfig baseUrl is required for exact package path remapping");
assert.deepEqual(
  tsconfig.compilerOptions?.paths?.zod,
  ["src/vendor/zod-v4.ts"],
  "bare `zod` imports must resolve through the exact local v4 shim; zod/v4 imports remain untouched",
);

assert.ok(fs.existsSync("src/vendor/zod-v4.ts"), "canonical Zod v4 shim must exist");
const shim = fs.readFileSync("src/vendor/zod-v4.ts", "utf8");
assert.match(shim, /export\s+\*\s+from\s+["']zod\/v4["']/, "Zod shim must re-export the public zod/v4 entry");
assert.doesNotMatch(shim, /zod\/v4\/core/, "Zod shim must not import private v4/core internals");

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert.equal(pkg.dependencies?.zod, "4.4.3", "pin Zod exactly so deploy installs are deterministic");
assert.equal(pkg.dependencies?.agents, "0.17.4", "pin the tested Cloudflare Agents runtime exactly");
assert.equal(pkg.dependencies?.["@modelcontextprotocol/sdk"], "1.29.0", "direct MCP SDK imports require the Agents-matched pinned direct dependency");
assert.equal(pkg.overrides?.zod, "4.4.3", "force one Zod implementation across MCP/Agents dependency graph");
assert.equal(pkg.overrides?.["@modelcontextprotocol/sdk"], "1.29.0", "force one MCP SDK implementation across the Worker bundle");

console.log("PASS Cloudflare MCP/Zod startup dependency + exact Zod v4 resolution contract");
