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
import {
  EXPECTED_MARKET_DATA_LAYERS,
  classifyTradingDay,
  dueLayerKeys,
  makePendingLayer,
  marketLayerKey,
  mergeReadyMonotonic,
  parseTwseHolidayCsv,
  summarizeDay,
  type MarketManifestLayer,
  type TradingCalendarEntry,
  type TradingDayOverride,
} from "../src/v6/market-data-incremental-controller.ts";

const VERSION = "diamond-tw-market-data/v2.1.0-incremental";
const OUT = process.env.DIAMOND_DATA_ROOT || process.argv[process.argv.indexOf("--out") + 1] || ".";
const requested = process.env.TRADE_DATE || process.argv[process.argv.indexOf("--date") + 1] || "auto";
const FINAL_AUDIT = ["1", "true", "yes"].includes(String(process.env.MARKET_DATA_FINAL_AUDIT || "").toLowerCase());

function taipeiParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Taipei", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).formatToParts(now);
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
function absolute(relative:string) { return path.join(OUT,relative); }
function writeJson(relative:string,value:any) {
  const file=absolute(relative); fs.mkdirSync(path.dirname(file),{recursive:true});
  const text=stableJson(value);
  if (!fs.existsSync(file) || fs.readFileSync(file,"utf8")!==text) fs.writeFileSync(file,text);
  return relative;
}
function readJson<T>(relative:string):T|null {
  const file=absolute(relative); if(!fs.existsSync(file))return null;
  try{return JSON.parse(fs.readFileSync(file,"utf8")) as T;}catch{return null;}
}
function sourceDate(body:any) {
  const direct=normalizeTradeDate(body?.date ?? body?.Date ?? body?.["資料日期"] ?? body?.["日期"]);
  if(direct)return direct;
  const rows=Array.isArray(body)?body:Array.isArray(body?.data)?body.data:[];
  for(const row of rows){const d=normalizeTradeDate(row?.Date??row?.date??row?.["資料日期"]??row?.["日期"]??row?.TradeDate);if(d)return d;}
  return null;
}
async function getJson(url:string,label:string) {
  const response=await fetch(url,{headers:{Accept:"application/json,text/plain,*/*","User-Agent":"Diamond-GitHub-Archive/2.1"}});
  const text=await response.text();
  if(!response.ok)throw new Error(`${label}_http_${response.status}:${text.slice(0,200)}`);
  try{return JSON.parse(text);}catch{throw new Error(`${label}_invalid_json:${text.slice(0,200)}`);}
}
async function getText(url:string,label:string) {
  const response=await fetch(url,{headers:{Accept:"text/csv,text/plain,*/*","User-Agent":"Diamond-GitHub-Archive/2.1"}});
  const text=await response.text();
  if(!response.ok)throw new Error(`${label}_http_${response.status}:${text.slice(0,200)}`);
  return text;
}
function rawCapture(source:string,body:any) {
  const h=sha(body);
  const relative=`data/market-data/raw/${year}/${month}/${day}/${source.toLowerCase()}-${h}.json`;
  writeJson(relative,{schema_version:"diamond-official-raw-capture/v1",trade_date:tradeDate,source,content_sha256:h,body});
  return {path:relative,sha256:h};
}

const manifestPath=`data/market-data/daily/${year}/${month}/${day}/manifest.json`;
type ExistingManifest={layers?:MarketManifestLayer[];day_status?:string;terminal?:boolean;[key:string]:any};
const existingManifest=readJson<ExistingManifest>(manifestPath);

const calendarPath=`data/market-calendar/${year}.json`;
const existingCalendar=readJson<{entries?:TradingCalendarEntry[]}>(calendarPath);
let calendarEntries:Array<TradingCalendarEntry>=Array.isArray(existingCalendar?.entries)?existingCalendar!.entries!:[];
let calendarVerified=calendarEntries.length>0;
let calendarError:string|null=null;
const currentTaipeiYear=String(taipeiParts().year || "");
if(year===currentTaipeiYear){
  try{
    const csv=await getText("https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=csv","TWSE_HOLIDAY_SCHEDULE");
    const parsed=parseTwseHolidayCsv(csv);
    if(parsed.length){
      calendarEntries=parsed; calendarVerified=true;
      writeJson(calendarPath,{schema_version:"diamond-market-calendar/v1",year,source:"TWSE_HOLIDAY_SCHEDULE_CSV",entries:parsed});
    } else calendarError="holiday_schedule_empty";
  }catch(error){calendarError=error instanceof Error?error.message:String(error);}
}
const overridePath=`data/market-calendar/overrides/${year}/${month}/${day}.json`;
const override=readJson<TradingDayOverride>(overridePath);
const gate=classifyTradingDay({tradeDate,calendarEntries,calendarVerified,override});

