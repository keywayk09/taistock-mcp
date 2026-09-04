import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
function walk(dir:string):string[]{return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const f=path.join(dir,e.name);return e.isDirectory()?walk(f):[f];});}

// Permanent application market-data boundary: no R2 and no D1 market-data
// persistence. OAuth/session KV and MCP Durable Object lifecycle state are not
// market-data storage and remain independently governed.
const r2Forbidden=[/RESEARCH_BUCKET/,/R2Bucket/,/"r2_buckets"/,/\br2_key\b/,/taistock-research-data/];
for(const file of [...walk(path.join(root,"src")).filter(f=>/\.(ts|jsonc)$/.test(f)),...walk(path.join(root,"migrations")).filter(f=>/\.(sql|ts)$/.test(f)),path.join(root,"wrangler.jsonc")]){
  const c=fs.readFileSync(file,"utf8");
  for(const p of r2Forbidden) assert.doesNotMatch(c,p,`Permanent no-R2 policy violated by ${path.relative(root,file)}: ${p}`);
}
const activeFiles=[...walk(path.join(root,"src")).filter(f=>f.endsWith(".ts")),path.join(root,"wrangler.jsonc")];
for(const file of activeFiles){
  const c=fs.readFileSync(file,"utf8");
  for(const p of [/\bD1Database\b/,/\bRESEARCH_DB\b/,/\benv\.DB\b/,/tw_market_data_snapshot_d1/,/tw_market_data_row_d1/]){
    assert.doesNotMatch(c,p,`No-D1 market-data policy violated by ${path.relative(root,file)}: ${p}`);
  }
}

const wrangler=fs.readFileSync(path.join(root,"wrangler.jsonc"),"utf8");
assert.match(wrangler,/OHLC\/K-line remains owned by the existing tv-fugle-1d canonical pipeline and is unchanged/);
assert.match(wrangler,/Non-OHLC chip data[\s\S]*read on demand[\s\S]*not scheduled for daily raw capture/);
assert.match(wrangler,/new current-day chip evidence is not persisted by this Worker/);
assert.match(wrangler,/OAUTH_KV is ephemeral OAuth\/session state[\s\S]*not application market-data persistence/);
assert.doesNotMatch(wrangler,/"d1_databases"\s*:/);
assert.doesNotMatch(wrangler,/"r2_buckets"\s*:/);
assert.match(wrangler,/"GITHUB_DATA_REPO"\s*:\s*"keywayk09\/tv-papertrader"/);
assert.match(wrangler,/"GITHUB_DATA_BRANCH"\s*:\s*"main"/);

// The old non-OHLC market-data wake is retired. No Wrangler cron may silently
// restart the writer; the production wrapper supplies a second no-op fence.
assert.doesNotMatch(wrangler,/"triggers"\s*:/,"retired non-OHLC market-data cron must not be rebound");
assert.doesNotMatch(wrangler,/"crons"\s*:/,"retired non-OHLC market-data cron must not be rebound");
const bridge=fs.readFileSync(path.join(root,"src/index-automation-bridge.ts"),"utf8");
assert.match(bridge,/status:\s*"RETIRED_NOOP"/);
assert.match(bridge,/reason:\s*"NON_OHLC_CHIP_DATA_MOVED_TO_ON_DEMAND"/);
assert.match(bridge,/current_chip_persistence:\s*"NONE"/);
assert.match(bridge,/ohlc_policy:\s*"UNCHANGED_CANONICAL_PIPELINE"/);

// Durable Object namespaces and deployment lifecycle must remain intact; these
// are runtime/session namespaces, not a replacement market-data persistence plane.
assert.match(wrangler,/"exports"\s*:\s*\{/);
assert.match(wrangler,/"MyMCP"\s*:\s*\{[\s\S]*?"type"\s*:\s*"durable-object"[\s\S]*?"storage"\s*:\s*"sqlite"/);
assert.match(wrangler,/"FamilyMCP"\s*:\s*\{[\s\S]*?"type"\s*:\s*"durable-object"[\s\S]*?"storage"\s*:\s*"sqlite"/);
assert.match(wrangler,/"class_name"\s*:\s*"FamilyMCP"[\s\S]*?"name"\s*:\s*"FAMILY_MCP_OBJECT"/);
assert.doesNotMatch(wrangler,/"migrations"\s*:/);
assert.doesNotMatch(wrangler,/"FamilyMCP"\s*:\s*\{[\s\S]*?"state"\s*:\s*"deleted"/);
assert.match(wrangler,/production deploys must use `wrangler deploy`/);

const index=fs.readFileSync(path.join(root,"src/index-v6.ts"),"utf8");
const composition=fs.readFileSync(path.join(root,"src/v6/mcp-runtime-composition.ts"),"utf8");
assert.match(index,/export \{ FamilyMCP, MyMCP \} from "\.\/v6\/mcp-runtime-composition"/);
assert.match(composition,/export \{ FamilyMCP \} from "\.\/family-mcp"/);
assert.match(composition,/export \{ MyMCP \} from "\.\/owner-content-handler"/);
assert.match(index,/GITHUB_ONLY_NO_D1_NO_R2/);
assert.doesNotMatch(index,/state:\s*["']deleted["']/);
assert.doesNotMatch(index,/syncDiamondCanonicalBatch|CANONICAL_SYNC_VERSION|diamond-data/);
// The old internal V6 health object can retain historical scheduler labels for
// compatibility, but the active automation bridge must override current status
// to on-demand/no-cron. Do not use the legacy label as an execution assertion.
assert.match(index,/NO_PRIVATE_GITHUB_ACTIONS_DEPENDENCY/);

const family=fs.readFileSync(path.join(root,"src/v6/family-mcp.ts"),"utf8");
assert.match(family,/export class FamilyMCP extends McpAgent<Env>/);
assert.match(family,/READ_ONLY_FAMILY_SURFACE/);
assert.match(family,/github_writes: false/);
assert.match(family,/production_writes: false/);
assert.doesNotMatch(family,/state:\s*["']deleted["']/);

const store=fs.readFileSync(path.join(root,"src/v6/github-data-store.ts"),"utf8");
assert.match(store,/HTTP 409\/422|409\/422/);
assert.match(store,/Strict CAS/);
assert.match(store,/GITHUB_CAS_EXHAUSTED/);
assert.match(store,/IMMUTABLE_CONFLICT/);
assert.match(store,/GITHUB_DATA_TOKEN \|\| env\.GITHUB_TOKEN/);
assert.match(store,/env\.GITHUB_DATA_REPO/);
assert.match(store,/env\.GITHUB_DATA_BRANCH/);

assert.equal(fs.existsSync(path.join(root,"src/v6/github-canonical-sync.ts")),false,"legacy diamond-data sync must stay retired");
for(const old of ["src/v6/tw-market-data-d1.ts","src/v6/twse-market-data-capture.ts","src/v6/tpex-market-data-backfill.ts","src/v6/tpex-official-relay.ts"]){
  assert.equal(fs.existsSync(path.join(root,old)),false,`${old} must stay retired`);
}

console.log("PASS persistence boundary: OHLC canonical GitHub unchanged, current chip reads non-persistent, no D1/R2 market-data plane, no retired chip cron, Durable Object namespaces preserved");
