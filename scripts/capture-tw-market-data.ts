import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  normalizeTpexInstitutional,
  normalizeTpexMargin,
  normalizeTpexSblShortSale,
  normalizeTradeDate,
  normalizeTwseInstitutional,
  normalizeTwseSecuritiesLending,
  normalizeTwseSblShortSale,
  type TwMarketDataKind,
} from "../src/v6/tw-market-data.ts";
import { normalizeTwseMiMargnOfficial } from "../src/v6/twse-mi-margin-official.ts";

const VERSION = "diamond-tw-market-data/v2.0.0-github";
const OUT = process.env.DIAMOND_DATA_ROOT || process.argv[process.argv.indexOf("--out") + 1] || ".";
const requested = process.env.TRADE_DATE || process.argv[process.argv.indexOf("--date") + 1] || "auto";

function taipeiParts() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Taipei", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", hourCycle:"h23" }).formatToParts(new Date());
  return Object.fromEntries(parts.map((x)=>[x.type,x.value]));
}
function autoDate() {
  const p = taipeiParts();
  const date = `${p.year}-${p.month}-${p.day}`;
  if (Number(p.hour) >= 18) return date;
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate()-1); return d.toISOString().slice(0,10);
}
const tradeDate = requested === "auto" ? autoDate() : requested;
if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) throw new Error(`invalid trade date: ${tradeDate}`);

const compact = tradeDate.replaceAll("-", "");
const [year, month, day] = tradeDate.split("-");
const capturedAt = new Date().toISOString();

