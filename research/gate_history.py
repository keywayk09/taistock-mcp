#!/usr/bin/env python3
"""Docs-compliant Gate futures candle history helper for research only.

Gate rejects `limit` when `from` or `to` is present. Page backward with a
conservative <=900-point from/to window. The smaller window intentionally stays
well below Gate's documented 2000-point ceiling because boundary-sized windows
returned HTTP 400 from the GitHub-hosted research runner.
"""
from __future__ import annotations
import time, urllib.parse
import crypto_mtf_rr_backtest as base

INTERVAL=300
MAX_POINTS=900


def fetch_gate_5m(symbol, days=60):
    contract=f"{symbol}_USDT"
    need=days*24*12
    out={}
    end=(int(time.time())//INTERVAL)*INTERVAL-1
    while len(out)<need:
        # Inclusive endpoints: MAX_POINTS bars exactly.
        start=max(0,end-(MAX_POINTS-1)*INTERVAL)
        q=urllib.parse.urlencode({"contract":contract,"interval":"5m","from":start,"to":end})
        data=base.request_json(f"{base.BASE_URL}?{q}")
        if not isinstance(data,list) or not data:
            break
        oldest=None
        for item in data:
            if not isinstance(item,dict): continue
            t=int(base.num(item.get('t')) or 0)
            o,h,l,c=map(base.num,[item.get('o'),item.get('h'),item.get('l'),item.get('c')])
            qv=base.num(item.get('sum')); v=base.num(item.get('v'))
            if t and all(x is not None for x in (o,h,l,c)):
                out[t]={"t":t,"o":o,"h":h,"l":l,"c":c,"qv":qv,"v":v}
                oldest=t if oldest is None else min(oldest,t)
        if oldest is None: break
        new_end=oldest-1
        if new_end>=end: break
        end=new_end
        if len(data)<2: break
        time.sleep(0.08)
    return [out[k] for k in sorted(out)][-need:]
