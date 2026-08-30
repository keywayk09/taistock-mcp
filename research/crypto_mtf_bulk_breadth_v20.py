#!/usr/bin/env python3
"""V20: 90-day screening of zero-extra-request bulk-ticker breadth proxies.

Research only. V18's simple BTC>=0 + 60% positive 24h breadth did not materially
filter the bad regime. This version screens a small, preregistered set of stricter
PRICE-ONLY 24h participation gates that can be computed from the Bybit/Gate bulk
tickers already fetched by Light Scan. No per-symbol market requests are required
for a future live implementation.

The expensive V14 breadth60 gate is included only as a research reference. Any
cheap V20 winner is discovery evidence, not a Production rule; it must survive a
separate confirmatory run / forward observation before promotion.
"""
from __future__ import annotations

import bisect
import json
from collections import defaultdict
from pathlib import Path
from statistics import median

import crypto_mtf_rr_backtest as base
import crypto_mtf_multiway_v3 as v3
import crypto_mtf_regime_v12 as v12
import crypto_mtf_regime_quality_v14 as v14
import crypto_mtf_okx_90d_v17 as v17

BASKETS = v12.BASKETS
CONFIGS = v12.CONFIGS
GATES = [
    "none",
    "reference_breadth60",
    "bulk24h_breadth70",
    "bulk24h_breadth80",
    "bulk24h_median050",
    "bulk24h_participation",
]

# These are declared before the run. Do not tune them after seeing V20 windows.
GATE_DEFINITIONS = {
    "bulk24h_breadth70": "BTC24h>=0 and advance_ratio>=0.70",
    "bulk24h_breadth80": "BTC24h>=0 and advance_ratio>=0.80",
    "bulk24h_median050": "BTC24h>=0 and advance_ratio>=0.60 and median24h>=+0.50%",
    "bulk24h_participation": "BTC24h>=+0.50% and advance_ratio>=0.70 and median24h>=+0.50%",
}


def pf(vals):
    wins = sum(x for x in vals if x > 0)
    losses = -sum(x for x in vals if x < 0)
    return wins / losses if losses > 0 else (999.0 if wins > 0 else 0.0)


def prep_cheap(rows):
    return {"rows": rows, "times": [x["t"] for x in rows]}


def ret24(prepped, cutoff):
    rows = prepped["rows"]
    times = prepped["times"]
    # Last fully closed 5m bar strictly before cutoff.
    j = bisect.bisect_left(times, cutoff) - 1
    if j < 288:
        return None
    now = rows[j]["c"]
    prev = rows[j - 288]["c"]
    return base.pct(now, prev)


def cheap_snapshot(market, cutoff):
    returns = {symbol: ret24(p, cutoff) for symbol, p in market.items()}
    vals = [v for v in returns.values() if v is not None]
    advance_ratio = sum(v > 0 for v in vals) / len(vals) if vals else 0.0
    median_return = median(vals) if vals else None
    return {
        "returns": returns,
        "advance_ratio": advance_ratio,
        "median_return": median_return,
        "btc": returns.get("BTC"),
        "eligible": len(vals),
    }


def accepts_cheap(name, snap):
    if name == "none":
        return True
    btc = snap.get("btc")
    adv = snap.get("advance_ratio", 0.0)
    med = snap.get("median_return")
    if btc is None or med is None:
        return False
    if name == "bulk24h_breadth70":
        return btc >= 0.0 and adv >= 0.70
    if name == "bulk24h_breadth80":
        return btc >= 0.0 and adv >= 0.80
    if name == "bulk24h_median050":
        return btc >= 0.0 and adv >= 0.60 and med >= 0.50
    if name == "bulk24h_participation":
        return btc >= 0.50 and adv >= 0.70 and med >= 0.50
    return False


