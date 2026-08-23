# Family Unified Evidence V4

## Status

Phase 1 contract is implemented on the Family read-only surface.

- Contract: `family-evidence/v1`
- Principle: `SAME_RESEARCH_BRAIN_DIFFERENT_PERMISSIONS`
- Identity rule: `EVIDENCE_CLASS_CANNOT_BE_SELF_PROMOTED`
- Family access: `READ_ONLY`

This phase does not change OAuth, does not add a writer, and does not alter Production OHLC or Published market-data pipelines.

## Evidence classes

### FORMAL_TRUTH

Only governed data with the required identity may enter this class.

Current identities:

- Canonical OHLC: only verified `OHLC_MCP` data.
- Market chip: only generation-fenced `PUBLISHED_GENERATION` data.

Fugle, FinMind prices, Web research, TXF context, or global context cannot be promoted into `FORMAL_TRUTH` by the Family layer.

### GOVERNED_CONTEXT

Structured read-only evidence that can support judgment but cannot overwrite formal truth.

Examples:

- Financial statements, monthly revenue, official valuation.
- TDCC/FinMind holder distribution and foreign shareholding supplements.
- TXF market-regime context.
- Global market and global futures context.

### DISPLAY_FALLBACK

Display or research fallbacks only.

Examples:

- Fugle intraday quote.
- FinMind price-based technical fallback.

These sources may explain market context but cannot produce formal support/resistance, stop, entry, or canonical OHLC claims.

### WEB_EVIDENCE

Open-world research evidence such as:

- Company filings and investor conferences.
- News and policy events.
- Supply-chain, customer, capacity, and industry research.

Web evidence must retain source and time in the final research workflow and cannot overwrite canonical/official facts.

## Family evidence bundle

Every smart single-stock or comparison analysis now attaches an `evidence_bundle` with the following logical layers:

- `realtime_market`
- `canonical_ohlc`
- `technical_research_fallback`
- `published_chip`
- `holder_structure`
- `fundamentals`
- `txf_context`
- `global_market_context`
- `global_futures_context`
- `web_evidence`

Each node contains a common identity envelope:

- `status`
- `evidence_class`
- `as_of`
- `source`
- `verification_level`
- `formal_research_eligible`
- `dataset_version`
- `provenance`
- `error`
- `notes`

## Decision readiness

The bundle returns:

- `state`
- `missing_critical`
- `degraded_sources`
- `usable_context`
- `formal_truth_ready`
- `formal_truth_missing`

Phase 1 treats these as critical:

- `canonical_ohlc`
- `published_chip`
- `fundamentals`

Until the OHLC MCP adapter is attached, a normal analysis is expected to be `DEGRADED`, not falsely `READY`, when other evidence remains usable.

## Read-only boundary

The Family evidence contract explicitly denies:

- Production writes.
- GitHub writes from the Family runtime.
- GitHub branch/PR mutation from the Family runtime.
- Strategy changes.
- Canonical OHLC writes.
- Published market-data writes.
- Order placement.
- Secret/token reads.

Developer/repository maintenance can still occur outside the Family runtime through normal engineering workflows; the denial applies to the Family product surface and its runtime capabilities.

## Published chip handling

The Family evidence layer consumes the existing Published Gateway and preserves its generation-fenced identity. It exposes a compact judgment payload containing:

- Institutional windows/latest/recent rows.
- Margin windows/latest/recent rows.
- Securities-lending windows/latest/recent rows.
- SBL short-sale windows/latest/recent rows.
- Maintenance-risk context.
- Publication receipt/data-quality metadata.

It does not create a second chip truth store.

## Next phases

### Phase 2 — OHLC + TXF read bridge

Attach read-only adapters for:

- Canonical Taiwan-stock OHLC.
- TXF `1D / 5m / 1m` market-regime context.

Only the OHLC MCP adapter may turn `canonical_ohlc.formal_research_eligible` true.

### Phase 3 — Global read plane

Attach:

- Global OHLC read context.
- Global Futures read-only adapter and session-integrity checks.

The old Global Futures pilot writer must not be called by Family reads.

### Phase 4 — Global Futures production data plane

Promote the existing pilot only after contract-roll, session, calendar, delayed-tail, verification receipt, retention, and cross-source verification are production-ready.

### Phase 5 — Judgment orchestration

Use the normalized evidence bundle to reason over agreement, conflict, missing evidence, confidence, and risk rather than dumping raw provider JSON.
