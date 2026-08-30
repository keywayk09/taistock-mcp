#!/usr/bin/env python3
"""Asymmetric SHORT research: failed bounce, breakdown-retest, blowoff reversal.

This deliberately does NOT invert LONG logic. It combines higher-timeframe context,
BTC risk regime, Gate OI/funding/account/taker statistics, and short-specific price patterns.
Research only; no Production writes.
"""
from __future__ import annotations
import json, math, sys
from collections import defaultdict
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import crypto_mtf_rr_backtest as base
import crypto_mtf_multiway_v3 as v3

BASKETS={
 'stable_quality':['BTC','ETH','SOL','XRP','DOGE','LINK'],
 'volatile':['WIF','PENGU','FARTCOIN','PEPE','ONT','BLESS','ALCH'],
}
TARGETS=[1.5,2.0,2.5,3.0]
COST={'stable_quality':0.08,'volatile':0.14}


def dirs(a1,a4,ad,ts):
 b1=base.latest_closed(a1,ts); b4=base.latest_closed(a4,ts); bd=base.latest_closed(ad,ts)
 return (base.direction(bd,5,1.5) if len(bd)>=7 else 'unavailable',
         base.direction(b4,6,0.75) if len(b4)>=8 else 'unavailable',
         base.direction(b1,6,0.25) if len(b1)>=8 else 'unavailable',b1,b4,bd)


def vr5(rows,i,n=12):
 prev=[x.get('qv') or 0 for x in rows[max(0,i-n):i]]
 avg=sum(prev)/len(prev) if prev else 0
 return ((rows[i].get('qv') or 0)/avg) if avg>0 else None


def deriv_score(f):
 if not f.get('ok'):return 0
 checks=[
   (f.get('oi_pct_1h') or -999)>0.20,
   (f.get('funding') or -999)>0,
   (f.get('lsr_account') or 0)>1.03,
   (f.get('taker_sell_ratio') or 0)>1.05,
   (f.get('mark_pct_1h') or 999)<-0.10,
 ]
 return sum(checks)


def signal_types(rows,i,b15,d1,h4,h1,basket,feat):
 if i<20 or len(b15)<20:return []
 a=base.atr(b15,14)
 if not a:return []
 out=[]; now=rows[i]; vol=vr5(rows,i)
 r15=base.pct(b15[-1]['c'],b15[-5]['c'])
 pre6=rows[i-6:i]; pre12=rows[i-12:i]
 # 1) Failed bounce inside an established downtrend: bounce, then rejection through local support.
 low6=min(x['l'] for x in pre6); high6=max(x['h'] for x in pre6)
 bounce=(high6/low6-1)*100 if low6>0 else 0
 local_support=min(x['l'] for x in rows[i-3:i])
 if r15 is not None and r15<-0.55 and bounce>(0.35 if basket=='stable_quality' else 0.70) and now['c']<local_support and (vol is None or vol>=0.95):
   out.append(('failed_bounce',max(x['h'] for x in pre6)+0.10*a))
 # 2) Breakdown then retest/rejection of prior support.
 support=min(x['l'] for x in rows[i-12:i-5])
 breakdown=any(x['c']<support for x in rows[i-5:i-1])
 retested=any(x['h']>=support-0.15*a for x in rows[i-3:i+1])
 if breakdown and retested and now['c']<support and r15 is not None and r15<-0.35:
   out.append(('breakdown_retest',max(max(x['h'] for x in rows[i-4:i+1]),support)+0.10*a))
 # 3) Blowoff/crowded reversal: extended upside + bearish rejection, allowed countertrend only with derivatives crowding.
 r1=base.pct(b15[-1]['c'],b15[-5]['c'])
 ext=(r1 or 0)>(1.4 if basket=='stable_quality' else 3.0)
 reject=now['c']<now['o'] and now['c']<rows[i-1]['l'] and (vol or 0)>=1.20
 if ext and reject and deriv_score(feat)>=2:
   out.append(('blowoff_reversal',max(x['h'] for x in pre12)+0.15*a))
 return out


def allow_filter(name,setup,d1,h4,h1,btc,feat):
 score=deriv_score(feat); btc_risk=btc['h4']=='down' and btc['h1']=='down'
 if setup in ('failed_bounce','breakdown_retest'):
   base_ok=h4=='down' and h1=='down' and d1!='up'
   if name=='price_riskoff':return base_ok
   if name=='btc_riskoff':return base_ok and btc_risk
   if name=='deriv2':return base_ok and btc_risk and score>=2
   if name=='deriv3':return base_ok and btc_risk and score>=3
   return False
 # Blowoff reversal is a separate countertrend family; require crowding, not a downtrend hierarchy.
 if name=='crowded2':return score>=2 and btc['h1']!='up'
 if name=='crowded3':return score>=3 and btc['h1']!='up'
 return False


