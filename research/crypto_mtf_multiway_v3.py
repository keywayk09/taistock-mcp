#!/usr/bin/env python3
"""Multi-method crypto MTF/RR research, isolated from Production.

Tests different MTF acceptance, entry timing, stop construction, reward management,
and asymmetric SHORT filters using Gate public price + futures statistics.
No secrets, orders, Cloudflare writes, or Production state are touched.
"""
from __future__ import annotations

import bisect, json, math, statistics, sys, time, urllib.parse, urllib.request
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import crypto_mtf_rr_backtest as base

PRICE_BASKETS = {
    "stable_quality": ["BTC","ETH","SOL","XRP","DOGE","LINK","ADA","AVAX","SUI","APT"],
    "volatile": ["WIF","PENGU","FARTCOIN","PEPE","ONT","BLESS","ALCH","BONK","TURBO","POPCAT","MOODENG"],
}
COST_PCT = {"stable_quality":0.08,"volatile":0.14}
H8 = base.HORIZONS["8h"]
GATE_STATS = "https://api.gateio.ws/api/v4/futures/usdt/contract_stats"


def fnum(v):
    try:
        x=float(v)
        return x if math.isfinite(x) else None
    except Exception:
        return None


def fetch_stats_1h(symbol, days=30):
    start=int(time.time())-days*86400
    q=urllib.parse.urlencode({"contract":f"{symbol}_USDT","from":start,"interval":"1h","limit":1000})
    req=urllib.request.Request(f"{GATE_STATS}?{q}",headers={"Accept":"application/json","User-Agent":"crypto-mtf-multiway-research"})
    with urllib.request.urlopen(req,timeout=30) as r:
        data=json.loads(r.read().decode("utf-8"))
    out=[]
    if isinstance(data,list):
        for x in data:
            t=int(fnum(x.get("time")) or 0)
            if not t: continue
            out.append({
                "t":t,
                "oi":fnum(x.get("open_interest_usd")) or fnum(x.get("open_interest")),
                "funding":fnum(x.get("last_funding_rate")),
                "lsr_account":fnum(x.get("lsr_account")),
                "long_taker":fnum(x.get("long_taker_size")),
                "short_taker":fnum(x.get("short_taker_size")),
                "mark":fnum(x.get("mark_price")),
            })
    out.sort(key=lambda x:x["t"])
    return out


def stat_features(stats, ts):
    if not stats: return {"ok":False}
    times=[x["t"] for x in stats]
    j=bisect.bisect_right(times,ts)-1
    if j<1: return {"ok":False}
    cur,prev=stats[j],stats[j-1]
    oi_pct=None
    if cur["oi"] and prev["oi"] and prev["oi"]!=0:
        oi_pct=(cur["oi"]/prev["oi"]-1)*100
    mark_pct=None
    if cur["mark"] and prev["mark"] and prev["mark"]!=0:
        mark_pct=(cur["mark"]/prev["mark"]-1)*100
    taker_sell=None
    if cur["short_taker"] is not None and cur["long_taker"] is not None:
        taker_sell=cur["short_taker"]/(cur["long_taker"]+1e-9)
    return {"ok":True,"oi_pct_1h":oi_pct,"mark_pct_1h":mark_pct,"funding":cur["funding"],"lsr_account":cur["lsr_account"],"taker_sell_ratio":taker_sell}


def tf_dirs(rows, ts):
    a1=base.prep_agg(rows,3600); a4=base.prep_agg(rows,14400); ad=base.prep_agg(rows,86400)
    b1=base.latest_closed(a1,ts); b4=base.latest_closed(a4,ts); bd=base.latest_closed(ad,ts)
    return {
        "d1": base.direction(bd,5,1.5) if len(bd)>=7 else "unavailable",
        "h4": base.direction(b4,6,0.75) if len(b4)>=8 else "unavailable",
        "h1": base.direction(b1,6,0.25) if len(b1)>=8 else "unavailable",
    }


