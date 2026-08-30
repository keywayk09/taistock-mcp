#!/usr/bin/env python3
"""Threshold, entry-delay, risk-cap and BTC-regime sensitivity for LONG setups.
Research only; no production writes.
"""
from __future__ import annotations
import json
from collections import defaultdict
from pathlib import Path
import crypto_mtf_rr_backtest as base
import crypto_mtf_multiway_v3 as v3
from gate_history import fetch_gate_5m

BASKETS={'stable_quality':['BTC','ETH','SOL','XRP','DOGE','LINK'],'volatile':['WIF','PENGU','FARTCOIN','PEPE','ONT','BLESS','ALCH']}
CFG={
 ('stable_quality','trend_follow'):('hier','structure_atr'),
 ('stable_quality','pullback_contraction'):('hier','swing15'),
 ('stable_quality','consolidation'):('hier','structure_atr'),
 ('volatile','trend_follow'):('strict','structure_atr'),
 ('volatile','pullback_contraction'):('strict','structure_atr'),
 ('volatile','consolidation'):('strict','structure_atr'),
}
EPS_MULT=[0.75,1.0,1.25]
DELAY=[1,2]
RISK_CAP={'stable_quality':[2.0,3.0],'volatile':[4.0,5.5]}

def pf(vals):
 w=sum(x for x in vals if x>0); l=-sum(x for x in vals if x<0)
 return w/l if l>0 else (999 if w>0 else 0)

def mtf_scaled(mode,side,bd,b4,b1,m):
 d1=base.direction(bd,5,1.5*m); h4=base.direction(b4,6,0.75*m); h1=base.direction(b1,6,0.25*m)
 exp='up' if side=='long' else 'down'; opp='down' if side=='long' else 'up'
 if mode=='strict': return d1==exp and h4==exp and h1==exp
 return h4==exp and h1==exp and d1!=opp

def sim_delay(rows,i,delay,side,b15,basket,stop_mode):
 ei=i+delay
 if ei>=len(rows): return None
 entry=rows[ei]['o']; stop=v3.stop_for(entry,side,b15,stop_mode)
 if stop is None: return None
 rr=v3.simulate(rows,ei,entry,stop,side,basket,'fixed3')
 return (rr,(entry-stop)/entry*100) if rr is not None else None

def main():
 data={}; coverage=[]
 for basket,syms in BASKETS.items():
  for s in syms:
   try: rows=fetch_gate_5m(s,30); data[s]=rows; print('FETCH_OK',basket,s,len(rows)); coverage.append({'basket':basket,'symbol':s,'bars':len(rows)})
   except Exception as e: print('FETCH_FAIL',basket,s,repr(e))
 btc=data.get('BTC',[]); btc1=base.prep_agg(btc,3600) if btc else []; btc4=base.prep_agg(btc,14400) if btc else []
 rec=[]
 for basket,syms in BASKETS.items():
  for s in syms:
   rows=data.get(s,[])
   if len(rows)<2500: continue
   a15=base.prep_agg(rows,900); a1=base.prep_agg(rows,3600); a4=base.prep_agg(rows,14400); ad=base.prep_agg(rows,86400); cool={}
   for i in range(220,len(rows)-base.HORIZONS['8h']-6):
    cutoff=rows[i]['t']+300
    b1=base.latest_closed(a1,cutoff); b4=base.latest_closed(a4,cutoff); bd=base.latest_closed(ad,cutoff)
    bb1=base.latest_closed(btc1,cutoff) if btc1 else []; bb4=base.latest_closed(btc4,cutoff) if btc4 else []
    btc_h1=base.direction(bb1,6,0.25) if len(bb1)>=8 else 'na'; btc_h4=base.direction(bb4,6,0.75) if len(bb4)>=8 else 'na'
    regime='risk_on' if btc_h1=='up' and btc_h4=='up' else 'risk_off' if btc_h1=='down' and btc_h4=='down' else 'mixed'
    for side,setup,_,_,_,b15,_ in base.setup_signal(rows,i,a15,a1,a4,ad):
     if side!='long' or (basket,setup) not in CFG: continue
     if i-cool.get(setup,-10000)<24: continue
     cool[setup]=i
     mode,sm=CFG[(basket,setup)]
     for em in EPS_MULT:
      if not mtf_scaled(mode,side,bd,b4,b1,em): continue
      for delay in DELAY:
       out=sim_delay(rows,i,delay,side,b15,basket,sm)
       if not out: continue
       rr,riskpct=out
       for cap in RISK_CAP[basket]:
        if riskpct<=0 or riskpct>cap: continue
        rec.append({'basket':basket,'setup':setup,'eps_mult':em,'delay_bars':delay,'risk_cap':cap,'btc_regime':regime,'symbol':s,'r':rr})
 g=defaultdict(list)
 for x in rec: g[(x['basket'],x['setup'],x['eps_mult'],x['delay_bars'],x['risk_cap'])].append(x)
 summary=[]
 for k,rows in g.items():
  vals=[x['r'] for x in rows]; regimes=defaultdict(list)
  for x in rows: regimes[x['btc_regime']].append(x['r'])
  summary.append({'basket':k[0],'setup':k[1],'eps_mult':k[2],'delay_bars':k[3],'risk_cap':k[4],'n':len(vals),'pf':pf(vals),'avg':sum(vals)/len(vals),'win':sum(v>0 for v in vals)/len(vals),'regimes':{r:{'n':len(v),'pf':pf(v),'avg':sum(v)/len(v)} for r,v in regimes.items()}})
 print('\n=== SENSITIVITY V9 ===')
 for r in sorted([x for x in summary if x['n']>=25],key=lambda x:x['avg'],reverse=True)[:36]:
  print(f"{r['basket']:14} {r['setup']:22} eps={r['eps_mult']:.2f} delay={r['delay_bars']} cap={r['risk_cap']:.1f}% n={r['n']:4} PF={r['pf']:.2f} avg={r['avg']:.3f} regimes={r['regimes']}")
 Path('/tmp/crypto_mtf_sensitivity_v9.json').write_text(json.dumps({'research_only':True,'coverage':coverage,'summary':summary},indent=2),encoding='utf-8')

if __name__=='__main__': main()
