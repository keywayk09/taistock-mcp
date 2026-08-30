#!/usr/bin/env python3
"""V18: validate a zero-extra-request production breadth proxy.

V14's higher-TF breadth was promising but would be expensive live. Production
already fetches bulk Bybit/Gate tickers, so this test uses only information that
can be represented by bulk 24h price changes: BTC non-negative plus at least 60%
of the representative market basket positive over the trailing 24h. Research only.
Setup/MTF/entry/stop/3R rules remain frozen and gate-specific cooldown is used.
"""
from __future__ import annotations

import bisect,json
from collections import defaultdict
from pathlib import Path

import crypto_mtf_rr_backtest as base
import crypto_mtf_multiway_v3 as v3
import crypto_mtf_okx_60d_v11 as v11
import crypto_mtf_regime_v12 as v12

BASKETS=v12.BASKETS
CONFIGS=v12.CONFIGS
GATES=["none","bulk24h_breadth60"]


def pf(vals):
    w=sum(x for x in vals if x>0);l=-sum(x for x in vals if x<0)
    return w/l if l>0 else (999.0 if w>0 else 0.0)


def prep(rows):return {"rows":rows,"times":[x["t"] for x in rows]}


def ret24(p,cutoff):
    rows=p["rows"];times=p["times"]
    j=bisect.bisect_left(times,cutoff)-1
    if j<288:return None
    now=rows[j]["c"];prev=rows[j-288]["c"]
    return base.pct(now,prev)


def snapshot(market,cutoff):
    rets={s:ret24(p,cutoff) for s,p in market.items()}
    vals=[v for v in rets.values() if v is not None]
    breadth=sum(v>0 for v in vals)/len(vals) if vals else 0.0
    return {"returns":rets,"breadth":breadth,"btc":rets.get("BTC")}


def accept(name,snap):
    if name=="none":return True
    return snap.get("btc") is not None and snap["btc"]>=0 and snap["breadth"]>=0.60


def main():
    syms=list(dict.fromkeys(BASKETS["stable_quality"]+BASKETS["volatile"]))
    cache={};coverage=[]
    for s in syms:
        try:
            rows=v11.fetch_okx_5m(s);cache[s]=rows;print("FETCH_OK",s,len(rows));coverage.append({"symbol":s,"bars":len(rows)})
        except Exception as exc:
            cache[s]=[];print("FETCH_FAIL",s,repr(exc));coverage.append({"symbol":s,"bars":0,"error":str(exc)})
    market={s:prep(rows) for s,rows in cache.items() if len(rows)>=15000}
    if "BTC" not in market:raise RuntimeError("BTC history unavailable")
    snap_cache={};rec=[]
    for basket,blist in BASKETS.items():
        for s in blist:
            rows=cache.get(s) or []
            if len(rows)<15000:continue
            a15=base.prep_agg(rows,900);a1=base.prep_agg(rows,3600);a4=base.prep_agg(rows,14400);ad=base.prep_agg(rows,86400)
            midpoint=(rows[0]["t"]+rows[-1]["t"])//2;cool={}
            for i in range(300,len(rows)-base.HORIZONS["8h"]-6):
                cutoff=rows[i]["t"]+300
                snap=snap_cache.get(cutoff)
                if snap is None:snap=snapshot(market,cutoff);snap_cache[cutoff]=snap
                for side,setup,d1,h4,h1,b15,b4 in base.setup_signal(rows,i,a15,a1,a4,ad):
                    if side!="long" or setup not in CONFIGS[basket]:continue
                    mtf,em,sm,xm=CONFIGS[basket][setup]
                    if not v3.mtf_accept(mtf,side,d1,h4,h1,basket):continue
                    ent=v3.select_entry(rows,i,side,setup,em,b15)
                    if not ent:continue
                    ei,entry=ent;stop=v3.stop_for(entry,side,b15,sm)
                    if stop is None:continue
                    risk_pct=(entry-stop)/entry*100
                    if risk_pct<=0 or risk_pct>(3.0 if basket=="stable_quality" else 4.0):continue
                    window="prior30d" if rows[i]["t"]<midpoint else "recent30d"
                    for gate in GATES:
                        if not accept(gate,snap):continue
                        ck=(gate,setup)
                        if ei-cool.get(ck,-10000)<24:continue
                        cool[ck]=ei
                        rr=v3.simulate(rows,ei,entry,stop,side,basket,xm)
                        if rr is not None:rec.append({"window":window,"gate":gate,"basket":basket,"symbol":s,"setup":setup,"r":rr,"breadth":snap["breadth"],"btc24h":snap["btc"]})
    g=defaultdict(list);gs=defaultdict(list)
    for x in rec:
        k=(x["window"],x["gate"],x["basket"],x["setup"]);g[k].append(x["r"]);gs[k+(x["symbol"],)].append(x["r"])
    summary=[]
    for k,vals in sorted(g.items()):
        window,gate,basket,setup=k;sy=[]
        for kk,sv in gs.items():
            if kk[:-1]==k:sy.append((kk[-1],sv))
        summary.append({"window":window,"gate":gate,"basket":basket,"setup":setup,"n":len(vals),"pf":pf(vals),"avg":sum(vals)/len(vals),"win":sum(x>0 for x in vals)/len(vals),"positive_symbols":sum(sum(v)/len(v)>0 for _,v in sy),"eligible_symbols":len(sy)})
    print("\n=== V18 BULK-TICKER-COMPATIBLE 24H BREADTH ===")
    for r in summary:print(f"{r['window']:9} {r['gate']:20} {r['basket']:14} {r['setup']:22} n={r['n']:3} PF={r['pf']:.2f} avg={r['avg']:.3f} win={r['win']:.1%} syms={r['positive_symbols']}/{r['eligible_symbols']}")
    Path('/tmp/crypto_mtf_bulk_breadth_v18.json').write_text(json.dumps({"research_only":True,"live_implementation":"existing_bulk_ticker_24h_change_zero_additional_exchange_requests","coverage":coverage,"summary":summary},indent=2),encoding='utf-8')

if __name__=='__main__':main()
