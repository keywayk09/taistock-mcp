#!/usr/bin/env python3
"""Two-half stability check on the same 30-day research window.
Not a full out-of-sample test; used to detect whether an apparent edge exists only in one half.
"""
import importlib.util, json, statistics
from collections import defaultdict
from pathlib import Path

spec=importlib.util.spec_from_file_location('rrbase', Path(__file__).with_name('crypto_mtf_rr_backtest.py'))
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def aggregate_rows(trades):
    g=defaultdict(list)
    for t in trades: g[(t['half'],t['policy'],t['basket'],t['side'],t['setup'])].append(t)
    out=[]
    for (half,policy,basket,side,setup),rows in g.items():
        vals=[x['outcomes']['2.0'] for x in rows]
        out.append({'half':half,'policy':policy,'basket':basket,'side':side,'setup':setup,'n':len(rows),
                    'pf2':m.pf(vals),'avg2':sum(vals)/len(vals),'win2':sum(v>0 for v in vals)/len(vals),
                    'med_mfe':statistics.median(x['mfe_r'] for x in rows),'med_mae':statistics.median(x['mae_r'] for x in rows)})
    return out

all_trades=[]; coverage=[]
policies=['small_tf_baseline','strict_full_mtf','hierarchical_mtf']
for basket,symbols in m.BASKETS.items():
    for base in symbols:
        try: rows=m.fetch_gate_5m(base)
        except Exception as e:
            print('FETCH_FAIL',basket,base,e); continue
        print('FETCH_OK',basket,base,'bars',len(rows)); coverage.append((basket,base,len(rows)))
        if len(rows)<2500: continue
        split_t=rows[len(rows)//2]['t']
        a15=m.prep_agg(rows,900); a1=m.prep_agg(rows,3600); a4=m.prep_agg(rows,14400); ad=m.prep_agg(rows,86400)
        cooldown={}
        for i in range(200,len(rows)-m.HORIZONS['8h']-2):
            for side,setup,d1,h4,h1,b15,b4 in m.setup_signal(rows,i,a15,a1,a4,ad):
                ev=m.trade_eval(rows,i,side,b15,b4,basket)
                if not ev: continue
                half='first15d' if rows[i]['t']<split_t else 'second15d'
                for policy in policies:
                    key=(half,policy,side,setup)
                    if i-cooldown.get(key,-10000)<24: continue
                    if not m.policy_accept(policy,side,setup,d1,h4,h1,ev['stop_pct'],ev['range_pos'],basket): continue
                    cooldown[key]=i
                    all_trades.append({'half':half,'policy':policy,'basket':basket,'base':base,'side':side,'setup':setup,**ev})
summary=aggregate_rows(all_trades)
Path('/tmp/crypto_mtf_rr_splitcheck.json').write_text(json.dumps({'coverage':coverage,'summary':summary},indent=2),encoding='utf-8')
print('\n=== TWO-HALF STABILITY 2R ===')
for r in sorted(summary,key=lambda x:(x['basket'],x['side'],x['setup'],x['policy'],x['half'])):
    if r['policy']=='small_tf_baseline' or r['n']<8: continue
    print(f"{r['half']:9} {r['basket']:14} {r['side']:5} {r['setup']:22} {r['policy']:18} n={r['n']:3d} PF2={r['pf2']:.2f} avgR={r['avg2']:.3f} win={r['win2']:.1%} MFE={r['med_mfe']:.2f} MAE={r['med_mae']:.2f}")
