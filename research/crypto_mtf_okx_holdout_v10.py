#!/usr/bin/env python3
"""Independent-venue validation of selected crypto LONG policies on OKX swaps.

Research only. This intentionally reuses the already-selected setup/MTF/execution
logic but changes the price venue from Gate to OKX. The goal is not to optimize
parameters on OKX; it is to check whether the Gate-discovered edge survives a
different exchange feed and microstructure.
"""
from __future__ import annotations

import json, math, time, urllib.parse, urllib.request
from collections import defaultdict
from pathlib import Path

import crypto_mtf_rr_backtest as base
import crypto_mtf_multiway_v3 as v3

OKX_HISTORY = "https://www.okx.com/api/v5/market/history-candles"
INTERVAL_MS = 5 * 60 * 1000
DAYS = 30
NEED = DAYS * 24 * 12

BASKETS = {
    "stable_quality": ["BTC", "ETH", "SOL", "XRP", "DOGE", "LINK", "ADA", "AVAX", "SUI", "APT"],
    "volatile": ["WIF", "PENGU", "FARTCOIN", "PEPE", "ONT", "BLESS", "ALCH", "BONK", "TURBO", "POPCAT", "MOODENG"],
}

CONFIGS = {
    "stable_quality": {
        "trend_follow": ("hier", "next_open", "structure_atr", "fixed3"),
        "pullback_contraction": ("hier", "next_open", "swing15", "fixed3"),
        # Secondary policy retained only as a comparison/control.
        "consolidation": ("hier", "confirm1", "structure_atr", "fixed3"),
    },
    "volatile": {
        "trend_follow": ("strict", "smart", "structure_atr", "fixed3"),
        # Secondary policies retained only as comparison/control; not promotion candidates.
        "pullback_contraction": ("strict", "next_open", "structure_atr", "fixed3"),
        "consolidation": ("strict", "confirm1", "structure_atr", "fixed3"),
    },
}


def _num(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except Exception:
        return None


def request_json(url, tries=5):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "crypto-mtf-okx-holdout-v10"})
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as exc:
            last = exc
            time.sleep(0.7 * (attempt + 1))
    raise last


def fetch_okx_5m(symbol: str):
    inst_id = f"{symbol}-USDT-SWAP"
    out = {}
    after = None
    pages = 0
    oldest_seen = None
    while len(out) < NEED and pages < 110:
        params = {"instId": inst_id, "bar": "5m", "limit": "100"}
        if after is not None:
            params["after"] = str(after)
        payload = request_json(f"{OKX_HISTORY}?{urllib.parse.urlencode(params)}")
        if not isinstance(payload, dict) or payload.get("code") != "0":
            raise RuntimeError(f"okx_code={payload.get('code') if isinstance(payload, dict) else 'non_dict'} msg={payload.get('msg') if isinstance(payload, dict) else ''}")
        data = payload.get("data") or []
        if not data:
            break
        page_oldest = None
        for item in data:
            if not isinstance(item, list) or len(item) < 9:
                continue
            ts = int(_num(item[0]) or 0)
            o, h, l, c = map(_num, item[1:5])
            qv = _num(item[7])
            confirm = str(item[8])
            if not ts or confirm != "1" or any(x is None for x in (o, h, l, c)):
                continue
            t = ts // 1000
            out[t] = {"t": t, "o": o, "h": h, "l": l, "c": c, "qv": qv, "v": _num(item[5])}
            page_oldest = ts if page_oldest is None else min(page_oldest, ts)
        if page_oldest is None:
            break
        if oldest_seen is not None and page_oldest >= oldest_seen:
            break
        oldest_seen = page_oldest
        after = page_oldest - 1
        pages += 1
        time.sleep(0.12)
    return [out[k] for k in sorted(out)][-NEED:]


def pf(vals):
    wins = sum(x for x in vals if x > 0)
    losses = -sum(x for x in vals if x < 0)
    return wins / losses if losses > 0 else (999.0 if wins > 0 else 0.0)


