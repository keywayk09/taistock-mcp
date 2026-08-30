#!/usr/bin/env python3
"""Robustness suite for candidate crypto LONG policies. Research only.

Adds tests that the earlier passes did not cover well: transaction-cost stress,
execution variants, per-symbol robustness, weekly-block stability, and a simple
symbol holdout (A/B symbol split). Production is never touched.
"""
from __future__ import annotations
import json
from collections import defaultdict
from pathlib import Path
import crypto_mtf_rr_backtest as base
import crypto_mtf_multiway_v3 as v3
from gate_history import fetch_gate_5m

BASKETS={
 'stable_quality':['BTC','ETH','SOL','XRP','DOGE','LINK','ADA','AVAX','SUI','APT'],
 'volatile':['WIF','PENGU','FARTCOIN','PEPE','ONT','BLESS','ALCH','BONK','TURBO','POPCAT','MOODENG'],
}
BASE_COST={'stable_quality':0.08,'volatile':0.14}
# name, mtf, entry, stop, exit
VARIANTS={
 ('stable_quality','trend_follow'):[
  ('hier_nx_struct_3','hier','next_open','structure_atr','fixed3'),
  ('strict_nx_struct_3','strict','next_open','structure_atr','fixed3'),
  ('hier_nx_struct_2','hier','next_open','structure_atr','fixed2'),
  ('hier_nx_struct_p','hier','next_open','structure_atr','partial2_3'),
  ('hier_confirm_struct_3','hier','confirm1','structure_atr','fixed3')],
 ('stable_quality','pullback_contraction'):[
  ('hier_nx_swing_3','hier','next_open','swing15','fixed3'),
  ('hier_nx_struct_3','hier','next_open','structure_atr','fixed3'),
  ('strict_nx_struct_3','strict','next_open','structure_atr','fixed3'),
  ('hier_smart_struct_p','hier','smart','structure_atr','partial2_3')],
 ('stable_quality','consolidation'):[
  ('hier_confirm_struct_3','hier','confirm1','structure_atr','fixed3'),
  ('strict_confirm_struct_3','strict','confirm1','structure_atr','fixed3'),
  ('hier_nx_struct_3','hier','next_open','structure_atr','fixed3'),
  ('hier_smart_struct_p','hier','smart','structure_atr','partial2_3')],
 ('volatile','trend_follow'):[
  ('strict_smart_struct_3','strict','smart','structure_atr','fixed3'),
  ('strict_nx_struct_3','strict','next_open','structure_atr','fixed3'),
  ('strict_smart_struct_p','strict','smart','structure_atr','partial2_3'),
  ('hier_smart_struct_p','hier','smart','structure_atr','partial2_3')],
 ('volatile','pullback_contraction'):[
  ('strict_nx_struct_3','strict','next_open','structure_atr','fixed3'),
  ('strict_nx_struct_2','strict','next_open','structure_atr','fixed2'),
  ('strict_nx_struct_p','strict','next_open','structure_atr','partial2_3'),
  ('hier_nx_struct_3','hier','next_open','structure_atr','fixed3')],
 ('volatile','consolidation'):[
  ('strict_confirm_struct_3','strict','confirm1','structure_atr','fixed3'),
  ('strict_nx_struct_3','strict','next_open','structure_atr','fixed3'),
  ('strict_smart_struct_p','strict','smart','structure_atr','partial2_3'),
  ('hier_confirm_struct_3','hier','confirm1','structure_atr','fixed3')],
}
COST_MULT=[1.0,1.5,2.0]

def pf(vals):
 w=sum(x for x in vals if x>0); l=-sum(x for x in vals if x<0)
 return w/l if l>0 else (999 if w>0 else 0)

def summarize(rows):
 vals=[x['r'] for x in rows]
 blocks=defaultdict(list); syms=defaultdict(list)
 for x in rows:
  blocks[x['block']].append(x['r']); syms[x['symbol']].append(x['r'])
 return {
  'n':len(vals),'pf':pf(vals),'avg':sum(vals)/len(vals) if vals else 0,'win':sum(x>0 for x in vals)/len(vals) if vals else 0,
  'positive_blocks':sum(1 for v in blocks.values() if len(v)>=3 and sum(v)/len(v)>0),'tested_blocks':sum(1 for v in blocks.values() if len(v)>=3),
  'positive_symbols':sum(1 for v in syms.values() if len(v)>=3 and sum(v)/len(v)>0),'tested_symbols':sum(1 for v in syms.values() if len(v)>=3),
 }

