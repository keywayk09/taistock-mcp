#!/usr/bin/env python3
"""V21: teacher-student market participation gate research.

Research only. V20 showed that threshold-hacking 24h price breadth does not
reproduce the useful higher-timeframe breadth signal. V21 changes the question:
can a compact combination of fields already present in Production bulk tickers
(24h return + 24h turnover) imitate the exact V14 `breadth60` teacher?

Guardrails:
- Exact V14 gate_snapshot/accepts is the teacher; no reconstructed substitute.
- 97d OKX 5m history = 7d warm-up + a full 90d analysis window.
- Frozen 10-symbol universe, same OKX pagination/parser semantics as V17.
- Samples with unavailable 1H/4H/1D teacher state are explicitly excluded.
- Oldest 30d is the ONLY fitting window.
- Middle and recent 30d are untouched teacher-imitation holdouts.
- Fit objective is teacher classification quality, never trading P&L.
- No raw candles are persisted; only aggregate metrics/model coefficients.
- Student features require zero extra live market requests because they map to
  Bybit/Gate bulk-ticker 24h change and turnover fields already fetched by Light Scan.
- Passing V21 is NOT a Production promotion. It only permits a fresh RR/P&L
  confirmatory V22 and then Forward Shadow.
"""
from __future__ import annotations

import bisect
import json
import math
import time
import urllib.parse
from pathlib import Path
from statistics import mean, median, pstdev

import crypto_mtf_okx_90d_v17 as v17
import crypto_mtf_regime_quality_v14 as v14

SYMBOLS = list(dict.fromkeys(v14.BASKETS["stable_quality"] + v14.BASKETS["volatile"]))
ANALYSIS_NEED = 90 * 24 * 12
WARMUP_NEED = 7 * 24 * 12
FETCH_NEED = ANALYSIS_NEED + WARMUP_NEED
SAMPLE_STEP = 12  # hourly observations; teacher only uses fully closed HTF bars.

FEATURES = [
    "btc24",
    "eth24",
    "advance_ratio",
    "smallcap_advance_ratio",
    "median24",
    "q25_24",
    "mean24",
    "turnover_weighted_advance",
    "smallcap_turnover_weighted_advance",
    "turnover_weighted_strength",
    "dispersion24",
]


def fetch97(symbol):
    """V17-equivalent OKX fetcher extended only by the preregistered 7d warm-up."""
    inst = f"{symbol}-USDT-SWAP"
    out = {}
    after = None
    oldest_seen = None
    pages = 0
    while len(out) < FETCH_NEED and pages < 340:
        params = {"instId": inst, "bar": "5m", "limit": "100"}
        if after is not None:
            params["after"] = str(after)
        payload = v17.request_json(f"{v17.URL}?{urllib.parse.urlencode(params)}")
        if not isinstance(payload, dict) or payload.get("code") != "0":
            raise RuntimeError(f"okx_code={payload.get('code') if isinstance(payload, dict) else 'non_dict'}")
        data = payload.get("data") or []
        if not data:
            break
        page_oldest = None
        for item in data:
            if not isinstance(item, list) or len(item) < 9 or str(item[8]) != "1":
                continue
            ts = int(v17.num(item[0]) or 0)
            o, h, l, c = map(v17.num, item[1:5])
            if not ts or any(x is None for x in (o, h, l, c)):
                continue
            out[ts // 1000] = {
                "t": ts // 1000,
                "o": o,
                "h": h,
                "l": l,
                "c": c,
                "qv": v17.num(item[7]),
                "v": v17.num(item[5]),
            }
            page_oldest = ts if page_oldest is None else min(page_oldest, ts)
        if page_oldest is None or (oldest_seen is not None and page_oldest >= oldest_seen):
            break
        oldest_seen = page_oldest
        after = page_oldest - 1
        pages += 1
        time.sleep(0.10)
    return [out[k] for k in sorted(out)][-FETCH_NEED:]


def qtile(values, q):
    xs = sorted(x for x in values if x is not None and math.isfinite(x))
    if not xs:
        return None
    if len(xs) == 1:
        return xs[0]
    p = (len(xs) - 1) * q
    lo = int(math.floor(p)); hi = int(math.ceil(p))
    if lo == hi:
        return xs[lo]
    w = p - lo
    return xs[lo] * (1 - w) + xs[hi] * w


def prep_bulk(rows):
    return {"rows": rows, "times": [x["t"] for x in rows]}


