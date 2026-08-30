#!/usr/bin/env python3
"""60-day OKX temporal holdout for selected crypto LONG policies.

Research only. Uses the same already-selected rules without retuning, then compares
the earlier 30d and later 30d windows on an independent exchange venue.
"""
from __future__ import annotations

import json, math, time, urllib.parse, urllib.request
from collections import defaultdict
from pathlib import Path

import crypto_mtf_rr_backtest as base
import crypto_mtf_multiway_v3 as v3

OKX_HISTORY = "https://www.okx.com/api/v5/market/history-candles"
DAYS = 60
NEED = DAYS * 24 * 12
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


def num(v):
    try:
        x=float(v); return x if math.isfinite(x) else None
    except Exception:
        return None


def request_json(url, tries=5):
    last=None
    for attempt in range(tries):
        try:
            req=urllib.request.Request(url,headers={"Accept":"application/json","User-Agent":"crypto-mtf-okx-60d-v11"})
            with urllib.request.urlopen(req,timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as exc:
            last=exc; time.sleep(0.7*(attempt+1))
    raise last


def fetch_okx_5m(symbol):
    inst=f"{symbol}-USDT-SWAP"; out={}; after=None; pages=0; oldest_seen=None
    while len(out)<NEED and pages<190:
        p={"instId":inst,"bar":"5m","limit":"100"}
        if after is not None: p["after"]=str(after)
        payload=request_json(f"{OKX_HISTORY}?{urllib.parse.urlencode(p)}")
        if not isinstance(payload,dict) or payload.get("code")!="0":
            raise RuntimeError(f"okx_code={payload.get('code') if isinstance(payload,dict) else 'non_dict'} msg={payload.get('msg') if isinstance(payload,dict) else ''}")
        data=payload.get("data") or []
        if not data: break
        page_oldest=None
        for item in data:
            if not isinstance(item,list) or len(item)<9 or str(item[8])!="1": continue
            ts=int(num(item[0]) or 0); o,h,l,c=map(num,item[1:5])
            if not ts or any(x is None for x in (o,h,l,c)): continue
            t=ts//1000
            out[t]={"t":t,"o":o,"h":h,"l":l,"c":c,"qv":num(item[7]),"v":num(item[5])}
            page_oldest=ts if page_oldest is None else min(page_oldest,ts)
        if page_oldest is None or (oldest_seen is not None and page_oldest>=oldest_seen): break
        oldest_seen=page_oldest; after=page_oldest-1; pages+=1; time.sleep(0.12)
    return [out[k] for k in sorted(out)][-NEED:]


def pf(vals):
    w=sum(x for x in vals if x>0); l=-sum(x for x in vals if x<0)
    return w/l if l>0 else (999.0 if w>0 else 0.0)


def main():
    trades=[]; coverage=[]
    for basket,symbols in BASKETS.items():
        for symbol in symbols:
            try:
                rows=fetch_okx_5m(symbol); print("FETCH_OK",basket,symbol,len(rows)); coverage.append({"basket":basket,"symbol":symbol,"bars":len(rows)})
            except Exception as exc:
                print("FETCH_FAIL",basket,symbol,repr(exc)); coverage.append({"basket":basket,"symbol":symbol,"bars":0,"error":str(exc)}); continue
            if len(rows)<15000: continue
            a15=base.prep_agg(rows,900); a1=base.prep_agg(rows,3600); a4=base.prep_agg(rows,14400); ad=base.prep_agg(rows,86400)
            midpoint=(rows[0]["t"]+rows[-1]["t"])//2; cooldown={}
            for i in range(220,len(rows)-base.HORIZONS["8h"]-6):
                for side,setup,d1,h4,h1,b15,b4 in base.setup_signal(rows,i,a15,a1,a4,ad):
                    if side!="long" or setup not in CONFIGS[basket]: continue
                    if i-cooldown.get(setup,-10000)<24: continue
                    cooldown[setup]=i
                    mtf,em,sm,xm=CONFIGS[basket][setup]
                    if not v3.mtf_accept(mtf,side,d1,h4,h1,basket): continue
                    ent=v3.select_entry(rows,i,side,setup,em,b15)
                    if not ent: continue
                    ei,entry=ent; stop=v3.stop_for(entry,side,b15,sm)
                    if stop is None: continue
                    risk_pct=(entry-stop)/entry*100
                    if risk_pct<=0 or risk_pct>(3.0 if basket=="stable_quality" else 5.5): continue
                    rr=v3.simulate(rows,ei,entry,stop,side,basket,xm)
                    if rr is None: continue
                    window="prior30d" if rows[i]["t"]<midpoint else "recent30d"
                    trades.append({"basket":basket,"symbol":symbol,"setup":setup,"window":window,"r":rr})
    g=defaultdict(list); gs=defaultdict(list)
    for t in trades:
        g[(t["window"],t["basket"],t["setup"])].append(t["r"])
        gs[(t["window"],t["basket"],t["setup"],t["symbol"])].append(t["r"])
    summary=[]
    for (window,basket,setup),vals in sorted(g.items()):
        syms=[]
        for (w,b,s,sym),sv in gs.items():
            if (w,b,s)==(window,basket,setup): syms.append({"symbol":sym,"n":len(sv),"pf":pf(sv),"avg":sum(sv)/len(sv)})
        summary.append({"window":window,"basket":basket,"setup":setup,"n":len(vals),"pf":pf(vals),"avg":sum(vals)/len(vals),"win":sum(x>0 for x in vals)/len(vals),"positive_symbols":sum(x["avg"]>0 for x in syms),"eligible_symbols":len(syms),"symbols":sorted(syms,key=lambda x:x["symbol"])})
    print("\n=== OKX 60D TEMPORAL HOLDOUT ===")
    for r in summary:
        print(f"{r['window']:9} {r['basket']:14} {r['setup']:22} n={r['n']:4} PF={r['pf']:.2f} avg={r['avg']:.3f} win={r['win']:.1%} syms={r['positive_symbols']}/{r['eligible_symbols']}")
    Path('/tmp/crypto_mtf_okx_60d_v11.json').write_text(json.dumps({"research_only":True,"venue":"OKX","coverage":coverage,"summary":summary},indent=2),encoding='utf-8')


if __name__=='__main__': main()