def mtf_accept(mode, side, d1,h4,h1,basket):
    exp="up" if side=="long" else "down"; opp="down" if side=="long" else "up"
    if mode=="small": return True
    if mode=="strict": return d1==exp and h4==exp and h1==exp
    if mode=="hier": return h4==exp and h1==exp and d1!=opp
    if mode=="weighted":
        score=(2 if h4==exp else -2 if h4==opp else 0)+(2 if h1==exp else -2 if h1==opp else 0)+(1 if d1==exp else -1 if d1==opp else 0)
        return score>=3 if basket=="stable_quality" else score>=5
    return False


def select_entry(rows,i,side,setup,mode,a15):
    if i+1>=len(rows): return None
    if mode=="next_open": return (i+1,rows[i+1]["o"])
    if mode=="confirm1":
        j=i+1
        b=rows[j]
        ok=(b["c"]>b["o"] and b["c"]>=rows[i]["c"]) if side=="long" else (b["c"]<b["o"] and b["c"]<=rows[i]["c"])
        return (j+1,rows[j+1]["o"]) if ok and j+1<len(rows) else None
    if mode=="smart":
        # Pullback waits for reclaim; breakout/consolidation waits for a shallow retest.
        if setup=="pullback_contraction":
            for j in range(i+1,min(i+4,len(rows)-1)):
                if side=="long" and rows[j]["c"]>rows[j-1]["h"]: return (j+1,rows[j+1]["o"])
                if side=="short" and rows[j]["c"]<rows[j-1]["l"]: return (j+1,rows[j+1]["o"])
            return None
        level=max(x["h"] for x in rows[i-6:i]) if side=="long" else min(x["l"] for x in rows[i-6:i])
        atr15=base.atr(a15,14)
        pad=(atr15 or 0)*0.20
        for j in range(i+1,min(i+4,len(rows)-1)):
            if side=="long" and rows[j]["l"]<=level+pad and rows[j]["c"]>=level: return (j+1,rows[j+1]["o"])
            if side=="short" and rows[j]["h"]>=level-pad and rows[j]["c"]<=level: return (j+1,rows[j+1]["o"])
        return None
    return None


def stop_for(entry,side,b15,mode):
    a=base.atr(b15,14)
    if not a or entry<=0: return None
    if side=="long":
        swing=min(x["l"] for x in b15[-4:])
        if mode=="structure_atr": stop=min(entry-0.8*a,swing-0.15*a)
        elif mode=="atr12": stop=entry-1.2*a
        else: stop=swing-0.05*a
        if stop>=entry: return None
        return stop
    swing=max(x["h"] for x in b15[-4:])
    if mode=="structure_atr": stop=max(entry+0.8*a,swing+0.15*a)
    elif mode=="atr12": stop=entry+1.2*a
    else: stop=swing+0.05*a
    if stop<=entry: return None
    return stop


def simulate(rows,entry_idx,entry,stop,side,basket,exit_mode):
    risk=(entry-stop) if side=="long" else (stop-entry)
    if risk<=0:return None
    future=rows[entry_idx:min(len(rows),entry_idx+H8)]
    if not future:return None
    cost=(COST_PCT[basket]/100*entry)/risk
    def hits(bar,r):
        if side=="long": return bar["l"]<=stop,bar["h"]>=entry+r*risk
        return bar["h"]>=stop,bar["l"]<=entry-r*risk
    if exit_mode in ("fixed2","fixed3"):
        target=2.0 if exit_mode=="fixed2" else 3.0
        result=None
        for bar in future:
            sh,th=hits(bar,target)
            if sh: result=-1.0; break
            if th: result=target; break
        if result is None:
            close=future[-1]["c"]
            cr=(close-entry)/risk if side=="long" else (entry-close)/risk
            result=max(-1.0,min(target,cr))
        return result-cost
    # Partial at 2R, runner to 3R; remaining stop moves to breakeven after 2R.
    first=False; result=None
    for bar in future:
        if not first:
            sh,t2=hits(bar,2.0)
            if sh: result=-1.0; break
            if t2: first=True; continue
        else:
            if side=="long":
                if bar["l"]<=entry: result=1.0; break
                if bar["h"]>=entry+3*risk: result=2.5; break
            else:
                if bar["h"]>=entry: result=1.0; break
                if bar["l"]<=entry-3*risk: result=2.5; break
    if result is None:
        close=future[-1]["c"]
        cr=(close-entry)/risk if side=="long" else (entry-close)/risk
        result=(1.0+0.5*max(0,min(3,cr))) if first else max(-1,min(2,cr))
    return result-cost


