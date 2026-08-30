#!/usr/bin/env python3
"""60d regime-conditioned SHORT holdout on OKX.

Earlier SHORT research used the latest bullish window and was poor. V11 showed the
earlier 30d was hostile to LONG. This test checks whether SHORT has a conditional
edge specifically when BTC/ETH higher-timeframe market structure is risk-off.
Rules are evaluated as research only; no production promotion is implied.
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
GATES = ["none", "btc_swing_off", "btc_eth_breadth_off", "btc_eth_strict_off"]


def pf(vals):
    w=sum(x for x in vals if x>0); l=-sum(x for x in vals if x<0)
    return w/l if l>0 else (999.0 if w>0 else 0.0)


def prep_market(rows):
    return {"1h":base.prep_agg(rows,3600),"4h":base.prep_agg(rows,14400),"1d":base.prep_agg(rows,86400)}


def dirs(p,cutoff):
    b1=base.latest_closed(p["1h"],cutoff); b4=base.latest_closed(p["4h"],cutoff); bd=base.latest_closed(p["1d"],cutoff)
    return {"1h":base.direction(b1,6,0.25),"4h":base.direction(b4,6,0.75),"1d":base.direction(bd,5,1.5)}


def swing_off(d): return d["4h"]=="down" and d["1h"]=="down" and d["1d"]!="up"
def strict_off(d): return d["1d"]=="down" and d["4h"]=="down" and d["1h"]=="down"


def gate_accept(name,btc,eth):
    if name=="none": return True
    if name=="btc_swing_off": return swing_off(btc)
    if name=="btc_eth_breadth_off": return swing_off(btc) and eth["4h"]!="up" and eth["1h"]!="up" and eth["1d"]!="up"
    if name=="btc_eth_strict_off": return strict_off(btc) and strict_off(eth)
    return False


def main():
    cache={};coverage=[]
    for basket,syms in BASKETS.items():
        for s in syms:
            if s in cache: continue
            try:
                rows=v11.fetch_okx_5m(s);cache[s]=rows;print("FETCH_OK",basket,s,len(rows));coverage.append({"basket":basket,"symbol":s,"bars":len(rows)})
            except Exception as exc:
                cache[s]=[];print("FETCH_FAIL",basket,s,repr(exc));coverage.append({"basket":basket,"symbol":s,"bars":0,"error":str(exc)})
    if len(cache.get("BTC",[]))<15000 or len(cache.get("ETH",[]))<15000: raise RuntimeError("benchmark history unavailable")
    btc_m=prep_market(cache["BTC"]);eth_m=prep_market(cache["ETH"])
    rec=[]
    for basket,syms in BASKETS.items():
        for s in syms:
            rows=cache.get(s) or []
            if len(rows)<15000: continue
            a15=base.prep_agg(rows,900);a1=base.prep_agg(rows,3600);a4=base.prep_agg(rows,14400);ad=base.prep_agg(rows,86400)
            midpoint=(rows[0]["t"]+rows[-1]["t"])//2;cool={}
            for i in range(220,len(rows)-base.HORIZONS["8h"]-6):
                cutoff=rows[i]["t"]+300;bd=dirs(btc_m,cutoff);ed=dirs(eth_m,cutoff)
                for side,setup,d1,h4,h1,b15,b4 in base.setup_signal(rows,i,a15,a1,a4,ad):
                    if side!="short" or setup not in CONFIGS[basket]: continue
                    if i-cool.get(setup,-10000)<24: continue
                    cool[setup]=i
                    mtf,em,sm,xm=CONFIGS[basket][setup]
                    if not v3.mtf_accept(mtf,side,d1,h4,h1,basket): continue
                    ent=v3.select_entry(rows,i,side,setup,em,b15)
                    if not ent: continue
                    ei,entry=ent;stop=v3.stop_for(entry,side,b15,sm)
                    if stop is None: continue
                    risk_pct=(stop-entry)/entry*100
                    if risk_pct<=0 or risk_pct>(3.0 if basket=="stable_quality" else 4.0): continue
                    rr=v3.simulate(rows,ei,entry,stop,side,basket,xm)
                    if rr is None: continue
                    window="prior30d" if rows[i]["t"]<midpoint else "recent30d"
                    for gate in GATES:
                        if gate_accept(gate,bd,ed): rec.append({"window":window,"gate":gate,"basket":basket,"symbol":s,"setup":setup,"r":rr})
    g=defaultdict(list);gs=defaultdict(list)
    for x in rec:
        g[(x["window"],x["gate"],x["basket"],x["setup"])].append(x["r"])
        gs[(x["window"],x["gate"],x["basket"],x["setup"],x["symbol"])].append(x["r"])
    summary=[]
    for (window,gate,basket,setup),vals in sorted(g.items()):
        sy=[]
        for (w,gg,b,s,sym),sv in gs.items():
            if (w,gg,b,s)==(window,gate,basket,setup): sy.append({"symbol":sym,"n":len(sv),"pf":pf(sv),"avg":sum(sv)/len(sv)})
        summary.append({"window":window,"gate":gate,"basket":basket,"setup":setup,"n":len(vals),"pf":pf(vals),"avg":sum(vals)/len(vals),"win":sum(x>0 for x in vals)/len(vals),"positive_symbols":sum(x["avg"]>0 for x in sy),"eligible_symbols":len(sy)})
    print("\n=== V13 REGIME-CONDITIONED SHORT HOLDOUT ===")
    for r in summary:
        print(f"{r['window']:9} {r['gate']:20} {r['basket']:14} {r['setup']:22} n={r['n']:3} PF={r['pf']:.2f} avg={r['avg']:.3f} win={r['win']:.1%} syms={r['positive_symbols']}/{r['eligible_symbols']}")
    Path('/tmp/crypto_mtf_short_regime_v13.json').write_text(json.dumps({"research_only":True,"venue":"OKX","coverage":coverage,"summary":summary},indent=2),encoding='utf-8')

if __name__=='__main__': main()
