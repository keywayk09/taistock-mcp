#!/usr/bin/env python3
"""Isolated crypto MTF risk/reward research.

Price-structure research only. Uses public Gate futures candles because the current
GitHub runner can reach Gate while Bybit returns 403 from the runner region.
No production state, secrets, orders, or Cloudflare resources are touched.
"""
from __future__ import annotations

import json, math, statistics, time, urllib.parse, urllib.request
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

BASE_URL = "https://api.gateio.ws/api/v4/futures/usdt/candlesticks"
INTERVAL = 300
DAYS = 30
MAX_BARS = DAYS * 24 * 12

BASKETS = {
    "stable_quality": ["BTC", "ETH", "SOL", "XRP", "DOGE", "LINK"],
    "volatile": ["WIF", "PENGU", "FARTCOIN", "PEPE", "ONT", "BLESS", "ALCH"],
}

COST_PCT = {"stable_quality": 0.08, "volatile": 0.14}
HORIZONS = {"30m": 6, "1h": 12, "2h": 24, "4h": 48, "8h": 96}
TARGETS_R = [1.5, 2.0, 2.5, 3.0]


def num(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except Exception:
        return None


def request_json(url, tries=4):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"Accept":"application/json","User-Agent":"crypto-mtf-rr-research"})
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            last = e
            time.sleep(0.8 * (attempt + 1))
    raise last


def fetch_gate_5m(base):
    contract = f"{base}_USDT"
    out = {}
    end = int(time.time())
    while len(out) < MAX_BARS:
        q = urllib.parse.urlencode({"contract": contract, "interval":"5m", "limit":2000, "to": end})
        data = request_json(f"{BASE_URL}?{q}")
        if not isinstance(data, list) or not data:
            break
        oldest = None
        for item in data:
            if not isinstance(item, dict):
                continue
            t = int(num(item.get("t")) or 0)
            o,h,l,c = map(num, [item.get("o"), item.get("h"), item.get("l"), item.get("c")])
            qv = num(item.get("sum")); v = num(item.get("v"))
            if t and all(x is not None for x in (o,h,l,c)):
                out[t] = {"t":t,"o":o,"h":h,"l":l,"c":c,"qv":qv,"v":v}
                oldest = t if oldest is None else min(oldest, t)
        if oldest is None or len(data) < 2:
            break
        new_end = oldest - 1
        if new_end >= end:
            break
        end = new_end
        if len(out) >= MAX_BARS:
            break
        time.sleep(0.08)
    rows = [out[k] for k in sorted(out)][-MAX_BARS:]
    return rows


