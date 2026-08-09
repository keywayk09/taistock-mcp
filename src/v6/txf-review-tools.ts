import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { recordExperiment } from "./experiment-ledger";
import {
  TXF_CONTRACT_MULTIPLIER_TWD_PER_POINT,
  TXF_CONTEXT_ENGINE_VERSION,
  TXF_REPLAY_ENGINE_VERSION,
  TXF_REVIEW_ENGINE_VERSION,
  TXF_TICK_SIZE_POINTS,
  buildStockTxfContext,
  resolveTxfReviewWith1m,
  runTxfBatchReview5m,
  runTxfReview5m,
  type TxfBar,
  type TxfDataset,
  type TxfReviewParameters,
  type TxfReviewSignal,
} from "./txf-review-engine";
import { getTxfSignal, listTxfSignals, recordTxfSignal, type RecordTxfSignalInput } from "./txf-signal-ledger";

const out=(value:unknown)=>({content:[{type:"text" as const,text:JSON.stringify(value,null,2)}]});

const datasetSchema=z.object({
  schema_version:z.string(),dataset_id:z.string(),dataset_version:z.string(),dataset_hash:z.string(),
  frozen_view:z.boolean(),complete_view:z.boolean(),truncated:z.boolean(),review_eligible:z.boolean().optional(),
  formal_research_eligible:z.boolean(),row_count:z.number(),total_validated_rows:z.number(),source:z.string(),
  source_files:z.array(z.any()).optional(),provenance:z.record(z.string(),z.any()),
});
const paramsSchema=z.object({
  parameter_schema_version:z.string().optional(),entry_rule:z.literal("NEXT_BAR_OPEN").optional(),
  stop_atr:z.number().positive().optional(),target_atr:z.number().positive().optional(),max_bars:z.number().int().min(1).max(200).optional(),
  tie_break:z.literal("STOP_FIRST").optional(),contract_multiplier_twd_per_point:z.number().positive().optional(),tick_size_points:z.number().positive().optional(),
  all_in_round_trip_cost_twd:z.number().nonnegative().nullable().optional(),slippage_points_round_trip:z.number().nonnegative().nullable().optional(),
}).optional();

function signalFromRow(row:any):TxfReviewSignal {
  if(!row) throw new Error("txf_signal_not_found");
  return {
    signal_id:String(row.signal_id),signal_version:String(row.signal_version),logical_symbol:"TXF",
    contract_symbol:row.contract_symbol?String(row.contract_symbol):null,trade_date:String(row.trade_date),session:String(row.session) as any,
    side:String(row.side) as any,signal_ts_ms:Number(row.signal_ts_ms),atr:Number(row.atr),strategy:String(row.strategy??""),stage:String(row.stage??""),
  };
}

