import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/diamond-chatgpt-fixed-facade-v20260802.json"), "utf8")) as {
  schema:string;
  source_commit:string;
  tool_count:number;
  tool_names:string[];
};

assert.equal(fixture.schema, "DIAMOND_CHATGPT_FIXED_FACADE_V1");
assert.equal(fixture.source_commit, "9e85592aa8e78a9afbbb246ee1fee2553c2d8187");
assert.equal(fixture.tool_count, 79);
assert.equal(fixture.tool_names.length, 79);
assert.equal(new Set(fixture.tool_names).size, 79);

const captured:string[] = [];
const capturedToolConfigs = new Map<string, any>();
const capturedResources:{name:string;uri:string}[] = [];
const fakeServer = {
  registerTool(name:string, config?:unknown){ captured.push(name); capturedToolConfigs.set(name, config); },
  registerResource(name:string, uri:string){ capturedResources.push({ name, uri }); },
};
const cjsRequire = createRequire(import.meta.url) as NodeJS.Require & { extensions:Record<string,(module:unknown,filename:string)=>void> };
const nodeModule = cjsRequire("node:module") as { _load:(request:string,parent:unknown,isMain:boolean)=>unknown };
const previousTsLoader = cjsRequire.extensions[".ts"];
const originalLoad = nodeModule._load;
class StubMcpAgent {}
class StubMcpServer { registerTool(){} registerResource(){} }

cjsRequire.extensions[".ts"] = (module:unknown, filename:string) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, esModuleInterop:true, moduleResolution:ts.ModuleResolutionKind.Node10 },
    fileName:filename,
    reportDiagnostics:false,
  }).outputText;
  (module as {_compile(code:string,filename:string):void})._compile(output, filename);
};
nodeModule._load = function(request:string,parent:unknown,isMain:boolean){
  if(request === "@modelcontextprotocol/sdk/server/mcp.js") return { McpServer:StubMcpServer };
  if(request === "agents/mcp") return { McpAgent:StubMcpAgent };
  if(request.startsWith("cloudflare:")) return {};
  return originalLoad.call(this, request, parent, isMain);
};

let compatNames:string[] = [];
let tryCompat:((request:Request,env:Env)=>Promise<Response|null>) | null = null;
try {
  const { MyMCP } = cjsRequire("../src/v6/owner-content-handler.ts") as { MyMCP:{prototype:{init:()=>Promise<void>}} };
  const compat = cjsRequire("../src/v6/diamond-fixed-facade-compat.ts") as {
    DIAMOND_FIXED_FACADE_COMPAT_TOOL_NAMES:readonly string[];
    tryHandleDiamondFixedFacadeCompatCall:(request:Request,env:Env)=>Promise<Response|null>;
  };
  compatNames = [...compat.DIAMOND_FIXED_FACADE_COMPAT_TOOL_NAMES];
  tryCompat = compat.tryHandleDiamondFixedFacadeCompatCall;
  await MyMCP.prototype.init.call({ server:fakeServer, env:{} as Env } as any);
} finally {
  nodeModule._load = originalLoad;
  if(previousTsLoader) cjsRequire.extensions[".ts"] = previousTsLoader;
  else delete cjsRequire.extensions[".ts"];
}

assert.equal(captured.length, 123, "modern Owner tools/list inventory must remain 123; compatibility aliases must not be registered");
assert.equal(new Set(captured).size, captured.length, "Owner runtime must never double-register a tool name");
assert.deepEqual(capturedResources, [{ name:"first_party_intelligence_registry", uri:"first-party-intelligence://registry" }], "static first-party metadata must be an MCP resource, not a 124th tool");
assert.equal(compatNames.length, 39, "frozen facade interceptor must contain exactly the 39 names absent from modern runtime");
assert.equal(new Set(compatNames).size, 39, "compatibility names must be unique");

const live = new Set(captured);
const missing = fixture.tool_names.filter((name) => !live.has(name));
assert.deepEqual([...missing].sort(), [...compatNames].sort(), "historical 79 facade gap must be covered exactly by the compatibility interceptor");
assert.ok(fixture.tool_names.every((name) => live.has(name) || compatNames.includes(name)), "every frozen ChatGPT tool must be callable through modern registration or compatibility interception");

