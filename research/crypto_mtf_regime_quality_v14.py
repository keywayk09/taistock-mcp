#!/usr/bin/env python3
"""V14: test whether trend quality + cross-sectional breadth can separate good/bad LONG regimes.

Research only. Setup/entry/stop/exit rules are frozen from V11/V12. We only vary a
small predefined regime gate using fully closed 1D/4H/1H bars and no future data.
"""
from __future__ import annotations

import bisect
import json
from collections import defaultdict
from pathlib import Path

import crypto_mtf_rr_backtest as base
import crypto_mtf_multiway_v3 as v3
import crypto_mtf_okx_60d_v11 as v11
import crypto_mtf_regime_v12 as v12

BASKETS = v12.BASKETS
CONFIGS = v12.CONFIGS
GATES = ["none", "breadth60", "btc_eth_quality", "breadth_quality"]


def pf(vals):
    w=sum(x for x in vals if x>0); l=-sum(x for x in vals if x<0)
    return w/l if l>0 else (999.0 if w>0 else 0.0)


def prep(rows):
    frames={"1h":base.prep_agg(rows,3600),"4h":base.prep_agg(rows,14400),"1d":base.prep_agg(rows,86400)}
    return {k:{"bars":v,"ends":[x["end"] for x in v]} for k,v in frames.items()}


def closed_slice(frame, cutoff, n=24):
    bars=frame["bars"]; idx=bisect.bisect_right(frame["ends"],cutoff)
    return bars[max(0,idx-n):idx]


def efficiency(bars, lookback):
    if len(bars)<lookback+1: return None
    x=bars[-(lookback+1):]
    net=abs(x[-1]["c"]-x[0]["c"])
    path=sum(abs(x[i]["c"]-x[i-1]["c"]) for i in range(1,len(x)))
    return net/path if path>0 else 0.0


def state(p,cutoff):
    b1=closed_slice(p["1h"],cutoff,20); b4=closed_slice(p["4h"],cutoff,16); bd=closed_slice(p["1d"],cutoff,10)
    return {
        "1h":base.direction(b1,6,0.25),"4h":base.direction(b4,6,0.75),"1d":base.direction(bd,5,1.5),
        "er1h":efficiency(b1,8),"er4h":efficiency(b4,6),
    }


def swing_on(d): return d["4h"]=="up" and d["1h"]=="up" and d["1d"]!="down"


def gate_snapshot(market, cutoff):
    st={s:state(p,cutoff) for s,p in market.items()}
    eligible=[x for x in st.values() if x["1h"]!="unavailable" and x["4h"]!="unavailable"]
    breadth=(sum(x["4h"]=="up" and x["1h"]=="up" and x["1d"]!="down" for x in eligible)/len(eligible)) if eligible else 0.0
    btc=st["BTC"]; eth=st["ETH"]
    btc_eth_quality=(
        swing_on(btc) and swing_on(eth)
        and (btc["er4h"] or 0)>=0.35 and (btc["er1h"] or 0)>=0.25
        and (eth["er4h"] or 0)>=0.25 and (eth["er1h"] or 0)>=0.20
    )
    return {"states":st,"breadth":breadth,"btc_swing":swing_on(btc),"btc_eth_quality":btc_eth_quality}


def accepts(name,snap):
    if name=="none": return True
    if name=="breadth60": return snap["btc_swing"] and snap["breadth"]>=0.60
    if name=="btc_eth_quality": return snap["btc_eth_quality"]
    if name=="breadth_quality": return snap["btc_eth_quality"] and snap["breadth"]>=0.60
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
    market={s:prep(rows) for s,rows in cache.items() if len(rows)>=15000}
    gate_cache={}
    records=[]
    for basket,syms in BASKETS.items():
        for s in syms:
            rows=cache.get(s) or []
            if len(rows)<15000: continue
            a15=base.prep_agg(rows,900); a1=base.prep_agg(rows,3600); a4=base.prep_agg(rows,14400); ad=base.prep_agg(rows,86400)
            midpoint=(rows[0]["t"]+rows[-1]["t"])//2; cool={}
            for i in range(220,len(rows)-base.HORIZONS["8h"]-6):
                cutoff=rows[i]["t"]+300
                snap=gate_cache.get(cutoff)
                if snap is None:
                    snap=gate_snapshot(market,cutoff); gate_cache[cutoff]=snap
                for side,setup,d1,h4,h1,b15,b4 in base.setup_signal(rows,i,a15,a1,a4,ad):
                    if side!="long" or setup not in CONFIGS[basket]: continue
                    if i-cool.get(setup,-10000)<24: continue
                    cool[setup]=i
                    mtf,em,sm,xm=CONFIGS[basket][setup]
                    if not v3.mtf_accept(mtf,side,d1,h4,h1,basket): continue
                    ent=v3.select_entry(rows,i,side,setup,em,b15)
                    if not ent: continue
                    ei,entry=ent; stop=v3.stop_for(entry,side,b15,sm)
                    if stop is None: continue
                    risk_pct=(entry-stop)/entry*100
                    if risk_pct<=0 or risk_pct>(3.0 if basket=="stable_quality" else 4.0): continue
                    rr=v3.simulate(rows,ei,entry,stop,side,basket,xm)
                    if rr is None: continue
                    window="prior30d" if rows[i]["t"]<midpoint else "recent30d"
                    for gate in GATES:
                        if accepts(gate,snap):
                            records.append({"window":window,"gate":gate,"basket":basket,"symbol":s,"setup":setup,"r":rr,"breadth":snap["breadth"]})
    g=defaultdict(list); gs=defaultdict(list)
    for x in records:
        k=(x["window"],x["gate"],x["basket"],x["setup"]); g[k].append(x["r"]); gs[k+(x["symbol"],)].append(x["r"])
    summary=[]
    for (window,gate,basket,setup),vals in sorted(g.items()):
        symrows=[]
        for (w,gg,b,ss,sym),sv in gs.items():
            if (w,gg,b,ss)==(window,gate,basket,setup): symrows.append((sym,sv))
        summary.append({"window":window,"gate":gate,"basket":basket,"setup":setup,"n":len(vals),"pf":pf(vals),"avg":sum(vals)/len(vals),"win":sum(x>0 for x in vals)/len(vals),"positive_symbols":sum(sum(v)/len(v)>0 for _,v in symrows),"eligible_symbols":len(symrows)})
    print("\n=== V14 REGIME QUALITY + BREADTH HOLDOUT ===")
    for r in summary:
        print(f"{r['window']:9} {r['gate']:18} {r['basket']:14} {r['setup']:22} n={r['n']:3} PF={r['pf']:.2f} avg={r['avg']:.3f} win={r['win']:.1%} syms={r['positive_symbols']}/{r['eligible_symbols']}")
    Path('/tmp/crypto_mtf_regime_quality_v14.json').write_text(json.dumps({"research_only":True,"venue":"OKX","coverage":coverage,"summary":summary},indent=2),encoding='utf-8')

if __name__=='__main__': main()
