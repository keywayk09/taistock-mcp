#!/usr/bin/env python3
"""Focused second-pass crypto research after broad V3 grid.

Keeps the symbol set modest and tests a curated set of execution/MTF variants plus
asymmetric SHORT filters with Gate historical OI/funding/taker statistics.
Research branch only; no Production writes.
"""
from __future__ import annotations
import json, sys
from collections import defaultdict
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import crypto_mtf_rr_backtest as base
import crypto_mtf_multiway_v3 as v3

BASKETS={
  'stable_quality':['BTC','ETH','SOL','XRP','DOGE','LINK'],
  'volatile':['WIF','PENGU','FARTCOIN','PEPE','ONT','BLESS','ALCH'],
}
LONG_CONFIGS=[
  ('hier','next_open','structure_atr','fixed2'),
  ('hier','next_open','structure_atr','fixed3'),
  ('hier','confirm1','structure_atr','fixed3'),
  ('hier','smart','structure_atr','partial2_3'),
  ('strict','next_open','structure_atr','fixed3'),
  ('weighted','next_open','structure_atr','fixed3'),
  ('hier','next_open','atr12','fixed3'),
  ('hier','next_open','swing15','fixed3'),
]
SHORT_FILTERS=['strict','strict_btc','deriv_soft','deriv_strict']
EXITS=['fixed2','fixed3','partial2_3']


def latest_dirs(aggs,ts):
  a1,a4,ad=aggs
  b1=base.latest_closed(a1,ts); b4=base.latest_closed(a4,ts); bd=base.latest_closed(ad,ts)
  return {
    'd1':base.direction(bd,5,1.5) if len(bd)>=7 else 'unavailable',
    'h4':base.direction(b4,6,0.75) if len(b4)>=8 else 'unavailable',
    'h1':base.direction(b1,6,0.25) if len(b1)>=8 else 'unavailable',
  }


def pf(vals):
  w=sum(x for x in vals if x>0); l=-sum(x for x in vals if x<0)
  return w/l if l>0 else (999 if w>0 else 0)


def summarize(rows,keys):
  g=defaultdict(list)
  for r in rows:g[tuple(r[k] for k in keys)].append(r)
  out=[]
  for k,arr in g.items():
    vals=[x['r'] for x in arr]
    d={keys[i]:k[i] for i in range(len(k))}
    blocks=defaultdict(list)
    for x in arr:blocks[x['block']].append(x['r'])
    d.update(n=len(arr),pf=pf(vals),avg=sum(vals)/len(vals),win=sum(x>0 for x in vals)/len(vals),
             positive_blocks=sum(1 for x in blocks.values() if len(x)>=3 and sum(x)/len(x)>0),
             tested_blocks=sum(1 for x in blocks.values() if len(x)>=3))
    out.append(d)
  return out


