# P11 Research Validation Suite

P11 adds deterministic robustness validation to the Diamond Engine Research & Validation Lab. The implementation is original Diamond code inspired by the validation categories used by Vibe-Trading; no external code is bulk-imported.

## Scope

P11 adds four read-only research tools:

- `run_walk_forward_validation`
- `run_bootstrap_validation`
- `run_monte_carlo_validation`
- `run_research_validation_suite`

These tools consume **already-computed immutable trade outcomes**. They do not fetch OHLC, news, fundamentals, or external provider data.

## Walk-Forward

Walk-Forward accepts multiple candidate/parameter runs that contain the exact same chronological case set.

Each fold is strictly:

`TRAIN -> select candidate -> TEST`

Only the Train window may be used to rank/select a candidate. The following Test window is then evaluated out-of-sample. Future Test rows never participate in selection.

Supported selection metrics:

- expectancy
- profit factor

Output includes:

- fold train/test boundaries
- selected candidate and parameter version
- train metrics used for selection
- test metrics
- out-of-sample aggregate metrics
- candidate selection counts / stability

## Bootstrap

Bootstrap resamples the fixed trade outcome set **with replacement**.

It reports distributions for:

- expectancy
- profit factor
- compounded return
- probability expectancy > 0
- probability profit factor > 1

Randomness is deterministic. The seed is either supplied explicitly or derived from immutable input content. `Math.random()` is not used.

## Monte Carlo

P11 Monte Carlo performs seeded **return-sequence permutation** on the same fixed set of trade returns. It measures path risk without inventing new trades.

It reports distributions for:

- maximum drawdown
- longest losing streak
- compounded terminal return

Because only order changes, compounded terminal return should remain invariant apart from floating-point noise.

## Validation Suite

`run_research_validation_suite` runs:

- Bootstrap
- Monte Carlo
- optional Walk-Forward when aligned candidates are supplied

The suite receives a deterministic versioned run identity and recommends persisting the result to P8 Experiment Memory.

## Governance boundary

P11 does not approve strategies.

Every result explicitly carries:

`production_promotion = FORBIDDEN`

The intended lifecycle remains:

`Hypothesis -> Development -> Backtest -> P11 Validation -> Experiment Memory -> Candidate -> Human Approval Gate`

P11 therefore strengthens evidence but never bypasses Strategy Lab governance.

## Data / look-ahead boundary

P11 does not fetch data. Dataset freezing, SHA-256 versioning, provenance, Signal timestamps, and no-lookahead data construction happen upstream in P1-P7.

P11 assumes each supplied trade result already belongs to a known immutable research run. The validation layer then operates only on those fixed outcomes.

## Diamond capability state

After P11:

Active internal Research Lab capabilities include:

- deterministic 5m backtest
- 5m batch backtest
- selective 1m replay
- Swing Outcome Path
- Experiment Memory / Review
- Walk-Forward
- Bootstrap
- Monte Carlo

Benchmark, Run Card, Shadow Account, and broader Alpha Research workflow remain candidate capabilities for later adaptation.