for (const tool of ["get_broker_chips", "get_institutional", "get_margin", "get_short_pressure"]) {
  assert.ok(live.has(tool), `${tool} must remain callable under the frozen Owner schema`);
}
const brokerDescription = String(capturedToolConfigs.get("get_broker_chips")?.description ?? "");
assert.match(brokerDescription, /Ranked-only|RANKED_ONLY/i);
assert.match(brokerDescription, /Provider|同一平台/i);
assert.match(brokerDescription, /1\/5\/10\/20\/60/);
assert.match(brokerDescription, /禁止逐 window 混用不同平台/);
assert.doesNotMatch(brokerDescription, /FinMind單日券商分點淨買賣/);
for (const tool of ["get_institutional", "get_margin"]) {
  const description = String(capturedToolConfigs.get(tool)?.description ?? "");
  assert.match(description, /exact-date on-demand/i, `${tool} must advertise the current exact-date read plane`);
}
const shortPressureDescription = String(capturedToolConfigs.get("get_short_pressure")?.description ?? "");
assert.match(shortPressureDescription, /最新交易日/);
assert.match(shortPressureDescription, /沒有日期參數/);
assert.match(shortPressureDescription, /get_tw_sbl_short_sale\(as_of\)/);
assert.match(shortPressureDescription, /get_tw_securities_lending\(as_of\)/);
assert.match(shortPressureDescription, /週末|假日/);

assert.ok(tryCompat, "compatibility tools/call interceptor must be exported");
const legacyCall = new Request("https://taistock-mcp.example/my-mcp", {
  method:"POST",
  headers:{ "content-type":"application/json", "mcp-session-id":"compat-test-session" },
  body:JSON.stringify({ jsonrpc:"2.0", id:79, method:"tools/call", params:{ name:"add_industry_evidence", arguments:{ evidence_id:"legacy" } } }),
});
const legacyResponse = await tryCompat!(legacyCall, {} as Env);
assert.ok(legacyResponse, "missing frozen tool call must be intercepted before modern MCP runtime");
assert.equal(legacyResponse!.status, 200);
assert.equal(legacyResponse!.headers.get("mcp-session-id"), "compat-test-session");
const legacyRpc = await legacyResponse!.json() as any;
assert.equal(legacyRpc.jsonrpc, "2.0");
assert.equal(legacyRpc.id, 79);
assert.equal(legacyRpc.result?.content?.[0]?.type, "text");
const legacyPayload = JSON.parse(String(legacyRpc.result.content[0].text));
assert.equal(legacyPayload.status, "LEGACY_COMPATIBILITY_RETAINED_FAIL_CLOSED");
assert.equal(legacyPayload.legacy_tool, "add_industry_evidence");
assert.equal(legacyPayload.production_mutation, "NONE");

const reportEnv = {
  // Intentionally no exact-date GitHub artifact: direct official reads must be
  // sufficient, proving GitHub is no longer today's readiness Gate.
  __GITHUB_DATA_MEMORY:new Map(),
} as any as Env;

const reportListedCount = 520;
const reportOtcCount = 320;
const reportT86 = {
  date:"20261005",
  stat:"OK",
  fields:["證券代號","證券名稱","外陸資買賣超股數(不含外資自營商)","投信買賣超股數","自營商買賣超股數","三大法人買賣超股數"],
  data:Array.from({ length:reportListedCount }, (_, i) => {
    const foreign=(i-260)*1000;
    const trust=(260-i)*700;
    return [String(1001+i),`L${i}`,String(foreign),String(trust),"0",String(foreign+trust)];
  }),
};
const reportTpexInstitutional = Array.from({ length:reportOtcCount }, (_, i) => {
  const foreign=(160-i)*900;
  const trust=(i-160)*600;
  return {
    Date:"1151005",
    Code:String(6001+i),
    Name:`O${i}`,
    "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference":String(foreign),
    "Securities Investment Trust Companies-Difference":String(trust),
    "Dealers-Difference":"0",
    "Total Difference":String(foreign+trust),
  };
});
const reportTwseMargin = {
  date:"20261005",
  tables:[{
    title:"融資融券彙總 (全部)",
    fields:["證券代號","證券名稱","前日餘額","買進","賣出","現金償還","今日餘額","前日餘額","賣出","買進","現券償還","今日餘額"],
    data:Array.from({ length:reportListedCount }, (_, i) => {
      const marginPrev=1000+i*3;
      const marginNow=marginPrev+(i-260);
      const shortPrev=100+i;
      const shortNow=shortPrev+(260-i);
      return [String(1001+i),`L${i}`,String(marginPrev),"0","0","0",String(marginNow),String(shortPrev),"0","0","0",String(shortNow)];
    }),
  }],
};
const reportTpexMargin = Array.from({ length:reportOtcCount }, (_, i) => {
  const marginPrev=800+i*2;
  const marginNow=marginPrev+(160-i);
  const shortPrev=80+i;
  const shortNow=shortPrev+(i-160);
  return {
    Date:"1151005",
    Code:String(6001+i),
    Name:`O${i}`,
    MarginPurchaseYesterdayBalance:String(marginPrev),
    MarginPurchaseTodayBalance:String(marginNow),
    ShortSaleYesterdayBalance:String(shortPrev),
    ShortSaleTodayBalance:String(shortNow),
  };
});
const reportOriginalFetch = globalThis.fetch;
globalThis.fetch = (async (input:RequestInfo|URL) => {
  const url=String(input);
  const response=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{"content-type":"application/json"}});
  if(url.includes("/fund/T86")) return response(reportT86);
  if(url.includes("/openapi/v1/tpex_3insti_daily_trading")) return response(reportTpexInstitutional);
  if(url.includes("/marginTrading/MI_MARGN")) return response(reportTwseMargin);
  if(url.includes("/openapi/v1/tpex_mainboard_margin_balance")) return response(reportTpexMargin);
  return new Response("",{status:404});
}) as typeof fetch;