def aggregate(rows, seconds):
    need = seconds // INTERVAL
    groups = defaultdict(list)
    for b in rows:
        bucket = (b["t"] // seconds) * seconds
        groups[bucket].append(b)
    out = []
    for bucket, g in sorted(groups.items()):
        g.sort(key=lambda x:x["t"])
        if len(g) != need:
            continue
        if any(g[i]["t"] != bucket + i*INTERVAL for i in range(need)):
            continue
        out.append({
            "t":bucket,"o":g[0]["o"],"h":max(x["h"] for x in g),"l":min(x["l"] for x in g),"c":g[-1]["c"],
            "qv": sum(x["qv"] or 0 for x in g),
        })
    return out


def pct(a,b):
    return (a/b-1)*100 if a is not None and b not in (None,0) else None


def atr(bars, n=14):
    if len(bars) < n+1: return None
    trs=[]
    for i in range(-n,0):
        cur=bars[i]; prev=bars[i-1]
        trs.append(max(cur["h"]-cur["l"], abs(cur["h"]-prev["c"]), abs(cur["l"]-prev["c"])))
    return sum(trs)/len(trs)


def direction(bars, lookback, eps):
    if len(bars) < lookback+1: return "unavailable"
    r = pct(bars[-1]["c"], bars[-(lookback+1)]["c"])
    if r is None: return "unavailable"
    return "up" if r > eps else "down" if r < -eps else "neutral"


def latest_closed(agg, cutoff_end):
    # aggregate bar starts at t and is closed when t+interval <= cutoff_end
    return [x for x in agg if x["end"] <= cutoff_end]


def prep_agg(rows, seconds):
    a=aggregate(rows,seconds)
    for x in a: x["end"]=x["t"]+seconds
    return a


def vol_ratio(bars, n=6):
    if len(bars) < n+1: return None
    prev=[x.get("qv") or 0 for x in bars[-(n+1):-1]]
    avg=sum(prev)/len(prev) if prev else 0
    return ((bars[-1].get("qv") or 0)/avg) if avg>0 else None


def setup_signal(rows5, i, a15, a1h, a4h, a1d):
    if i < 50: return []
    now = rows5[i]; cutoff = now["t"] + INTERVAL
    b15=latest_closed(a15,cutoff); b1=latest_closed(a1h,cutoff); b4=latest_closed(a4h,cutoff); bd=latest_closed(a1d,cutoff)
    if len(b15)<20 or len(b1)<8 or len(b4)<8 or len(bd)<7: return []
    d1=direction(bd,5,1.5); h4=direction(b4,6,0.75); h1=direction(b1,6,0.25)
    r15=pct(b15[-1]["c"],b15[-5]["c"])
    vr15=vol_ratio(b15,6)
    vr5=None
    prevq=[x.get("qv") or 0 for x in rows5[max(0,i-12):i]]
    if prevq and sum(prevq)>0: vr5=(now.get("qv") or 0)/(sum(prevq)/len(prevq))
    prev_high=max(x["h"] for x in rows5[i-6:i]); prev_low=min(x["l"] for x in rows5[i-6:i])
    recent15=b15[-8:]
    a15v=atr(b15,14)
    if not a15v: return []
    # Compression: recent 4x15m range small relative to ATR history.
    range4=max(x["h"] for x in b15[-4:]) - min(x["l"] for x in b15[-4:])
    compression=range4 <= 2.2*a15v
    out=[]
    # Trend-follow breakout.
    if r15 is not None and r15>0.45 and now["c"]>prev_high and (vr5 or 0)>=1.05:
        out.append(("long","trend_follow",d1,h4,h1,b15,b4))
    if r15 is not None and r15<-0.45 and now["c"]<prev_low and (vr5 or 0)>=1.05:
        out.append(("short","trend_follow",d1,h4,h1,b15,b4))
    # Pullback-volume contraction: existing 15m trend, small opposite/flat 5m bar, light volume.
    ret5=pct(now["c"],rows5[i-1]["c"])
    if r15 is not None and r15>0.8 and ret5 is not None and -0.25<=ret5<=0.05 and (vr5 is None or vr5<=0.90):
        out.append(("long","pullback_contraction",d1,h4,h1,b15,b4))
    if r15 is not None and r15<-0.8 and ret5 is not None and -0.05<=ret5<=0.25 and (vr5 is None or vr5<=0.90):
        out.append(("short","pullback_contraction",d1,h4,h1,b15,b4))
    # Consolidation breakout after compressed 15m structure.
    if compression and now["c"]>prev_high and (vr5 or 0)>=1.10:
        out.append(("long","consolidation",d1,h4,h1,b15,b4))
    if compression and now["c"]<prev_low and (vr5 or 0)>=1.10:
        out.append(("short","consolidation",d1,h4,h1,b15,b4))
    return out


def policy_accept(policy, side, setup, d1,h4,h1, stop_pct, range_pos, basket):
    exp="up" if side=="long" else "down"; opp="down" if side=="long" else "up"
    if policy=="small_tf_baseline": return True
    if policy=="strict_full_mtf": return d1==exp and h4==exp and h1==exp
    hierarchical = h4==exp and h1==exp and d1!=opp
    if not hierarchical: return False
    if d1==opp and setup in ("trend_follow","pullback_contraction"): return False
    if policy=="hierarchical_mtf": return True
    # RR gate: avoid already-extended entries and structural stops that are too wide.
    max_stop = 2.8 if basket=="stable_quality" else 5.0
    if stop_pct > max_stop: return False
    if range_pos is not None:
        if side=="long" and range_pos>0.84: return False
        if side=="short" and range_pos<0.16: return False
    return True


def trade_eval(rows5,i,side,b15,b4,basket):
    if i+1 >= len(rows5): return None
    entry=rows5[i+1]["o"]
    a=atr(b15,14)
    if not a or entry<=0: return None
    if side=="long":
        structural=min(x["l"] for x in b15[-4:]) - 0.15*a
        stop=min(entry-0.8*a, structural)
        risk=entry-stop
    else:
        structural=max(x["h"] for x in b15[-4:]) + 0.15*a
        stop=max(entry+0.8*a, structural)
        risk=stop-entry
    if risk<=0: return None
    stop_pct=risk/entry*100
    recent4=b4[-8:]
    lo=min(x["l"] for x in recent4); hi=max(x["h"] for x in recent4)
    range_pos=(entry-lo)/(hi-lo) if hi>lo else None
    end=min(len(rows5), i+1+HORIZONS["8h"])
    future=rows5[i+1:end]
    if not future: return None
    sign=1 if side=="long" else -1
    mfe=max(sign*(x["h"]-entry)/risk if side=="long" else sign*(x["l"]-entry)/risk for x in future)
    # explicit to avoid sign confusion
    if side=="long":
        mfe=max((x["h"]-entry)/risk for x in future); mae=max((entry-x["l"])/risk for x in future)
    else:
        mfe=max((entry-x["l"])/risk for x in future); mae=max((x["h"]-entry)/risk for x in future)
    horizons={}
    for name,n in HORIZONS.items():
        f=future[:n]
        if not f: continue
        if side=="long":
            hmfe=max((x["h"]-entry)/risk for x in f); hmae=max((entry-x["l"])/risk for x in f); close_r=(f[-1]["c"]-entry)/risk
        else:
            hmfe=max((entry-x["l"])/risk for x in f); hmae=max((x["h"]-entry)/risk for x in f); close_r=(entry-f[-1]["c"])/risk
        horizons[name]={"mfe_r":hmfe,"mae_r":hmae,"close_r":close_r}
    outcomes={}
    cost_r=(COST_PCT[basket]/100*entry)/risk
    for target in TARGETS_R:
        result=None
        for x in future:
            if side=="long":
                stop_hit=x["l"]<=stop; target_hit=x["h"]>=entry+target*risk
            else:
                stop_hit=x["h"]>=stop; target_hit=x["l"]<=entry-target*risk
            if stop_hit and target_hit:
                result=-1.0; break  # conservative same-bar ordering
            if stop_hit: result=-1.0; break
            if target_hit: result=target; break
        if result is None:
            result=max(-1.0,min(target,horizons["8h"]["close_r"]))
        outcomes[str(target)] = result-cost_r
    return {"entry":entry,"stop":stop,"stop_pct":stop_pct,"range_pos":range_pos,"mfe_r":mfe,"mae_r":mae,"horizons":horizons,"outcomes":outcomes}


def pf(vals):
    wins=sum(x for x in vals if x>0); losses=-sum(x for x in vals if x<0)
    return wins/losses if losses>0 else (999.0 if wins>0 else 0.0)


def summarize(trades):
    groups=defaultdict(list)
    for t in trades:
        groups[(t["policy"],t["basket"],t["side"],t["setup"])].append(t)
    rows=[]
    for key,g in groups.items():
        policy,basket,side,setup=key
        row={"policy":policy,"basket":basket,"side":side,"setup":setup,"n":len(g),
             "median_mfe_r":statistics.median(x["mfe_r"] for x in g),"median_mae_r":statistics.median(x["mae_r"] for x in g)}
        for trg in TARGETS_R:
            vals=[x["outcomes"][str(trg)] for x in g]
            row[f"pf_{trg}r"]=pf(vals); row[f"avg_{trg}r"]=sum(vals)/len(vals); row[f"win_{trg}r"]=sum(v>0 for v in vals)/len(vals)
        rows.append(row)
    return rows


def main():
    all_trades=[]; coverage=[]
    policies=["small_tf_baseline","strict_full_mtf","hierarchical_mtf","hierarchical_rr"]
    for basket,symbols in BASKETS.items():
        for base in symbols:
            try:
                rows=fetch_gate_5m(base)
            except Exception as e:
                print(f"FETCH_FAIL {basket} {base}: {e}"); coverage.append({"basket":basket,"base":base,"bars":0,"error":str(e)}); continue
            coverage.append({"basket":basket,"base":base,"bars":len(rows)})
            print(f"FETCH_OK {basket} {base} bars={len(rows)}")
            if len(rows)<2500: continue
            a15=prep_agg(rows,900); a1=prep_agg(rows,3600); a4=prep_agg(rows,14400); ad=prep_agg(rows,86400)
            cooldown={}
            for i in range(200,len(rows)-HORIZONS["8h"]-2):
                sigs=setup_signal(rows,i,a15,a1,a4,ad)
                for side,setup,d1,h4,h1,b15,b4 in sigs:
                    ev=trade_eval(rows,i,side,b15,b4,basket)
                    if not ev: continue
                    for policy in policies:
                        key=(policy,side,setup)
                        if i-cooldown.get(key,-10_000)<24: continue
                        if not policy_accept(policy,side,setup,d1,h4,h1,ev["stop_pct"],ev["range_pos"],basket): continue
                        cooldown[key]=i
                        all_trades.append({"policy":policy,"basket":basket,"base":base,"side":side,"setup":setup,"d1":d1,"h4":h4,"h1":h1,**ev})
    summary=summarize(all_trades)
    report={"research_only":True,"source":"Gate futures 5m public candles","days":DAYS,"coverage":coverage,"summary":summary,"trade_count":len(all_trades)}
    Path("/tmp/crypto_mtf_rr_report.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    print("\n=== SUMMARY 2R (8h first-touch, costs included) ===")
    for r in sorted(summary,key=lambda x:(x["basket"],x["side"],x["setup"],x["policy"])):
        print(f"{r['basket']:14} {r['side']:5} {r['setup']:22} {r['policy']:18} n={r['n']:4d} PF2R={r['pf_2.0r']:.2f} avgR={r['avg_2.0r']:.3f} win={r['win_2.0r']:.1%} medMFE={r['median_mfe_r']:.2f} medMAE={r['median_mae_r']:.2f}")
    print("REPORT=/tmp/crypto_mtf_rr_report.json")

if __name__=="__main__": main()
