import assert from "node:assert/strict";
import fs from "node:fs";
import { extractFamilyQuerySymbols, inferFamilyAdaptiveIntent, planFamilyQuery } from "../src/v6/family-adaptive-planner.ts";
import { FAMILY_HARD_DENY_CAPABILITIES, familySharedReadManifest } from "../src/v6/family-shared-read-plane.ts";

const manifest = familySharedReadManifest();
assert.equal(manifest.principle, "SAME_RESEARCH_BRAIN_DIFFERENT_PERMISSIONS");
assert.equal(manifest.permission_model.market_and_research_reads, "ALLOW_WHEN_AVAILABLE");
assert.equal(manifest.permission_model.all_mutations, "DENY");
assert.equal(manifest.permission_model.owner_private_context, "DENY_BY_DEFAULT_UNLESS_EXPLICITLY_SHARED");
assert.equal(manifest.evidence_contract, "family-evidence/v1");
assert.equal(manifest.evidence_identity_policy, "EVIDENCE_CLASS_CANNOT_BE_SELF_PROMOTED");
assert.ok(manifest.evidence_hierarchy.FORMAL_TRUTH.includes("OFFICIAL_EXACT_DATE_ON_DEMAND"));
assert.ok(manifest.evidence_hierarchy.FORMAL_TRUTH.includes("PUBLISHED_GENERATION_HISTORY"));
assert.ok(manifest.evidence_hierarchy.FORMAL_TRUTH.includes("OHLC_MCP_GITHUB_CANONICAL_READ"));
assert.ok(manifest.evidence_hierarchy.GOVERNED_CONTEXT.includes("MONEYDJ_BROKER_RANKED_PUBLIC_SECONDARY"));
assert.ok(manifest.evidence_hierarchy.GOVERNED_CONTEXT.includes("JIN10_MCP_EVENTS_READ_ONLY"));
assert.ok(manifest.evidence_hierarchy.DISPLAY_FALLBACK.includes("FUGLE_REST_QUOTE_TRADES"));
assert.ok(manifest.capabilities.some((item) => item.id === "canonical_ohlc" && item.sources.includes("OHLC_MCP_GITHUB_CANONICAL_READ")));
assert.ok(manifest.capabilities.some((item) => item.id === "realtime_market" && item.sources.includes("FUGLE_REST_TRADES")));
assert.ok(manifest.capabilities.some((item) => item.id === "current_chip" && item.sources.includes("OFFICIAL_EXACT_DATE_ON_DEMAND")));
assert.ok(manifest.capabilities.some((item) => item.id === "published_chip" && item.sources.includes("PUBLISHED_GENERATION")));
assert.ok(manifest.capabilities.some((item) => item.id === "jin10_events" && item.sources.includes("JIN10_MCP_EVENTS_READ_ONLY")));
assert.ok(manifest.capabilities.some((item) => item.id === "open_world_web"));
assert.equal(manifest.read_transport.mode, "CROSS_ACCOUNT_SAFE_DIRECT_READ");
assert.equal(manifest.read_transport.cloudflare_service_binding, false);
assert.equal(manifest.read_transport.current_chip, "OFFICIAL_EXACT_DATE_ON_DEMAND_READ_ONLY");
assert.equal(manifest.read_transport.current_chip_persistence, "NONE");
assert.equal(manifest.read_transport.stock_live_persistence, "NONE");
assert.equal(manifest.read_transport.event_research_persistence, "NONE");
assert.ok(FAMILY_HARD_DENY_CAPABILITIES.includes("GITHUB_WRITE"));
assert.ok(FAMILY_HARD_DENY_CAPABILITIES.includes("PRODUCTION_WRITE"));
assert.ok(FAMILY_HARD_DENY_CAPABILITIES.includes("OWNER_PRIVATE_EMAIL"));
assert.ok(FAMILY_HARD_DENY_CAPABILITIES.includes("SECRET_OR_TOKEN_READ"));

assert.deepEqual(extractFamilyQuerySymbols("2317 跟 2382 哪個比較好？"), ["2317", "2382"]);
assert.equal(inferFamilyAdaptiveIntent("2317 現在可以買嗎", ["2317"]), "QUICK_STOCK_QUESTION");
assert.equal(inferFamilyAdaptiveIntent("2317 幫我完整深入分析", ["2317"]), "FULL_STOCK_ANALYSIS");
assert.equal(inferFamilyAdaptiveIntent("2317 跟 2382 比較", ["2317", "2382"]), "STOCK_COMPARE");
assert.equal(inferFamilyAdaptiveIntent("幫我找波段選股", []), "SWING_DISCOVERY");
assert.equal(inferFamilyAdaptiveIntent("今天台股為什麼跌", []), "MARKET_CONTEXT");

