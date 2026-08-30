# Crypto MTF robustness validation V8/V9 — 2026-08-30

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

## SHORT status

The separate asymmetric SHORT experiments still do not justify a general production short path. Symmetric short logic remains poor. A crowded/blowoff-reversal short pattern showed only an early hint in volatile coins (about PF 1.23 at 3R in the prior asymmetric pass), which is below the intended promotion threshold and should remain research/observation-only.

## 60d independent-window attempt

A true prior-30d vs recent-30d 5m validation was attempted twice. Gate returned HTTP 400 when paging beyond the currently accessible 5m history window. This run must not be counted as successful out-of-sample validation. The valid robustness evidence above therefore still comes from the latest 30d, with weekly temporal blocks, A/B symbol holdout, cost stress, entry-delay stress, and threshold perturbation.

## Current recommendation before engine write

Promotable candidates for a later shadow implementation:
1. stable-quality LONG trend_follow: hierarchical MTF (4H+1H aligned, 1D not adverse), structure+ATR stop, target/runner toward 3R.
2. stable-quality LONG pullback_contraction: hierarchical MTF, 15m swing or structure stop, target/runner toward 3R.
3. volatile/妖幣 LONG trend_follow: strict 1D+4H+1H alignment, prefer retest/smart entry, structure+ATR stop, target/runner toward 3R.

Keep watch-only for now:
- stable consolidation (positive but weaker symbol robustness).
- volatile pullback contraction.
- volatile consolidation.
- all general SHORT paths.

Do not write these into Production yet. Final engine write should follow one more forward/shadow validation pass, especially for volatile setups and all SHORT logic.
