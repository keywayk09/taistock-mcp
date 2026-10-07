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

const rankingGroup = Array.from({ length:10 }, (_, i) => ({
  rank:i + 1,
  symbol:String(1001 + i),
  name:`R${i + 1}`,
  market:i % 2 === 0 ? "listed" : "otc",
  net_shares:10000 - i,
  net_lots:(10000 - i) / 1000,
}));
const exactDateArtifact = {
  schema:"TW_OFFICIAL_INSTITUTIONAL_RANKINGS_V2",
  status:"READY",
  trade_date:"2026-10-05",
  source_date_verified:true,
  markets:["listed", "otc"],
  etf_excluded:true,
  ranking_unit:"張",
  previous_day_substitution:false,
  read_only:true,
  coverage:{ listed_rows:1080, otc_rows:795, total_rows:1875 },
  sources:{ listed:"TWSE_T86_ALLBUT0999", otc:"TPEX_3INSTI_DAILY_TRADING" },
  rankings:{
    foreign_buy:rankingGroup,
    foreign_sell:rankingGroup,
    trust_buy:rankingGroup,
    trust_sell:rankingGroup,
  },
};
const reportEnv = {
  __GITHUB_DATA_MEMORY:new Map([
    ["data/daily-report-inputs/2026/10/05/official-rankings.json", {
      sha:"fixture-official-rankings",
      text:JSON.stringify(exactDateArtifact),
    }],
  ]),
} as any as Env;