if(gate.terminal){
  const manifest={
    schema_version:"diamond-market-data-manifest/v2",trade_date:tradeDate,storage:"GITHUB_ONLY",
    day_status:"NO_TRADING_DAY",terminal:true,expected_layers:0,ready_layers:0,missing_layers:[],
    trading_day_gate:gate,calendar_path:calendarVerified?calendarPath:null,calendar_error:calendarError,
    layers:[],updated_at:capturedAt,
  };
  writeJson(manifestPath,manifest);
  console.log(JSON.stringify({trade_date:tradeDate,storage:"GITHUB_ONLY",day_status:"NO_TRADING_DAY",terminal:true,trading_day_gate:gate},null,2));
  process.exit(0);
}

if(existingManifest?.terminal===true && existingManifest?.day_status==="COMPLETE"){
  console.log(JSON.stringify({trade_date:tradeDate,storage:"GITHUB_ONLY",day_status:"COMPLETE",terminal:true,status:"NOOP_ALREADY_COMPLETE"},null,2));
  process.exit(0);
}

const existingByKey=new Map((existingManifest?.layers||[]).map((layer)=>[marketLayerKey(layer),layer]));
const due=new Set(dueLayerKeys(existingManifest?.layers,capturedAt));

type Layer = { kind:TwMarketDataKind; market:"listed"|"otc"; source:string; rows:any[]; raw_paths:string[] };
const observedReady=new Map<string,Layer>();
const observedFailure=new Map<string,{source:string|null;error:string;status:"PENDING"|"ERROR"}>();
function isDue(kind:TwMarketDataKind,market:"listed"|"otc"){return due.has(`${kind}-${market}`);}
function markFailure(kind:TwMarketDataKind,market:"listed"|"otc",error:unknown,source:string|null=null){
  const message=error instanceof Error?error.message:String(error);
  const pending=/source_date_mismatch|official_rows_empty|not_published|no data|沒有符合條件/i.test(message);
  observedFailure.set(`${kind}-${market}`,{source,error:message,status:pending?"PENDING":"ERROR"});
}
function validateDate(body:any,label:string){const d=sourceDate(body);if(d!==tradeDate)throw new Error(`${label}_source_date_mismatch:${d}`);}
function addReady(layer:Layer){if(!layer.rows.length)throw new Error(`${layer.kind}-${layer.market}_official_rows_empty`);observedReady.set(`${layer.kind}-${layer.market}`,layer);}

