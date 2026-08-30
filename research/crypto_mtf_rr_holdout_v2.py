#!/usr/bin/env python3
"""Holdout validation for a setup-specific MTF/RR policy.

Uses the *previous* 30-day window (days -60 to -30) so the refinements suggested
by the most-recent-30d exploration are not evaluated on the exact same sample.
"""
import importlib.util, json, math, time, urllib.parse
from pathlib import Path

spec=importlib.util.spec_from_file_location('rrbase', Path(__file__).with_name('crypto_mtf_rr_backtest.py'))
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

HOLDOUT_END=int(time.time())-30*86400


def fetch_holdout(base):
    contract=f"{base}_USDT"; out={}; end=HOLDOUT_END
    while len(out)<m.MAX_BARS:
        q=urllib.parse.urlencode({'contract':contract,'interval':'5m','limit':2000,'to':end})
        data=m.request_json(f"{m.BASE_URL}?{q}")
        if not isinstance(data,list) or not data: break
        oldest=None
        for item in data:
            if not isinstance(item,dict): continue
            t=int(m.num(item.get('t')) or 0)
            o,h,l,c=map(m.num,[item.get('o'),item.get('h'),item.get('l'),item.get('c')])
            qv=m.num(item.get('sum')); v=m.num(item.get('v'))
            if t and all(x is not None for x in (o,h,l,c)):
                out[t]={'t':t,'o':o,'h':h,'l':l,'c':c,'qv':qv,'v':v}; oldest=t if oldest is None else min(oldest,t)
        if oldest is None: break
        new_end=oldest-1
        if new_end>=end: break
        end=new_end
        time.sleep(0.08)
    return [out[k] for k in sorted(out)][-m.MAX_BARS:]

orig_setup=m.setup_signal

def setup_v2(rows5,i,a15,a1h,a4h,a1d):
    out=orig_setup(rows5,i,a15,a1h,a4h,a1d)
    if i<60: return out
    now=rows5[i]; prev=rows5[i-1]; cutoff=now['t']+m.INTERVAL
    b15=m.latest_closed(a15,cutoff); b1=m.latest_closed(a1h,cutoff); b4=m.latest_closed(a4h,cutoff); bd=m.latest_closed(a1d,cutoff)
    if len(b15)<20 or len(b1)<8 or len(b4)<8 or len(bd)<7: return out
    d1=m.direction(bd,5,1.5); h4=m.direction(b4,6,0.75); h1=m.direction(b1,6,0.25)
    r15=m.pct(b15[-1]['c'],b15[-5]['c'])
    histq=[x.get('qv') or 0 for x in rows5[max(0,i-13):i-1]]
    avg=(sum(histq)/len(histq)) if histq and sum(histq)>0 else None
    prev_vr=((prev.get('qv') or 0)/avg) if avg else None
    cur_vr=((now.get('qv') or 0)/avg) if avg else None
    prev_ret=m.pct(prev['c'],rows5[i-2]['c']); cur_ret=m.pct(now['c'],prev['c'])
    # Wait for the pullback to contract, then require a 5m re-acceleration trigger.
    if r15 is not None and r15>0.8 and prev_ret is not None and -0.35<=prev_ret<=0.05 and (prev_vr is None or prev_vr<=0.90):
        if cur_ret is not None and cur_ret>0.08 and now['c']>prev['h'] and (cur_vr is None or cur_vr>=0.90):
            out.append(('long','pullback_reaccel',d1,h4,h1,b15,b4))
    if r15 is not None and r15<-0.8 and prev_ret is not None and -0.05<=prev_ret<=0.35 and (prev_vr is None or prev_vr<=0.90):
        if cur_ret is not None and cur_ret<-0.08 and now['c']<prev['l'] and (cur_vr is None or cur_vr>=0.90):
            out.append(('short','pullback_reaccel',d1,h4,h1,b15,b4))
    return out

orig_accept=m.policy_accept

def accept_v2(policy,side,setup,d1,h4,h1,stop_pct,range_pos,basket):
    if policy!='hierarchical_rr':
        return orig_accept(policy,side,setup,d1,h4,h1,stop_pct,range_pos,basket)
    exp='up' if side=='long' else 'down'; opp='down' if side=='long' else 'up'
    strict=(d1==exp and h4==exp and h1==exp)
    hier=(h4==exp and h1==exp and d1!=opp)
    if not hier: return False
    # Remove the V1 hard "near 4H high/low" rejection; breakouts naturally occur at edges.
    max_stop=3.5 if basket=='stable_quality' else 5.5
    if stop_pct>max_stop: return False
    if side=='long':
        # Stable pullbacks/trend can use hierarchical alignment; consolidation needs full alignment.
        if setup=='consolidation' and not strict: return False
        if basket=='volatile' and setup in ('trend_follow','consolidation') and not strict: return False
        return setup in ('trend_follow','pullback_contraction','pullback_reaccel','consolidation')
    # Shorts are not symmetric with longs in the exploratory sample: require full MTF and a failed-bounce/re-accel structure.
    if not strict: return False
    if basket=='stable_quality': return setup=='pullback_reaccel'
    return setup in ('pullback_reaccel','pullback_contraction')

m.fetch_gate_5m=fetch_holdout
m.setup_signal=setup_v2
m.policy_accept=accept_v2

orig_summary=m.summarize

def summary_with_window(trades):
    return orig_summary(trades)
m.summarize=summary_with_window

m.main()
p=Path('/tmp/crypto_mtf_rr_report.json')
obj=json.loads(p.read_text())
obj['window']='holdout_previous_30d'
obj['holdout_end_epoch']=HOLDOUT_END
obj['policy_note']='hierarchical_rr is V2 setup-specific candidate; other policies remain baseline comparators'
p.write_text(json.dumps(obj,indent=2),encoding='utf-8')