def main():
  price={}; stats={}; coverage=[]
  for basket,symbols in BASKETS.items():
    for s in symbols:
      try:
        price[s]=base.fetch_gate_5m(s); print('PRICE_OK',basket,s,len(price[s]))
      except Exception as e:
        print('PRICE_FAIL',basket,s,repr(e)); continue
      try:
        stats[s]=v3.fetch_stats_1h(s); print('STATS_OK',s,len(stats[s]))
      except Exception as e:
        stats[s]=[]; print('STATS_FAIL',s,repr(e))
      coverage.append({'basket':basket,'symbol':s,'bars':len(price[s]),'stats':len(stats[s])})
  btc=price.get('BTC',[])
  btc_aggs=(base.prep_agg(btc,3600),base.prep_agg(btc,14400),base.prep_agg(btc,86400)) if btc else ([],[],[])
  longs=[]; shorts=[]
  for basket,symbols in BASKETS.items():
    for s in symbols:
      rows=price.get(s,[])
      if len(rows)<2500:continue
      a15=base.prep_agg(rows,900); a1=base.prep_agg(rows,3600); a4=base.prep_agg(rows,14400); ad=base.prep_agg(rows,86400)
      start=rows[0]['t']; cooldown={}
      for i in range(220,len(rows)-base.HORIZONS['8h']-6):
        sigs=base.setup_signal(rows,i,a15,a1,a4,ad)
        if not sigs:continue
        ts=rows[i]['t']+300; block=int((ts-start)//(7*86400)); btcdirs=latest_dirs(btc_aggs,ts)
        feat=v3.stat_features(stats.get(s,[]),ts)
        for side,setup,d1,h4,h1,b15,b4 in sigs:
          key=(side,setup)
          if i-cooldown.get(key,-10000)<24:continue
          cooldown[key]=i
          if side=='long':
            for mtf,entry_mode,stop_mode,exit_mode in LONG_CONFIGS:
              # Stable prefers hierarchical; volatile config still gets tested but strict/weighted are expected to dominate.
              if not v3.mtf_accept(mtf,side,d1,h4,h1,basket):continue
              ent=v3.select_entry(rows,i,side,setup,entry_mode,b15)
              if not ent:continue
              ei,entry=ent; stop=v3.stop_for(entry,side,b15,stop_mode)
              if stop is None:continue
              rp=(entry-stop)/entry*100
              if rp<=0 or rp>(3.0 if basket=='stable_quality' else 5.5):continue
              rr=v3.simulate(rows,ei,entry,stop,side,basket,exit_mode)
              if rr is not None:longs.append({'basket':basket,'symbol':s,'setup':setup,'mtf':mtf,'entry':entry_mode,'stop':stop_mode,'exit':exit_mode,'r':rr,'block':block})
          else:
            ent=v3.select_entry(rows,i,side,setup,'next_open',b15)
            if not ent:continue
            ei,entry=ent; stop=v3.stop_for(entry,side,b15,'structure_atr')
            if stop is None:continue
            rp=(stop-entry)/entry*100
            if rp<=0 or rp>(3.0 if basket=='stable_quality' else 5.5):continue
            for filt in SHORT_FILTERS:
              if not v3.short_filter(filt,feat,btcdirs,d1,h4,h1):continue
              for ex in EXITS:
                rr=v3.simulate(rows,ei,entry,stop,side,basket,ex)
                if rr is not None:shorts.append({'basket':basket,'symbol':s,'setup':setup,'filter':filt,'exit':ex,'r':rr,'block':block})
  ls=summarize(longs,['basket','setup','mtf','entry','stop','exit'])
  ss=summarize(shorts,['basket','setup','filter','exit'])
  ls=[x for x in ls if x['n']>=15]; ss=[x for x in ss if x['n']>=8]
  ls.sort(key=lambda x:(x['positive_blocks'],x['avg'],x['pf']),reverse=True)
  ss.sort(key=lambda x:(x['positive_blocks'],x['avg'],x['pf']),reverse=True)
  print('\n=== FOCUSED LONG ===')
  for r in ls[:35]:print(f"{r['basket']:14} {r['setup']:22} {r['mtf']:8} {r['entry']:9} {r['stop']:13} {r['exit']:10} n={r['n']:4} PF={r['pf']:.2f} avg={r['avg']:.3f} win={r['win']:.1%} blocks={r['positive_blocks']}/{r['tested_blocks']}")
  print('\n=== FOCUSED SHORT ===')
  for r in ss[:35]:print(f"{r['basket']:14} {r['setup']:22} {r['filter']:12} {r['exit']:10} n={r['n']:4} PF={r['pf']:.2f} avg={r['avg']:.3f} win={r['win']:.1%} blocks={r['positive_blocks']}/{r['tested_blocks']}")
  report={'research_only':True,'coverage':coverage,'long':ls,'short':ss}
  Path('/tmp/crypto_mtf_focused_v4.json').write_text(json.dumps(report,indent=2),encoding='utf-8')

if __name__=='__main__':main()