def snapshot_24h(prepped, cutoff):
    rows = prepped["rows"]; times = prepped["times"]
    j = bisect.bisect_left(times, cutoff) - 1  # last fully closed 5m bar
    if j < 288:
        return None
    now = rows[j]["c"]; prev = rows[j - 288]["c"]
    ret = (now / prev - 1) * 100 if prev else None
    qv = 0.0
    qv_ok = False
    for k in range(j - 287, j + 1):
        x = rows[k].get("qv")
        if x is not None and math.isfinite(x) and x >= 0:
            qv += x; qv_ok = True
    return {"ret": ret, "qv": qv if qv_ok else None}


def student_features(bulk_market, cutoff):
    snap = {s: snapshot_24h(p, cutoff) for s, p in bulk_market.items()}
    if any(snap.get(s) is None or snap[s]["ret"] is None for s in SYMBOLS):
        return None
    rets = {s: snap[s]["ret"] for s in SYMBOLS}
    qvs = {s: snap[s]["qv"] for s in SYMBOLS}
    vals = list(rets.values())
    small = [s for s in SYMBOLS if s not in ("BTC", "ETH")]
    advance = sum(rets[s] > 0 for s in SYMBOLS) / len(SYMBOLS)
    small_adv = sum(rets[s] > 0 for s in small) / len(small)

    valid_qv = [qvs[s] for s in SYMBOLS if qvs[s] is not None and qvs[s] >= 0]
    total_qv = sum(valid_qv)
    if total_qv > 0 and len(valid_qv) == len(SYMBOLS):
        twa = sum(qvs[s] for s in SYMBOLS if rets[s] > 0) / total_qv
        tws = sum(qvs[s] * max(-1.0, min(1.0, rets[s] / 5.0)) for s in SYMBOLS) / total_qv
    else:
        twa = advance
        tws = mean(max(-1.0, min(1.0, x / 5.0)) for x in vals)

    small_qv_total = sum(qvs[s] or 0.0 for s in small)
    small_twa = (
        sum((qvs[s] or 0.0) for s in small if rets[s] > 0) / small_qv_total
        if small_qv_total > 0 else small_adv
    )

    return {
        "btc24": rets["BTC"],
        "eth24": rets["ETH"],
        "advance_ratio": advance,
        "smallcap_advance_ratio": small_adv,
        "median24": median(vals),
        "q25_24": qtile(vals, 0.25),
        "mean24": mean(vals),
        "turnover_weighted_advance": twa,
        "smallcap_turnover_weighted_advance": small_twa,
        "turnover_weighted_strength": tws,
        "dispersion24": pstdev(vals),
    }


def teacher_ready(snap):
    states = snap.get("states") or {}
    if len(states) != len(SYMBOLS):
        return False
    for s in SYMBOLS:
        state = states.get(s) or {}
        if state.get("1h") == "unavailable" or state.get("4h") == "unavailable" or state.get("1d") == "unavailable":
            return False
    return True


def zstats(rows):
    out = {}
    for f in FEATURES:
        vals = [r[f] for r in rows]
        mu = mean(vals); sd = pstdev(vals)
        out[f] = (mu, sd if sd > 1e-12 else 1.0)
    return out


def build_effect_weights(train, stats):
    pos = [r for r in train if r["teacher"] == 1]
    neg = [r for r in train if r["teacher"] == 0]
    if not pos or not neg:
        raise RuntimeError("teacher has only one class in training window")
    raw = {}
    for f in FEATURES:
        mu, sd = stats[f]
        p = mean((r[f] - mu) / sd for r in pos)
        n = mean((r[f] - mu) / sd for r in neg)
        raw[f] = max(-2.0, min(2.0, p - n))
    norm = sum(abs(x) for x in raw.values())
    if norm <= 1e-12:
        raise RuntimeError("zero student feature effect")
    return {f: raw[f] / norm for f in FEATURES}


def score(row, stats, weights, excluded=None):
    num = 0.0; den = 0.0
    for f in FEATURES:
        if f == excluded:
            continue
        mu, sd = stats[f]; w = weights[f]
        num += w * ((row[f] - mu) / sd)
        den += abs(w)
    return num / den if den else 0.0


