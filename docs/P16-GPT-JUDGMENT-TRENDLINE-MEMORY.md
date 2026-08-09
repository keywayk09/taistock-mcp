# P16 — GPT Judgment / Structure / Pattern / Trendline Memory

## Purpose

The objective is not to optimize a TradingView script first. The objective is to make GPT's market cognition measurable and progressively better, then translate repeatedly validated cognition into future engine-rule candidates.

P16 supports both Taiwan stocks and TXF.

```text
GPT current view
  -> immutable Judgment
  -> OHLC MCP frozen outcome data
  -> Judgment Review
  -> reason / structure / pattern / trendline statistics
  -> hypothesis
  -> validated or rejected Trading Knowledge
  -> later deterministic engine-rule candidate
```

## Judgment snapshot

Each judgment freezes only information available at the judgment time:

- market / symbol / timeframe / trade date
- direction and confidence
- thesis and reason codes
- market structure labels
- support / resistance levels
- patterns
- trendlines
- risk/reward score
- data watermark and knowledge cutoff

`data_watermark <= knowledge_cutoff <= judgment_ts` is mandatory.

For Taiwan stocks, trade date must match the judgment timestamp in Asia/Taipei. TXF keeps explicit TAIFEX trading-date semantics because the AFTERHOURS session crosses calendar dates.

## Trendline memory

Trendline is a first-class research object, not free-form prose.

Each line can store:

- type: support / resistance / channel boundary
- status: active / broken / reclaimed / invalidated
- quality: low / medium / high
- two or more timestamped anchors
- anchor type and strength
- volume and ATR context at anchors
- normalized slope
- touch count
- false-break count
- distance in ATR and percent
- current and projected price
- expected behavior and metadata

Every anchor timestamp must be at or before the original knowledge cutoff. Outcome knowledge cannot be used to redraw an old line.

The long-run goal is:

```text
GPT-selected trendlines
  -> anchor/touch/break/reclaim dataset
  -> outcome statistics
  -> deterministic anchor + quality model
  -> GPT-vs-engine parity study
  -> TradingView trendline indicator
```

## Pattern memory

Patterns are also structured:

- pattern type
- forming / confirmed / failed / completed
- confidence
- detection timestamp
- boundaries
- ATR compression
- volume behavior
- metadata

Pattern detection timestamps cannot be later than the original knowledge cutoff.

## Review dimensions

After an OHLC MCP frozen dataset is available, review is appended without changing the judgment:

- direction correctness
- location quality
- timing quality
- structure correctness
- pattern correctness
- trendline correctness
- risk/reward correctness
- return / MFE / MAE
- failure patterns
- attribution
- optimization hypotheses

TW_STOCK outcomes use percentage units. TXF outcomes use points. They must not be combined into one numeric expectancy.

## Trading Knowledge governance

Knowledge statuses:

- `OBSERVATION`
- `HYPOTHESIS`
- `VALIDATED`
- `REJECTED`
- `ACCEPTED`

GPT or system review may record observations, hypotheses, validation evidence or rejected beliefs. `ACCEPTED` knowledge requires an explicit `HUMAN` actor with `human_approved=true`.

Even Accepted Knowledge is not an automatic Production strategy change. A future engine rule must still pass formal backtest / walk-forward / robustness / regression governance.

## MCP tools

- `get_gpt_judgment_memory_contract`
- `record_gpt_market_judgment`
- `get_gpt_market_judgment`
- `list_gpt_market_judgments`
- `record_gpt_judgment_review`
- `analyze_gpt_judgment_history`
- `record_gpt_trading_knowledge`
- `list_gpt_trading_knowledge`

## Storage

Runtime D1 schema is created defensively by the memory module. An explicit migration is also provided:

`migrations/0005_gpt_judgment_memory.sql`

## Hard boundaries

- no direct market-data provider access
- no OHLC writes
- no future anchor/pattern information in a judgment
- no rewriting an old judgment after outcome is known
- no mixing stock percentage expectancy with TXF point expectancy
- GPT cannot self-approve Accepted Knowledge
- no automatic Production strategy modification
