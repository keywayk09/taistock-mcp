#!/usr/bin/env python3
"""V19: preregistered 90-day validation of setup-specific RR/horizon policies.

Research only. Candidate RR/horizon policies were selected from V16 before this
90-day run and are not re-tuned on old/mid/recent windows. Setup/MTF/entry/stop
rules stay frozen. The reference regime gate is V14 breadth60, with an ungated
control. Gate rejection happens before gate-specific cooldown consumption.

Primary policies:
- stable trend_follow:          12h fixed3
- stable pullback_contraction: 24h fixed3
- stable consolidation:         8h fixed2

Predeclared sensitivity challengers (not substitutes chosen after seeing V19):
- trend_follow:          12h partial2_3
- pullback_contraction: 24h partial2_3
- consolidation:        24h fixed2
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import crypto_mtf_rr_backtest as base
import crypto_mtf_multiway_v3 as v3
import crypto_mtf_regime_v12 as v12
import crypto_mtf_regime_quality_v14 as v14
import crypto_mtf_rr_regime_v16 as v16
import crypto_mtf_okx_90d_v17 as v17

BASKET = "stable_quality"
GATES = ["none", "breadth60"]
COST_MULTS = (1, 2)

# Locked before V19 execution from V16 evidence. Do not select a different row
# after V19 results are known; any future change must become a new version/test.
POLICIES = {
    "trend_follow": [
        {"profile": "primary_12h_fixed3", "horizon": "12h", "exit": "fixed3", "primary": True},
        {"profile": "sensitivity_12h_partial2_3", "horizon": "12h", "exit": "partial2_3", "primary": False},
    ],
    "pullback_contraction": [
        {"profile": "primary_24h_fixed3", "horizon": "24h", "exit": "fixed3", "primary": True},
        {"profile": "sensitivity_24h_partial2_3", "horizon": "24h", "exit": "partial2_3", "primary": False},
    ],
    "consolidation": [
        {"profile": "primary_8h_fixed2", "horizon": "8h", "exit": "fixed2", "primary": True},
        {"profile": "sensitivity_24h_fixed2", "horizon": "24h", "exit": "fixed2", "primary": False},
    ],
}


def pf(vals):
    wins = sum(x for x in vals if x > 0)
    losses = -sum(x for x in vals if x < 0)
    return wins / losses if losses > 0 else (999.0 if wins > 0 else 0.0)


def main():
    # Breadth is computed from the same representative market basket used by V14.
    all_symbols = list(dict.fromkeys(v12.BASKETS["stable_quality"] + v12.BASKETS["volatile"]))
    cache = {}
    coverage = []
    for symbol in all_symbols:
        try:
            rows = v17.fetch90(symbol)
            cache[symbol] = rows
            print("FETCH_OK", symbol, len(rows))
            coverage.append({"symbol": symbol, "bars": len(rows)})
        except Exception as exc:
            cache[symbol] = []
            print("FETCH_FAIL", symbol, repr(exc))
            coverage.append({"symbol": symbol, "bars": 0, "error": str(exc)})

    market = {s: v14.prep(rows) for s, rows in cache.items() if len(rows) >= 25000}
    if "BTC" not in market or "ETH" not in market:
        raise RuntimeError("90d benchmark history unavailable")

    records = []
    snap_cache = {}
    max_horizon = max(v16.HORIZONS[p["horizon"]] for plist in POLICIES.values() for p in plist)
    config = v12.CONFIGS[BASKET]

    for symbol in v12.BASKETS[BASKET]:
        rows = cache.get(symbol) or []
        if len(rows) < 25000:
            continue

        a15 = base.prep_agg(rows, 900)
        a1 = base.prep_agg(rows, 3600)
        a4 = base.prep_agg(rows, 14400)
        ad = base.prep_agg(rows, 86400)
        t0 = rows[0]["t"]
        t1 = rows[-1]["t"] + 300
        span = t1 - t0
        cooldown = {}

        for i in range(220, len(rows) - max_horizon - 6):
            cutoff = rows[i]["t"] + 300
            snap = snap_cache.get(cutoff)
            if snap is None:
                snap = v14.gate_snapshot(market, cutoff)
                snap_cache[cutoff] = snap

            age = (rows[i]["t"] - t0) / span
            window = "old30d" if age < 1 / 3 else "mid30d" if age < 2 / 3 else "recent30d"

            for side, setup, d1, h4, h1, b15, _b4 in base.setup_signal(rows, i, a15, a1, a4, ad):
                if side != "long" or setup not in POLICIES or setup not in config:
                    continue

                mtf, entry_mode, stop_mode, _ = config[setup]
                if not v3.mtf_accept(mtf, side, d1, h4, h1, BASKET):
                    continue
                selected = v3.select_entry(rows, i, side, setup, entry_mode, b15)
                if not selected:
                    continue
                entry_idx, entry = selected
                stop = v3.stop_for(entry, side, b15, stop_mode)
                if stop is None:
                    continue
                risk_pct = (entry - stop) / entry * 100
                if risk_pct <= 0 or risk_pct > 3.0:
                    continue

                for gate in GATES:
                    if gate == "breadth60" and not v14.accepts("breadth60", snap):
                        continue

                    # Corrected methodology: only an accepted, valid entry consumes
                    # this gate+setup cooldown. Rejected gate signals consume nothing.
                    cooldown_key = (gate, setup)
                    if entry_idx - cooldown.get(cooldown_key, -10000) < 24:
                        continue
                    cooldown[cooldown_key] = entry_idx

                    for policy in POLICIES[setup]:
                        horizon_bars = v16.HORIZONS[policy["horizon"]]
                        for cost_mult in COST_MULTS:
                            r = v16.simulate(
                                rows,
                                entry_idx,
                                entry,
                                stop,
                                side,
                                BASKET,
                                policy["exit"],
                                horizon_bars,
                                cost_mult,
                            )
                            if r is None:
                                continue
                            records.append(
                                {
                                    "window": window,
                                    "gate": gate,
                                    "basket": BASKET,
                                    "symbol": symbol,
                                    "setup": setup,
                                    "profile": policy["profile"],
                                    "primary": policy["primary"],
                                    "horizon": policy["horizon"],
                                    "exit": policy["exit"],
                                    "cost_mult": cost_mult,
                                    "r": r,
                                }
                            )

    grouped = defaultdict(list)
    by_symbol = defaultdict(list)
    for x in records:
        key = (
            x["window"], x["gate"], x["setup"], x["profile"], x["primary"],
            x["horizon"], x["exit"], x["cost_mult"],
        )
        grouped[key].append(x["r"])
        by_symbol[key + (x["symbol"],)].append(x["r"])

    summary = []
    for key, vals in sorted(grouped.items()):
        window, gate, setup, profile, primary, horizon, exit_mode, cost_mult = key
        symbol_rows = [(k[-1], v) for k, v in by_symbol.items() if k[:-1] == key]
        summary.append(
            {
                "window": window,
                "gate": gate,
                "basket": BASKET,
                "setup": setup,
                "profile": profile,
                "primary": primary,
                "horizon": horizon,
                "exit": exit_mode,
                "cost_mult": cost_mult,
                "n": len(vals),
                "pf": pf(vals),
                "avg": sum(vals) / len(vals),
                "win": sum(x > 0 for x in vals) / len(vals),
                "positive_symbols": sum(sum(v) / len(v) > 0 for _, v in symbol_rows),
                "eligible_symbols": len(symbol_rows),
            }
        )

    print("\n=== V19 PREREGISTERED 90D SETUP-SPECIFIC RR POLICY ===")
    for r in summary:
        if r["gate"] != "breadth60" or r["cost_mult"] != 2:
            continue
        tag = "PRIMARY" if r["primary"] else "SENS"
        print(
            f"{r['window']:9} {r['setup']:22} {tag:7} {r['horizon']:3} {r['exit']:10} "
            f"n={r['n']:3} PF={r['pf']:.2f} avg={r['avg']:.3f} "
            f"win={r['win']:.1%} syms={r['positive_symbols']}/{r['eligible_symbols']}"
        )

    report = {
        "research_only": True,
        "venue": "OKX",
        "windows": 3,
        "bars_target": v17.NEED,
        "method": "preregistered_v16_profiles_gate_before_gate_specific_entry_cooldown",
        "promotion_guard": "do_not_reselect_policy_after_v19_results",
        "policies": POLICIES,
        "coverage": coverage,
        "summary": summary,
    }
    Path("/tmp/crypto_mtf_okx_90d_rr_policy_v19.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