const listedSymbols = Array.from({ length:500 }, (_, i) => String(1000 + i));
const otcSymbols = Array.from({ length:300 }, (_, i) => String(6000 + i));
const twseInstitutional = {
  date:"20261005",
  fields:["證券代號", "證券名稱", "外陸資買賣超股數(不含外資自營商)", "投信買賣超股數", "自營商買賣超股數", "三大法人買賣超股數"],
  data:listedSymbols.map((symbol, i) => {
    const foreign=(i % 2 === 0 ? 1 : -1) * (100000 + i);
    const trust=(i % 2 === 0 ? -1 : 1) * (50000 + i);
    return [symbol, "L" + symbol, String(foreign), String(trust), "0", String(foreign + trust)];
  }),
};
const tpexInstitutional = otcSymbols.map((symbol, i) => {
  const foreign=(i % 2 === 0 ? 1 : -1) * (90000 + i);
  const trust=(i % 2 === 0 ? -1 : 1) * (40000 + i);
  return {
    Date:"2026-10-05",
    SecuritiesCompanyCode:symbol,
    CompanyName:"O" + symbol,
    "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference":String(foreign),
    "Securities Investment Trust Companies-Difference":String(trust),
    "Dealers-Difference":"0",
    "Total Difference":String(foreign + trust),
  };
});
const twseMargin = {
  date:"20261005",
  tables:[{
    title:"115年10月05日 融資融券彙總 (全部)",
    fields:[
      "代號", "名稱",
      "買進", "賣出", "現金償還", "前日餘額", "今日餘額", "次一營業日限額",
      "買進", "賣出", "現券償還", "前日餘額", "今日餘額", "次一營業日限額",
      "資券互抵", "註記",
    ],
    data:listedSymbols.map((symbol, i) => {
      const marginPrev=1000 + i;
      const marginNow=marginPrev + (i % 2 === 0 ? 20 : -10);
      const shortPrev=100 + i;
      const shortNow=shortPrev + (i % 3 === 0 ? 5 : -2);
      return [symbol, "L" + symbol, "10", "5", "0", String(marginPrev), String(marginNow), "999999", "1", "2", "0", String(shortPrev), String(shortNow), "999999", "0", ""];
    }),
  }],
};
const tpexMargin = otcSymbols.map((symbol, i) => {
  const marginPrev=800 + i;
  const marginNow=marginPrev + (i % 2 === 0 ? 15 : -8);
  const shortPrev=80 + i;
  const shortNow=shortPrev + (i % 3 === 0 ? 4 : -1);
  return {
    Date:"2026-10-05",
    SecuritiesCompanyCode:symbol,
    CompanyName:"O" + symbol,
    MarginPurchaseYesterdayBalance:String(marginPrev),
    MarginPurchaseTodayBalance:String(marginNow),
    ShortSaleYesterdayBalance:String(shortPrev),
    ShortSaleTodayBalance:String(shortNow),
  };
});

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input:RequestInfo | URL) => {
  const url=String(input);
  if(url.includes("/fund/T86")) return new Response(JSON.stringify(twseInstitutional), { status:200, headers:{ "content-type":"application/json" } });
  if(url.includes("/openapi/v1/tpex_3insti_daily_trading")) return new Response(JSON.stringify(tpexInstitutional), { status:200, headers:{ "content-type":"application/json" } });
  if(url.includes("/marginTrading/MI_MARGN")) return new Response(JSON.stringify(twseMargin), { status:200, headers:{ "content-type":"application/json" } });
  if(url.includes("/openapi/v1/tpex_mainboard_margin_balance")) return new Response(JSON.stringify(tpexMargin), { status:200, headers:{ "content-type":"application/json" } });
  throw new Error("unexpected_direct_market_fetch:" + url);
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
assert.equal(dailyReportPayload.role, "CURRENT_EXACT_DATE_OFFICIAL");
assert.equal(dailyReportPayload.trade_date, "2026-10-05");
assert.equal(dailyReportPayload.current_selection_source, true);
assert.equal(dailyReportPayload.source_mode, "OFFICIAL_EXACT_DATE_ON_DEMAND");
assert.equal(dailyReportPayload.persistence, "NONE");
assert.equal(dailyReportPayload.previous_day_substitution, false);
assert.equal(dailyReportPayload.data.coverage.total_rows, 800);
assert.equal(dailyReportPayload.data.persistence, "NONE");
assert.equal(dailyReportPayload.data.rankings.foreign_buy.length, 10);

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
assert.equal(fullMarketInstitutionalPayload.role, "CURRENT_EXACT_DATE_OFFICIAL");
assert.equal(fullMarketInstitutionalPayload.current_selection_source, true);
assert.equal(fullMarketInstitutionalPayload.source_mode, "OFFICIAL_EXACT_DATE_ON_DEMAND");
assert.equal(fullMarketInstitutionalPayload.persistence, "NONE");
assert.equal(fullMarketInstitutionalPayload.data.source_date_verified, true);
assert.equal(fullMarketInstitutionalPayload.data.previous_day_substitution, false);
assert.equal(fullMarketInstitutionalPayload.data.coverage.total_rows, 800);

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
assert.equal(fullMarketMarginPayload.role, "CURRENT_EXACT_DATE_OFFICIAL");
assert.equal(fullMarketMarginPayload.current_selection_source, true);
assert.equal(fullMarketMarginPayload.source_mode, "OFFICIAL_EXACT_DATE_ON_DEMAND");
assert.equal(fullMarketMarginPayload.previous_day_substitution, false);
assert.equal(fullMarketMarginPayload.data.schema, "TW_OFFICIAL_MARGIN_CROSS_SECTION_V1");
assert.equal(fullMarketMarginPayload.data.source_date_verified, true);
assert.equal(fullMarketMarginPayload.data.coverage.total_rows, 800);
assert.equal(fullMarketMarginPayload.data.rankings.margin_increase.length, 10);
assert.equal(fullMarketMarginPayload.data.rankings.short_increase.length, 10);

globalThis.fetch = originalFetch;

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
assert.match(compatSource, /getTwOfficialMarketInstitutionalOnDemand/, "full-market institutional compatibility must prefer direct exact-date official reads");
assert.match(compatSource, /getTwOfficialMarketMarginOnDemand/, "full-market margin compatibility must provide direct exact-date official reads");
assert.match(compatSource, /readGitHubJson/, "GitHub exact-date institutional artifact must remain available as backup persistence");
assert.match(compatSource, /daily-report-inputs/, "full-market daily compatibility must use the dedicated report-input namespace");
assert.match(compatSource, /CURRENT_EXACT_DATE_OFFICIAL/, "current exact-date institutional artifacts must be explicitly marked as current official evidence");
assert.doesNotMatch(compatSource, /getTwMarketChipSummaryPublished|tw-market-data-github-live/, "frozen chip aliases must not use Published/GitHub-live as current evidence");
assert.match(compatSource, /LEGACY_MARKET_CROSS_SECTION_HISTORY_ONLY/, "legacy cross-section must remain history-only when direct exact-date evidence is unavailable");

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