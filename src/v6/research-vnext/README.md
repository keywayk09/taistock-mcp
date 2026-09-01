# Research VNext

Research VNext is the in-place rebuild lane for `taistock-mcp` research capabilities.

## Authority model

- **GPT is the sole reasoning / interpretation owner.**
- Research VNext is infrastructure only: data, deterministic compute, replay, evidence and research memory.
- The backend must not present its own narrative inference as trading reasoning.

## Hard boundaries

- No direct market-provider access for OHLC.
- No OHLC writes.
- No automatic strategy promotion.
- No Production tool registration during the foundation phase.
- No dependency on Family, OAuth, Market Data writer, FORMAL Blind runtime or deployment control surfaces.
- Inputs and outputs must use bounded, versioned contracts and fail closed on invalid data.

## Migration phases

1. **Foundation** — unregistered contracts and safety gates only.
2. **Shadow** — deterministic legacy/VNext comparisons on the same frozen inputs.
3. **Failure/resource validation** — prove research failures are contained and workloads remain within Cloudflare limits.
4. **Gateway switch** — only after ABI, regression, shadow and resource gates pass.
5. **Legacy retirement** — only after the switched path is proven stable.

## Foundation status

The files in this directory are intentionally not imported by `owner-content-handler.ts` or `research-tools.ts`. Adding Production registration before the required gates pass is a boundary violation.
