#!/usr/bin/env python3
"""60-day two-window validation for selected LONG policies, research only."""
from __future__ import annotations
import json
from collections import defaultdict
from pathlib import Path
import crypto_mtf_rr_backtest as base
import crypto_mtf_multiway_v3 as v3
from gate_history import fetch_gate_5m

BASKETS={
 'stable_quality':['BTC','ETH','SOL','XRP','DOGE','LINK'],
 'volatile':['WIF','PENGU','FARTCOIN','PEPE','ONT','BLESS','ALCH'],
}
CONFIGS={
 'stable_quality':{
   'trend_follow':('hier','next_open','structure_atr','fixed3'),
   'pullback_contraction':('hier','next_open','swing15','fixed3'),
   'consolidation':('hier','confirm1','structure_atr','fixed3'),
 },
 'volatile':{
   'trend_follow':('strict','smart','structure_atr','fixed3'),
   'pullback_contraction':('strict','next_open','structure_atr','fixed3'),
   'consolidation':('strict','confirm1','structure_atr','fixed3'),
 },
}

def pf(vals):
 w=sum(x for x in vals if x>0); l=-sum(x for x in vals if x<0)
 return w/l if l>0 else (999 if w>0 else 0)

def main():
 rec=[]; coverage=[]
 for basket,syms in BASKETS.items():
  for s in syms:
   try:
    rows=fetch_gate_5m(s,60); print('FETCH_OK',basket,s,len(rows)); coverage.append({'basket':basket,'symbol':s,'bars':len(rows)})
   except Exception as e:
    print('FETCH_FAIL',basket,s,repr(e)); coverage.append({'basket':basket,'symbol':s,'bars':0,'error':str(e)}); continue
   if len(rows)<12000: continue
   a15=base.prep_agg(rows,900); a1=base.prep_agg(rows,3600); a4=base.prep_agg(rows,14400); ad=base.prep_agg(rows,86400)
   midpoint=(rows[0]['t']+rows[-1]['t'])//2; cool={}
   for i in range(220,len(rows)-base.HORIZONS['8h']-6):
    for side,setup,d1,h4,h1,b15,b4 in base.setup_signal(rows,i,a15,a1,a4,ad):
     if side!='long' or setup not in CONFIGS[basket]: continue
     if i-cool.get(setup,-10000)<24: continue
     cool[setup]=i
     mtf,em,sm,xm=CONFIGS[basket][setup]
     if not v3.mtf_accept(mtf,side,d1,h4,h1,basket): continue
     ent=v3.select_entry(rows,i,side,setup,em,b15)
     if not ent: continue
     ei,entry=ent; stop=v3.stop_for(entry,side,b15,sm)
     if stop is None: continue
     rp=(entry-stop)/entry*100
     if rp<=0 or rp>(3.0 if basket=='stable_quality' else 5.5): continue
     rr=v3.simulate(rows,ei,entry,stop,side,basket,xm)
     if rr is None: continue
     window='prior30d' if rows[i]['t']<midpoint else 'recent30d'
     rec.append({'basket':basket,'symbol':s,'setup':setup,'window':window,'r':rr})
 g=defaultdict(list)
 for x in rec: g[(x['window'],x['basket'],x['setup'])].append(x['r'])
 summary=[]
 for k,vals in sorted(g.items()):
  summary.append({'window':k[0],'basket':k[1],'setup':k[2],'n':len(vals),'pf':pf(vals),'avg':sum(vals)/len(vals),'win':sum(x>0 for x in vals)/len(vals)})
 print('\n=== 60D TWO-WINDOW SELECTED POLICY CHECK ===')
 for r in summary: print(f"{r['window']:9} {r['basket']:14} {r['setup']:22} n={r['n']:4} PF={r['pf']:.2f} avg={r['avg']:.3f} win={r['win']:.1%}")
 Path('/tmp/crypto_mtf_60d_windows_v6.json').write_text(json.dumps({'research_only':True,'coverage':coverage,'summary':summary},indent=2),encoding='utf-8')

if __name__=='__main__': main()
