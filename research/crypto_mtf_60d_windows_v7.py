#!/usr/bin/env python3
"""Re-run V6 60d validation with the docs-compliant Gate pager."""
from __future__ import annotations
import crypto_mtf_rr_backtest as base
import crypto_mtf_60d_windows_v6 as v6
from gate_history import fetch_gate_5m

base.DAYS=60
base.MAX_BARS=60*24*12
base.fetch_gate_5m=lambda s: fetch_gate_5m(s,60)
v6.base.fetch_gate_5m=base.fetch_gate_5m

if __name__=='__main__':
    v6.main()