const dailyReportCall = new Request("https://taistock-mcp.example/my-mcp", {
  method:"POST",
  headers:{ "content-type":"application/json" },
  body:JSON.stringify({
    jsonrpc:"2.0",
    id:81,
    method:"tools/call",
    params:{ name:"get_daily_chip_report", arguments:{ date:"2026-10-05", fallback_days:0, watchlist:[], include_raw:false } },
  }),
});
const dailyReportResponse = await tryCompat!(dailyReportCall, reportEnv);
assert.ok(dailyReportResponse);
const dailyReportRpc = await dailyReportResponse!.json() as any;
const dailyReportPayload = JSON.parse(String(dailyReportRpc.result.content[0].text));
assert.equal(dailyReportPayload.status, "READY");
assert.equal(dailyReportPayload.role, "CURRENT_EXACT_DATE_OFFICIAL_ON_DEMAND");
assert.equal(dailyReportPayload.trade_date, "2026-10-05");
assert.equal(dailyReportPayload.current_selection_source, true);
assert.equal(dailyReportPayload.previous_day_substitution, false);
assert.equal(dailyReportPayload.data.coverage.total_rows, 840);
assert.equal(dailyReportPayload.data.rankings.foreign_buy.length, 10);
assert.equal(dailyReportPayload.components.inflow_outflow.ready, true);
assert.equal(dailyReportPayload.components.margin_short.ready, true);
assert.equal(dailyReportPayload.components.margin_short.blocks_inflow_outflow, false);
assert.equal(dailyReportPayload.margin.status, "READY");
assert.equal(dailyReportPayload.exact_date_readback, null);

const fullMarketInstitutionalCall = new Request("https://taistock-mcp.example/my-mcp", {
  method:"POST",
  headers:{ "content-type":"application/json" },
  body:JSON.stringify({
    jsonrpc:"2.0",
    id:82,
    method:"tools/call",
    params:{ name:"get_official_market_institutional", arguments:{ date:"2026-10-05" } },
  }),
});
const fullMarketInstitutionalResponse = await tryCompat!(fullMarketInstitutionalCall, reportEnv);
assert.ok(fullMarketInstitutionalResponse);
const fullMarketInstitutionalRpc = await fullMarketInstitutionalResponse!.json() as any;
const fullMarketInstitutionalPayload = JSON.parse(String(fullMarketInstitutionalRpc.result.content[0].text));
assert.equal(fullMarketInstitutionalPayload.status, "READY");
assert.equal(fullMarketInstitutionalPayload.role, "CURRENT_EXACT_DATE_OFFICIAL_ON_DEMAND");
assert.equal(fullMarketInstitutionalPayload.current_selection_source, true);
assert.equal(fullMarketInstitutionalPayload.evidence_source, "DIRECT_TWSE_TPEX_EXACT_DATE_ON_DEMAND");
assert.equal(fullMarketInstitutionalPayload.data.source_date_verified, true);
assert.equal(fullMarketInstitutionalPayload.data.previous_day_substitution, false);
assert.equal(fullMarketInstitutionalPayload.exact_date_readback, null);

const fullMarketMarginCall = new Request("https://taistock-mcp.example/my-mcp", {
  method:"POST",
  headers:{ "content-type":"application/json" },
  body:JSON.stringify({
    jsonrpc:"2.0",
    id:83,
    method:"tools/call",
    params:{ name:"get_official_market_margin", arguments:{ date:"2026-10-05" } },
  }),
});
const fullMarketMarginResponse = await tryCompat!(fullMarketMarginCall, reportEnv);
assert.ok(fullMarketMarginResponse);
const fullMarketMarginRpc = await fullMarketMarginResponse!.json() as any;
const fullMarketMarginPayload = JSON.parse(String(fullMarketMarginRpc.result.content[0].text));
assert.equal(fullMarketMarginPayload.status, "READY");
assert.equal(fullMarketMarginPayload.role, "CURRENT_EXACT_DATE_OFFICIAL_ON_DEMAND");
assert.equal(fullMarketMarginPayload.current_selection_source, true);
assert.equal(fullMarketMarginPayload.data.source_date_verified, true);
assert.equal(fullMarketMarginPayload.data.previous_day_substitution, false);
assert.equal(fullMarketMarginPayload.data.rankings.margin_increase.length, 20);
assert.equal(fullMarketMarginPayload.data.rankings.short_decrease.length, 20);