def metrics(rows, threshold, stats, weights, excluded=None):
    tp = tn = fp = fn = 0
    for r in rows:
        pred = score(r, stats, weights, excluded) >= threshold
        y = bool(r["teacher"])
        if pred and y: tp += 1
        elif pred and not y: fp += 1
        elif not pred and y: fn += 1
        else: tn += 1
    n = tp + tn + fp + fn
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    specificity = tn / (tn + fp) if tn + fp else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    den = math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn))
    mcc = (tp * tn - fp * fn) / den if den else 0.0
    teacher_rate = (tp + fn) / n if n else 0.0
    pred_rate = (tp + fp) / n if n else 0.0
    return {
        "n": n, "tp": tp, "tn": tn, "fp": fp, "fn": fn,
        "accuracy": (tp + tn) / n if n else 0.0,
        "balanced_accuracy": (recall + specificity) / 2,
        "precision": precision, "recall": recall, "f1": f1, "mcc": mcc,
        "teacher_positive_rate": teacher_rate,
        "predicted_positive_rate": pred_rate,
        "positive_rate_abs_error": abs(teacher_rate - pred_rate),
    }


def choose_threshold(train, stats, weights):
    scored = sorted(score(r, stats, weights) for r in train)
    stride = max(1, len(scored) // 240)
    candidates = sorted(set(scored[::stride] + [scored[-1]]))
    teacher_rate = mean(r["teacher"] for r in train)
    best = None; best_key = None
    for th in candidates:
        m = metrics(train, th, stats, weights)
        # Teacher imitation only. Penalize pathological positive-rate mismatch.
        objective = m["mcc"] - 0.25 * abs(m["predicted_positive_rate"] - teacher_rate)
        key = (objective, m["balanced_accuracy"], m["f1"])
        if best is None or key > best_key:
            best = (th, m); best_key = key
    return best


def heuristic_metrics(rows):
    rules = {
        "v20_breadth60_like": lambda r: r["btc24"] >= 0 and r["advance_ratio"] >= 0.60,
        "turnover60": lambda r: r["btc24"] >= 0 and r["advance_ratio"] >= 0.60 and r["turnover_weighted_advance"] >= 0.60,
        "smallcap_participation60": lambda r: r["btc24"] >= 0 and r["smallcap_advance_ratio"] >= 0.60 and r["smallcap_turnover_weighted_advance"] >= 0.60,
    }
    out = {}
    for name, fn in rules.items():
        tp = tn = fp = fn = 0
        for r in rows:
            pred = bool(fn(r)); y = bool(r["teacher"])
            if pred and y: tp += 1
            elif pred and not y: fp += 1
            elif not pred and y: fn += 1
            else: tn += 1
        n = tp + tn + fp + fn
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        specificity = tn / (tn + fp) if tn + fp else 0.0
        den = math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn))
        out[name] = {
            "n": n,
            "balanced_accuracy": (recall + specificity) / 2,
            "precision": precision,
            "recall": recall,
            "mcc": (tp * tn - fp * fn) / den if den else 0.0,
        }
    return out


def weekly_blocks(rows, threshold, stats, weights):
    blocks = []
    for start in range(0, len(rows), 7 * 24):
        block = rows[start:start + 7 * 24]
        if len(block) < 72:
            continue
        blocks.append(metrics(block, threshold, stats, weights))
    return blocks


def clean_numbers(obj):
    if isinstance(obj, float):
        return round(obj, 6)
    if isinstance(obj, list):
        return [clean_numbers(x) for x in obj]
    if isinstance(obj, dict):
        return {k: clean_numbers(v) for k, v in obj.items()}
    return obj