def short_filter(name,feat,btcdirs,d1,h4,h1):
    strict=(d1=="down" and h4=="down" and h1=="down")
    if name=="strict": return strict
    riskoff=btcdirs.get("h4")=="down" and btcdirs.get("h1")=="down"
    if name=="strict_btc": return strict and riskoff
    if not (strict and riskoff and feat.get("ok")): return False
    checks=[
        (feat.get("oi_pct_1h") or -999)>0.25,
        (feat.get("funding") or -999)>0,
        (feat.get("lsr_account") or 0)>1.03,
        (feat.get("taker_sell_ratio") or 0)>1.05,
        (feat.get("mark_pct_1h") or 999)<-0.15,
    ]
    if name=="deriv_soft": return sum(checks)>=2
    return sum(checks)>=3


def pf(vals):
    w=sum(x for x in vals if x>0); l=-sum(x for x in vals if x<0)
    return w/l if l>0 else (999 if w>0 else 0)


def summarize(records,key_fields):
    g=defaultdict(list)
    for r in records:g[tuple(r[k] for k in key_fields)].append(r)
    out=[]
    for k,rows in g.items():
        vals=[x["r"] for x in rows]
        d={key_fields[i]:k[i] for i in range(len(k))}
        d.update(n=len(rows),pf=pf(vals),avg=sum(vals)/len(vals),win=sum(v>0 for v in vals)/len(vals))
        blocks=defaultdict(list)
        for x in rows: blocks[x["block"]].append(x["r"])
        d["positive_blocks"]=sum(1 for v in blocks.values() if len(v)>=3 and sum(v)/len(v)>0)
        d["tested_blocks"]=sum(1 for v in blocks.values() if len(v)>=3)
        out.append(d)
    return out