if(isDue("institutional","listed")){
  try{const body=await getJson(`https://www.twse.com.tw/rwd/zh/fund/T86?date=${compact}&selectType=ALLBUT0999&response=json`,"TWSE_T86");validateDate(body,"TWSE_T86");const rows=normalizeTwseInstitutional(body,tradeDate);if(!rows.length)throw new Error("institutional-listed_official_rows_empty");const raw=rawCapture("TWSE_T86",body);addReady({kind:"institutional",market:"listed",source:"TWSE_T86",rows,raw_paths:[raw.path]});}catch(e){markFailure("institutional","listed",e,"TWSE_T86");}
}
if(isDue("institutional","otc")){
  try{const body=await getJson("https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading","TPEX_3INSTI");validateDate(body,"TPEX_3INSTI");const rows=normalizeTpexInstitutional(body,tradeDate);if(!rows.length)throw new Error("institutional-otc_official_rows_empty");const raw=rawCapture("TPEX_3INSTI_DAILY_TRADING",body);addReady({kind:"institutional",market:"otc",source:"TPEX_3INSTI_DAILY_TRADING",rows,raw_paths:[raw.path]});}catch(e){markFailure("institutional","otc",e,"TPEX_3INSTI_DAILY_TRADING");}
}
if(isDue("margin","listed")){
  try{const body=await getJson(`https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${compact}&selectType=ALL&response=json`,"TWSE_MI_MARGN");validateDate(body,"TWSE_MI_MARGN");const rows=normalizeTwseMiMargnOfficial(body,tradeDate);if(!rows.length)throw new Error("margin-listed_official_rows_empty");const raw=rawCapture("TWSE_MI_MARGN",body);addReady({kind:"margin",market:"listed",source:"TWSE_MI_MARGN",rows,raw_paths:[raw.path]});}catch(e){markFailure("margin","listed",e,"TWSE_MI_MARGN");}
}
if(isDue("margin","otc")){
  try{const body=await getJson("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance","TPEX_MARGIN");validateDate(body,"TPEX_MARGIN");const rows=normalizeTpexMargin(body,tradeDate);if(!rows.length)throw new Error("margin-otc_official_rows_empty");const raw=rawCapture("TPEX_MAINBOARD_MARGIN_BALANCE",body);addReady({kind:"margin",market:"otc",source:"TPEX_MAINBOARD_MARGIN_BALANCE",rows,raw_paths:[raw.path]});}catch(e){markFailure("margin","otc",e,"TPEX_MAINBOARD_MARGIN_BALANCE");}
}
if(isDue("securities_lending","listed")||isDue("securities_lending","otc")){
  try{
    const body=await getJson(`https://www.twse.com.tw/exchangeReport/TWT72U?date=${compact}&selectType=SLBNLB&response=json`,"TWSE_TWT72U");validateDate(body,"TWSE_TWT72U");
    const rows=normalizeTwseSecuritiesLending(body,tradeDate);if(!rows.length)throw new Error("securities_lending_official_rows_empty");
    const split={listed:rows.filter((x)=>x.market==="listed"),otc:rows.filter((x)=>x.market==="otc")};
    const raw=rawCapture("TWSE_TWT72U",body);
    for(const market of ["listed","otc"] as const){if(!isDue("securities_lending",market))continue;if(split[market].length)addReady({kind:"securities_lending",market,source:"TWSE_TWT72U",rows:split[market],raw_paths:[raw.path]});else markFailure("securities_lending",market,"official_rows_empty","TWSE_TWT72U");}
  }catch(e){for(const market of ["listed","otc"] as const)if(isDue("securities_lending",market))markFailure("securities_lending",market,e,"TWSE_TWT72U");}
}
if(isDue("sbl_short_sale","listed")){
  try{const body=await getJson(`https://www.twse.com.tw/rwd/zh/marginTrading/TWT93U?date=${compact}&response=json`,"TWSE_TWT93U");validateDate(body,"TWSE_TWT93U");const rows=normalizeTwseSblShortSale(body,tradeDate);if(!rows.length)throw new Error("sbl_short_sale-listed_official_rows_empty");const raw=rawCapture("TWSE_TWT93U",body);addReady({kind:"sbl_short_sale",market:"listed",source:"TWSE_TWT93U",rows,raw_paths:[raw.path]});}catch(e){markFailure("sbl_short_sale","listed",e,"TWSE_TWT93U");}
}
if(isDue("sbl_short_sale","otc")){
  try{
    const [balance,volume]=await Promise.all([getJson("https://www.tpex.org.tw/openapi/v1/tpex_margin_sbl","TPEX_MARGIN_SBL"),getJson("https://www.tpex.org.tw/openapi/v1/tpex_short_sell","TPEX_SHORT_SELL")]);
    validateDate(balance,"TPEX_MARGIN_SBL");const rows=normalizeTpexSblShortSale(balance,volume,tradeDate);if(!rows.length)throw new Error("sbl_short_sale-otc_official_rows_empty");
    const rawA=rawCapture("TPEX_MARGIN_SBL",balance),rawB=rawCapture("TPEX_SHORT_SELL",volume);addReady({kind:"sbl_short_sale",market:"otc",source:"TPEX_MARGIN_SBL+TPEX_SHORT_SELL",rows,raw_paths:[rawA.path,rawB.path]});
  }catch(e){markFailure("sbl_short_sale","otc",e,"TPEX_MARGIN_SBL+TPEX_SHORT_SELL");}
}

