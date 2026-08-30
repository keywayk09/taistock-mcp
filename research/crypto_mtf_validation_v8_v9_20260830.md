# Crypto MTF robustness validation V8/V9/V10 — 2026-08-30

Research-only. No production crypto engine rules were changed by these tests.

## V8 robustness and cost stress

Tested 30d Gate perpetual 5m history across 10 stable-quality symbols and 11 volatile symbols. Added A/B symbol split, weekly-block stability, execution variants, stop variants, fixed-2R/fixed-3R/partial exits, and 1x/1.5x/2x cost stress.

High-confidence stable-quality LONG results at base costs:
- trend_follow / hierarchical MTF / next-open / structure+ATR / 3R: n=145, PF=2.69, avg=+0.731R, positive weekly blocks 3/3, positive symbols 10/10, A split avg +0.516R, B split avg +0.962R.
- pullback_contraction / hierarchical MTF / next-open / 15m swing stop / 3R: n=125, PF=2.77, avg=+0.746R, positive weekly blocks 3/3, positive symbols 10/10, A split avg +0.675R, B split avg +0.823R.
- consolidation / hierarchical MTF / one-bar confirmation / structure+ATR / 3R: n=87, PF=2.02, avg=+0.561R, positive weekly blocks 3/3, but only 6/9 tested symbols positive; this is materially less robust than trend/pullback.

At 2x assumed transaction costs, the same stable trend setup still had PF=2.46 and avg=+0.670R; the stable pullback setup still had PF=2.54 and avg=+0.689R. Stable consolidation survived but remained weaker (PF=1.80).

High-confidence volatile/妖幣 LONG result:
- trend_follow / strict 1D+4H+1H MTF / smart retest entry / structure+ATR / 3R: n=88, PF=1.97, avg=+0.518R, positive weekly blocks 4/4, positive symbols 8/11, A split avg +0.324R, B split avg +0.712R.
- Under 2x costs it still had PF=1.80 and avg=+0.454R.

Lower-confidence volatile results:
- pullback_contraction strict next-open structure+ATR 3R: aggregate PF=1.53, avg=+0.316R, but only 1/4 positive weekly blocks. Do not promote yet.
- consolidation strict confirm structure+ATR 3R: PF=1.75, avg=+0.410R, 2/3 positive weekly blocks. Keep secondary/watch-only until more regimes confirm.

## V9 threshold, delay, risk-cap and BTC-regime sensitivity

Tested direction-threshold multipliers 0.75x / 1.0x / 1.25x, entry delay 1 or 2 bars, tighter/wider structural risk caps, and BTC 4H+1H regime splits.

Stable-quality trend remained robust across all tested threshold multipliers and one/two-bar delays. Examples:
- eps 1.0, delay 1, max risk 3.0%: n=104, PF=2.97, avg=+0.816R.
- eps 1.0, delay 2, max risk 3.0%: n=105, PF=2.76, avg=+0.751R.
- eps 0.75, delay 1, max risk 2.0%: n=91, PF=3.79, avg=+1.027R.
This indicates the edge is not dependent on one exact MTF epsilon or immediate entry bar.

Stable-quality pullback also remained positive across threshold multipliers, one/two-bar delay, and 2%-3% risk caps. Example: eps 1.0, delay 1, max risk 3.0%: n=84, PF=2.80, avg=+0.745R.

Volatile trend also remained positive across threshold perturbations. Example: eps 1.0, delay 1, max risk 4.0%: n=94, PF=2.15, avg=+0.599R. The edge was strongest in BTC risk-on periods; mixed BTC regimes remained positive but weaker. Risk-off sample counts were too small for a hard rule.

## V10 independent-venue holdout on OKX

To reduce exchange-feed overfitting risk, the same already-selected rules were run without retuning on 30d of OKX USDT perpetual 5m candles. Ten stable-quality symbols and nine available volatile symbols each returned 8,640 closed 5m bars; BLESS and ALCH do not have the requested OKX swap instrument and were excluded rather than substituted.

Stable-quality LONG replicated strongly on OKX:
- trend_follow: n=145, PF=2.97, avg=+0.821R, win 58.6%, positive symbols 10/10, positive weekly blocks 3/3.
- pullback_contraction: n=127, PF=2.34, avg=+0.597R, win 53.5%, positive symbols 10/10, positive weekly blocks 3/3.
- consolidation with one-bar confirmation: n=86, PF=2.44, avg=+0.708R, positive symbols 10/10, positive weekly blocks 3/3. This improves confidence versus Gate, but consolidation remains secondary because the Gate symbol-robustness result was weaker.

Volatile/妖幣 LONG also remained positive on OKX:
- trend_follow strict MTF + smart/retest entry: n=93, PF=2.20, avg=+0.581R, positive symbols 7/9, positive weekly blocks 2/3.
- consolidation strict + confirmation: n=85, PF=1.85, avg=+0.440R, positive symbols 7/9, positive weekly blocks 3/3.
- pullback_contraction strict: n=189, PF=1.84, avg=+0.450R, positive symbols 7/9, but only 1/3 weekly blocks positive. Keep volatile pullback watch-only despite the good aggregate PF.

The key point is that the strongest selected rules did not depend on Gate's exact candle feed: stable trend/pullback and volatile trend all survived on a second exchange with comparable or better aggregate expectancy.

## SHORT status

The separate asymmetric SHORT experiments still do not justify a general production short path. Symmetric short logic remains poor. A crowded/blowoff-reversal short pattern showed only an early hint in volatile coins (about PF 1.23 at 3R in the prior asymmetric pass), which is below the intended promotion threshold and should remain research/observation-only.

## Longer-history validation status

Gate's current futures candle endpoint was diagnosed directly from the GitHub runner. Recent `limit=100`, `to`-only, 100-point from/to and 900-point from/to requests all returned HTTP 200. However, the 60d paginator still fails once it reaches older 5m history with HTTP 400 across all tested contracts. Therefore the failed Gate 60d run is treated as a data-access limitation, not as strategy evidence.

A separate 60d OKX temporal holdout has been started using five stable-quality and five volatile symbols. It will compare prior 30d vs recent 30d without retuning. That result is the final historical gate before the engine shadow policy is frozen.

## Current recommendation before engine write

Highest-confidence candidates:
1. stable-quality LONG trend_follow: hierarchical MTF (4H+1H aligned, 1D not adverse), structure+ATR stop, 3% max structural-risk envelope, 2R decision point with runner toward 3R.
2. stable-quality LONG pullback_contraction: hierarchical MTF, 15m swing/structure stop, 3% max structural-risk envelope, 2R decision point with runner toward 3R.
3. volatile/妖幣 LONG trend_follow: strict 1D+4H+1H alignment, prefer shallow retest/smart entry instead of blind chase, structure+ATR stop, tighter ~4% max structural-risk envelope, 2R decision point with runner toward 3R.

Secondary/watch-only until temporal holdout and forward shadow confirm:
- stable consolidation with one extra 5m confirmation.
- volatile consolidation with breakout confirmation.
- volatile pullback contraction.
- all general SHORT paths.

Do not write these into Production yet. The next engine revision should be a shadow-only policy freeze, not a live promotion, after the OKX 60d prior/recent window result is reviewed.