def fixed_eval(rows,ei,entry,stop,basket,target):
 risk=stop-entry
 if risk<=0:return None
 future=rows[ei:min(len(rows),ei+base.HORIZONS['8h'])]
 if not future:return None
 cost=(COST[basket]/100*entry)/risk
 result=None
 for b in future:
   sh=b['h']>=stop; th=b['l']<=entry-target*risk
   if sh:result=-1.0;break
   if th:result=target;break
 if result is None:
   cr=(entry-future[-1]['c'])/risk
   result=max(-1,min(target,cr))
 return result-cost


def pf(v):
 w=sum(x for x in v if x>0);l=-sum(x for x in v if x<0)
 return w/l if l>0 else (999 if w>0 else 0)


def main():
 price={};stats={}
 for basket,syms in BASKETS.items():
  for s in syms:
   try:price[s]=base.fetch_gate_5m(s);print('PRICE_OK',basket,s,len(price[s]))
   except Exception as e:print('PRICE_FAIL',s,repr(e));continue
   try:stats[s]=v3.fetch_stats_1h(s);print('STATS_OK',s,len(stats[s]))
   except Exception as e:stats[s]=[];print('STATS_FAIL',s,repr(e))
 btc=price.get('BTC',[]); ba1=base.prep_agg(btc,3600);ba4=base.prep_agg(btc,14400);bad=base.prep_agg(btc,86400)
 rec=[]
 for basket,syms in BASKETS.items():
  for s in syms:
   rows=price.get(s,[])
   if len(rows)<2500:continue
   a15=base.prep_agg(rows,900);a1=base.prep_agg(rows,3600);a4=base.prep_agg(rows,14400);ad=base.prep_agg(rows,86400)
   start=rows[0]['t'];cool={}
   for i in range(240,len(rows)-base.HORIZONS['8h']-3):
    ts=rows[i]['t']+300
    d1,h4,h1,b1,b4,bd=dirs(a1,a4,ad,ts)
    b15=base.latest_closed(a15,ts)
    if len(b15)<20:continue
    bd1,bh4,bh1,_,_,_=dirs(ba1,ba4,bad,ts)
    btcdirs={'d1':bd1,'h4':bh4,'h1':bh1}
    feat=v3.stat_features(stats.get(s,[]),ts)
    for setup,stop in signal_types(rows,i,b15,d1,h4,h1,basket,feat):
      if stop<=rows[i]['c']:continue
      key=setup
      if i-cool.get(key,-10000)<24:continue
      cool[key]=i
      if i+1>=len(rows):continue
      entry=rows[i+1]['o'];riskpct=(stop-entry)/entry*100
      if riskpct<=0 or riskpct>(2.8 if basket=='stable_quality' else 5.5):continue
      filters=['crowded2','crowded3'] if setup=='blowoff_reversal' else ['price_riskoff','btc_riskoff','deriv2','deriv3']
      for flt in filters:
       if not allow_filter(flt,setup,d1,h4,h1,btcdirs,feat):continue
       for target in TARGETS:
        rr=fixed_eval(rows,i+1,entry,stop,basket,target)
        if rr is not None:rec.append({'basket':basket,'symbol':s,'setup':setup,'filter':flt,'target':target,'r':rr,'block':int((ts-start)//(7*86400))})
 g=defaultdict(list)
 for x in rec:g[(x['basket'],x['setup'],x['filter'],x['target'])].append(x)
 rows=[]
 for k,a in g.items():
  vals=[x['r'] for x in a];blocks=defaultdict(list)
  for x in a:blocks[x['block']].append(x['r'])
  rows.append({'basket':k[0],'setup':k[1],'filter':k[2],'target':k[3],'n':len(a),'pf':pf(vals),'avg':sum(vals)/len(vals),'win':sum(x>0 for x in vals)/len(vals),
               'positive_blocks':sum(1 for x in blocks.values() if len(x)>=3 and sum(x)/len(x)>0),'tested_blocks':sum(1 for x in blocks.values() if len(x)>=3)})
 rows=[x for x in rows if x['n']>=8];rows.sort(key=lambda x:(x['positive_blocks'],x['avg'],x['pf']),reverse=True)
 print('\n=== ASYMMETRIC SHORT RESULTS ===')
 for r in rows[:50]:print(f"{r['basket']:14} {r['setup']:18} {r['filter']:13} T={r['target']:.1f}R n={r['n']:3} PF={r['pf']:.2f} avg={r['avg']:.3f} win={r['win']:.1%} blocks={r['positive_blocks']}/{r['tested_blocks']}")
 Path('/tmp/crypto_short_asym_v5.json').write_text(json.dumps({'research_only':True,'summary':rows},indent=2),encoding='utf-8')

if __name__=='__main__':main()
