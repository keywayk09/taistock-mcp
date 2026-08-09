# P10b Diamond Global OHLC Surface

P10 in `keywayk09/tv-papertrader` implemented the first governed overseas OHLC adapter behind OHLC MCP. P10b updates the Diamond Engine product registry so the user-facing capability state matches reality without overstating runtime configuration or data verification.

## Implemented product surfaces

The following Diamond Tool Registry entries are now `ADAPTER_IMPLEMENTED_UNVERIFIED`:

- US stocks / ETFs
- Hong Kong stocks
- China A-shares
- Japan stocks
- Korea stocks
- global indexes
- crypto
- forex

All use:

- gateway: `OHLC_MCP`
- tool: `read_global_ohlc`
- timeframe: `1d`
- direct provider access from Diamond: forbidden
- production write: forbidden
- runtime provider secret ownership: OHLC data plane
- `formal_research_eligible=false`

## Why the status is not ACTIVE_INTERNAL

The adapter code and CI/Cloudflare build are implemented, but Diamond cannot and should not claim that the provider secret is configured in every runtime. More importantly, a single provider response has not yet become independent cross-verified archive truth.

Therefore the registry distinguishes:

- `ACTIVE_INTERNAL`: internally governed capabilities such as Taiwan OHLC.
- `ADAPTER_IMPLEMENTED_UNVERIFIED`: adapter exists and can be called through OHLC MCP when runtime provider configuration is present, but returned overseas data is blocked from formal strategy backtests until cross-verification/archive reconciliation is added.
- `CANDIDATE_EXTERNAL`: not yet implemented.

Futures remains `CANDIDATE_EXTERNAL`; P10 did not implement a futures adapter.

## Research boundary

Overseas data may be used for context, comparison, cross-market observation, and exploratory research. It must not be treated as formal backtest truth until a later milestone adds an independently verified/archive-backed dataset policy.

This preserves the architecture:

`Diamond Tool Registry -> OHLC MCP -> Global Market Adapter -> Data Quality Gate -> frozen dataset/provenance`

without allowing:

`Diamond -> provider directly`

or:

`single provider snapshot -> Production strategy evidence`.
