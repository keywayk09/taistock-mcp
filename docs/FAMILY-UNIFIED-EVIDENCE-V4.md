# Family Unified Evidence V4

## Status

The Family read-only surface implements the shared evidence contract used by Owner/Family market research.

- Contract: `family-evidence/v1`
- Current implementation: `family-evidence/v1.2.0`
- Principle: `SAME_RESEARCH_BRAIN_DIFFERENT_PERMISSIONS`
- Identity rule: `EVIDENCE_CLASS_CANNOT_BE_SELF_PROMOTED`
- Family access: `READ_ONLY`

This contract does not change OAuth, does not add a writer, and does not alter Production OHLC or the deterministic Published history/replay pipeline.

## Evidence classes

### FORMAL_TRUTH

Only governed data with the required identity may enter this class.

Current identities:

- Canonical OHLC: only verified `OHLC_MCP` data.
- Current market chip: exact-date TWSE/TPEx on-demand official institutional, margin/short, securities-lending and SBL short-sale evidence.

Requested-date mismatch remains fail-closed/PENDING and previous-day substitution is forbidden. Fugle, FinMind prices, Web research, broker-ranked evidence, warrant turnover, TXF context, or global context cannot promote themselves into `FORMAL_TRUTH`.

### GOVERNED_CONTEXT

Structured read-only evidence that can support judgment but cannot overwrite formal truth.

Examples:

- `published_chip`: immutable Published generation history/replay context.
- `broker_branch`: MoneyDJ public-secondary `RANKED_ONLY` evidence; a missing branch is not zero activity and the list is not a complete broker inventory.
- `warrant_activity`: official TWSE/TPEx warrant activity/turnover evidence; it is non-directional and does not establish buy aggressor, broker net flow, dealer inventory or hedge direction.
- Financial statements, monthly revenue, official valuation.
- TDCC/FinMind holder distribution and foreign shareholding supplements.
- TXF market-regime context.
- Global market and global futures context.

Published history may explain prior state and deterministic replay but must not override available current official chip evidence.

### DISPLAY_FALLBACK

Display or research fallbacks only.

Examples:

- Fugle intraday quote.
- FinMind price-based technical fallback.

These sources may explain market context but cannot produce formal support/resistance, stop, entry, canonical OHLC, or current official chip claims.

### WEB_EVIDENCE

Open-world research evidence such as:

- Company filings and investor conferences.
- News and policy events.
- Supply-chain, customer, capacity, and industry research.

Web evidence must retain source and time in the final research workflow and cannot overwrite canonical/official facts.

## Family evidence bundle

Every smart single-stock or comparison analysis attaches an `evidence_bundle` with the following logical layers:

- `realtime_market`
- `canonical_ohlc`
- `technical_research_fallback`
- `current_chip`
- `broker_branch`
- `warrant_activity`
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

Current critical layers are:

- `canonical_ohlc`
- `current_chip`
- `fundamentals`

`published_chip` is valuable history/replay context but is no longer a substitute for missing current official chip evidence. If exact-date current official chip evidence is PENDING/UNAVAILABLE, the analysis must report the gap rather than promote an older Published date into current truth.

## Read-only boundary

The Family evidence contract explicitly denies:

- Production writes.
- GitHub writes from the Family runtime.
- GitHub branch/PR mutation from the Family runtime.
- Strategy changes.
- Canonical OHLC writes.
- Published market-data writes.
- Current chip raw/normalized persistence.
- Order placement.
- Secret/token reads.

Developer/repository maintenance can still occur outside the Family runtime through normal engineering workflows; the denial applies to the Family product surface and its runtime capabilities.

## Current chip handling

Owner and Family current-facing routes share the same `getTwMarketChipSummaryOnDemand` facade. The facade reads:

- TWSE/TPEx exact-date official institutional evidence.
- TWSE/TPEx exact-date official margin/short evidence.
- Official securities-lending/SBL short-sale evidence.
- MoneyDJ broker-ranked public-secondary evidence as `RANKED_ONLY` fail-soft context.
- TWSE/TPEx official warrant activity as non-directional context.
- Existing Published generation only as labelled `HISTORY_CONTEXT_ONLY`.

Current raw/normalized chip responses are not persisted. Broker branch reads do not depend on a FinMind token. True customer-account maintenance ratio is not reconstructed from public market aggregates; any estimate remains explicitly labelled as a proxy and fails closed when required inputs are absent.

## Published chip handling

The deterministic Published Gateway remains unchanged and preserves generation-fenced historical identity. Existing Published generations remain immutable for:

- historical comparison,
- deterministic replay,
- research reproducibility,
- prior-decision context.

Family/Owner current-facing routes do not call the Published gateway directly; they receive Published information only through the shared facade as historical/replay context. There is no second chip truth store and no rewrite of old receipts.

## Broker-window boundary

The MoneyDJ public interface exposes period/self-defined interval controls, but an exact URL-parameter mapping for `recent N trading days` has not yet been independently verified. Therefore this contract does not claim a verified N-trading-day broker adapter, does not guess a `b=` parameter meaning, and does not introduce daily raw-page persistence merely to manufacture that history.

## OHLC / market-regime boundaries

- Canonical Taiwan-stock OHLC remains owned by the existing OHLC MCP/canonical pipeline.
- TXF and Global Futures remain governed market-regime context and fail closed when their read adapters are unavailable.
- Family reads never trigger canonical writers.

## Judgment orchestration

The normalized evidence bundle should reason over agreement, conflict, missing evidence, confidence and risk instead of dumping raw provider JSON. Data identity must remain explicit so a later research review can distinguish a source-data failure from a GPT interpretation failure.
