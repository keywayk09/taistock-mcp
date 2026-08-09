import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeDeterministicBacktestTool } from "./deterministic-backtest-tool";
import { recordExperiment } from "./experiment-ledger";
import { getSignalLedger, listSignalLedger } from "./signal-event-ledger";
import { executeSwingOutcomePathTool } from "./swing-outcome-path-tool";
import { getTxfSignal, listTxfSignals } from "./txf-signal-ledger";
import { runTxfReview5m, type TxfBar, type TxfDataset, type TxfReviewParameters, type TxfReviewSignal } from "./txf-review-engine";
import {
  REVIEW_ORCHESTRATOR_VERSION,
  SWING_SELECTOR_VERSION,
  buildReviewInterpretation,
  selectSwingCandidates,
  summarizeReviewRows,
  type ReviewMetricRow,
  type SwingSignalLike,
} from "./review-orchestrator";

const out = (value: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

const datasetSchema = z.object({
  schema_version: z.string(), dataset_id: z.string(), dataset_version: z.string(), dataset_hash: z.string(),
  frozen_view: z.boolean(), complete_view: z.boolean(), truncated: z.boolean(), formal_research_eligible: z.boolean(),
  review_eligible: z.boolean().optional(), row_count: z.number(), total_validated_rows: z.number(), source: z.string(),
  source_files: z.array(z.any()).optional(), provenance: z.record(z.string(), z.any()),
}).passthrough();

const stockBarSchema = z.object({
  symbol: z.string(), bar_time_tw: z.string(), ts_ms: z.union([z.number(), z.string()]), open: z.union([z.number(), z.string()]),
  high: z.union([z.number(), z.string()]), low: z.union([z.number(), z.string()]), close: z.union([z.number(), z.string()]), volume: z.union([z.number(), z.string()]),
}).passthrough();

const swingBarSchema = z.object({
  date: z.string(), symbol: z.string(), open: z.union([z.number(), z.string()]), high: z.union([z.number(), z.string()]),
  low: z.union([z.number(), z.string()]), close: z.union([z.number(), z.string()]), volume: z.union([z.number(), z.string()]),
}).passthrough();

async function sha256(value: unknown) {
  const text = JSON.stringify(value, Object.keys(value as any).sort());
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function stockSignalFromLedger(row: any) {
  if (!row) throw new Error("signal_not_found");
  return {
    signal_id: String(row.signal_id), signal_version: String(row.signal_version), symbol: String(row.symbol),
    side: String(row.side), trade_date: String(row.trade_date), signal_ts_ms: Number(row.signal_ts_ms), atr: Number(row.atr),
    strategy: String(row.strategy ?? ""), event: row.stage ? String(row.stage) : undefined,
  };
}

function txfSignalFromLedger(row: any): TxfReviewSignal {
  if (!row) throw new Error("txf_signal_not_found");
  return {
    signal_id: String(row.signal_id), signal_version: String(row.signal_version), logical_symbol: "TXF",
    contract_symbol: row.contract_symbol ? String(row.contract_symbol) : null, trade_date: String(row.trade_date),
    session: String(row.session) as any, side: String(row.side) as any, signal_ts_ms: Number(row.signal_ts_ms), atr: Number(row.atr),
    strategy: String(row.strategy ?? ""), stage: String(row.stage ?? ""),
  };
}

function stockMetric(result: any): ReviewMetricRow | null {
  if (!result?.ok || result?.status !== "OK") return null;
  return {
    market: "tw-stock", signal_id: String(result.signal_id), signal_version: String(result.signal_version),
    strategy: String(result.strategy ?? "UNSPECIFIED"), side: String(result.side), net_return_pct: Number(result.net_return_pct),
    mfe_pct: Number(result.mfe_pct), mae_pct: Number(result.mae_pct), ambiguous_intrabar: Boolean(result.ambiguous_intrabar),
    requires_1m_replay: Boolean(result.requires_1m_replay),
  };
}

function txfMetric(result: any): ReviewMetricRow | null {
  if (result?.status !== "OK") return null;
  return {
    market: "txf", signal_id: String(result.signal_id), signal_version: String(result.signal_version),
    strategy: String(result.strategy ?? "UNSPECIFIED"), side: String(result.side),
    net_points: result.net_points === null ? Number(result.gross_points) : Number(result.net_points),
    mfe_points: Number(result.mfe_points), mae_points: Number(result.mae_points), ambiguous_intrabar: Boolean(result.ambiguous_intrabar),
    requires_1m_replay: Boolean(result.requires_1m_replay),
  };
}

function summarizeSwing(results: any[]) {
  const okRows = results.filter((x) => x?.ok && x?.status === "OK");
  const byHorizon = new Map<number, number[]>();
  const mfe: number[] = [], mae: number[] = [];
  for (const row of okRows) {
    for (const h of Array.isArray(row.horizons) ? row.horizons : []) {
      const day = Number(h.horizon_day), ret = Number(h.directional_close_return_pct);
      if (!Number.isInteger(day) || !Number.isFinite(ret)) continue;
      const values = byHorizon.get(day) ?? []; values.push(ret); byHorizon.set(day, values);
      if (Number.isFinite(Number(h.mfe_pct))) mfe.push(Number(h.mfe_pct));
      if (Number.isFinite(Number(h.mae_pct))) mae.push(Number(h.mae_pct));
    }
  }
  const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((a,b)=>a+b,0)/xs.length*1e6)/1e6 : null;
  return {
    total: results.length, ok_count: okRows.length, failed_count: results.length - okRows.length,
    avg_mfe_pct: avg(mfe), avg_mae_pct: avg(mae),
    horizons: Array.from(byHorizon.entries()).sort((a,b)=>a[0]-b[0]).map(([day, values]) => ({
      horizon_day: day, count: values.length, win_rate: Math.round(values.filter((x)=>x>0).length/values.length*1e6)/1e6,
      avg_directional_close_return_pct: avg(values),
    })),
  };
}

export function registerReviewOrchestratorTools(server: McpServer, env: Env) {
  server.registerTool("get_review_orchestration_contract", {
    description: "P15 復盤/波段閉環契約。採兩階段 orchestration：Diamond 先產生 OHLC MCP read plan，OHLC MCP 回傳 frozen dataset 後再 finalize；Diamond 永不直連 Fugle/Provider。",
    inputSchema: {}, annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out({
    version: REVIEW_ORCHESTRATOR_VERSION,
    daily_review: "TradingView formal Signal -> immutable Signal Ledger -> prepare plan -> OHLC MCP -> 5m review -> selective 1m replay queue -> statistics/review -> P8 memory",
    swing: "Signal Ledger -> Diamond score/rank snapshot -> OHLC MCP 1D frozen dataset -> D1..Dn Swing Outcome -> statistics/review -> P8 memory",
    txf: "separate TXF Signal Ledger/Profile; included in daily review and available as TW-stock market context",
    hard_boundaries: ["NO_DIRECT_PROVIDER_ACCESS", "NO_OHLC_WRITE", "NO_FUTURE_DATA_IN_SIGNAL", "NO_AUTO_STRATEGY_PROMOTION"],
  }));

  server.registerTool("prepare_daily_review_run", {
    description: "讀取指定交易日 immutable 台股/TXF Signal Ledger，產生唯一的 OHLC MCP 5m 讀取計畫。這一步不抓行情、不跑回測。",
    inputSchema: {
      trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      include_txf: z.boolean().optional().default(true),
      stock_stage: z.string().optional(),
      limit: z.number().int().min(1).max(500).optional().default(500),
    }, annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async ({ trade_date, include_txf, stock_stage, limit }) => {
    const stock = (await listSignalLedger(env, { trade_date, stage: stock_stage, limit })).filter((x:any)=>["LONG","SHORT"].includes(String(x?.side)) && String(x?.timeframe)==="5m");
    const txf = include_txf ? (await listTxfSignals(env, { trade_date, limit })).filter((x:any)=>["LONG","SHORT"].includes(String(x?.side))) : [];
    const stockRequests = Array.from(new Set(stock.map((x:any)=>String(x.symbol)))).sort().map((symbol) => ({
      gateway: "OHLC_MCP", tool: "read_ohlc", arguments: { symbol, timeframe: "5m", mode: "research", trade_date, limit: 2000 },
    }));
    const sessions = Array.from(new Set(txf.map((x:any)=>String(x.session)))).sort();
    const txfRequests = sessions.map((session) => ({ gateway:"OHLC_MCP", tool:"read_txf_ohlc", arguments:{ timeframe:"5m", trade_date, session, limit:5000 } }));
    const planHash = await sha256({ trade_date, stock: stock.map((x:any)=>[x.signal_id,x.signal_version]), txf: txf.map((x:any)=>[x.signal_id,x.signal_version]) });
    return out({
      ok:true, orchestrator_version:REVIEW_ORCHESTRATOR_VERSION, review_plan_id:`daily-review-plan:${planHash}`, trade_date,
      stock_signals:stock.map((x:any)=>({signal_id:x.signal_id,signal_version:x.signal_version,symbol:x.symbol,strategy:x.strategy,stage:x.stage,side:x.side,signal_ts_ms:x.signal_ts_ms})),
      txf_signals:txf.map((x:any)=>({signal_id:x.signal_id,signal_version:x.signal_version,session:x.session,strategy:x.strategy,stage:x.stage,side:x.side,signal_ts_ms:x.signal_ts_ms})),
      ohlc_requests:[...stockRequests,...txfRequests], next_step:"Call OHLC MCP exactly as requested, then pass frozen datasets to finalize_daily_review_run.",
    });
  });

  server.registerTool("finalize_daily_review_run", {
    description: "完成指定日台股＋TXF 復盤。所有 case 必須攜帶 OHLC MCP frozen dataset；輸出逐筆結果、Strategy/Side 統計、1m replay queue、機器復盤觀察與最多3個待驗證優化假設。可寫入 P8 Experiment Memory，但永不改正式策略。",
    inputSchema: {
      trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      stock_cases: z.array(z.object({ signal_id:z.string(), signal_version:z.string(), dataset:datasetSchema, bars:z.array(stockBarSchema).min(1).max(5000), parameters:z.any().optional() })).max(500).optional().default([]),
      txf_cases: z.array(z.object({ signal_id:z.string(), signal_version:z.string(), dataset:datasetSchema, bars:z.array(z.any()).min(1).max(5000), parameters:z.any().optional() })).max(500).optional().default([]),
      persist_experiment: z.boolean().optional().default(true),
    }, annotations: { readOnlyHint:false, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async ({ trade_date, stock_cases, txf_cases, persist_experiment }) => {
    const stockResults:any[]=[]; const txfResults:any[]=[]; const metricRows:ReviewMetricRow[]=[];
    for (const c of stock_cases) {
      const row = await getSignalLedger(env,c.signal_id,c.signal_version);
      const result = await executeDeterministicBacktestTool({ dataset:c.dataset, bars:c.bars, signal:stockSignalFromLedger(row), parameters:c.parameters });
      stockResults.push(result); const metric=stockMetric(result); if(metric) metricRows.push(metric);
    }
    for (const c of txf_cases) {
      const row = await getTxfSignal(env,c.signal_id,c.signal_version);
      try {
        const result=await runTxfReview5m({dataset:c.dataset as TxfDataset,bars:c.bars as TxfBar[],signal:txfSignalFromLedger(row),parameters:c.parameters as TxfReviewParameters|undefined});
        txfResults.push(result); const metric=txfMetric(result); if(metric) metricRows.push(metric);
      } catch(error) { txfResults.push({ok:false,status:"TXF_REVIEW_ERROR",error:error instanceof Error?error.message:String(error),signal_id:c.signal_id,signal_version:c.signal_version}); }
    }
    const summary=summarizeReviewRows(metricRows); const interpretation=buildReviewInterpretation(summary);
    const replay_requests:any[]=[];
    for(const r of stockResults.filter((x:any)=>x?.ok&&x?.requires_1m_replay)) replay_requests.push({market:"tw-stock",signal_id:r.signal_id,signal_version:r.signal_version,gateway:"OHLC_MCP",tool:"read_ohlc",arguments:{symbol:r.symbol,timeframe:"1m",mode:"research",trade_date,limit:2000}});
    for(const r of txfResults.filter((x:any)=>x?.status==="OK"&&x?.requires_1m_replay)) replay_requests.push({market:"txf",signal_id:r.signal_id,signal_version:r.signal_version,gateway:"OHLC_MCP",tool:"read_txf_ohlc",arguments:{timeframe:"1m",trade_date,session:r.session,limit:5000}});
    const runHash=await sha256({trade_date,stock:stockResults.map((x:any)=>x.backtest_run_id??x.status),txf:txfResults.map((x:any)=>x.review_run_id??x.status)});
    const result={ok:true,orchestrator_version:REVIEW_ORCHESTRATOR_VERSION,daily_review_run_id:`daily-review:${runHash}`,trade_date,stock_results:stockResults,txf_results:txfResults,summary,interpretation,replay_requests,review_policy:"OBJECTIVE_RESULTS_SEPARATE_FROM_HYPOTHESIS",production_promotion:"FORBIDDEN"};
    let experiment:any=null;
    if(persist_experiment){
      const datasetRefs=[...stockResults,...txfResults].filter((x:any)=>x?.dataset_id&&x?.dataset_version&&x?.dataset_hash).map((x:any)=>({dataset_id:String(x.dataset_id),dataset_version:String(x.dataset_version),dataset_hash:String(x.dataset_hash),symbol:String(x.symbol??x.logical_symbol??""),timeframe:"5m"}));
      experiment=await recordExperiment(env,{experiment_id:`daily-review:${trade_date}:${runHash}`,hypothesis:`${trade_date} TradingView 正式訊號每日復盤基準；優化項目只作待驗證 Hypothesis。`,source:"DAILY_REVIEW_ORCHESTRATOR",strategy_id:null,strategy_version:REVIEW_ORCHESTRATOR_VERSION,signal_refs:metricRows.map((x)=>({signal_id:x.signal_id,signal_version:x.signal_version})),dataset_refs:datasetRefs,parameters:{orchestrator_version:REVIEW_ORCHESTRATOR_VERSION},result:{daily_review_run_id:result.daily_review_run_id,summary,interpretation,replay_requests},metrics:{profit_factor:metricRows.every((x)=>x.market==="tw-stock")?summary.profit_factor:null,win_rate:summary.win_rate,expectancy_pct:metricRows.every((x)=>x.market==="tw-stock")?summary.expectancy:null,mfe_pct:null,mae_pct:null},regime:null,validation_status:"DEVELOPMENT",rejection_reason:null});
    }
    return out({...result,experiment});
  });

  server.registerTool("prepare_swing_selection_run", {
    description: "從指定日 immutable Signal Ledger 建立 Diamond Swing Selection snapshot。排名只讀 Signal 當時已保存的 swing_score/diamond_score/confidence/probability，不使用未來行情；同股票只保留最高分訊號。",
    inputSchema: {
      trade_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/), stage:z.string().optional(), limit:z.number().int().min(1).max(50).optional().default(10),
      min_score:z.number().finite().optional().default(0), max_horizon_days:z.number().int().min(1).max(20).optional().default(5),
    }, annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  }, async ({trade_date,stage,limit,min_score,max_horizon_days})=>{
    const signals=(await listSignalLedger(env,{trade_date,stage,limit:500})).map((x:any)=>({
      signal_id:String(x.signal_id),signal_version:String(x.signal_version),symbol:String(x.symbol),trade_date:String(x.trade_date),side:String(x.side),strategy:String(x.strategy),stage:x.stage?String(x.stage):null,signal_ts_ms:Number(x.signal_ts_ms),reason_codes:Array.isArray(x.reason_codes)?x.reason_codes:[],payload:(x.payload&&typeof x.payload==="object")?x.payload:{},
    })) as SwingSignalLike[];
    const selected=selectSwingCandidates(signals,limit).filter((x)=>x.score>=min_score);
    const hash=await sha256({trade_date,max_horizon_days,selected:selected.map((x)=>[x.signal_id,x.signal_version,x.score])});
    return out({ok:true,selector_version:SWING_SELECTOR_VERSION,selection_id:`swing-selection:${hash}`,trade_date,max_horizon_days,selected,
      data_policy:"SELECTION_USES_SIGNAL_TIME_DATA_ONLY",future_policy:"FUTURE_1D_BARS_ARE_OUTCOME_ONLY",
      ohlc_request_template:{gateway:"OHLC_MCP",tool:"read_ohlc",arguments:{timeframe:"1d",mode:"research",from:trade_date,to:"<evaluation_date>",limit:300}},
      note:"Selection 可先保存；到 D1..D5/指定 horizon 時再用 finalize_swing_review_run 評估。"});
  });

  server.registerTool("finalize_swing_review_run", {
    description:"對 Diamond 已選波段標的跑 1D Swing Outcome。每筆都用 OHLC MCP complete frozen 1D dataset，輸出 D1..Dn 報酬/MFE/MAE 統計與 P8 記憶；未來K只評估結果。",
    inputSchema:{
      selection_id:z.string().min(1),trade_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),max_horizon_days:z.number().int().min(1).max(20).optional().default(5),
      cases:z.array(z.object({signal_id:z.string(),signal_version:z.string(),dataset:datasetSchema,bars:z.array(swingBarSchema).min(2).max(2000)})).min(1).max(50),
      persist_experiment:z.boolean().optional().default(true),
    },annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  },async({selection_id,trade_date,max_horizon_days,cases,persist_experiment})=>{
    const results:any[]=[];
    for(const c of cases){const row:any=await getSignalLedger(env,c.signal_id,c.signal_version);if(!row){results.push({ok:false,status:"SIGNAL_NOT_FOUND",signal_id:c.signal_id,signal_version:c.signal_version});continue;}
      const result=await executeSwingOutcomePathTool({dataset:c.dataset,bars:c.bars,signal:{signal_id:String(row.signal_id),signal_version:String(row.signal_version),symbol:String(row.symbol),side:String(row.side),signal_ts_ms:Number(row.signal_ts_ms),trade_date:String(row.trade_date),strategy:String(row.strategy),event:String(row.stage??"")},parameters:{max_horizon_days,reference_rule:"NEXT_SESSION_OPEN"}});results.push(result);}
    const summary=summarizeSwing(results);const hash=await sha256({selection_id,results:results.map((x:any)=>x.swing_run_id??x.status)});
    const review={ok:true,selector_version:SWING_SELECTOR_VERSION,swing_review_run_id:`swing-review:${hash}`,selection_id,trade_date,max_horizon_days,results,summary,
      interpretation:{view:summary.ok_count?"波段標的以 D1..Dn directional return、MFE/MAE 評估；結果只反饋選標品質，不直接改策略。":"沒有成功完成的 Swing Outcome，先檢查 Dataset/Signal。",optimization_policy:"HYPOTHESIS_ONLY"},production_promotion:"FORBIDDEN"};
    let experiment:any=null;if(persist_experiment){const okResults=results.filter((x:any)=>x?.ok&&x?.status==="OK");const last=summary.horizons.at(-1);
      experiment=await recordExperiment(env,{experiment_id:`swing-review:${trade_date}:${hash}`,hypothesis:`${trade_date} Diamond Swing Selector 選標後 ${max_horizon_days} 日 Outcome Review。`,source:"SWING_REVIEW_ORCHESTRATOR",strategy_id:"DIAMOND_SWING_SELECTOR",strategy_version:SWING_SELECTOR_VERSION,signal_refs:okResults.map((x:any)=>({signal_id:String(x.signal_id),signal_version:String(x.signal_version)})),dataset_refs:okResults.map((x:any)=>({dataset_id:String(x.dataset_id),dataset_version:String(x.dataset_version),dataset_hash:String(x.dataset_hash),symbol:String(x.symbol),timeframe:"1d"})),parameters:{selection_id,max_horizon_days},result:{swing_review_run_id:review.swing_review_run_id,summary},metrics:{profit_factor:null,win_rate:last?.win_rate??null,expectancy_pct:last?.avg_directional_close_return_pct??null,mfe_pct:summary.avg_mfe_pct,mae_pct:summary.avg_mae_pct},regime:null,validation_status:"DEVELOPMENT",rejection_reason:null});}
    return out({...review,experiment});
  });
}