globalThis.fetch = reportOriginalFetch;

const modernCall = new Request("https://taistock-mcp.example/my-mcp", {
  method:"POST",
  headers:{ "content-type":"application/json" },
  body:JSON.stringify({ jsonrpc:"2.0", id:80, method:"tools/call", params:{ name:"get_quote", arguments:{ symbol:"2330" } } }),
});
assert.equal(await tryCompat!(modernCall, {} as Env), null, "modern registered tools must bypass legacy interceptor");

const compatPath = path.join(root, "src/v6/diamond-fixed-facade-compat.ts");
const compatSource = fs.readFileSync(compatPath, "utf8");
assert.doesNotMatch(compatSource, /\bD1Database\b|env\.DB\b|\.prepare\(/, "fixed facade compat must not restore D1 app persistence");
assert.doesNotMatch(compatSource, /\bR2Bucket\b/, "fixed facade compat must not introduce R2 app persistence");
assert.match(compatSource, /method !== "tools\/call"/, "compatibility adapter must intercept only tools/call");
assert.match(compatSource, /getTwMarketChipSummaryOnDemand/, "frozen chip aliases must use the current on-demand facade");
assert.match(compatSource, /getTwFullMarketInstitutionalOnDemand/, "full-market institutional compatibility must call direct official exact-date readers");
assert.match(compatSource, /getTwFullMarketMarginOnDemand/, "full-market margin compatibility must call direct official exact-date readers");
assert.match(compatSource, /DIRECT_TWSE_TPEX_EXACT_DATE_ON_DEMAND/, "direct official sources must be the preferred current evidence");
assert.match(compatSource, /readGitHubJson/, "exact-date GitHub artifact may remain as readback fallback/audit context");
assert.match(compatSource, /GITHUB_EXACT_DATE_READBACK_FALLBACK/, "GitHub exact-date data must be labeled fallback/readback rather than current Gate");
assert.match(compatSource, /daily-report-inputs/, "canonical report-input namespace must remain available for exact-date readback");
assert.match(compatSource, /CURRENT_EXACT_DATE_OFFICIAL_ON_DEMAND/, "direct exact-date institutional evidence must be explicitly marked current official");
assert.doesNotMatch(compatSource, /getTwMarketChipSummaryPublished|tw-market-data-github-live/, "frozen chip aliases must not use Published/GitHub-live as current evidence");
assert.doesNotMatch(compatSource, /LEGACY_MARKET_CROSS_SECTION_HISTORY_ONLY/, "current full-market institutional/margin aliases must not be hardcoded to history-only");
assert.doesNotMatch(compatSource, /getTwMarketCrossSection/, "current full-market aliases must not depend on the legacy GitHub cross-section");

const bridgePath = path.join(root, "src/v6/legacy-owner-chip-tools.ts");
const bridgeSource = fs.readFileSync(bridgePath, "utf8");
assert.match(bridgeSource, /getTwBrokerProviderBundleOnDemand/);
assert.doesNotMatch(bridgeSource, /getTwBrokerRankedWindowBundleOnDemand/);
assert.match(bridgeSource, /getTwChipOnDemandSnapshot/);
assert.match(bridgeSource, /runFamilyCreditSblQueryFastPath/);
assert.match(bridgeSource, /resolved_as_of/);
assert.match(bridgeSource, /current_summary/);
assert.match(bridgeSource, /sold_shares/);
assert.match(bridgeSource, /HISTORY_CONTEXT_ONLY/);
assert.match(bridgeSource, /missing_branch_means_zero:\s*false/);
assert.match(bridgeSource, /previous_day_substitution:\s*false/);
assert.doesNotMatch(bridgeSource, /\bfinmind\s*\(|FINMIND_TOKEN|taiwan_stock_trading_daily_report/, "frozen Owner chip bridge must never execute the retired FinMind current-chip provider");

const ownerPath = path.join(root, "src/v6/owner-content-handler.ts");
const ownerSource = fs.readFileSync(ownerPath, "utf8");
assert.match(ownerSource, /LEGACY_OWNER_CHIP_OVERRIDE_TOOL_NAMES/);
assert.match(ownerSource, /registerLegacyOwnerChipTools\(this\.server, this\.env\)/);

console.log(JSON.stringify({
  schema:"DIAMOND_CHATGPT_FIXED_FACADE_TEST_V1",
  status:"PASS",
  frozen_tools:79,
  modern_owner_tools:123,
  static_resources:capturedResources.length,
  compatibility_intercepts:39,
  owner_chip_overrides:4,
  production_mutation:"NONE",
}, null, 2));