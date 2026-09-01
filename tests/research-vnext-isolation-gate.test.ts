import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { RESEARCH_VNEXT_ISOLATION_MANIFEST } from "../src/v6/research-vnext/isolation-manifest.ts";

const root = path.resolve(import.meta.dirname, "..");
const vnextRoot = path.join(root, "src/v6/research-vnext");

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(full);
  }
  return files.sort();
}

assert.equal(RESEARCH_VNEXT_ISOLATION_MANIFEST.schema, "RESEARCH_VNEXT_ISOLATION_MANIFEST_V1");
assert.equal(RESEARCH_VNEXT_ISOLATION_MANIFEST.runtime_mode, "SHADOW_UNREGISTERED");
assert.equal(RESEARCH_VNEXT_ISOLATION_MANIFEST.production_registration, "DISABLED");
assert.equal(RESEARCH_VNEXT_ISOLATION_MANIFEST.owner_abi, "UNCHANGED");
assert.deepEqual(RESEARCH_VNEXT_ISOLATION_MANIFEST.regression_domains, [
  "VNEXT",
  "FAMILY",
  "MARKET_DATA",
  "FORMAL_BLIND",
  "OWNER_OPS",
  "BUNDLE",
]);

const forbidden = [
  "owner-content-handler",
  "research-tools",
  "index-v6",
  "mcp-runtime-composition",
  "family-",
  "tw-market-data",
  "formal-blind",
  "jin10",
];
const compatPath = "src/v6/research-vnext/compat-cutover.ts";

for (const file of walk(vnextRoot)) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  const source = fs.readFileSync(file, "utf8");
  const executable = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const token of forbidden) {
    assert.doesNotMatch(
      executable,
      new RegExp(`from\\s+["'][^"']*${token}[^"']*["']`, "i"),
      `${relative} imports protected domain ${token}`,
    );
  }

  if (relative === compatPath) {
    // Phase 10B allows exactly one internal registration adapter. It still may
    // not import protected Production domains, create a second MCP graph, or
    // perform a real deployment; public registration remains owned by the
    // existing Legacy research registrar.
    assert.match(
      executable,
      /createResearchVNextCompatRegistrationServer/,
      `${compatPath} must expose the bounded Phase 10B registration adapter`,
    );
  } else {
    assert.doesNotMatch(
      executable,
      /registerTool|registerResearchTools|server\.tool|server\.registerTool/,
      `${relative} must remain unregistered outside the exact Phase 10B compat adapter`,
    );
  }
}

const researchToolsSource = fs.readFileSync(path.join(root, "src/v6/research-tools.ts"), "utf8");
const researchVnextImports = Array.from(
  researchToolsSource.matchAll(/from\s+["'](\.\/research-vnext\/[^"']+)["']/g),
  (match) => match[1],
);
assert.deepEqual(
  researchVnextImports,
  ["./research-vnext/compat-cutover"],
  "research-tools may know Research VNext only through the approved Phase 10B compat boundary",
);
assert.doesNotMatch(
  researchToolsSource,
  /research-vnext\/(research-gateway|shadow-facade|compute\/|memory\/)/,
  "research-tools must not bypass the compat boundary",
);

for (const productionFile of [
  "src/v6/owner-content-handler.ts",
  "src/v6/mcp-runtime-composition.ts",
  "src/index-v6.ts",
]) {
  const source = fs.readFileSync(path.join(root, productionFile), "utf8");
  assert.doesNotMatch(
    source,
    /research-vnext/i,
    `${productionFile} must not directly know Research VNext during Phase 10B`,
  );
}

const workflow = fs.readFileSync(path.join(root, ".github/workflows/research-vnext-isolation-gate.yml"), "utf8");
for (const required of [
  "test:family-selection",
  "test:market-data",
  "test:formal-blind-ohlc",
  "test:ops-contracts",
  "owner-live-tool-exposure.test.ts",
  "wrangler deploy --dry-run",
  "research-vnext-*.test.ts",
]) {
  assert.ok(workflow.includes(required), `isolation workflow missing ${required}`);
}
assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
assert.match(workflow, /persist-credentials:\s*false/);
assert.doesNotMatch(workflow, /wrangler deploy(?! --dry-run)/, "isolation workflow must never perform a real deploy");
assert.doesNotMatch(
  workflow,
  /CLOUDFLARE_API_TOKEN|GITHUB_DATA_TOKEN|GITHUB_TOKEN:\s*\$\{\{\s*secrets/i,
  "isolation workflow must not consume Production credentials",
);

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_ISOLATION_GATE_TEST_V1",
  status: "PASS",
  runtime_mode: RESEARCH_VNEXT_ISOLATION_MANIFEST.runtime_mode,
  vnext_files_scanned: walk(vnextRoot).length,
  registration_exception: compatPath,
  owner_direct_registration: "FORBIDDEN",
  regression_domains: RESEARCH_VNEXT_ISOLATION_MANIFEST.regression_domains,
  production_registration: "DISABLED",
}, null, 2));