def main():
    cache = {}; coverage = []
    for s in SYMBOLS:
        try:
            rows = fetch97(s)
            cache[s] = rows
            coverage.append({"symbol": s, "bars": len(rows)})
            print("FETCH_OK", s, len(rows))
        except Exception as exc:
            cache[s] = []
            coverage.append({"symbol": s, "bars": 0, "error": str(exc)})
            print("FETCH_FAIL", s, repr(exc))

    if any(len(cache.get(s, [])) < FETCH_NEED for s in SYMBOLS):
        raise RuntimeError("full 97d frozen-universe coverage required")

    teacher_market = {s: v14.prep(cache[s]) for s in SYMBOLS}
    bulk_market = {s: prep_bulk(cache[s]) for s in SYMBOLS}

    # Use BTC timestamps as canonical alignment. Warm-up observations are discarded.
    btc = cache["BTC"]
    observations = []
    for i in range(288, len(btc), SAMPLE_STEP):
        cutoff = btc[i]["t"] + 300
        snap = v14.gate_snapshot(teacher_market, cutoff)
        if not teacher_ready(snap):
            continue
        feat = student_features(bulk_market, cutoff)
        if feat is None:
            continue
        observations.append({
            "t": btc[i]["t"],
            "teacher": int(v14.accepts("breadth60", snap)),
            "teacher_breadth": snap["breadth"],
            "teacher_btc_swing": int(snap["btc_swing"]),
            **feat,
        })

    observations = observations[-90 * 24:]
    if len(observations) != 90 * 24:
        raise RuntimeError(f"insufficient post-warmup aligned observations: {len(observations)}")

    n30 = 30 * 24
    windows = {
        "old30d_train": observations[:n30],
        "mid30d_holdout": observations[n30:2*n30],
        "recent30d_holdout": observations[2*n30:3*n30],
    }

    stats = zstats(windows["old30d_train"])
    weights = build_effect_weights(windows["old30d_train"], stats)
    threshold, train_fit = choose_threshold(windows["old30d_train"], stats, weights)

    by_window = {k: metrics(v, threshold, stats, weights) for k, v in windows.items()}
    heuristics = {k: heuristic_metrics(v) for k, v in windows.items()}
    weekly = {k: weekly_blocks(v, threshold, stats, weights) for k, v in windows.items() if k != "old30d_train"}
    loo = {
        excluded: {
            k: metrics(v, threshold, stats, weights, excluded=excluded)
            for k, v in windows.items() if k != "old30d_train"
        }
        for excluded in FEATURES
    }

    def window_pass(m):
        return (
            m["mcc"] >= 0.35
            and m["balanced_accuracy"] >= 0.65
            and m["precision"] >= 0.65
            and m["recall"] >= 0.60
            and m["positive_rate_abs_error"] <= 0.15
        )

    holdout_pass = all(window_pass(by_window[k]) for k in ("mid30d_holdout", "recent30d_holdout"))
    # Robustness: no single feature removal may collapse both holdouts below MCC 0.20.
    loo_ok = all(
        max(loo[f]["mid30d_holdout"]["mcc"], loo[f]["recent30d_holdout"]["mcc"]) >= 0.20
        for f in FEATURES
    )
    passed = holdout_pass and loo_ok

    report = {
        "research_only": True,
        "version": "V21",
        "purpose": "zero-extra-request teacher-student market participation proxy",
        "teacher": "exact V14 breadth60 = btc_swing AND higher-TF breadth>=0.60",
        "history": "97d fetched = 7d warmup + exact 90d analysis",
        "teacher_readiness": "all 10 symbols require available 1h/4h/1d state before sample eligibility",
        "student_live_fields": ["24h return", "24h turnover"],
        "added_live_market_requests_if_implemented": 0,
        "fit_uses_trade_pnl": False,
        "fit_window": "old30d only",
        "holdouts": ["mid30d", "recent30d"],
        "features": FEATURES,
        "weights": weights,
        "threshold": threshold,
        "train_fit": train_fit,
        "window_metrics": by_window,
        "heuristic_baselines": heuristics,
        "weekly_holdout_blocks": weekly,
        "leave_one_feature_out": loo,
        "predeclared_pass": {
            "each_holdout_mcc_min": 0.35,
            "each_holdout_balanced_accuracy_min": 0.65,
            "each_holdout_precision_min": 0.65,
            "each_holdout_recall_min": 0.60,
            "each_holdout_positive_rate_abs_error_max": 0.15,
            "leave_one_feature_out_guard": "no feature removal collapses both holdouts below MCC 0.20",
        },
        "status": "PASS_TO_V22_CONFIRMATORY_RR" if passed else "FAIL_NO_THRESHOLD_HACKING",
        "coverage": coverage,
        "window_sizes": {k: len(v) for k, v in windows.items()},
        "next_if_pass": "V22: combine this frozen proxy with stable_quality LONG trend_follow 12h partial2_3; fresh 90d 2x-cost confirmatory trade test; Shadow only",
        "next_if_fail": "stop historical 24h-only fitting; move to live Forward Shadow aggregate telemetry using Bybit/Gate cross-exchange sign + turnover + funding, no raw storage",
    }

    report = clean_numbers(report)
    print("\n=== V21 TEACHER-STUDENT MARKET PARTICIPATION ===")
    print("status", report["status"])
    print("threshold", report["threshold"])
    print("weights", json.dumps(report["weights"], sort_keys=True))
    for k, m in report["window_metrics"].items():
        print(k, "n", m["n"], "MCC", m["mcc"], "BA", m["balanced_accuracy"], "P", m["precision"], "R", m["recall"], "rate_err", m["positive_rate_abs_error"])

    Path("/tmp/crypto_mtf_market_participation_v21.json").write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
