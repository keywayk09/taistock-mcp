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
const bareZodImports = runtimeFiles.flatMap((file) => {
  const source = fs.readFileSync(file, "utf8");
  return /from\s+["']zod["']|import\s+["']zod["']/.test(source) ? [file] : [];
});

assert.deepEqual(
  bareZodImports,
  [],
  `Cloudflare Worker runtime must use the same Zod v4 entry as MCP SDK; bare zod imports found: ${bareZodImports.join(", ")}`,
);

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert.equal(pkg.dependencies?.zod, "4.4.3", "pin Zod exactly so deploy installs are deterministic");
assert.equal(pkg.dependencies?.agents, "0.17.4", "pin the tested Cloudflare Agents runtime exactly");
assert.equal(pkg.dependencies?.["@modelcontextprotocol/sdk"], "1.29.0", "direct MCP SDK imports require a pinned direct dependency");
assert.equal(pkg.overrides?.zod, "4.4.3", "force one Zod implementation across MCP/Agents dependency graph");
assert.equal(pkg.overrides?.["@modelcontextprotocol/sdk"], "1.29.0", "force one MCP SDK implementation across the Worker bundle");

console.log("PASS Cloudflare MCP/Zod startup dependency contract");
