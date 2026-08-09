import { getDiamondArchitectureStatusP13, getDiamondToolRegistryP13 } from "./diamond-capability-p13";
import { getDiamondResearchLabP11 } from "./diamond-capability-p11";
import { TXF_CONTEXT_ENGINE_VERSION, TXF_REPLAY_ENGINE_VERSION, TXF_REVIEW_ENGINE_VERSION } from "./txf-review-engine";

export function getDiamondToolRegistryP14(){
  const base=getDiamondToolRegistryP13();
  const capabilities=base.capabilities.map((capability:any)=>{
    if(capability.id!=="futures_ohlc") return capability;
    return {
      ...capability,
      title:"台指期 TXF OHLC",
      status:"ADAPTER_IMPLEMENTED_UNVERIFIED" as const,
      owner:"OHLC MCP / TXF Data Plane",
      source_projects:["keywayk09/tv-papertrader"],
      markets:["TXF"],
      gateway:"OHLC_MCP",
      current_tool:"read_txf_ohlc",
      timeframes:["1d","5m","1m"],
      implementation_version:"OHLC MCP 1.4.0 / txf-forward-capture v1.0.0",
      runtime_configuration:"INTERNAL" as const,
      formal_research_eligible:false,
      direct_provider_access:false as const,
      read_only_research:true,
      production_write:false as const,
      notes:"P14 TXF forward capture is implemented behind OHLC MCP. 1m is captured, 5m is deterministic derived, 1D is REGULAR-only. Dataset can be used for daily review only when review_eligible=true; formal research remains blocked until independent TAIFEX cross-verification/archive. Diamond never calls Fugle directly.",
    };
  });
  return {...base,txf:{status:"ADAPTER_IMPLEMENTED_UNVERIFIED",gateway:"OHLC_MCP",tool:"read_txf_ohlc",timeframes:["1d","5m","1m"],review_eligible:"PER_DATASET",formal_research_eligible:false},capabilities};
}

export function getDiamondResearchLabP14(){
  const base=getDiamondResearchLabP11();
  const txfCapabilities=[
    {id:"txf_signal_ledger",title:"TXF TradingView Signal Ledger",status:"ACTIVE_INTERNAL" as const,source_projects:["keywayk09/taistock-mcp"],current_tool:"record_txf_signal",deterministic:true,production_strategy_promotion:false as const,notes:"Immutable TXF-specific signal ledger; TAIFEX trading date and REGULAR/AFTERHOURS session are explicit."},
    {id:"txf_5m_review",title:"TXF Deterministic 5m Review",status:"ACTIVE_INTERNAL" as const,source_projects:["keywayk09/taistock-mcp"],current_tool:"run_txf_batch_review_5m",deterministic:true,production_strategy_promotion:false as const,notes:"Separate futures profile: gross points/TWD, MFE/MAE, ambiguous rate and explicit optional cost model; never reuses stock 0.04% costs."},
    {id:"txf_selective_1m_replay",title:"TXF Selective 1m Replay",status:"ACTIVE_INTERNAL" as const,source_projects:["keywayk09/taistock-mcp"],current_tool:"resolve_txf_ambiguous_with_1m",deterministic:true,production_strategy_promotion:false as const,notes:"Resolves 5m ambiguous TXF cases while preserving the original conservative 5m result."},
    {id:"stock_txf_context",title:"TW Stock × TXF Context",status:"ACTIVE_INTERNAL" as const,source_projects:["keywayk09/taistock-mcp"],current_tool:"build_stock_txf_context",deterministic:true,production_strategy_promotion:false as const,notes:"No-lookahead TXF context at each stock signal timestamp for later regime/edge statistics."},
  ];
  return {...base,txf_review:{status:"ACTIVE_INTERNAL",review_engine_version:TXF_REVIEW_ENGINE_VERSION,replay_engine_version:TXF_REPLAY_ENGINE_VERSION,context_engine_version:TXF_CONTEXT_ENGINE_VERSION,formal_validation_blocked_until_taifex_verified:true},active_count:base.active_count+txfCapabilities.length,capabilities:[...base.capabilities,...txfCapabilities]};
}

export function getDiamondArchitectureStatusP14(){
  const base=getDiamondArchitectureStatusP13();
  return {...base,architecture_version:"diamond-architecture/2026-08-p14",dual_market_review:{
    status:"ACTIVE_INTERNAL",
    markets:["TW_STOCK","TXF"],
    signal_sources:{TW_STOCK:"existing Signal/Event Ledger from latest TradingView Taiwan-stock engine",TXF:"TXF Signal Ledger from latest TradingView TXF engine"},
    data_gateway:"OHLC_MCP_ONLY",
    txf_data_tool:"read_txf_ohlc",
    txf_review_tools:["record_txf_signal","get_txf_signal","list_txf_signals","run_txf_signal_review_5m","run_txf_batch_review_5m","resolve_txf_ambiguous_with_1m","record_txf_review_experiment"],
    cross_market_context_tool:"build_stock_txf_context",
    txf_profile_separate_from_stock:true,
    futures_cost_model:"EXPLICIT; no stock 0.04% reuse",
    txf_formal_research:"BLOCKED_UNTIL_TAIFEX_CROSS_VERIFIED_DATASET",
    review_hypothesis_auto_promotion:false,
  },hard_boundaries:{...base.hard_boundaries,txf_direct_provider_access:"FORBIDDEN_IN_DIAMOND",txf_stock_cost_profile_reuse:"FORBIDDEN",txf_review_without_review_eligible_dataset:"FORBIDDEN",txf_formal_validation_on_unverified_forward_capture:"FORBIDDEN"}};
}
