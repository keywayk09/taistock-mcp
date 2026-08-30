#!/usr/bin/env python3
"""V15: longer-horizon BTC/ETH + breadth regime holdout.

V12 showed that short 1D/4H/1H direction gates did not rescue the prior 30d.
This test keeps trade rules fixed and only asks whether 10d / 3d / 12h market
trend plus broad participation separates tradable LONG regimes. Research only.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import crypto_mtf_rr_backtest as base
import crypto_mtf_multiway_v3 as v3
import crypto_mtf_okx_60d_v11 as v11
import crypto_mtf_regime_v12 as v12
import crypto_mtf_regime_quality_v14 as v14

BASKETS=v12.BASKETS
CONFIGS=v12.CONFIGS
GATES=["none","btc_macro_sign","btc_eth_macro_sign","btc_eth_macro_strength","macro_strength_breadth"]


def pf(vals):
    w=sum(x for x in vals if x>0); l=-sum(x for x in vals if x<0)
    return w/l if l>0 else (999.0 if w>0 else 0.0)


def ret(bars, lookback):
    if len(bars)<lookback+1: return None
    return base.pct(bars[-1]["c"],bars[-(lookback+1)]["c"])


def macro_state(p,cutoff):
    b1=v14.closed_slice(p["1h"],cutoff,20); b4=v14.closed_slice(p["4h"],cutoff,24); bd=v14.closed_slice(p["1d"],cutoff,14)
    return {"r12h":ret(b1,12),"r3d":ret(b4,18),"r10d":ret(bd,10)}


def usable(s): return all(s.get(k) is not None for k in ("r12h","r3d","r10d"))

def sign_on(s): return usable(s) and s["r10d"]>0 and s["r3d"]>0 and s["r12h"]>-0.5

def strength_on(s): return usable(s) and s["r10d"]>2.0 and s["r3d"]>1.0 and s["r12h"]>-0.5


def snapshot(market,cutoff):
    st={s:macro_state(p,cutoff) for s,p in market.items()}
    eligible=[x for x in st.values() if usable(x)]
    breadth10=(sum(x["r10d"]>0 for x in eligible)/len(eligible)) if eligible else 0.0
    breadth3=(sum(x["r3d"]>0 for x in eligible)/len(eligible)) if eligible else 0.0
    return {"states":st,"breadth10":breadth10,"breadth3":breadth3}


def accepts(name,snap):
    if name=="none": return True
    btc=snap["states"]["BTC"]; eth=snap["states"]["ETH"]
    if name=="btc_macro_sign": return sign_on(btc)
    if name=="btc_eth_macro_sign": return sign_on(btc) and sign_on(eth)
    if name=="btc_eth_macro_strength": return strength_on(btc) and strength_on(eth)
    if name=="macro_strength_breadth": return strength_on(btc) and strength_on(eth) and snap["breadth10"]>=0.60 and snap["breadth3"]>=0.60
    return False


def main():
    all_symbols=list(dict.fromkeys(BASKETS["stable_quality"]+BASKETS["volatile"]))
    cache={}; coverage=[]
    for s in all_symbols:
        try:
            rows=v11.fetch_okx_5m(s); cache[s]=rows; print("FETCH_OK",s,len(rows)); coverage.append({"symbol":s,"bars":len(rows)})
        except Exception as exc:
            cache[s]=[]; print("FETCH_FAIL",s,repr(exc)); coverage.append({"symbol":s,"bars":0,"error":str(exc)})
    if len(cache.get("BTC",[]))<15000 or len(cache.get("ETH",[]))<15000: raise RuntimeError("benchmark history unavailable")
    market={s:v14.prep(rows) for s,rows in cache.items() if len(rows)>=15000}
    snap_cache={}; rec=[]
    for basket,syms in BASKETS.items():
        for s in syms:
            rows=cache.get(s) or []
            if len(rows)<15000: continue
            a15=base.prep_agg(rows,900);a1=base.prep_agg(rows,3600);a4=base.prep_agg(rows,14400);ad=base.prep_agg(rows,86400)
            midpoint=(rows[0]["t"]+rows[-1]["t"])//2;cool={}
            for i in range(220,len(rows)-base.HORIZONS["8h"]-6):
                cutoff=rows[i]["t"]+300
                snap=snap_cache.get(cutoff)
                if snap is None: snap=snapshot(market,cutoff);snap_cache[cutoff]=snap
                for side,setup,d1,h4,h1,b15,b4 in base.setup_signal(rows,i,a15,a1,a4,ad):
                    if side!="long" or setup not in CONFIGS[basket]: continue
                    if i-cool.get(setup,-10000)<24: continue
                    cool[setup]=i
                    mtf,em,sm,xm=CONFIGS[basket][setup]
                    if not v3.mtf_accept(mtf,side,d1,h4,h1,basket): continue
                    ent=v3.select_entry(rows,i,side,setup,em,b15)
                    if not ent: continue
                    ei,entry=ent;stop=v3.stop_for(entry,side,b15,sm)
                    if stop is None: continue
                    risk_pct=(entry-stop)/entry*100
                    if risk_pct<=0 or risk_pct>(3.0 if basket=="stable_quality" else 4.0): continue
                    rr=v3.simulate(rows,ei,entry,stop,side,basket,xm)
                    if rr is None: continue
                    window="prior30d" if rows[i]["t"]<midpoint else "recent30d"
                    for gate in GATES:
                        if accepts(gate,snap): rec.append({"window":window,"gate":gate,"basket":basket,"symbol":s,"setup":setup,"r":rr})
    g=defaultdict(list);gs=defaultdict(list)
    for x in rec:
        k=(x["window"],x["gate"],x["basket"],x["setup"]);g[k].append(x["r"]);gs[k+(x["symbol"],)].append(x["r"])
    summary=[]
    for (window,gate,basket,setup),vals in sorted(g.items()):
        sy=[]
        for (w,gg,b,ss,sym),sv in gs.items():
            if (w,gg,b,ss)==(window,gate,basket,setup): sy.append((sym,sv))
        summary.append({"window":window,"gate":gate,"basket":basket,"setup":setup,"n":len(vals),"pf":pf(vals),"avg":sum(vals)/len(vals),"win":sum(x>0 for x in vals)/len(vals),"positive_symbols":sum(sum(v)/len(v)>0 for _,v in sy),"eligible_symbols":len(sy)})
    print("\n=== V15 LONGER-HORIZON MACRO REGIME HOLDOUT ===")
    for r in summary:
        print(f"{r['window']:9} {r['gate']:23} {r['basket']:14} {r['setup']:22} n={r['n']:3} PF={r['pf']:.2f} avg={r['avg']:.3f} win={r['win']:.1%} syms={r['positive_symbols']}/{r['eligible_symbols']}")
    Path('/tmp/crypto_mtf_macro_regime_v15.json').write_text(json.dumps({"research_only":True,"venue":"OKX","coverage":coverage,"summary":summary},indent=2),encoding='utf-8')

if __name__=='__main__': main()
