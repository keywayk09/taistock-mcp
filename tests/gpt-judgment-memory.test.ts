import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GPT_JUDGMENT_MEMORY_VERSION,
  GPT_JUDGMENT_REVIEW_SCHEMA_VERSION,
  GPT_JUDGMENT_SCHEMA_VERSION,
  GPT_TRADING_KNOWLEDGE_SCHEMA_VERSION,
} from "../src/v6/gpt-judgment-memory.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

assert.equal(GPT_JUDGMENT_MEMORY_VERSION, "diamond-gpt-judgment-memory/v1.0.0");
assert.equal(GPT_JUDGMENT_SCHEMA_VERSION, "diamond-gpt-judgment/v1");
assert.equal(GPT_JUDGMENT_REVIEW_SCHEMA_VERSION, "diamond-gpt-judgment-review/v1");
assert.equal(GPT_TRADING_KNOWLEDGE_SCHEMA_VERSION, "diamond-trading-knowledge/v1");

const core = read("src/v6/gpt-judgment-memory.ts");
assert.match(core, /data_watermark_ts_ms > knowledge_cutoff_ts_ms \|\| knowledge_cutoff_ts_ms > judgment_ts_ms/);
assert.match(core, /trendline anchor is after knowledge cutoff/);
assert.match(core, /pattern detection is after knowledge cutoff/);
assert.match(core, /TW_STOCK judgment symbol must|TW_STOCK symbol must be 4-6 digits/);
assert.match(core, /TXF judgment symbol must be logical symbol TXF/);
assert.match(core, /TW_STOCK judgment review requires formal research eligible OHLC dataset/);
assert.match(core, /TXF judgment review requires review_eligible or formal_research_eligible dataset/);
assert.match(core, /ACCEPTED knowledge requires HUMAN actor and human_approved=true/);
assert.match(core, /MIXED_DO_NOT_COMPARE_DIRECTLY/);
assert.match(core, /REVIEW_DOES_NOT_MUTATE_STRATEGY/);
assert.match(core, /STATISTICS_GENERATE_HYPOTHESES_ONLY_NO_AUTO_STRATEGY_CHANGE/);
assert.match(core, /gpt_judgment_trendlines/);
assert.match(core, /gpt_judgment_patterns/);
assert.match(core, /gpt_trading_knowledge/);

const tools = read("src/v6/gpt-judgment-memory-tools.ts");
for (const name of [
  "get_gpt_judgment_memory_contract",
  "record_gpt_market_judgment",
  "get_gpt_market_judgment",
  "list_gpt_market_judgments",
  "record_gpt_judgment_review",
  "analyze_gpt_judgment_history",
  "record_gpt_trading_knowledge",
  "list_gpt_trading_knowledge",
]) assert.match(tools, new RegExp(`server\\.registerTool\\(\\"${name}\\"`));
assert.match(tools, /Trendline anchors/);
assert.match(tools, /TradingView trendline indicator/);
assert.match(tools, /ACCEPTED requires explicit HUMAN approval/);

const registry = read("src/v6/diamond-capability-p16.ts");
assert.match(registry, /Improve GPT trading cognition first/);
assert.match(registry, /DETERMINISTIC_TRENDLINE_ENGINE_THEN_TRADINGVIEW_INDICATOR/);
assert.match(registry, /future_anchor_or_pattern_in_judgment: "FORBIDDEN"/);
assert.match(registry, /mixed_stock_pct_and_txf_point_expectancy: "FORBIDDEN"/);
assert.match(registry, /gpt_self_accept_knowledge: "FORBIDDEN"/);

const researchTools = read("src/v6/research-tools.ts");
assert.match(researchTools, /registerGptJudgmentMemoryTools\(server, env\)/);

const index = read("src/index-v6.ts");
assert.match(index, /version: "6\.14\.0"/);
assert.match(index, /tools: 105/);

const migration = read("migrations/0005_gpt_judgment_memory.sql");
for (const table of ["gpt_judgments","gpt_judgment_reasons","gpt_judgment_trendlines","gpt_judgment_patterns","gpt_judgment_reviews","gpt_trading_knowledge"]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));

console.log("P16 GPT judgment / structure / pattern / trendline memory tests passed");