const quickPlan = planFamilyQuery("2317 現在可以買嗎", ["2317"]);
assert.equal(quickPlan.fixed_workflow, false);
assert.equal(quickPlan.model_override_allowed, true);
assert.equal(quickPlan.answer_contract.render_for_intent_not_template, true);
assert.equal(quickPlan.answer_contract.quick_question_may_answer_without_all_eleven_sections, true);
assert.ok(quickPlan.preferred_reads.includes("canonical_ohlc"));
assert.ok(quickPlan.preferred_reads.includes("current_chip"));
assert.ok(quickPlan.preferred_reads.includes("published_chip"));
assert.ok(quickPlan.preferred_reads.indexOf("current_chip") < quickPlan.preferred_reads.indexOf("published_chip"));
assert.ok(quickPlan.preferred_reads.includes("open_world_web"));

const fullPlan = planFamilyQuery("2317 完整分析", ["2317"]);
assert.equal(fullPlan.intent, "FULL_STOCK_ANALYSIS");
assert.ok(fullPlan.preferred_reads.includes("current_chip"));
assert.deepEqual(fullPlan.answer_contract.eleven_point_required_when, ["FULL_STOCK_ANALYSIS"]);

const smartRestSource = fs.readFileSync(new URL("../src/v6/family-smart-rest.ts", import.meta.url), "utf8");
assert.match(smartRestSource, /\/api\/family\/query/);
assert.match(smartRestSource, /planFamilyQuery/);
assert.match(smartRestSource, /adaptive_open_research/);
assert.match(smartRestSource, /SAME_RESEARCH_BRAIN_DIFFERENT_PERMISSIONS/);

const analysisSource = fs.readFileSync(new URL("../src/v6/family-analysis.ts", import.meta.url), "utf8");
assert.match(analysisSource, /ADAPTIVE_TO_USER_INTENT/);
assert.match(analysisSource, /FULL_ANALYSIS_USES_FIXED_1_TO_11_COMPLETENESS_CONTRACT/);
assert.match(analysisSource, /buildFamilyUnifiedEvidence/);
assert.match(analysisSource, /evidence_bundle/);
assert.match(analysisSource, /current_chip/);
assert.match(analysisSource, /OFFICIAL_EXACT_DATE_ON_DEMAND/);
assert.match(analysisSource, /GITHUB_CANONICAL_READ_ONLY/);
assert.match(analysisSource, /FUGLE_REST_QUOTE_TRADES_READ_ONLY/);
assert.match(analysisSource, /loadJin10StockEventContext/);
assert.match(analysisSource, /safeFamilyJin10Context/);
assert.match(analysisSource, /jin10_context/);
assert.match(analysisSource, /JIN10_MCP_READ_ONLY_FAIL_SOFT/);
assert.match(analysisSource, /jin10_persistence:\s*"NONE"/);
assert.doesNotMatch(analysisSource, /ALWAYS_RENDER_FIXED_1_TO_11_TEMPLATE/);

const mcpSource = fs.readFileSync(new URL("../src/v6/family-mcp.ts", import.meta.url), "utf8");
assert.match(mcpSource, /familySharedReadManifest/);
assert.match(mcpSource, /FAMILY_EVIDENCE_V1_READY/);
assert.match(mcpSource, /current_chip/);
assert.match(mcpSource, /owner_private_context_shared_by_default: false/);
assert.match(mcpSource, /github_writes: false/);
assert.match(mcpSource, /LOCAL_FUGLE_REST_QUOTE_TRADES/);
assert.doesNotMatch(mcpSource, /registerTool\("jin10_/);

// Keep the focused routing regressions in the permanent Family gate so they
// cannot silently return even if a future package.json refactor forgets a test.
await import("./family-broker-query-routing.test.ts");
await import("./credit-sbl-date-routing-v2.test.ts");
await import("./family-credit-broker-composite-routing.test.ts");

console.log("family-shared-read-intelligence.test.ts: PASS");
