# Crypto MTF promotion criteria — 2026-08-30

This file is intentionally written before V14/V15 results are known. Its purpose is to prevent cherry-picking a regime filter after seeing the answer.

## General rule

No research rule is promoted to the Production crypto engine merely because the latest 30-day window is profitable. Production promotion requires temporal robustness, symbol breadth, realistic costs, and no look-ahead.

## LONG promotion gate

A setup/regime combination may advance from research to shadow-candidate only when all of the following hold:

1. Independent OKX 60-day temporal split: PF >= 1.20 and average R > 0 in both prior30d and recent30d.
2. Minimum sample: at least 15 trades in each 30-day window. Smaller samples remain research-only even if PF is high.
3. Symbol breadth: at least 60% of eligible symbols have positive average R in each window where at least 3 symbols are eligible.
4. The regime gate must retain a meaningful share of the profitable recent window; a tiny filter that simply removes almost every trade is not promotable.
5. Existing cost/entry-delay/threshold perturbation evidence must remain positive. No new rule may depend on one exact epsilon or immediate entry bar.
6. No future bar may be used in regime classification, setup classification, entry selection, or stop construction.

## SHORT promotion gate

SHORT is intentionally asymmetric and has a higher bar because V5/V13 evidence has been weak.

1. PF >= 1.30 and average R > 0 in both temporal windows.
2. At least 20 trades total and at least 8 trades in each window.
3. Positive average R in a majority of eligible symbols in both windows.
4. Must remain positive under a dedicated risk-off gate; symmetric inversion of LONG rules is not sufficient.
5. Until these conditions pass, SHORT remains observation-only and must not be surfaced as an actionable entry recommendation.

## Risk/reward policy if a setup is eventually promoted

- Structural stop defines 1R.
- 2R is a decision point, not a universal full-exit cap.
- A remaining runner may target approximately 3R only while higher-timeframe structure remains intact.
- Stable-quality initial structural risk cap: 3% of entry price.
- Volatile/妖幣 initial structural risk cap: 4% of entry price.
- Do not hard-reject a candidate merely because it is near a 4H range edge; prior tests showed that generic range-edge rejection removes valid breakouts.

## Current pre-V14/V15 status

- Stable-quality LONG trend-follow and pullback have strong recent-window evidence but failed the prior30d temporal holdout without an effective regime gate.
- Volatile LONG trend-follow has strong recent evidence but also failed the prior30d temporal holdout.
- Simple BTC/ETH short-horizon directional regime gates in V12 did not restore positive expectancy in the prior30d window.
- V13 SHORT risk-off conditioning did not establish a robust production SHORT lane.
- Therefore Production remains unchanged until a regime model passes the criteria above.
