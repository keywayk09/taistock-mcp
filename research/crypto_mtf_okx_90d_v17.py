#!/usr/bin/env python3
"""V17: 90-day / three-30d temporal holdout for the fixed crypto LONG policies.

Research only. This extends V11 after the OKX 90d coverage probe passed with no
missing 5m slots. Setup/MTF/entry/stop rules remain frozen. The only regime gate
under test is the already-defined breadth60 gate from V14, plus an ungated control.
Gate-specific cooldown begins only after an accepted valid entry, matching V16.
"""
from __future__ import annotations

import json, math, time, urllib.parse, urllib.request
from collections import defaultdict
from pathlib import Path

import crypto_mtf_rr_backtest as base
import crypto_mtf_multiway_v3 as v3
import crypto_mtf_regime_v12 as v12
import crypto_mtf_regime_quality_v14 as v14

URL="https://www.okx.com/api/v5/market/history-candles"
NEED=90*24*12
BASKETS=v12.BASKETS
CONFIGS=v12.CONFIGS
GATES=["none","breadth60"]
COST={"stable_quality":0.08,"volatile":0.14}


def num(v):
    try:
        x=float(v);return x if math.isfinite(x) else None
    except Exception:return None


def request_json(url,tries=5):
    last=None
    for n in range(tries):
        try:
            r=urllib.request.Request(url,headers={"Accept":"application/json","User-Agent":"crypto-mtf-okx-90d-v17"})
            with urllib.request.urlopen(r,timeout=25) as resp:return json.loads(resp.read().decode())
        except Exception as exc:
            last=exc;time.sleep(0.7*(n+1))
    raise last


def fetch90(symbol):
    inst=f"{symbol}-USDT-SWAP";out={};after=None;oldest_seen=None;pages=0
    while len(out)<NEED and pages<320:
        p={"instId":inst,"bar":"5m","limit":"100"}
        if after is not None:p["after"]=str(after)
        payload=request_json(f"{URL}?{urllib.parse.urlencode(p)}")
        if not isinstance(payload,dict) or payload.get("code")!="0":raise RuntimeError(f"okx_code={payload.get('code') if isinstance(payload,dict) else 'non_dict'}")
        data=payload.get("data") or []
        if not data:break
        page_oldest=None
        for item in data:
            if not isinstance(item,list) or len(item)<9 or str(item[8])!="1":continue
            ts=int(num(item[0]) or 0);o,h,l,c=map(num,item[1:5])
            if not ts or any(x is None for x in (o,h,l,c)):continue
            out[ts//1000]={"t":ts//1000,"o":o,"h":h,"l":l,"c":c,"qv":num(item[7]),"v":num(item[5])}
            page_oldest=ts if page_oldest is None else min(page_oldest,ts)
        if page_oldest is None or (oldest_seen is not None and page_oldest>=oldest_seen):break
        oldest_seen=page_oldest;after=page_oldest-1;pages+=1;time.sleep(0.10)
    return [out[k] for k in sorted(out)][-NEED:]


def pf(vals):
    w=sum(x for x in vals if x>0);l=-sum(x for x in vals if x<0)
    return w/l if l>0 else (999.0 if w>0 else 0.0)


def simulate_fixed3(rows,ei,entry,stop,basket,cost_mult=1):
    risk=entry-stop
    if risk<=0:return None
    future=rows[ei:min(len(rows),ei+96)]
    if not future:return None
    cost=(COST[basket]*cost_mult/100*entry)/risk
    result=None
    for bar in future:
        if bar["l"]<=stop:result=-1.0;break
        if bar["h"]>=entry+3*risk:result=3.0;break
    if result is None:
        cr=(future[-1]["c"]-entry)/risk;result=max(-1,min(3,cr))
    return result-cost


def main():
    syms=list(dict.fromkeys(BASKETS["stable_quality"]+BASKETS["volatile"]))
    cache={};coverage=[]
    for s in syms:
        try:
            rows=fetch90(s);cache[s]=rows;print("FETCH_OK",s,len(rows));coverage.append({"symbol":s,"bars":len(rows)})
        except Exception as exc:
            cache[s]=[];print("FETCH_FAIL",s,repr(exc));coverage.append({"symbol":s,"bars":0,"error":str(exc)})
    market={s:v14.prep(rows) for s,rows in cache.items() if len(rows)>=25000}
    if "BTC" not in market or "ETH" not in market:raise RuntimeError("90d benchmark history unavailable")
    snap_cache={};rec=[]
    for basket,blist in BASKETS.items():
        for s in blist:
            rows=cache.get(s) or []
            if len(rows)<25000:continue
            a15=base.prep_agg(rows,900);a1=base.prep_agg(rows,3600);a4=base.prep_agg(rows,14400);ad=base.prep_agg(rows,86400)
            t0=rows[0]["t"];t1=rows[-1]["t"]+300;span=t1-t0
            cooldown={}
            for i in range(220,len(rows)-base.HORIZONS["8h"]-6):
                cutoff=rows[i]["t"]+300
                snap=snap_cache.get(cutoff)
                if snap is None:snap=v14.gate_snapshot(market,cutoff);snap_cache[cutoff]=snap
                age=(rows[i]["t"]-t0)/span
                window="old30d" if age<1/3 else "mid30d" if age<2/3 else "recent30d"
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
                    for gate in GATES:
                        if gate=="breadth60" and not v14.accepts("breadth60",snap):continue
                        ck=(gate,setup)
                        if ei-cooldown.get(ck,-10000)<24:continue
                        cooldown[ck]=ei
                        for cm in (1,2):
                            rr=simulate_fixed3(rows,ei,entry,stop,basket,cm)
                            if rr is not None:rec.append({"window":window,"gate":gate,"basket":basket,"symbol":s,"setup":setup,"cost_mult":cm,"r":rr})
    g=defaultdict(list);gs=defaultdict(list)
    for x in rec:
        k=(x["window"],x["gate"],x["basket"],x["setup"],x["cost_mult"]);g[k].append(x["r"]);gs[k+(x["symbol"],)].append(x["r"])
    summary=[]
    for k,vals in sorted(g.items()):
        window,gate,basket,setup,cm=k;sy=[]
        for kk,sv in gs.items():
            if kk[:-1]==k:sy.append((kk[-1],sv))
        summary.append({"window":window,"gate":gate,"basket":basket,"setup":setup,"cost_mult":cm,"n":len(vals),"pf":pf(vals),"avg":sum(vals)/len(vals),"win":sum(x>0 for x in vals)/len(vals),"positive_symbols":sum(sum(v)/len(v)>0 for _,v in sy),"eligible_symbols":len(sy)})
    print("\n=== V17 OKX 90D THREE-WINDOW HOLDOUT ===")
    for r in summary:
        print(f"{r['window']:9} {r['gate']:9} {r['basket']:14} {r['setup']:22} c{r['cost_mult']} n={r['n']:3} PF={r['pf']:.2f} avg={r['avg']:.3f} win={r['win']:.1%} syms={r['positive_symbols']}/{r['eligible_symbols']}")
    Path('/tmp/crypto_mtf_okx_90d_v17.json').write_text(json.dumps({"research_only":True,"venue":"OKX","windows":3,"bars_target":NEED,"coverage":coverage,"summary":summary},indent=2),encoding='utf-8')

if __name__=='__main__':main()
