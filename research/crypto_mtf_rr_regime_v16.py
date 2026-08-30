#!/usr/bin/env python3
"""V16: regime-gate integrity + reward/horizon sensitivity.

Research only. This pass fixes one methodological issue from V12-V15: a signal
rejected by a regime gate must not consume that gate's cooldown. Cooldown starts
only after that gate produces a valid entry. It also tests 2R/3R/partial exits
across 8h/12h/24h and 1x/2x costs without changing setup definitions.
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
import crypto_mtf_macro_regime_v15 as v15

BASKETS=v12.BASKETS
CONFIGS=v12.CONFIGS
GATES=["none","breadth60","btc_macro_sign","btc_eth_macro_sign","btc_eth_macro_strength","macro_strength_breadth"]
HORIZONS={"8h":96,"12h":144,"24h":288}
EXIT_MODES=["fixed2","fixed3","partial2_3"]
COST={"stable_quality":0.08,"volatile":0.14}


def pf(vals):
    w=sum(x for x in vals if x>0); l=-sum(x for x in vals if x<0)
    return w/l if l>0 else (999.0 if w>0 else 0.0)


def gate_snapshot(market,cutoff):
    q=v14.gate_snapshot(market,cutoff)
    m=v15.snapshot(market,cutoff)
    return {"quality":q,"macro":m}


def gate_accept(name,snap):
    if name=="none": return True
    if name=="breadth60": return v14.accepts("breadth60",snap["quality"])
    return v15.accepts(name,snap["macro"])


def simulate(rows,entry_idx,entry,stop,side,basket,exit_mode,horizon_bars,cost_mult):
    risk=(entry-stop) if side=="long" else (stop-entry)
    if risk<=0:return None
    future=rows[entry_idx:min(len(rows),entry_idx+horizon_bars)]
    if not future:return None
    cost=(COST[basket]*cost_mult/100*entry)/risk
    def hits(bar,r):
        if side=="long": return bar["l"]<=stop,bar["h"]>=entry+r*risk
        return bar["h"]>=stop,bar["l"]<=entry-r*risk
    if exit_mode in ("fixed2","fixed3"):
        target=2.0 if exit_mode=="fixed2" else 3.0
        result=None
        for bar in future:
            sh,th=hits(bar,target)
            if sh: result=-1.0;break
            if th: result=target;break
        if result is None:
            close=future[-1]["c"];cr=(close-entry)/risk if side=="long" else (entry-close)/risk
            result=max(-1.0,min(target,cr))
        return result-cost
    first=False;result=None
    for bar in future:
        if not first:
            sh,t2=hits(bar,2.0)
            if sh: result=-1.0;break
            if t2:first=True;continue
        else:
            if side=="long":
                if bar["l"]<=entry: result=1.0;break
                if bar["h"]>=entry+3*risk: result=2.5;break
            else:
                if bar["h"]>=entry: result=1.0;break
                if bar["l"]<=entry-3*risk: result=2.5;break
    if result is None:
        close=future[-1]["c"];cr=(close-entry)/risk if side=="long" else (entry-close)/risk
        result=(1.0+0.5*max(0,min(3,cr))) if first else max(-1,min(2,cr))
    return result-cost


def main():
    all_symbols=list(dict.fromkeys(BASKETS["stable_quality"]+BASKETS["volatile"]))
    cache={};coverage=[]
    for s in all_symbols:
        try:
            rows=v11.fetch_okx_5m(s);cache[s]=rows;print("FETCH_OK",s,len(rows));coverage.append({"symbol":s,"bars":len(rows)})
        except Exception as exc:
            cache[s]=[];print("FETCH_FAIL",s,repr(exc));coverage.append({"symbol":s,"bars":0,"error":str(exc)})
    if len(cache.get("BTC",[]))<15000 or len(cache.get("ETH",[]))<15000:raise RuntimeError("benchmark history unavailable")
    market={s:v14.prep(rows) for s,rows in cache.items() if len(rows)>=15000}
    snap_cache={};records=[]
    max_h=max(HORIZONS.values())
    for basket,syms in BASKETS.items():
        for s in syms:
            rows=cache.get(s) or []
            if len(rows)<15000:continue
            a15=base.prep_agg(rows,900);a1=base.prep_agg(rows,3600);a4=base.prep_agg(rows,14400);ad=base.prep_agg(rows,86400)
            midpoint=(rows[0]["t"]+rows[-1]["t"])//2
            gate_cooldown={}
            for i in range(220,len(rows)-max_h-6):
                cutoff=rows[i]["t"]+300
                snap=snap_cache.get(cutoff)
                if snap is None:snap=gate_snapshot(market,cutoff);snap_cache[cutoff]=snap
                for side,setup,d1,h4,h1,b15,b4 in base.setup_signal(rows,i,a15,a1,a4,ad):
                    if side!="long" or setup not in CONFIGS[basket]:continue
                    mtf,em,sm,_=CONFIGS[basket][setup]
                    if not v3.mtf_accept(mtf,side,d1,h4,h1,basket):continue
                    ent=v3.select_entry(rows,i,side,setup,em,b15)
                    if not ent:continue
                    ei,entry=ent;stop=v3.stop_for(entry,side,b15,sm)
                    if stop is None:continue
                    risk_pct=(entry-stop)/entry*100
                    if risk_pct<=0 or risk_pct>(3.0 if basket=="stable_quality" else 4.0):continue
                    window="prior30d" if rows[i]["t"]<midpoint else "recent30d"
                    for gate in GATES:
                        if not gate_accept(gate,snap):continue
                        ck=(gate,setup)
                        if ei-gate_cooldown.get(ck,-10000)<24:continue
                        gate_cooldown[ck]=ei
                        for hname,hbars in HORIZONS.items():
                            for exit_mode in EXIT_MODES:
                                for cost_mult in (1,2):
                                    rr=simulate(rows,ei,entry,stop,side,basket,exit_mode,hbars,cost_mult)
                                    if rr is not None:records.append({"window":window,"gate":gate,"basket":basket,"symbol":s,"setup":setup,"horizon":hname,"exit":exit_mode,"cost_mult":cost_mult,"r":rr})
    g=defaultdict(list);gs=defaultdict(list)
    for x in records:
        k=(x["window"],x["gate"],x["basket"],x["setup"],x["horizon"],x["exit"],x["cost_mult"]);g[k].append(x["r"]);gs[k+(x["symbol"],)].append(x["r"])
    summary=[]
    for k,vals in sorted(g.items()):
        window,gate,basket,setup,horizon,exit_mode,cost_mult=k
        sy=[]
        for kk,sv in gs.items():
            if kk[:-1]==k:sy.append((kk[-1],sv))
        summary.append({"window":window,"gate":gate,"basket":basket,"setup":setup,"horizon":horizon,"exit":exit_mode,"cost_mult":cost_mult,"n":len(vals),"pf":pf(vals),"avg":sum(vals)/len(vals),"win":sum(x>0 for x in vals)/len(vals),"positive_symbols":sum(sum(v)/len(v)>0 for _,v in sy),"eligible_symbols":len(sy)})
    print("\n=== V16 GATE-INTEGRITY + RR/HORIZON ===")
    focus=[r for r in summary if r["exit"] in ("fixed3","partial2_3") and r["horizon"] in ("8h","12h","24h") and r["cost_mult"] in (1,2)]
    for r in focus:
        if r["setup"] not in ("trend_follow","pullback_contraction"):continue
        print(f"{r['window']:9} {r['gate']:23} {r['basket']:14} {r['setup']:22} {r['horizon']:3} {r['exit']:10} c{r['cost_mult']} n={r['n']:3} PF={r['pf']:.2f} avg={r['avg']:.3f} syms={r['positive_symbols']}/{r['eligible_symbols']}")
    Path('/tmp/crypto_mtf_rr_regime_v16.json').write_text(json.dumps({"research_only":True,"venue":"OKX","method":"gate_before_gate_specific_entry_cooldown","coverage":coverage,"summary":summary},indent=2),encoding='utf-8')

if __name__=='__main__':main()

# Trigger marker: V16 validation should run only after V14/V15 completed.
