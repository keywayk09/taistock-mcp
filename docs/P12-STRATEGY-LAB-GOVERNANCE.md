# P12 Strategy Lab Governance

P12 turns the 15 `daily_stock_analysis` Strategy Skills from a catalog entry into governed Diamond Engine research candidates.

## Source snapshot

Upstream repository:

`ZhuLinsen/daily_stock_analysis`

License observed at intake: **MIT**.

P12 does not bulk-copy the upstream YAML content. Instead it locks each candidate to the exact upstream GitHub blob SHA that was audited on 2026-08-09. The immutable source identity is stored as:

`github-blob:<sha>`

This makes future upstream changes visible instead of silently changing our research definition.

## The 15 registered candidates

- bottom_volume
- box_oscillation
- bull_trend
- chan_theory
- dragon_head
- emotion_cycle
- event_driven
- expectation_repricing
- growth_quality
- hot_theme
- ma_golden_cross
- one_yang_three_yin
- shrink_pullback
- volume_breakout
- wave_theory

All 15 remain:

- Research only
- not formalized into Diamond deterministic rules
- not Taiwan-semantics calibrated
- not validated on Taiwan market history
- Production disabled

## Formalization classes

### Fully quantifiable candidate

Examples include MA golden cross, volume breakout, shrink pullback, bottom volume and box oscillation.

Required treatment:

- extract deterministic rule definitions
- remove natural-language ambiguity
- bind every feature to time-safe inputs
- version all parameters
- add deterministic unit / Golden Dataset tests

### Semi-quantitative candidate

Examples include bull trend, Chan theory, wave theory, one-yang-three-yin and growth quality.

Required treatment:

- separate mechanical core from contextual judgment
- validate the mechanical and contextual variants separately
- make context evidence explicit and time-watermarked
- never let context rewrite historical Signal state

### Research / LLM candidate

Examples include dragon head, emotion cycle, event driven, expectation repricing and hot theme.

These are not treated as executable strategies. They are research frameworks that may generate a separate versioned hypothesis. Any extracted trading rule must then enter the normal P5/P7/P11/P8 validation path.

## Validation path

For every candidate:

`Source Audit`
→ `Formalization`
→ `Taiwan Semantic Calibration`
→ `Time-safe Data Mapping`
→ `P5 and/or P7 Backtest`
→ `P11 Walk-Forward + Bootstrap + Monte Carlo`
→ `Regime Test`
→ `P8 Experiment Memory`
→ `Regression`
→ `Human Candidate Gate`

P12 deliberately stops at Candidate.

There is no Production promotion action in this layer.

## Candidate Gate

`evaluate_strategy_candidate_gate` requires evidence for:

- matching immutable source version
- formalization complete
- Taiwan semantic calibration
- time-safe data mapping
- P2 dataset provenance
- backtest evidence
- P11 Walk-Forward
- P11 Bootstrap
- P11 Monte Carlo
- Regime test
- regression pass
- P8 Experiment Memory
- human Candidate approval

If all are present, the only permitted transition is:

`MARK_CANDIDATE_ONLY`

Otherwise:

`KEEP_RESEARCH`

`Production promotion = FORBIDDEN` in both cases.

## MCP tools

- `list_strategy_lab_candidates`
- `get_strategy_lab_candidate`
- `build_strategy_validation_plan`
- `evaluate_strategy_candidate_gate`

These are governance/research tools. They do not fetch external code at runtime, write OHLC, execute external YAML directly, or enable a Production trading rule.