def main():
    all_symbols = list(dict.fromkeys(BASKETS["stable_quality"] + BASKETS["volatile"]))
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

    cheap_market = {s: prep_cheap(rows) for s, rows in cache.items() if len(rows) >= 25000}
    reference_market = {s: v14.prep(rows) for s, rows in cache.items() if len(rows) >= 25000}
    if "BTC" not in cheap_market or "ETH" not in reference_market:
        raise RuntimeError("90d representative market history unavailable")

    cheap_cache = {}
    reference_cache = {}
    records = []

    for basket, symbols in BASKETS.items():
        for symbol in symbols:
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

            for i in range(300, len(rows) - base.HORIZONS["8h"] - 6):
                cutoff = rows[i]["t"] + 300
                cheap = cheap_cache.get(cutoff)
                if cheap is None:
                    cheap = cheap_snapshot(cheap_market, cutoff)
                    cheap_cache[cutoff] = cheap
                reference = reference_cache.get(cutoff)
                if reference is None:
                    reference = v14.gate_snapshot(reference_market, cutoff)
                    reference_cache[cutoff] = reference

                age = (rows[i]["t"] - t0) / span
                window = "old30d" if age < 1 / 3 else "mid30d" if age < 2 / 3 else "recent30d"

                for side, setup, d1, h4, h1, b15, _b4 in base.setup_signal(rows, i, a15, a1, a4, ad):
                    if side != "long" or setup not in CONFIGS[basket]:
                        continue
                    mtf, entry_mode, stop_mode, exit_mode = CONFIGS[basket][setup]
                    if not v3.mtf_accept(mtf, side, d1, h4, h1, basket):
                        continue
                    selected = v3.select_entry(rows, i, side, setup, entry_mode, b15)
                    if not selected:
                        continue
                    entry_idx, entry = selected
                    stop = v3.stop_for(entry, side, b15, stop_mode)
                    if stop is None:
                        continue
                    risk_pct = (entry - stop) / entry * 100
                    if risk_pct <= 0 or risk_pct > (3.0 if basket == "stable_quality" else 4.0):
                        continue

                    for gate in GATES:
                        if gate == "reference_breadth60":
                            accepted = v14.accepts("breadth60", reference)
                        else:
                            accepted = accepts_cheap(gate, cheap)
                        if not accepted:
                            continue

                        cooldown_key = (gate, setup)
                        if entry_idx - cooldown.get(cooldown_key, -10000) < 24:
                            continue
                        cooldown[cooldown_key] = entry_idx

                        r = v3.simulate(rows, entry_idx, entry, stop, side, basket, exit_mode)
                        if r is None:
                            continue
                        records.append(
                            {
                                "window": window,
                                "gate": gate,
                                "basket": basket,
                                "symbol": symbol,
                                "setup": setup,
                                "r": r,
                                "advance_ratio": cheap["advance_ratio"],
                                "median24h": cheap["median_return"],
                                "btc24h": cheap["btc"],
                                "cheap_eligible": cheap["eligible"],
                            }
                        )

    grouped = defaultdict(list)
    by_symbol = defaultdict(list)
    for x in records:
        key = (x["window"], x["gate"], x["basket"], x["setup"])
        grouped[key].append(x["r"])
        by_symbol[key + (x["symbol"],)].append(x["r"])

    summary = []
    for key, vals in sorted(grouped.items()):
        window, gate, basket, setup = key
        symbol_rows = [(k[-1], v) for k, v in by_symbol.items() if k[:-1] == key]
        summary.append(
            {
                "window": window,
                "gate": gate,
                "basket": basket,
                "setup": setup,
                "n": len(vals),
                "pf": pf(vals),
                "avg": sum(vals) / len(vals),
                "win": sum(x > 0 for x in vals) / len(vals),
                "positive_symbols": sum(sum(v) / len(v) > 0 for _, v in symbol_rows),
                "eligible_symbols": len(symbol_rows),
            }
        )

    print("\n=== V20 90D ZERO-EXTRA-REQUEST BULK BREADTH SCREEN ===")
    for r in summary:
        if r["setup"] != "trend_follow":
            continue
        print(
            f"{r['window']:9} {r['gate']:24} {r['basket']:14} {r['setup']:22} "
            f"n={r['n']:3} PF={r['pf']:.2f} avg={r['avg']:.3f} "
            f"syms={r['positive_symbols']}/{r['eligible_symbols']}"
        )

    report = {
        "research_only": True,
        "venue": "OKX historical proxy",
        "windows": 3,
        "bars_target": v17.NEED,
        "live_compatibility": "price-only fields already present in Bybit/Gate bulk ticker payloads",
        "added_live_market_requests_if_implemented": 0,
        "reference_gate": "V14 breadth60 research-only benchmark; not bulk-compatible",
        "screening_guard": "any V20 winner requires separate confirmatory validation; do not promote directly",
        "gate_definitions": GATE_DEFINITIONS,
        "coverage": coverage,
        "summary": summary,
    }
    Path("/tmp/crypto_mtf_bulk_breadth_v20.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
