import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

declare global { interface Env { FUGLE_API_KEY: string; FINMIND_TOKEN: string } }
type Obj = Record<string, any>;
type Market = "listed" | "otc";

const FUGLE = "https://api.fugle.tw/marketdata/v1.0/stock";
const FINMIND = "https://api.finmindtrade.com/api/v4/data";
const BROKER = "https://api.finmindtrade.com/api/v4/taiwan_stock_trading_daily_report";
const TWSE_EVENTS = "https://openapi.twse.com.tw/v1/opendata/t187ap04_L";
const TPEX_EVENTS = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O";
const symbol = z.string().trim().min(1).max(20).regex(/^[0-9A-Za-z._-]+$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const ok = (x: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(x, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: `查詢失敗：${e instanceof Error ? e.message : String(e)}` }] });
const rec = (x: unknown): Obj => x && typeof x === "object" ? x as Obj : {};
const num = (x: unknown) => Number.isFinite(Number(x)) ? Number(x) : 0;
const arr = (x: unknown): any[] => Array.isArray(x) ? x : Array.isArray(rec(x).data) ? rec(x).data : [];
const recent = (x: any[], n: number) => x.length <= n ? x : x.slice(-n);

function twDate(daysAgo = 0) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - daysAgo * 86400000));
}

async function json(url: string | URL, init: RequestInit, source: string): Promise<any> {
  const r = await fetch(url, init); const text = await r.text(); let body: any = text;
  try { body = text ? JSON.parse(text) : null } catch {}
  if (!r.ok) throw new Error(`${source} HTTP ${r.status}: ${String(rec(body).message ?? rec(body).msg ?? rec(body).error ?? text.slice(0, 300))}`);
  return body;
}

async function fugle(env: Env, path: string, query: Obj = {}) {
  if (!env.FUGLE_API_KEY) throw new Error("FUGLE_API_KEY 尚未設定");
  const url = new URL(FUGLE + path); Object.entries(query).forEach(([k,v]) => v !== undefined && v !== "" && url.searchParams.set(k, String(v)));
  return json(url, { headers: { Accept: "application/json", "X-API-KEY": env.FUGLE_API_KEY } }, "富果");
}

async function finmind(env: Env, dataset: string, params: Obj) {
  if (!env.FINMIND_TOKEN) throw new Error("FINMIND_TOKEN 尚未設定");
  const url = new URL(FINMIND); url.searchParams.set("dataset", dataset); Object.entries(params).forEach(([k,v]) => v !== undefined && v !== "" && url.searchParams.set(k, String(v)));
  const body = await json(url, { headers: { Accept: "application/json", Authorization: `Bearer ${env.FINMIND_TOKEN}` } }, "FinMind");
  if (!Array.isArray(body.data)) throw new Error(`FinMind 回傳缺少 data：${String(body.msg ?? body.message ?? "unknown")}`);
  return body;
}

async function broker(env: Env, stock: string, day: string) {
  const url = new URL(BROKER); url.searchParams.set("data_id", stock); url.searchParams.set("date", day);
  const body = await json(url, { headers: { Accept: "application/json", Authorization: `Bearer ${env.FINMIND_TOKEN}` } }, "FinMind 分點");
  if (!Array.isArray(body.data)) throw new Error("FinMind 分點回傳缺少 data"); return body.data as any[];
}

const pick = (o: Obj, keys: string[]) => { for (const k of keys) if (o[k] != null && String(o[k]).trim()) return String(o[k]).trim(); return "" };
function normalizeEvent(x: unknown, market: Market) { const o = rec(x); return {
  market,
  company_code: pick(o,["公司代號","公司代碼","SecuritiesCompanyCode","stock_id"]), company_name: pick(o,["公司名稱","CompanyName","stock_name"]),
  report_date: pick(o,["出表日期","資料日期","date"]), publish_date: pick(o,["發言日期","申報日期","publish_date"]), publish_time: pick(o,["發言時間","申報時間","publish_time"]),
  subject: pick(o,["主旨","Subject","title"]), clause: pick(o,["符合條款","條款","clause"]), event_date: pick(o,["事實發生日","event_date"]), description: pick(o,["說明","Description","content"]), raw:o
} }
async function events(market: Market) { const url = market === "listed" ? TWSE_EVENTS : TPEX_EVENTS; return arr(await json(url,{headers:{Accept:"application/json"}},market === "listed" ? "證交所重大訊息" : "櫃買重大訊息")).map(x=>normalizeEvent(x,market)) }
async function eventsFor(stock: string, market: "auto"|Market, limit=30) {
  const markets: Market[] = market === "auto" ? ["listed","otc"] : [market]; const settled = await Promise.allSettled(markets.map(events)); const rows:any[]=[]; const errors:string[]=[];
  settled.forEach(r=>r.status === "fulfilled" ? rows.push(...r.value) : errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason)));
  return { markets, errors, rows: rows.filter(x=>x.company_code===stock).slice(0,limit) };
}

