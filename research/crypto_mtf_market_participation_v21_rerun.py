#!/usr/bin/env python3
"""V21 rerun shim: fixes only heuristic_metrics variable shadowing.

This file deliberately leaves the V21 teacher, student features, fit window,
threshold selection, holdouts, pass gates, and data coverage rules unchanged.
The original V21 helper used `fn` both for a rule callable and the false-negative
counter, causing `TypeError: 'int' object is not callable` after the 97d fetch.
"""
import math

import crypto_mtf_market_participation_v21 as v21


def heuristic_metrics_fixed(rows):
    rules = {
        "v20_breadth60_like": lambda r: r["btc24"] >= 0 and r["advance_ratio"] >= 0.60,
        "turnover60": lambda r: r["btc24"] >= 0 and r["advance_ratio"] >= 0.60 and r["turnover_weighted_advance"] >= 0.60,
        "smallcap_participation60": lambda r: r["btc24"] >= 0 and r["smallcap_advance_ratio"] >= 0.60 and r["smallcap_turnover_weighted_advance"] >= 0.60,
    }
    out = {}
    for name, rule in rules.items():
        tp = tn = fp = fn_count = 0
        for r in rows:
            pred = bool(rule(r))
            y = bool(r["teacher"])
            if pred and y:
                tp += 1
            elif pred and not y:
                fp += 1
            elif not pred and y:
                fn_count += 1
            else:
                tn += 1
        n = tp + tn + fp + fn_count
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn_count) if tp + fn_count else 0.0
        specificity = tn / (tn + fp) if tn + fp else 0.0
        den = math.sqrt((tp + fp) * (tp + fn_count) * (tn + fp) * (tn + fn_count))
        out[name] = {
            "n": n,
            "balanced_accuracy": (recall + specificity) / 2,
            "precision": precision,
            "recall": recall,
            "mcc": (tp * tn - fp * fn_count) / den if den else 0.0,
        }
    return out


v21.heuristic_metrics = heuristic_metrics_fixed
v21.main()