def main():
    trades = []
    coverage = []
    for basket, symbols in BASKETS.items():
        for symbol in symbols:
            try:
                rows = fetch_okx_5m(symbol)
                print("FETCH_OK", basket, symbol, len(rows))
                coverage.append({"basket": basket, "symbol": symbol, "bars": len(rows)})
            except Exception as exc:
                print("FETCH_FAIL", basket, symbol, repr(exc))
                coverage.append({"basket": basket, "symbol": symbol, "bars": 0, "error": str(exc)})
                continue
            if len(rows) < 7000:
                continue
            a15 = base.prep_agg(rows, 900)
            a1 = base.prep_agg(rows, 3600)
            a4 = base.prep_agg(rows, 14400)
            ad = base.prep_agg(rows, 86400)
            cooldown = {}
            for i in range(220, len(rows) - base.HORIZONS["8h"] - 6):
                for side, setup, d1, h4, h1, b15, b4 in base.setup_signal(rows, i, a15, a1, a4, ad):
                    if side != "long" or setup not in CONFIGS[basket]:
                        continue
                    if i - cooldown.get(setup, -10000) < 24:
                        continue
                    cooldown[setup] = i
                    mtf, entry_mode, stop_mode, exit_mode = CONFIGS[basket][setup]
                    if not v3.mtf_accept(mtf, side, d1, h4, h1, basket):
                        continue
                    ent = v3.select_entry(rows, i, side, setup, entry_mode, b15)
                    if not ent:
                        continue
                    entry_i, entry = ent
                    stop = v3.stop_for(entry, side, b15, stop_mode)
                    if stop is None:
                        continue
                    risk_pct = (entry - stop) / entry * 100
                    if risk_pct <= 0 or risk_pct > (3.0 if basket == "stable_quality" else 5.5):
                        continue
                    result_r = v3.simulate(rows, entry_i, entry, stop, side, basket, exit_mode)
                    if result_r is None:
                        continue
                    week_block = min(3, max(0, int((rows[i]["t"] - rows[0]["t"]) // (7 * 86400))))
                    trades.append({"basket": basket, "symbol": symbol, "setup": setup, "r": result_r, "block": week_block})

    grouped = defaultdict(list)
    by_symbol = defaultdict(list)
    by_block = defaultdict(list)
    for t in trades:
        k = (t["basket"], t["setup"])
        grouped[k].append(t["r"])
        by_symbol[(t["basket"], t["setup"], t["symbol"])].append(t["r"])
        by_block[(t["basket"], t["setup"], t["block"])].append(t["r"])

    summary = []
    for (basket, setup), vals in sorted(grouped.items()):
        symbols = []
        for (b, s, sym), sv in by_symbol.items():
            if b == basket and s == setup:
                symbols.append({"symbol": sym, "n": len(sv), "pf": pf(sv), "avg": sum(sv) / len(sv)})
        blocks = []
        for (b, s, block), bv in by_block.items():
            if b == basket and s == setup:
                blocks.append({"block": block, "n": len(bv), "pf": pf(bv), "avg": sum(bv) / len(bv)})
        summary.append({
            "basket": basket,
            "setup": setup,
            "n": len(vals),
            "pf": pf(vals),
            "avg": sum(vals) / len(vals),
            "win": sum(x > 0 for x in vals) / len(vals),
            "positive_symbols": sum(x["avg"] > 0 for x in symbols),
            "eligible_symbols": len(symbols),
            "positive_blocks": sum(x["avg"] > 0 for x in blocks),
            "eligible_blocks": len(blocks),
            "symbols": sorted(symbols, key=lambda x: x["symbol"]),
            "blocks": sorted(blocks, key=lambda x: x["block"]),
        })

    print("\n=== OKX INDEPENDENT-VENUE HOLDOUT ===")
    for r in summary:
        print(f"{r['basket']:14} {r['setup']:22} n={r['n']:4} PF={r['pf']:.2f} avg={r['avg']:.3f} win={r['win']:.1%} syms={r['positive_symbols']}/{r['eligible_symbols']} blocks={r['positive_blocks']}/{r['eligible_blocks']}")

    Path("/tmp/crypto_mtf_okx_holdout_v10.json").write_text(json.dumps({"research_only": True, "venue": "OKX", "coverage": coverage, "summary": summary}, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