export class MyMCP extends McpAgent<Env> {
  server = new McpServer({ name: "Taiwan Stock AI", version: "3.1.0" });
  async init() {
    this.server.registerTool("get_quote", { description:"富果台股即時報價、量與五檔。", inputSchema:{symbol,type:z.enum(["normal","oddlot"]).optional().default("normal")} }, async ({symbol,type})=>{try{return ok({source:"Fugle",retrieved_at:new Date().toISOString(),data:await fugle(this.env,`/intraday/quote/${encodeURIComponent(symbol)}`,{type:type==="oddlot"?"oddlot":undefined})})}catch(e){return fail(e)}});

    this.server.registerTool("get_intraday_candles", { description:"富果台股當日日內分K。", inputSchema:{symbol,timeframe:z.enum(["1","3","5","10","15","30","60"]).optional().default("5"),sort:z.enum(["asc","desc"]).optional().default("asc"),type:z.enum(["normal","oddlot"]).optional().default("normal"),last_n:z.number().int().min(1).max(500).optional().default(100)} }, async ({symbol,timeframe,sort,type,last_n})=>{try{const raw=rec(await fugle(this.env,`/intraday/candles/${encodeURIComponent(symbol)}`,{timeframe,sort,type:type==="oddlot"?"oddlot":undefined}));const data=Array.isArray(raw.data)?raw.data:[];return ok({source:"Fugle",...raw,data:sort==="desc"?data.slice(0,last_n):data.slice(-last_n)})}catch(e){return fail(e)}});

    this.server.registerTool("get_daily_price", { description:"FinMind台股日K。", inputSchema:{symbol,start_date:date.optional(),end_date:date.optional(),limit:z.number().int().min(1).max(500).optional().default(120)} }, async ({symbol,start_date,end_date,limit})=>{try{const s=start_date??twDate(180),e=end_date??twDate();if(s>e)throw new Error("start_date 不可晚於 end_date");const r=await finmind(this.env,"TaiwanStockPrice",{data_id:symbol,start_date:s,end_date:e});return ok({source:"FinMind",dataset:"TaiwanStockPrice",symbol,start_date:s,end_date:e,data:recent(r.data,limit)})}catch(e){return fail(e)}});

    this.server.registerTool("get_institutional", { description:"FinMind個股三大法人買賣。", inputSchema:{symbol,start_date:date.optional(),end_date:date.optional(),limit_days:z.number().int().min(1).max(120).optional().default(20)} }, async ({symbol,start_date,end_date,limit_days})=>{try{const s=start_date??twDate(45),e=end_date??twDate();const r=await finmind(this.env,"TaiwanStockInstitutionalInvestorsBuySell",{data_id:symbol,start_date:s,end_date:e});const rows=r.data.map((x:any)=>({...x,net:num(x.buy)-num(x.sell)}));const ds=[...new Set(rows.map((x:any)=>String(x.date??"")))].filter(Boolean).sort().slice(-limit_days);return ok({source:"FinMind",symbol,data:rows.filter((x:any)=>ds.includes(String(x.date??"")))})}catch(e){return fail(e)}});

    this.server.registerTool("get_margin", { description:"FinMind融資融券。", inputSchema:{symbol,start_date:date.optional(),end_date:date.optional(),limit:z.number().int().min(1).max(250).optional().default(30)} }, async ({symbol,start_date,end_date,limit})=>{try{const s=start_date??twDate(60),e=end_date??twDate();const r=await finmind(this.env,"TaiwanStockMarginPurchaseShortSale",{data_id:symbol,start_date:s,end_date:e});const rows=r.data.map((x:any)=>({...x,margin_balance_change:num(x.MarginPurchaseTodayBalance)-num(x.MarginPurchaseYesterdayBalance),short_balance_change:num(x.ShortSaleTodayBalance)-num(x.ShortSaleYesterdayBalance)}));return ok({source:"FinMind",symbol,data:recent(rows,limit)})}catch(e){return fail(e)}});

    this.server.registerTool("get_broker_chips", { description:"FinMind單日券商分點淨買賣；需要對應權限。", inputSchema:{symbol,date,top_n:z.number().int().min(1).max(50).optional().default(20)} }, async ({symbol,date,top_n})=>{try{const rows=await broker(this.env,symbol,date);const m=new Map<string,any>();for(const x of rows){const id=String(x.securities_trader_id??"unknown"),name=String(x.securities_trader??id),k=`${id}|${name}`,v=m.get(k)??{id,name,buy:0,sell:0,bv:0,sv:0};const p=num(x.price),b=num(x.buy),s=num(x.sell);v.buy+=b;v.sell+=s;v.bv+=p*b;v.sv+=p*s;m.set(k,v)}const sum=[...m.values()].map(v=>({securities_trader_id:v.id,securities_trader:v.name,buy_shares:v.buy,sell_shares:v.sell,net_shares:v.buy-v.sell,net_lots:Number(((v.buy-v.sell)/1000).toFixed(2)),avg_buy_price:v.buy?Number((v.bv/v.buy).toFixed(4)):null,avg_sell_price:v.sell?Number((v.sv/v.sell).toFixed(4)):null}));return ok({source:"FinMind",symbol,date,top_net_buyers:sum.filter(x=>x.net_shares>0).sort((a,b)=>b.net_shares-a.net_shares).slice(0,top_n),top_net_sellers:sum.filter(x=>x.net_shares<0).sort((a,b)=>a.net_shares-b.net_shares).slice(0,top_n)})}catch(e){return fail(e)}});

    this.server.registerTool("get_stock_news", { description:"FinMind指定個股單日新聞。", inputSchema:{symbol,date:date.optional(),limit:z.number().int().min(1).max(100).optional().default(30)} }, async ({symbol,date,limit})=>{try{const d=date??twDate();const r=await finmind(this.env,"TaiwanStockNews",{data_id:symbol,start_date:d});return ok({source:"FinMind",dataset:"TaiwanStockNews",symbol,date:d,data:r.data.slice(0,limit).map((x:any)=>({date:x.date,stock_id:x.stock_id,title:x.title,source:x.source,link:x.link,description:x.description}))})}catch(e){return fail(e)}});

    this.server.registerTool("get_material_events", { description:"證交所/櫃買中心官方每日重大訊息。", inputSchema:{symbol,market:z.enum(["auto","listed","otc"]).optional().default("auto"),limit:z.number().int().min(1).max(100).optional().default(30)} }, async ({symbol,market,limit})=>{try{const r=await eventsFor(symbol,market,limit);return ok({source:"TWSE/TPEx OpenAPI",symbol,markets_checked:r.markets,partial_errors:r.errors,data:r.rows})}catch(e){return fail(e)}});

    this.server.registerTool("explain_price_move", { description:"彙整即時報價、5分K、日K、新聞與重大訊息，供模型判斷異動原因；不宣稱已證明因果。", inputSchema:{symbol,date:date.optional(),market:z.enum(["auto","listed","otc"]).optional().default("auto")} }, async ({symbol,date,market})=>{try{const d=date??twDate();const [q,c,p,n,ev]=await Promise.allSettled([fugle(this.env,`/intraday/quote/${encodeURIComponent(symbol)}`),fugle(this.env,`/intraday/candles/${encodeURIComponent(symbol)}`,{timeframe:"5",sort:"asc"}),finmind(this.env,"TaiwanStockPrice",{data_id:symbol,start_date:twDate(30),end_date:d}),finmind(this.env,"TaiwanStockNews",{data_id:symbol,start_date:d}),eventsFor(symbol,market,30)]);const errors:string[]=[];for(const r of [q,c,p,n,ev])if(r.status==="rejected")errors.push(r.reason instanceof Error?r.reason.message:String(r.reason));const cr=c.status==="fulfilled"?rec(c.value):{};const er=ev.status==="fulfilled"?ev.value:null;if(er)errors.push(...er.errors);return ok({symbol,date:d,retrieved_at:new Date().toISOString(),caution:"同時出現不等於已證明因果關係。",quote:q.status==="fulfilled"?q.value:null,intraday_5m_candles:Array.isArray(cr.data)?cr.data.slice(-60):[],recent_daily_prices:p.status==="fulfilled"?recent(p.value.data,20):[],stock_news:n.status==="fulfilled"?n.value.data.slice(0,30):[],material_events:er?.rows??[],partial_errors:errors})}catch(e){return fail(e)}});
  }
}

export default { fetch(request: Request, env: Env, ctx: ExecutionContext) { const u=new URL(request.url); if(u.pathname==="/mcp")return MyMCP.serve("/mcp").fetch(request,env,ctx); if(u.pathname==="/"||u.pathname==="/health")return Response.json({service:"Taiwan Stock AI MCP",status:"ok",version:"3.1.0",mcp_endpoint:"/mcp",tools:9}); return new Response("Not found",{status:404}) } };