function stableValue(value: any): any {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((k)=>[k,stableValue(value[k])]));
  if (value === undefined) return null;
  return value;
}
function stableJson(value:any) { return JSON.stringify(stableValue(value), null, 2) + "\n"; }
function sha(value:any) { return crypto.createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex"); }
function writeJson(relative:string,value:any) {
  const file=path.join(OUT,relative); fs.mkdirSync(path.dirname(file),{recursive:true});
  const text=stableJson(value);
  if (!fs.existsSync(file) || fs.readFileSync(file,"utf8")!==text) fs.writeFileSync(file,text);
  return relative;
}
function sourceDate(body:any) {
  const direct=normalizeTradeDate(body?.date ?? body?.Date ?? body?.["資料日期"] ?? body?.["日期"]);
  if(direct)return direct;
  const rows=Array.isArray(body)?body:Array.isArray(body?.data)?body.data:[];
  for(const row of rows){const d=normalizeTradeDate(row?.Date??row?.date??row?.["資料日期"]??row?.["日期"]??row?.TradeDate);if(d)return d;}
  return null;
}
async function getJson(url:string,label:string) {
  const response=await fetch(url,{headers:{Accept:"application/json,text/plain,*/*","User-Agent":"Diamond-GitHub-Archive/2.0"}});
  const text=await response.text();
  if(!response.ok)throw new Error(`${label}_http_${response.status}:${text.slice(0,200)}`);
  try{return JSON.parse(text);}catch{throw new Error(`${label}_invalid_json:${text.slice(0,200)}`);}
}
function rawCapture(source:string,body:any) {
  const h=sha(body);
  const relative=`data/market-data/raw/${year}/${month}/${day}/${source.toLowerCase()}-${h}.json`;
  writeJson(relative,{schema_version:"diamond-official-raw-capture/v1",trade_date:tradeDate,source,content_sha256:h,body});
  return {path:relative,sha256:h};
}

type Layer = { kind:TwMarketDataKind; market:"listed"|"otc"; source:string; rows:any[]; raw_paths:string[] };
const layers:Layer[]=[];
const errors:Record<string,string>={};
async function capture(label:string, fn:()=>Promise<void>){try{await fn();}catch(e){errors[label]=e instanceof Error?e.message:String(e);}}

await capture("institutional-listed",async()=>{
  const body=await getJson(`https://www.twse.com.tw/rwd/zh/fund/T86?date=${compact}&selectType=ALLBUT0999&response=json`,"TWSE_T86");
  const raw=rawCapture("TWSE_T86",body); const d=sourceDate(body); if(d!==tradeDate)throw new Error(`source_date_mismatch:${d}`);
  layers.push({kind:"institutional",market:"listed",source:"TWSE_T86",rows:normalizeTwseInstitutional(body,tradeDate),raw_paths:[raw.path]});
});
await capture("institutional-otc",async()=>{
  const body=await getJson("https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading","TPEX_3INSTI");
  const raw=rawCapture("TPEX_3INSTI_DAILY_TRADING",body); const d=sourceDate(body); if(d!==tradeDate)throw new Error(`source_date_mismatch:${d}`);
  layers.push({kind:"institutional",market:"otc",source:"TPEX_3INSTI_DAILY_TRADING",rows:normalizeTpexInstitutional(body,tradeDate),raw_paths:[raw.path]});
});
await capture("margin-listed",async()=>{
  const body=await getJson(`https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${compact}&selectType=ALL&response=json`,"TWSE_MI_MARGN");
  const raw=rawCapture("TWSE_MI_MARGN",body); const d=sourceDate(body); if(d!==tradeDate)throw new Error(`source_date_mismatch:${d}`);
  layers.push({kind:"margin",market:"listed",source:"TWSE_MI_MARGN",rows:normalizeTwseMiMargnOfficial(body,tradeDate),raw_paths:[raw.path]});
});
await capture("margin-otc",async()=>{
  const body=await getJson("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance","TPEX_MARGIN");
  const raw=rawCapture("TPEX_MAINBOARD_MARGIN_BALANCE",body); const d=sourceDate(body); if(d!==tradeDate)throw new Error(`source_date_mismatch:${d}`);
  layers.push({kind:"margin",market:"otc",source:"TPEX_MAINBOARD_MARGIN_BALANCE",rows:normalizeTpexMargin(body,tradeDate),raw_paths:[raw.path]});
});

await capture("securities-lending",async()=>{
  const body=await getJson(`https://www.twse.com.tw/exchangeReport/TWT72U?date=${compact}&selectType=SLBNLB&response=json`,"TWSE_TWT72U");
  const raw=rawCapture("TWSE_TWT72U",body); const d=sourceDate(body); if(d!==tradeDate)throw new Error(`source_date_mismatch:${d}`);
  const rows=normalizeTwseSecuritiesLending(body,tradeDate);
  for(const market of ["listed","otc"] as const){
    const marketRows=rows.filter((x)=>x.market===market);
    if(marketRows.length)layers.push({kind:"securities_lending",market,source:"TWSE_TWT72U",rows:marketRows,raw_paths:[raw.path]});
    else errors[`securities_lending-${market}`]="official_rows_empty";
  }
});

await capture("sbl-short-sale-listed",async()=>{
  const body=await getJson(`https://www.twse.com.tw/rwd/zh/marginTrading/TWT93U?date=${compact}&response=json`,"TWSE_TWT93U");
  const raw=rawCapture("TWSE_TWT93U",body); const d=sourceDate(body); if(d!==tradeDate)throw new Error(`source_date_mismatch:${d}`);
  layers.push({kind:"sbl_short_sale",market:"listed",source:"TWSE_TWT93U",rows:normalizeTwseSblShortSale(body,tradeDate),raw_paths:[raw.path]});
});
await capture("sbl-short-sale-otc",async()=>{
  const [balance,volume]=await Promise.all([
    getJson("https://www.tpex.org.tw/openapi/v1/tpex_margin_sbl","TPEX_MARGIN_SBL"),
    getJson("https://www.tpex.org.tw/openapi/v1/tpex_short_sell","TPEX_SHORT_SELL"),
  ]);
  const rawA=rawCapture("TPEX_MARGIN_SBL",balance),rawB=rawCapture("TPEX_SHORT_SELL",volume);
  const d=sourceDate(balance); if(d!==tradeDate)throw new Error(`source_date_mismatch:${d}`);
  layers.push({kind:"sbl_short_sale",market:"otc",source:"TPEX_MARGIN_SBL+TPEX_SHORT_SELL",rows:normalizeTpexSblShortSale(balance,volume,tradeDate),raw_paths:[rawA.path,rawB.path]});
});

const expected:Array<[TwMarketDataKind,"listed"|"otc"]>=[
  ["institutional","listed"],["institutional","otc"],["margin","listed"],["margin","otc"],
  ["securities_lending","listed"],["securities_lending","otc"],["sbl_short_sale","listed"],["sbl_short_sale","otc"],
];

const manifestLayers:any[]=[];
for(const [kind,market] of expected){
  const layer=layers.find((x)=>x.kind===kind&&x.market===market);
  if(!layer||!layer.rows.length){
    manifestLayers.push({kind,market,status:"MISSING",source:layer?.source??null,row_count:0,dataset_version:null,content_sha256:null,snapshot_path:null,raw_paths:layer?.raw_paths??[],captured_at:capturedAt,error:errors[`${kind}-${market}`]??errors[`${kind.replaceAll("_","-")}-${market}`]??null});
    continue;
  }
  layer.rows.sort((a,b)=>String(a.symbol).localeCompare(String(b.symbol)));
  const canonical={schema_version:VERSION,trade_date:tradeDate,market,kind,source:layer.source,source_date_verified:true,rows:layer.rows};
  const contentSha=sha(canonical); const datasetVersion=`sha256:${contentSha}`;
  const snapshotPath=`data/market-data/daily/${year}/${month}/${day}/snapshots/${kind}-${market}/${contentSha}.json`;
  writeJson(snapshotPath,{...canonical,content_sha256:contentSha,dataset_version:datasetVersion});
  manifestLayers.push({kind,market,status:"READY",source:layer.source,row_count:layer.rows.length,dataset_version:datasetVersion,content_sha256:contentSha,snapshot_path:snapshotPath,raw_paths:layer.raw_paths,captured_at:capturedAt,error:null});
}

const byPrefix=new Map<string,any>();
for(const layer of layers){
  for(const row of layer.rows){
    if(!/^\d{4,6}$/.test(String(row.symbol)))continue;
    const prefix=String(row.symbol).slice(0,2);
    if(!byPrefix.has(prefix)){
      const shardFile=path.join(OUT,`data/market-data/index/${year}/${month}/${prefix}.json`);
      let existing:any={schema_version:"diamond-market-data-symbol-shard/v2",month:`${year}-${month}`,prefix,symbols:{},updated_at:""};
      if(fs.existsSync(shardFile)){try{existing=JSON.parse(fs.readFileSync(shardFile,"utf8"));}catch{}}
      byPrefix.set(prefix,existing);
    }
    const shard=byPrefix.get(prefix); const symbol=String(row.symbol);
    shard.symbols[symbol]??={}; const list:any[]=Array.isArray(shard.symbols[symbol][layer.kind])?shard.symbols[symbol][layer.kind]:[];
    shard.symbols[symbol][layer.kind]=[...list.filter((x)=>x.trade_date!==tradeDate),row].sort((a,b)=>String(a.trade_date).localeCompare(String(b.trade_date)));
  }
}
for(const [prefix,shard] of byPrefix){shard.updated_at=capturedAt;writeJson(`data/market-data/index/${year}/${month}/${prefix}.json`,shard);}

const manifest={schema_version:"diamond-market-data-manifest/v2",trade_date:tradeDate,storage:"GITHUB_ONLY",layers:manifestLayers,updated_at:capturedAt};
writeJson(`data/market-data/daily/${year}/${month}/${day}/manifest.json`,manifest);
const ready=manifestLayers.filter((x)=>x.status==="READY").length;
console.log(JSON.stringify({trade_date:tradeDate,storage:"GITHUB_ONLY",ready_count:ready,total_count:expected.length,layers:manifestLayers.map((x)=>({kind:x.kind,market:x.market,status:x.status,rows:x.row_count,source:x.source,error:x.error}))},null,2));
if(ready<expected.length)process.exitCode=2;
