# P7 Swing Outcome Path

## Purpose

P7 adds a deterministic **Swing Outcome Path** beside the existing intraday research path. It does not redefine the Taiwan swing strategy and does not promote any rule to production.

The same immutable Signal may now be evaluated through two independent research paths:

- `INTRADAY_PATH`: existing 5m deterministic backtest + selective 1m replay.
- `SWING_PATH`: 1D post-signal outcome path, default horizon 5 trading days.

## Hard boundaries

Swing Path is outcome evaluation only.

It may use future daily bars only after the Signal timestamp to measure what happened later. Those bars must never flow back into Signal generation, ranking, or the Signal Ledger.

It must not:

- fetch Fugle or any market provider directly;
- mutate OHLC;
- mutate Signal/Event Ledger rows;
- overwrite Intraday results;
- turn a hypothesis into an approved strategy;
- share Intraday stop/target/exit rules implicitly.

## Dataset contract

Input must be an exact complete frozen `ohlc-dataset/v1` 1D view returned by the OHLC MCP research gateway.

Required invariants:

- `frozen_view=true`
- `complete_view=true`
- `truncated=false`
- `formal_research_eligible=true`
- `provenance.market=tw-stock`
- `provenance.timeframe=1d`
- dataset symbol equals Signal symbol
- exact row count matches the frozen view
- SHA-256 dataset content is recomputed before evaluation

A hash mismatch fails closed.

## Reference rule

P7 v1 uses one deterministic reference rule:

`NEXT_SESSION_OPEN`

The first trading session strictly after `signal.trade_date` supplies the reference price. This avoids contaminating Swing Path with the Intraday entry model and gives every signal the same forward measurement origin.

## Output

For each available horizon D1..Dn (default n=5, maximum 20):

- horizon trade date
- directional close return from the reference open
- cumulative MFE
- cumulative MAE

Directional metrics are signed from the signal side:

- LONG: rising prices are favorable.
- SHORT: falling prices are favorable.

The result includes deterministic `swing_run_id`, dataset version/hash, signal version, parameter hash, and engine version.

## Interpretation

P7 answers questions such as:

- Did this signal have same-day edge only, or did it mature after 2-5 sessions?
- Was the forward path favorable but noisy?
- Was a short-term spike later reversed?
- Which Signal families have better D1/D3/D5 outcome distributions?

It does **not** answer whether a production swing trade should be entered. Strategy-specific entries, stops, targets, position sizing, and exits remain a later validated rule layer.
