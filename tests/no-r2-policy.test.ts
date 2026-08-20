import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
function walk(dir:string):string[]{return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const f=path.join(dir,e.name);return e.isDirectory()?walk(f):[f];});}
const r2Forbidden=[/RESEARCH_BUCKET/,/R2Bucket/,/"r2_buckets"/,/\br2_key\b/,/taistock-research-data/];
for(const file of [...walk(path.join(root,"src")).filter(f=>/\.(ts|jsonc)$/.test(f)),...walk(path.join(root,"migrations")).filter(f=>/\.(sql|ts)$/.test(f)),path.join(root,"wrangler.jsonc")]){const c=fs.readFileSync(file,"utf8");for(const p of r2Forbidden)assert.doesNotMatch(c,p,`Permanent no-R2 policy violated by ${path.relative(root,file)}: ${p}`);}
const activeFiles=[...walk(path.join(root,"src")).filter(f=>f.endsWith(".ts")),path.join(root,"wrangler.jsonc")];
for(const file of activeFiles){const c=fs.readFileSync(file,"utf8");for(const p of [/\bD1Database\b/,/\bRESEARCH_DB\b/,/\benv\.DB\b/,/tw_market_data_snapshot_d1/,/tw_market_data_row_d1/])assert.doesNotMatch(c,p,`GitHub-only persistence policy violated by ${path.relative(root,file)}: ${p}`);}
const wrangler=fs.readFileSync(path.join(root,"wrangler.jsonc"),"utf8");
assert.match(wrangler,/Application persistence is GitHub-only on the diamond-data branch/);assert.doesNotMatch(wrangler,/"d1_databases"\s*:/);assert.doesNotMatch(wrangler,/"r2_buckets"\s*:/);assert.doesNotMatch(wrangler,/"triggers"\s*:/);
assert.match(wrangler,/"exports"\s*:\s*\{/);assert.match(wrangler,/"MyMCP"\s*:\s*\{[\s\S]*?"type"\s*:\s*"durable-object"[\s\S]*?"storage"\s*:\s*"sqlite"/);assert.match(wrangler,/"FamilyMCP"\s*:\s*\{[\s\S]*?"type"\s*:\s*"durable-object"[\s\S]*?"storage"\s*:\s*"sqlite"/);assert.match(wrangler,/"class_name"\s*:\s*"FamilyMCP"[\s\S]*?"name"\s*:\s*"FAMILY_MCP_OBJECT"/);assert.doesNotMatch(wrangler,/"migrations"\s*:/);assert.doesNotMatch(wrangler,/"FamilyMCP"\s*:\s*\{[\s\S]*?"state"\s*:\s*"deleted"/);assert.match(wrangler,/production deploys must use `wrangler deploy`/);
const index=fs.readFileSync(path.join(root,"src/index-v6.ts"),"utf8");assert.match(index,/export class FamilyMCP extends McpAgent<Env>/);assert.match(index,/PRESERVED_READ_ONLY/);assert.match(index,/GITHUB_ONLY_NO_D1_NO_R2/);assert.doesNotMatch(index,/state:\s*["']deleted["']/);
const store=fs.readFileSync(path.join(root,"src/v6/github-data-store.ts"),"utf8");assert.match(store,/HTTP 409\/422|409\/422/);assert.match(store,/Strict CAS/);assert.match(store,/GITHUB_CAS_EXHAUSTED/);assert.match(store,/IMMUTABLE_CONFLICT/);assert.match(store,/DEFAULT_GITHUB_DATA_BRANCH = "diamond-data"/);
for(const old of ["src/v6/tw-market-data-d1.ts","src/v6/twse-market-data-capture.ts","src/v6/tpex-market-data-backfill.ts","src/v6/tpex-official-relay.ts"])assert.equal(fs.existsSync(path.join(root,old)),false,`${old} must stay retired`);
console.log("Permanent GitHub-only app persistence, no-R2, and Durable Object namespace preservation tests passed");
