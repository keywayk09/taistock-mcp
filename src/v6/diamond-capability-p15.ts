import { getDiamondArchitectureStatusP14, getDiamondResearchLabP14, getDiamondToolRegistryP14 } from "./diamond-capability-p14";
import { REVIEW_ORCHESTRATOR_VERSION, SWING_SELECTOR_VERSION } from "./review-orchestrator";

export function getDiamondToolRegistryP15(){
  const base=getDiamondToolRegistryP14();
  return {...base,orchestration:{status:"ACTIVE_INTERNAL",owner:"Diamond Intelligence Core",data_gateway:"OHLC_MCP_ONLY",tools:["prepare_daily_review_run","finalize_daily_review_run","prepare_swing_selection_run","finalize_swing_review_run"]}};
}

export function getDiamondResearchLabP15(){
  const base=getDiamondResearchLabP14();
  const added=[
    {id:"daily_review_orchestrator",title:"Daily Review Orchestrator",status:"ACTIVE_INTERNAL" as const,source_projects:["keywayk09/taistock-mcp"],current_tool:"finalize_daily_review_run",deterministic:true,production_strategy_promotion:false as const,notes:"Two-phase orchestration: Signal Ledger -> OHLC MCP read plan -> frozen 5m evaluation -> replay queue -> statistics/interpretation -> P8 memory."},
    {id:"swing_selector_orchestrator",title:"Swing Selector + Outcome Orchestrator",status:"ACTIVE_INTERNAL" as const,source_projects:["keywayk09/taistock-mcp"],current_tool:"finalize_swing_review_run",deterministic:true,production_strategy_promotion:false as const,notes:"Ranks immutable signal-time scores only; future 1D bars are outcome-only and never affect selection."},
  ];
  return {...base,orchestration:{status:"ACTIVE_INTERNAL",review_orchestrator_version:REVIEW_ORCHESTRATOR_VERSION,swing_selector_version:SWING_SELECTOR_VERSION},active_count:base.active_count+added.length,capabilities:[...base.capabilities,...added]};
}

export function getDiamondArchitectureStatusP15(){
  const base=getDiamondArchitectureStatusP14();
  return {...base,architecture_version:"diamond-architecture/2026-08-p15",review_closure:{
    status:"ACTIVE_INTERNAL",
    daily_review_flow:"TradingView Signal -> Signal Ledger -> prepare_daily_review_run -> OHLC MCP -> finalize_daily_review_run -> 1m replay queue -> P8",
    swing_flow:"Signal Ledger -> prepare_swing_selection_run -> OHLC MCP 1D -> finalize_swing_review_run -> P8",
    objective_and_interpretation_separated:true,
    max_optimization_hypotheses_per_daily_review:3,
    auto_strategy_change:false,
    direct_provider_access:false,
  },hard_boundaries:{...base.hard_boundaries,orchestrator_direct_provider_access:"FORBIDDEN",orchestrator_ohlc_write:"FORBIDDEN",future_data_in_swing_selection:"FORBIDDEN",review_to_production_promotion:"FORBIDDEN"}};
}