def main():
    price={}; stats={}; coverage=[]
    for basket,symbols in PRICE_BASKETS.items():
        for s in symbols:
            try:
                rows=base.fetch_gate_5m(s); price[s]=rows
                print("PRICE_OK",basket,s,len(rows))
            except Exception as e:
                print("PRICE_FAIL",basket,s,repr(e)); continue
            try:
                st=fetch_stats_1h(s); stats[s]=st; print("STATS_OK",s,len(st))
            except Exception as e:
                stats[s]=[]; print("STATS_FAIL",s,repr(e))
            coverage.append({"basket":basket,"symbol":s,"bars":len(price.get(s,[])),"stats":len(stats.get(s,[]))})
    btc=price.get("BTC",[])
    long_records=[]; short_records=[]
    mtf_modes={"stable_quality":["hier","strict","weighted"],"volatile":["strict","weighted","hier"]}
    entry_modes=["next_open","confirm1","smart"]
    stop_modes=["structure_atr","atr12","swing15"]
    exits=["fixed2","fixed3","partial2_3"]
    for basket,symbols in PRICE_BASKETS.items():
        for s in symbols:
            rows=price.get(s,[])
            if len(rows)<2500: continue
            a15=base.prep_agg(rows,900); a1=base.prep_agg(rows,3600); a4=base.prep_agg(rows,14400); ad=base.prep_agg(rows,86400)
            start_ts=rows[0]["t"]
            cooldown={}
            for i in range(220,len(rows)-H8-6):
                sigs=base.setup_signal(rows,i,a15,a1,a4,ad)
                if not sigs: continue
                ts=rows[i]["t"]+300
                block=max(0,int((ts-start_ts)//(7*86400)))
                btcdirs=tf_dirs(btc,ts) if btc else {"d1":"unavailable","h4":"unavailable","h1":"unavailable"}
                feat=stat_features(stats.get(s,[]),ts)
                for side,setup,d1,h4,h1,b15,b4 in sigs:
                    sigkey=(side,setup)
                    if i-cooldown.get(sigkey,-10000)<24: continue
                    cooldown[sigkey]=i
                    if side=="long":
                        for mtf in mtf_modes[basket]:
                            if not mtf_accept(mtf,side,d1,h4,h1,basket): continue
                            for em in entry_modes:
                                ent=select_entry(rows,i,side,setup,em,b15)
                                if not ent: continue
                                entry_idx,entry=ent
                                for sm in stop_modes:
                                    stop=stop_for(entry,side,b15,sm)
                                    if stop is None: continue
                                    risk_pct=(entry-stop)/entry*100
                                    maxrisk=3.0 if basket=="stable_quality" else 5.5
                                    if risk_pct<=0 or risk_pct>maxrisk: continue
                                    for xm in exits:
                                        rr=simulate(rows,entry_idx,entry,stop,side,basket,xm)
                                        if rr is None: continue
                                        long_records.append({"basket":basket,"symbol":s,"setup":setup,"mtf":mtf,"entry":em,"stop":sm,"exit":xm,"r":rr,"block":block})
                    else:
                        # Keep entry/stop simple while isolating short-filter quality.
                        ent=select_entry(rows,i,side,setup,"next_open",b15)
                        if not ent: continue
                        entry_idx,entry=ent
                        stop=stop_for(entry,side,b15,"structure_atr")
                        if stop is None: continue
                        risk_pct=(stop-entry)/entry*100
                        if risk_pct<=0 or risk_pct>(3.0 if basket=="stable_quality" else 5.5): continue
                        for filt in ["strict","strict_btc","deriv_soft","deriv_strict"]:
                            if not short_filter(filt,feat,btcdirs,d1,h4,h1): continue
                            for xm in exits:
                                rr=simulate(rows,entry_idx,entry,stop,side,basket,xm)
                                if rr is None: continue
                                short_records.append({"basket":basket,"symbol":s,"setup":setup,"filter":filt,"exit":xm,"r":rr,"block":block})
    long_sum=summarize(long_records,["basket","setup","mtf","entry","stop","exit"])
    short_sum=summarize(short_records,["basket","setup","filter","exit"])
    long_rank=[x for x in long_sum if x["n"]>=25]
    long_rank.sort(key=lambda x:(x["positive_blocks"],x["avg"],x["pf"]),reverse=True)
    short_rank=[x for x in short_sum if x["n"]>=12]
    short_rank.sort(key=lambda x:(x["positive_blocks"],x["avg"],x["pf"]),reverse=True)
    report={"research_only":True,"coverage":coverage,"long_top":long_rank[:40],"short_top":short_rank[:30],"long_groups":len(long_sum),"short_groups":len(short_sum)}
    Path('/tmp/crypto_mtf_multiway_v3.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print('\n=== LONG TOP ROBUST COMBOS ===')
    for r in long_rank[:25]:
        print(f"{r['basket']:14} {r['setup']:22} mtf={r['mtf']:8} entry={r['entry']:9} stop={r['stop']:13} exit={r['exit']:10} n={r['n']:4d} PF={r['pf']:.2f} avg={r['avg']:.3f} win={r['win']:.1%} blocks={r['positive_blocks']}/{r['tested_blocks']}")
    print('\n=== SHORT TOP FILTERS ===')
    for r in short_rank[:25]:
        print(f"{r['basket']:14} {r['setup']:22} filter={r['filter']:12} exit={r['exit']:10} n={r['n']:4d} PF={r['pf']:.2f} avg={r['avg']:.3f} win={r['win']:.1%} blocks={r['positive_blocks']}/{r['tested_blocks']}")
    print('REPORT=/tmp/crypto_mtf_multiway_v3.json')

if __name__=='__main__': main()