export function registerTxfReviewTools(server:McpServer,env:Env){
  server.registerTool("get_txf_review_contract",{
    description:"取得台指期 TXF 復盤契約與安全邊界。TXF 與台股現貨使用獨立 Review Profile；目前單點價值 200 元、最小跳動 1 點。Fugle forward-capture dataset 可做 daily review，但正式策略研究仍需 TAIFEX 獨立驗證。",
    inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  },async()=>out({
    market:"txf",logical_symbol:"TXF",review_engine_version:TXF_REVIEW_ENGINE_VERSION,replay_engine_version:TXF_REPLAY_ENGINE_VERSION,context_engine_version:TXF_CONTEXT_ENGINE_VERSION,
    contract_multiplier_twd_per_point:TXF_CONTRACT_MULTIPLIER_TWD_PER_POINT,tick_size_points:TXF_TICK_SIZE_POINTS,
    sessions:{REGULAR:"08:45-13:45 Asia/Taipei (expiry day may close earlier)",AFTERHOURS:"15:00-05:00 Asia/Taipei (expiry-day rules differ)"},
    entry:"NEXT_BAR_OPEN",default_stop:"1 ATR",default_target:"1.5 ATR",default_max_bars:12,tie_break:"STOP_FIRST",
    costs:"gross points/TWD always computed; net points/TWD only when caller supplies all-in round-trip cost and round-trip slippage",
    data_gateway:"OHLC_MCP/read_txf_ohlc",review_dataset_gate:"review_eligible=true + frozen/complete/hash-valid",formal_strategy_gate:"formal_research_eligible=true required before formal validation/promotion",
    production_promotion:"FORBIDDEN",
  }));

  server.registerTool("record_txf_signal",{
    description:"將 TradingView 最新台指期引擎正式訊號寫入 immutable TXF Signal Ledger。trade_date 是 TAIFEX trading date；AFTERHOURS 不強迫等於本地日曆日期，避免夜盤跨日錯配。",
    inputSchema:{
      signal_id:z.string().min(1).max(240),signal_version:z.string().min(1).max(160),contract_symbol:z.string().optional(),trade_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      session:z.enum(["REGULAR","AFTERHOURS"]),timeframe:z.literal("5m"),side:z.enum(["LONG","SHORT","NEUTRAL"]),strategy:z.string().min(1).max(200),stage:z.string().min(1).max(120),
      signal_ts_ms:z.number().int().positive(),knowledge_cutoff_ts_ms:z.number().int().positive(),data_watermark_ts_ms:z.number().int().positive(),price:z.number().positive().optional(),atr:z.number().positive().optional(),
      source:z.string().min(1).max(200),reason_codes:z.array(z.string()).optional(),payload:z.record(z.string(),z.any()).optional(),
    },annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  },async(input)=>out(await recordTxfSignal(env,input as RecordTxfSignalInput)));

  server.registerTool("get_txf_signal",{
    description:"讀取 immutable TXF Signal Ledger 的單一訊號版本。",
    inputSchema:{signal_id:z.string().min(1).max(240),signal_version:z.string().min(1).max(160)},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  },async({signal_id,signal_version})=>out(await getTxfSignal(env,signal_id,signal_version)));

  server.registerTool("list_txf_signals",{
    description:"列出台指期 TradingView 正式訊號，供每日/每週復盤編排。",
    inputSchema:{trade_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),session:z.enum(["REGULAR","AFTERHOURS"]).optional(),strategy:z.string().optional(),limit:z.number().int().min(1).max(500).optional().default(100)},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  },async(input)=>out(await listTxfSignals(env,input as any)));

  server.registerTool("run_txf_signal_review_5m",{
    description:"P14 台指期單筆復盤：從 immutable TXF Signal Ledger 取訊號，以 OHLC MCP frozen 5m dataset 重播。5m 同根碰停損/停利固定 STOP_FIRST 並排入 1m selective replay。",
    inputSchema:{signal_id:z.string(),signal_version:z.string(),dataset:datasetSchema,bars:z.array(z.any()).min(1).max(5000),parameters:paramsSchema},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  },async({signal_id,signal_version,dataset,bars,parameters})=>{
    const signal=signalFromRow(await getTxfSignal(env,signal_id,signal_version));
    return out(await runTxfReview5m({dataset:dataset as TxfDataset,bars:bars as TxfBar[],signal,parameters:parameters as TxfReviewParameters|undefined}));
  });

  server.registerTool("run_txf_batch_review_5m",{
    description:"P14/P5-TXF 批次復盤：每個 case 綁定 immutable TXF signal + frozen 5m dataset，回傳勝率、Expectancy(points)、PF、MFE/MAE、ambiguous rate、by-strategy 與 1m replay queue。",
    inputSchema:{cases:z.array(z.object({signal_id:z.string(),signal_version:z.string(),dataset:datasetSchema,bars:z.array(z.any()).min(1).max(5000),parameters:paramsSchema})).min(1).max(1000)},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  },async({cases})=>{
    const resolved=[];
    for(const c of cases){resolved.push({dataset:c.dataset as TxfDataset,bars:c.bars as TxfBar[],signal:signalFromRow(await getTxfSignal(env,c.signal_id,c.signal_version)),parameters:c.parameters as TxfReviewParameters|undefined});}
    return out(await runTxfBatchReview5m({cases:resolved}));
  });

  server.registerTool("resolve_txf_ambiguous_with_1m",{
    description:"P14/P6-TXF Selective Replay：只解析 5m ambiguous case，使用同一 trading date/session/contract 的 frozen 1m dataset 判斷 Target-first 或 Stop-first；永不覆蓋原 5m conservative result。",
    inputSchema:{original_review:z.any(),dataset:datasetSchema,bars:z.array(z.any()).min(1).max(5000)},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  },async({original_review,dataset,bars})=>out(await resolveTxfReviewWith1m({original_review:original_review as any,dataset:dataset as TxfDataset,bars:bars as TxfBar[]})));

  server.registerTool("build_stock_txf_context",{
    description:"建立個股 Signal 時點的 TXF 市場 Context，不看未來 K。輸出 TXF 當時合約、session return、1/3-bar momentum、12-bar range position，供後續統計個股訊號在 TXF 強/弱環境下的 Edge。",
    inputSchema:{dataset:datasetSchema,bars:z.array(z.any()).min(1).max(5000),stock_signal:z.object({symbol:z.string().regex(/^\d{4,6}$/),signal_id:z.string(),signal_version:z.string(),signal_ts_ms:z.number().int().positive(),trade_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}),session:z.enum(["REGULAR","AFTERHOURS"]).optional().default("REGULAR")},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  },async(input)=>out(await buildStockTxfContext({dataset:input.dataset as TxfDataset,bars:input.bars as TxfBar[],stock_signal:input.stock_signal,session:input.session})));

  server.registerTool("record_txf_review_experiment",{
    description:"將一筆 TXF 復盤結果寫入 P8 Experiment Memory。僅保存研究/復盤記憶，不會升級 Production Strategy。",
    inputSchema:{review:z.any(),hypothesis:z.string().min(1).max(5000),regime:z.string().max(200).optional()},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  },async({review,hypothesis,regime})=>{
    const r=review as any;
    if(String(r?.market)!=="txf"||!r?.review_run_id||!r?.dataset_version||!r?.dataset_hash) throw new Error("invalid_txf_review_result");
    return out(await recordExperiment(env,{
      experiment_id:`txf-review:${String(r.review_run_id)}`,hypothesis,source:"TXF_DAILY_REVIEW",strategy_id:r.strategy?String(r.strategy):null,strategy_version:r.signal_version?String(r.signal_version):null,
      signal_refs:[{signal_id:String(r.signal_id),signal_version:String(r.signal_version)}],dataset_refs:[{dataset_id:String(r.dataset_id),dataset_version:String(r.dataset_version),dataset_hash:String(r.dataset_hash),symbol:"TXF",timeframe:"5m"}],
      parameters:r.parameters??{},result:r,metrics:{expectancy_pct:null,mfe_pct:null,mae_pct:null},regime:regime??`${r.session??""}`,validation_status:"DEVELOPMENT",
    }));
  });
}