const newReadyRows:Layer[]=[];
const manifestLayers:MarketManifestLayer[]=[];
for(const identity of EXPECTED_MARKET_DATA_LAYERS){
  const key=marketLayerKey(identity);const previous=existingByKey.get(key)||null;const readyLayer=observedReady.get(key);
  if(readyLayer){
    readyLayer.rows.sort((a,b)=>String(a.symbol).localeCompare(String(b.symbol)));
    const canonical={schema_version:VERSION,trade_date:tradeDate,market:readyLayer.market,kind:readyLayer.kind,source:readyLayer.source,source_date_verified:true,rows:readyLayer.rows};
    const contentSha=sha(canonical);const datasetVersion=`sha256:${contentSha}`;const snapshotPath=`data/market-data/daily/${year}/${month}/${day}/snapshots/${readyLayer.kind}-${readyLayer.market}/${contentSha}.json`;
    writeJson(snapshotPath,{...canonical,content_sha256:contentSha,dataset_version:datasetVersion});
    const incoming:MarketManifestLayer={...identity,status:"READY",source:readyLayer.source,row_count:readyLayer.rows.length,dataset_version:datasetVersion,content_sha256:contentSha,snapshot_path:snapshotPath,raw_paths:readyLayer.raw_paths,captured_at:capturedAt,error:null,attempts:Number(previous?.attempts||0)+1,first_attempt_at:previous?.first_attempt_at||capturedAt,last_attempt_at:capturedAt,next_retry_at:null};
    const merged=mergeReadyMonotonic(previous,incoming);manifestLayers.push(merged);if(merged===incoming)newReadyRows.push(readyLayer);continue;
  }
  if(previous?.status==="READY"){manifestLayers.push(previous);continue;}
  const failure=observedFailure.get(key);
  if(failure){manifestLayers.push(makePendingLayer(identity,capturedAt,{previous,source:failure.source,error:failure.error,status:failure.status}));continue;}
  if(previous){manifestLayers.push(previous);continue;}
  manifestLayers.push({...makePendingLayer(identity,capturedAt,{error:"not_attempted_in_current_window"}),attempts:0,first_attempt_at:null,last_attempt_at:null});
}

const byPrefix=new Map<string,any>();
for(const layer of newReadyRows){
  for(const row of layer.rows){
    if(!/^\d{4,6}$/.test(String(row.symbol)))continue;
    const prefix=String(row.symbol).slice(0,2);
    if(!byPrefix.has(prefix)){
      const shardFile=absolute(`data/market-data/index/${year}/${month}/${prefix}.json`);
      let existing:any={schema_version:"diamond-market-data-symbol-shard/v2",month:`${year}-${month}`,prefix,symbols:{},updated_at:""};
      if(fs.existsSync(shardFile)){try{existing=JSON.parse(fs.readFileSync(shardFile,"utf8"));}catch{}}
      byPrefix.set(prefix,existing);
    }
    const shard=byPrefix.get(prefix);const symbol=String(row.symbol);shard.symbols[symbol]??={};const list:any[]=Array.isArray(shard.symbols[symbol][layer.kind])?shard.symbols[symbol][layer.kind]:[];
    shard.symbols[symbol][layer.kind]=[...list.filter((x)=>x.trade_date!==tradeDate),row].sort((a,b)=>String(a.trade_date).localeCompare(String(b.trade_date)));
  }
}
for(const [prefix,shard] of byPrefix){shard.updated_at=capturedAt;writeJson(`data/market-data/index/${year}/${month}/${prefix}.json`,shard);}

const summary=summarizeDay(manifestLayers);
const manifest={schema_version:"diamond-market-data-manifest/v2",trade_date:tradeDate,storage:"GITHUB_ONLY",day_status:summary.day_status,terminal:summary.terminal,expected_layers:summary.expected_layers,ready_layers:summary.ready_layers,missing_layers:summary.missing_layers,trading_day_gate:gate,calendar_path:calendarVerified?calendarPath:null,calendar_error:calendarError,layers:manifestLayers,updated_at:capturedAt};
writeJson(manifestPath,manifest);
console.log(JSON.stringify({trade_date:tradeDate,storage:"GITHUB_ONLY",...summary,due_layers:[...due],calendar_error:calendarError,layers:manifestLayers.map((x)=>({kind:x.kind,market:x.market,status:x.status,rows:x.row_count,attempts:x.attempts,next_retry_at:x.next_retry_at,error:x.error}))},null,2));
if(!summary.terminal&&FINAL_AUDIT)process.exitCode=2;
