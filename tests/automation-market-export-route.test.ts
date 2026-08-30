import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { handleAutomationMarketExportRoute } from "../src/v6/automation-market-export-route.ts";

const BASE = "https://taistock-mcp.keywayk09.workers.dev";
const REV = "a".repeat(40);

// Mutating methods are rejected before any reader access.
{
  const response = await handleAutomationMarketExportRoute(
    new Request(`${BASE}/research/automation/market-export?as_of=2026-08-28&source_revision=${REV}&prefix=2`, { method: "POST" }),
    {} as any,
  );
  assert(response);
  const body = await response.json() as any;
  assert.equal(body.blocked, true);
  assert.equal(body.error, "METHOD_NOT_ALLOWED");
  assert.equal(body.read_only, true);
  assert.equal(body.writer_routes, false);
}

// Moving-main or malformed revisions can never become a formal export.
{
  const response = await handleAutomationMarketExportRoute(
    new Request(`${BASE}/research/automation/market-export?as_of=2026-08-28&source_revision=main&prefix=2`),
    {} as any,
  );
  assert(response);
  const body = await response.json() as any;
  assert.equal(body.blocked, true);
  assert.equal(body.error, "INVALID_SOURCE_REVISION");
}

// Prefix is deliberately bounded to one decimal digit.
{
  const response = await handleAutomationMarketExportRoute(
    new Request(`${BASE}/research/automation/market-export?as_of=2026-08-28&source_revision=${REV}&prefix=all`),
    {} as any,
  );
  assert(response);
  const body = await response.json() as any;
  assert.equal(body.blocked, true);
  assert.equal(body.error, "INVALID_PREFIX");
}

// Static contract: this route must remain a thin read-only facade over the
// canonical cross-section reader, never a second shard implementation.
const source = await readFile(new URL("../src/v6/automation-market-export-route.ts", import.meta.url), "utf8");
assert.match(source, /getTwMarketCrossSection\(pinnedEnv\(env, revision\)/);
assert.match(source, /formal_research_eligible !== true/);
assert.match(source, /SOURCE_REVISION_MISMATCH/);
assert.match(source, /limit:\s*500/);
assert.doesNotMatch(source, /putImmutableGitHubJson|updateGitHubJson|createGitHub|DELETE|POST[^\n]*fetch/);
assert.doesNotMatch(source, /url\.searchParams\.get\("url"\)|url\.searchParams\.get\("path"\)/);

console.log("automation-market-export-route: PASS");