def main():
 records=[]; coverage=[]
 for basket,syms in BASKETS.items():
  for si,s in enumerate(syms):
   try:
    rows=fetch_gate_5m(s,30); print('FETCH_OK',basket,s,len(rows)); coverage.append({'basket':basket,'symbol':s,'bars':len(rows)})
   except Exception as e:
    print('FETCH_FAIL',basket,s,repr(e)); continue
   if len(rows)<2500: continue
   a15=base.prep_agg(rows,900); a1=base.prep_agg(rows,3600); a4=base.prep_agg(rows,14400); ad=base.prep_agg(rows,86400)
   start=rows[0]['t']; cool={}
   for i in range(220,len(rows)-base.HORIZONS['8h']-6):
    for side,setup,d1,h4,h1,b15,b4 in base.setup_signal(rows,i,a15,a1,a4,ad):
     if side!='long' or (basket,setup) not in VARIANTS: continue
     key=setup
     if i-cool.get(key,-10000)<24: continue
     cool[key]=i
     for name,mtf,em,sm,xm in VARIANTS[(basket,setup)]:
      if not v3.mtf_accept(mtf,side,d1,h4,h1,basket): continue
      ent=v3.select_entry(rows,i,side,setup,em,b15)
      if not ent: continue
      ei,entry=ent; stop=v3.stop_for(entry,side,b15,sm)
      if stop is None: continue
      riskpct=(entry-stop)/entry*100
      if riskpct<=0 or riskpct>(3.0 if basket=='stable_quality' else 5.5): continue
      for cm in COST_MULT:
       old=v3.COST_PCT[basket]; v3.COST_PCT[basket]=BASE_COST[basket]*cm
       rr=v3.simulate(rows,ei,entry,stop,side,basket,xm)
       v3.COST_PCT[basket]=old
       if rr is None: continue
       records.append({'basket':basket,'setup':setup,'variant':name,'cost_mult':cm,'symbol':s,'symbol_split':'A' if si%2==0 else 'B','block':int((rows[i]['t']-start)//(7*86400)),'r':rr})
 groups=defaultdict(list)
 for x in records: groups[(x['basket'],x['setup'],x['variant'],x['cost_mult'])].append(x)
 summary=[]
 for k,rs in groups.items():
  row={'basket':k[0],'setup':k[1],'variant':k[2],'cost_mult':k[3],**summarize(rs)}
  a=[x for x in rs if x['symbol_split']=='A']; b=[x for x in rs if x['symbol_split']=='B']
  row['split_A']=summarize(a); row['split_B']=summarize(b); summary.append(row)
 print('\n=== ROBUSTNESS V8: BASE COST TOP ===')
 base_rows=[r for r in summary if r['cost_mult']==1.0 and r['n']>=25]
 for r in sorted(base_rows,key=lambda x:x['avg'],reverse=True)[:30]:
  print(f"{r['basket']:14} {r['setup']:22} {r['variant']:24} n={r['n']:4} PF={r['pf']:.2f} avg={r['avg']:.3f} blocks={r['positive_blocks']}/{r['tested_blocks']} syms={r['positive_symbols']}/{r['tested_symbols']} Aavg={r['split_A']['avg']:.3f} Bavg={r['split_B']['avg']:.3f}")
 print('\n=== COST x2 SURVIVORS ===')
 stress=[r for r in summary if r['cost_mult']==2.0 and r['n']>=25 and r['avg']>0 and r['pf']>1.15]
 for r in sorted(stress,key=lambda x:x['avg'],reverse=True)[:30]:
  print(f"{r['basket']:14} {r['setup']:22} {r['variant']:24} n={r['n']:4} PF={r['pf']:.2f} avg={r['avg']:.3f} blocks={r['positive_blocks']}/{r['tested_blocks']} syms={r['positive_symbols']}/{r['tested_symbols']}")
 Path('/tmp/crypto_mtf_robustness_v8.json').write_text(json.dumps({'research_only':True,'coverage':coverage,'summary':summary},indent=2),encoding='utf-8')

if __name__=='__main__': main()
