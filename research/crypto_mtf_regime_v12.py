#!/usr/bin/env python3
"""Regime-conditioned 60d holdout for selected crypto LONG policies.

The V11 temporal holdout showed a major regime split: the same LONG rules were
negative in the earlier 30d and strongly positive in the recent 30d. This test
keeps the already-selected setup/entry/stop rules fixed and varies only a small,
predefined market-regime gate based on fully closed BTC/ETH 1D/4H/1H bars.
No production code is touched.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import crypto_mtf_rr_backtest as base
import crypto_mtf_multiway_v3 as v3
import crypto_mtf_okx_60d_v11 as v11

BASKETS = {
    "stable_quality": ["BTC", "ETH", "SOL", "XRP", "LINK"],
    "volatile": ["WIF", "PENGU", "PEPE", "BONK", "TURBO"],
}
CONFIGS = {
    "stable_quality": {
        "trend_follow": ("hier", "next_open", "structure_atr", "fixed3"),
        "pullback_contraction": ("hier", "next_open", "swing15", "fixed3"),
        "consolidation": ("hier", "confirm1", "structure_atr", "fixed3"),
    },
    "volatile": {
        "trend_follow": ("strict", "smart", "structure_atr", "fixed3"),
        "pullback_contraction": ("strict", "next_open", "structure_atr", "fixed3"),
        "consolidation": ("strict", "confirm1", "structure_atr", "fixed3"),
    },
}
REGIME_GATES = ["none", "btc_swing_on", "btc_eth_breadth_on", "btc_eth_strict_on"]


def pf(vals):
    w = sum(x for x in vals if x > 0)
    l = -sum(x for x in vals if x < 0)
    return w / l if l > 0 else (999.0 if w > 0 else 0.0)


def prep_market(rows):
    return {
        "1h": base.prep_agg(rows, 3600),
        "4h": base.prep_agg(rows, 14400),
        "1d": base.prep_agg(rows, 86400),
    }


def market_dirs(prepped, cutoff):
    b1 = base.latest_closed(prepped["1h"], cutoff)
    b4 = base.latest_closed(prepped["4h"], cutoff)
    bd = base.latest_closed(prepped["1d"], cutoff)
    return {
        "1h": base.direction(b1, 6, 0.25),
        "4h": base.direction(b4, 6, 0.75),
        "1d": base.direction(bd, 5, 1.5),
    }


def swing_on(d):
    return d["4h"] == "up" and d["1h"] == "up" and d["1d"] != "down"


def strict_on(d):
    return d["1d"] == "up" and d["4h"] == "up" and d["1h"] == "up"


def gate_accept(name, btc, eth):
    if name == "none":
        return True
    if name == "btc_swing_on":
        return swing_on(btc)
    if name == "btc_eth_breadth_on":
        # Require BTC leadership and at least non-adverse ETH swing context.
        return swing_on(btc) and eth["4h"] != "down" and eth["1h"] != "down" and eth["1d"] != "down"
    if name == "btc_eth_strict_on":
        return strict_on(btc) and strict_on(eth)
    return False


def main():
    cache = {}
    coverage = []
    for basket, symbols in BASKETS.items():
        for symbol in symbols:
            if symbol in cache:
                continue
            try:
                rows = v11.fetch_okx_5m(symbol)
                cache[symbol] = rows
                print("FETCH_OK", basket, symbol, len(rows))
                coverage.append({"basket": basket, "symbol": symbol, "bars": len(rows)})
            except Exception as exc:
                print("FETCH_FAIL", basket, symbol, repr(exc))
                cache[symbol] = []
                coverage.append({"basket": basket, "symbol": symbol, "bars": 0, "error": str(exc)})

    if len(cache.get("BTC", [])) < 15000 or len(cache.get("ETH", [])) < 15000:
        raise RuntimeError("BTC/ETH 60d benchmark history unavailable")
    btc_market = prep_market(cache["BTC"])
    eth_market = prep_market(cache["ETH"])

    records = []
    for basket, symbols in BASKETS.items():
        for symbol in symbols:
            rows = cache.get(symbol) or []
            if len(rows) < 15000:
                continue
            a15 = base.prep_agg(rows, 900)
            a1 = base.prep_agg(rows, 3600)
            a4 = base.prep_agg(rows, 14400)
            ad = base.prep_agg(rows, 86400)
            midpoint = (rows[0]["t"] + rows[-1]["t"]) // 2
            cooldown = {}
            for i in range(220, len(rows) - base.HORIZONS["8h"] - 6):
                cutoff = rows[i]["t"] + 300
                btc_dirs = market_dirs(btc_market, cutoff)
                eth_dirs = market_dirs(eth_market, cutoff)
                for side, setup, d1, h4, h1, b15, b4 in base.setup_signal(rows, i, a15, a1, a4, ad):
                    if side != "long" or setup not in CONFIGS[basket]:
                        continue
                    if i - cooldown.get(setup, -10000) < 24:
                        continue
                    cooldown[setup] = i
                    mtf, em, sm, xm = CONFIGS[basket][setup]
                    if not v3.mtf_accept(mtf, side, d1, h4, h1, basket):
                        continue
                    ent = v3.select_entry(rows, i, side, setup, em, b15)
                    if not ent:
                        continue
                    ei, entry = ent
                    stop = v3.stop_for(entry, side, b15, sm)
                    if stop is None:
                        continue
                    risk_pct = (entry - stop) / entry * 100
                    if risk_pct <= 0 or risk_pct > (3.0 if basket == "stable_quality" else 4.0):
                        continue
                    rr = v3.simulate(rows, ei, entry, stop, side, basket, xm)
                    if rr is None:
                        continue
                    window = "prior30d" if rows[i]["t"] < midpoint else "recent30d"
                    for gate in REGIME_GATES:
                        if gate_accept(gate, btc_dirs, eth_dirs):
                            records.append({
                                "window": window,
                                "gate": gate,
                                "basket": basket,
                                "symbol": symbol,
                                "setup": setup,
                                "r": rr,
                                "btc": btc_dirs,
                                "eth": eth_dirs,
                            })

    grouped = defaultdict(list)
    symbols = defaultdict(list)
    for r in records:
        k = (r["window"], r["gate"], r["basket"], r["setup"])
        grouped[k].append(r["r"])
        symbols[(r["window"], r["gate"], r["basket"], r["setup"], r["symbol"])].append(r["r"])

    summary = []
    for (window, gate, basket, setup), vals in sorted(grouped.items()):
        symrows = []
        for (w, g, b, s, sym), sv in symbols.items():
            if (w, g, b, s) == (window, gate, basket, setup):
                symrows.append({"symbol": sym, "n": len(sv), "pf": pf(sv), "avg": sum(sv) / len(sv)})
        summary.append({
            "window": window,
            "gate": gate,
            "basket": basket,
            "setup": setup,
            "n": len(vals),
            "pf": pf(vals),
            "avg": sum(vals) / len(vals),
            "win": sum(x > 0 for x in vals) / len(vals),
            "positive_symbols": sum(x["avg"] > 0 for x in symrows),
            "eligible_symbols": len(symrows),
        })

    print("\n=== V12 REGIME-CONDITIONED 60D HOLDOUT ===")
    for r in summary:
        print(f"{r['window']:9} {r['gate']:20} {r['basket']:14} {r['setup']:22} n={r['n']:3} PF={r['pf']:.2f} avg={r['avg']:.3f} win={r['win']:.1%} syms={r['positive_symbols']}/{r['eligible_symbols']}")

    Path('/tmp/crypto_mtf_regime_v12.json').write_text(json.dumps({
        "research_only": True,
        "venue": "OKX",
        "purpose": "regime_filter_after_v11_temporal_failure",
        "coverage": coverage,
        "summary": summary,
    }, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
