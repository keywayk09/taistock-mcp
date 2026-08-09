# P9 Diamond Capability Registry

P9 makes the previously agreed Diamond Engine product architecture explicit in code without collapsing service boundaries.

## Product-level integration, service-level separation

The user-facing Diamond Engine now has four named internal areas:

1. **Tool Registry** — market data, research data, and workflow capabilities.
2. **Research & Validation Lab** — deterministic backtest/replay/swing/experiment capabilities and future validation methods.
3. **Strategy Lab** — external and internal strategy candidates before formal approval.
4. **Intelligence Core** — orchestration, ranking, review, comparison, and hypothesis generation.

P9 is a registry/control-surface milestone. It does not pretend an external capability is live merely because it appears in the catalog.

## Overseas market data

Overseas OHLC is now a formal Diamond Tool Registry product capability for:

- US stocks / ETFs
- Hong Kong
- China A-shares
- Japan
- Korea
- global indexes
- crypto
- FX / metals
- futures

Every overseas OHLC capability is currently marked `CANDIDATE_EXTERNAL` until its governed adapter is implemented.

The mandatory implementation path is:

`External Provider -> OHLC MCP Provider Adapter -> normalization -> Data Quality Gate -> dataset version/hash/provenance -> Diamond Tool Registry`

Diamond Engine itself must never call Yahoo, YFinance, Longbridge, Fugle, or another OHLC provider directly.

## Research & Validation Lab

Active internal capabilities:

- deterministic 5m backtest
- large-sample 5m batch backtest
- selective 1m replay
- Swing Outcome Path
- Experiment Memory / Review

Vibe-Trading-derived method candidates are formally cataloged but not marked implemented:

- Walk-Forward
- Monte Carlo
- Bootstrap
- Benchmark / Alpha comparison
- Research Run Card
- Shadow Account / journal
- Alpha research workflow

Activation requires adaptation to the Diamond contracts for frozen datasets, provenance, no-lookahead, deterministic runs where applicable, and Experiment Memory.

## Strategy Lab

The 15 strategy YAML files currently present in `ZhuLinsen/daily_stock_analysis/strategies` are registered as external candidates:

`bottom_volume`, `box_oscillation`, `bull_trend`, `chan_theory`, `dragon_head`, `emotion_cycle`, `event_driven`, `expectation_repricing`, `growth_quality`, `hot_theme`, `ma_golden_cross`, `one_yang_three_yin`, `shrink_pullback`, `volume_breakout`, `wave_theory`.

They are **not** declared effective Taiwan strategies. Every item is:

- `validated_on_taiwan_market=false`
- `production_enabled=false`
- `status=CANDIDATE_EXTERNAL`

Required path before any promotion:

`audit -> formalization -> Taiwan semantic calibration -> data mapping -> historical backtest -> walk-forward -> MFE/MAE -> regime test -> robustness -> regression -> human approval gate`

## External projects

- `ZhuLinsen/daily_stock_analysis` -> Tool Registry + Strategy Lab
- `HKUDS/Vibe-Trading` -> Tool Registry + Research & Validation Lab
- `mattpocock/skills` -> AI Toolbox / Engineering Control Plane only
- `PrimeIntellect-ai/prime-agent` -> AI Toolbox sandbox-only runtime candidate

External repositories are not bulk-imported into the trading core.

## P9 safety property

P9 registers **capabilities and governance state**, not unchecked network access. This allows the Diamond product surface to be built now while P10 can implement overseas OHLC adapters in the correct OHLC MCP data plane later.
