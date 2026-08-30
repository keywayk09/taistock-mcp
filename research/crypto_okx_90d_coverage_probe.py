#!/usr/bin/env python3
"""Probe whether OKX can supply a clean 90-day 5m history before V17.

Research-only coverage check. No strategy logic, secrets, writes, or Production state.
"""
from __future__ import annotations
import json, math, time, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

URL="https://www.okx.com/api/v5/market/history-candles"
NEED=90*24*12


def num(v):
    try:
        x=float(v); return x if math.isfinite(x) else None
    except Exception:return None


def req(url,tries=5):
    last=None
    for n in range(tries):
        try:
            r=urllib.request.Request(url,headers={"Accept":"application/json","User-Agent":"crypto-okx-90d-probe"})
            with urllib.request.urlopen(r,timeout=25) as resp:return json.loads(resp.read().decode())
        except Exception as exc:
            last=exc;time.sleep(0.7*(n+1))
    raise last


def fetch(symbol="BTC"):
    inst=f"{symbol}-USDT-SWAP";out={};after=None;oldest_seen=None;pages=0
    while len(out)<NEED and pages<320:
        p={"instId":inst,"bar":"5m","limit":"100"}
        if after is not None:p["after"]=str(after)
        payload=req(f"{URL}?{urllib.parse.urlencode(p)}")
        if not isinstance(payload,dict) or payload.get("code")!="0":raise RuntimeError(str(payload))
        data=payload.get("data") or []
        if not data:break
        page_oldest=None
        for item in data:
            if not isinstance(item,list) or len(item)<9 or str(item[8])!="1":continue
            ts=int(num(item[0]) or 0)
            if not ts:continue
            out[ts//1000]=1
            page_oldest=ts if page_oldest is None else min(page_oldest,ts)
        if page_oldest is None or (oldest_seen is not None and page_oldest>=oldest_seen):break
        oldest_seen=page_oldest;after=page_oldest-1;pages+=1;time.sleep(0.10)
    return sorted(out),pages


def iso(ts):return datetime.fromtimestamp(ts,tz=timezone.utc).isoformat()

def main():
    rows,pages=fetch("BTC")
    expected_span=(rows[-1]-rows[0])//300+1 if rows else 0
    gaps=max(0,expected_span-len(rows))
    result={"symbol":"BTC","bars":len(rows),"need":NEED,"pages":pages,"oldest":iso(rows[0]) if rows else None,"newest":iso(rows[-1]) if rows else None,"expected_slots":expected_span,"missing_slots":gaps,"coverage_ratio":len(rows)/expected_span if expected_span else 0,"pass_90d":len(rows)>=NEED and gaps<=3}
    print(json.dumps(result,indent=2))
    Path('/tmp/crypto_okx_90d_coverage_probe.json').write_text(json.dumps(result,indent=2),encoding='utf-8')

if __name__=='__main__':main()
