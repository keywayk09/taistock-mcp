import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const indexV6 = read("src/index-v6.ts");
const familyCompat = read("src/v6/family-oauth-public-client-compat.ts");

// PUBLIC_INGRESS_CONTRACT_V1
// The external connector endpoints are public ABI. Internal runtimes may change,
// but these paths and identities must not drift.
assert.match(indexV6, /url\.pathname === "\/my-mcp"/);
assert.match(indexV6, /url\.pathname === "\/family-mcp"|FamilyMCP\.serve\("\/family-mcp"/);

// Owner and Family identities must stay distinct. A Family compatibility layer
// must never rewrite a generic Owner resource to /family-mcp.
assert.doesNotMatch(
  familyCompat,
  /\(resource\.pathname === "\/" \|\| resource\.pathname === FAMILY_MCP_PATH\)[\s\S]{0,220}url\.searchParams\.set\("resource", canonical\)/,
  "Family OAuth compatibility must not normalize Worker-root/Owner resources to /family-mcp",
);

// Generic protected-resource discovery must not globally advertise Family as the
// identity for the whole Worker origin. Family metadata must be path-scoped or
// otherwise isolated from Owner /my-mcp.
assert.doesNotMatch(
  familyCompat,
  /url\.pathname === "\/\.well-known\/oauth-protected-resource"[\s\S]{0,240}canonicalProtectedResourceMetadata/,
  "Global protected-resource metadata must not be hard-wired to the Family identity",
);

console.log("Public ingress freeze contract passed");
