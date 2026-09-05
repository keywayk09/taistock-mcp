#!/usr/bin/env python3
"""Evaluate matured Crypto V1.3.0 Forward Shadow observations without raw persistence.

The observation artifacts intentionally contain only aggregate/candidate state. This
script reconstructs the price path at review time from public KuCoin + MEXC 5m
candles, computes forward return/MFE/MAE in memory, and writes only compact outcome
metrics. Raw K-lines are never written to disk or included in the output artifact.

This is research-only. It does not change model thresholds, ranking, setup rules,
or Production routing, and it does not promote any candidate.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

FIVE_MINUTES_MS = 5 * 60_000
HORIZONS_HOURS = (1, 3, 6, 12, 24)
USER_AGENT = "taistock-mcp-crypto-forward-outcome-v130/1"


def number(value: Any) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def median(values: list[float]) -> float | None:
    clean = [value for value in values if math.isfinite(value)]
    return statistics.median(clean) if clean else None


def mean(values: list[float]) -> float | None:
    clean = [value for value in values if math.isfinite(value)]
    return sum(clean) / len(clean) if clean else None


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def fetch_json(url: str, timeout: int = 30) -> Any:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": USER_AGENT},
    )
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"fetch_failed url={url} error={last_error}")


def canonical_kucoin_base(value: Any) -> str:
    base = "".join(ch for ch in str(value or "").upper() if ch.isalnum())
    if base == "XBT":
        return "BTC"
    for prefix in ("1000000", "10000", "1000"):
        if base.startswith(prefix) and len(base) > len(prefix) and base[len(prefix)].isalpha():
            return base[len(prefix):]
    return base


def mexc_symbol_for_base(base: str, kucoin_symbol: str | None) -> str:
    """Reuse the KuCoin multiplier contract mapping without an extra market request."""
    normalized = canonical_kucoin_base(base)
    explicit = str(kucoin_symbol or "").upper().strip()
    match = re.match(r"^(1000|10000|1000000)([A-Z0-9]+)USDTM$", explicit)
    if match and canonical_kucoin_base(match.group(2)) == normalized:
        return f"{match.group(1)}{normalized}_USDT"
    return f"{normalized}_USDT"


def kucoin_contract_map() -> dict[str, str]:
    payload = fetch_json("https://api-futures.kucoin.com/api/v1/contracts/active")
    rows = payload.get("data") if isinstance(payload, dict) else None
    if payload.get("code") != "200000" or not isinstance(rows, list):
        raise RuntimeError("kucoin_contracts_invalid")
    mapping: dict[str, str] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        symbol = str(row.get("symbol") or "").upper().strip()
        quote = str(row.get("quoteCurrency") or "").upper().strip()
        settle = str(row.get("settleCurrency") or "").upper().strip()
        status = str(row.get("status") or "").lower().strip()
        if not symbol.endswith("USDTM") or quote != "USDT" or settle != "USDT" or status != "open":
            continue
        base = canonical_kucoin_base(row.get("displayBaseCurrency") or row.get("baseCurrency"))
        if base and base not in mapping:
            mapping[base] = symbol
    if not mapping:
        raise RuntimeError("kucoin_contract_map_empty")
    return mapping


def normalize_bars(rows: list[dict[str, Any]]) -> list[dict[str, float]]:
    dedup: dict[int, dict[str, float]] = {}
    for row in rows:
        t = number(row.get("t"))
        o = number(row.get("o"))
        h = number(row.get("h"))
        l = number(row.get("l"))
        c = number(row.get("c"))
        if None in (t, o, h, l, c):
            continue
        if h < max(o, c, l) or l > min(o, c, h):
            continue
        dedup[int(t)] = {"t": float(int(t)), "o": o, "h": h, "l": l, "c": c}
    return [dedup[key] for key in sorted(dedup)]


def fetch_kucoin_bars(symbol: str, start_ms: int, end_ms: int) -> list[dict[str, float]]:
    """Fetch in bounded chunks so KuCoin never has to return an oversized series."""
    rows: list[dict[str, Any]] = []
    chunk_ms = 20 * 60 * 60_000
    cursor = start_ms
    while cursor < end_ms:
        stop = min(end_ms, cursor + chunk_ms)
        query = urllib.parse.urlencode({
            "symbol": symbol,
            "granularity": "5",
            "from": str(cursor),
            "to": str(stop),
        })
        payload = fetch_json(f"https://api-futures.kucoin.com/api/v1/kline/query?{query}")
        data = payload.get("data") if isinstance(payload, dict) else None
        if payload.get("code") != "200000" or not isinstance(data, list):
            raise RuntimeError(f"kucoin_kline_invalid symbol={symbol}")
        for item in data:
            if not isinstance(item, list) or len(item) < 5:
                continue
            rows.append({"t": item[0], "o": item[1], "h": item[2], "l": item[3], "c": item[4]})
        cursor = stop + 1
    return normalize_bars(rows)


def fetch_mexc_bars(symbol: str, start_ms: int, end_ms: int) -> list[dict[str, float]]:
    """Fetch the bounded review window in one MEXC futures K-line request."""
    query = urllib.parse.urlencode({
        "interval": "Min5",
        "start": str(start_ms // 1000),
        "end": str(end_ms // 1000),
    })
    payload = fetch_json(f"https://contract.mexc.com/api/v1/contract/kline/{symbol}?{query}")
    data = payload.get("data") if isinstance(payload, dict) else None
    if payload.get("success") is not True or payload.get("code") != 0 or not isinstance(data, dict):
        raise RuntimeError(f"mexc_kline_invalid symbol={symbol}")
    times = data.get("time") or []
    opens, highs, lows, closes = data.get("open") or [], data.get("high") or [], data.get("low") or [], data.get("close") or []
    rows = []
    for index, value in enumerate(times):
        if index >= min(len(opens), len(highs), len(lows), len(closes)):
            break
        t = number(value)
        rows.append({"t": t * 1000 if t is not None else None, "o": opens[index], "h": highs[index], "l": lows[index], "c": closes[index]})
    return normalize_bars(rows)


def load_observations(root: Path, now: datetime, min_age_h: float, max_age_h: float) -> list[dict[str, Any]]:
    observations: dict[str, dict[str, Any]] = {}
    for path in root.rglob("*.json"):
        try:
            body = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if body.get("schema_version") != "crypto-forward-observation-v1":
            continue
        observed_at = body.get("observed_at")
        if not isinstance(observed_at, str):
            continue
        observed = parse_time(observed_at)
        age_h = (now - observed).total_seconds() / 3600
        if age_h < min_age_h or age_h > max_age_h:
            continue
        # Artifact retries may contain the same timestamp. Exact timestamp is the
        # immutable observation identity for this review cohort.
        observations[observed_at] = body
    return [observations[key] for key in sorted(observations)]


def candidate_rows(observation: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    observed_at = observation["observed_at"]
    for lane, key in (("stable_quality", "stable_quality"), ("volatile", "volatile")):
        section = observation.get(key) or {}
        for candidate in section.get("candidates") or []:
            if not isinstance(candidate, dict):
                continue
            side = str(candidate.get("side") or "").lower()
            if side not in ("long", "short"):
                continue
            base = str(candidate.get("base") or "").upper().strip()
            if not base:
                continue
            out.append({
                "observed_at": observed_at,
                "shadow_version": (observation.get("shadow") or {}).get("version"),
                "lane": lane,
                "base": base,
                "side": side,
                "setup": candidate.get("research_setup") if lane == "stable_quality" else candidate.get("setup"),
                "actionability": candidate.get("research_actionability"),
                "mtf_alignment": candidate.get("mtf_alignment"),
                "mtf_score": candidate.get("mtf_score"),
            })
    return out


def reference_bar(bars: list[dict[str, float]], observed_ms: int) -> dict[str, float] | None:
    eligible = [bar for bar in bars if int(bar["t"]) + FIVE_MINUTES_MS <= observed_ms]
    if not eligible:
        return None
    ref = eligible[-1]
    # A stale reference would no longer represent what the live engine saw.
    if observed_ms - (int(ref["t"]) + FIVE_MINUTES_MS) > 15 * 60_000:
        return None
    return ref


def exchange_horizon_metrics(
    bars: list[dict[str, float]], ref: dict[str, float], observed_ms: int, horizon_hours: int, side: str
) -> dict[str, float] | None:
    horizon_ms = observed_ms + horizon_hours * 60 * 60_000
    ref_end = int(ref["t"]) + FIVE_MINUTES_MS
    future = [
        bar for bar in bars
        if int(bar["t"]) >= ref_end and int(bar["t"]) + FIVE_MINUTES_MS <= horizon_ms
    ]
    if not future:
        return None
    last = future[-1]
    # Require the price path to cover the horizon to within one 5m bar.
    if horizon_ms - (int(last["t"]) + FIVE_MINUTES_MS) > 6 * 60_000:
        return None
    ref_price = ref["c"]
    if ref_price <= 0:
        return None
    if side == "long":
        final_return = (last["c"] / ref_price - 1) * 100
        mfe = (max(bar["h"] for bar in future) / ref_price - 1) * 100
        mae = (min(bar["l"] for bar in future) / ref_price - 1) * 100
    else:
        final_return = (ref_price - last["c"]) / ref_price * 100
        mfe = (ref_price - min(bar["l"] for bar in future)) / ref_price * 100
        mae = (ref_price - max(bar["h"] for bar in future)) / ref_price * 100
    return {
        "return_pct": round(final_return, 6),
        "mfe_pct": round(mfe, 6),
        "mae_pct": round(mae, 6),
    }


def evaluate_candidate(
    candidate: dict[str, Any], market: dict[str, dict[str, list[dict[str, float]]]], now: datetime
) -> dict[str, Any]:
    observed = parse_time(candidate["observed_at"])
    observed_ms = int(observed.timestamp() * 1000)
    base = candidate["base"]
    sources = market.get(base) or {}
    refs: dict[str, dict[str, float]] = {}
    for exchange in ("kucoin", "mexc"):
        ref = reference_bar(sources.get(exchange) or [], observed_ms)
        if ref:
            refs[exchange] = ref

    ref_prices = [ref["c"] for ref in refs.values()]
    reference_price = median(ref_prices)
    reference_spread_pct = None
    if len(ref_prices) == 2 and reference_price and reference_price > 0:
        reference_spread_pct = abs(ref_prices[0] - ref_prices[1]) / reference_price * 100

    horizons: dict[str, Any] = {}
    for hours in HORIZONS_HOURS:
        if observed + timedelta(hours=hours) > now:
            continue
        by_exchange: dict[str, dict[str, float]] = {}
        for exchange, ref in refs.items():
            metric = exchange_horizon_metrics(
                sources.get(exchange) or [], ref, observed_ms, hours, candidate["side"]
            )
            if metric:
                by_exchange[exchange] = metric
        returns = [row["return_pct"] for row in by_exchange.values()]
        mfes = [row["mfe_pct"] for row in by_exchange.values()]
        maes = [row["mae_pct"] for row in by_exchange.values()]
        horizons[f"{hours}h"] = {
            "exchange_count": len(by_exchange),
            "cross_exchange_ok": len(by_exchange) == 2,
            "return_pct": round(median(returns), 6) if returns else None,
            "mfe_pct": round(median(mfes), 6) if mfes else None,
            "mae_pct": round(median(maes), 6) if maes else None,
        }

    promotion_cohort = (
        candidate["lane"] == "stable_quality"
        and candidate["side"] == "long"
        and candidate.get("setup") == "trend_follow"
    )
    preferred = str(candidate.get("actionability") or "").startswith("shadow_preferred_long")
    return {
        **candidate,
        "reference_price": round(reference_price, 10) if reference_price is not None else None,
        "reference_exchange_count": len(refs),
        "reference_cross_exchange_spread_pct": round(reference_spread_pct, 6) if reference_spread_pct is not None else None,
        "promotion_cohort": promotion_cohort,
        "preferred_shadow_state": preferred,
        "promotion_statistics_eligible": bool(
            promotion_cohort
            and candidate.get("shadow_version") == "1.3.0-shadow"
            and len(refs) == 2
            and reference_spread_pct is not None
            and reference_spread_pct <= 0.5
        ),
        "horizons": horizons,
    }


def aggregate(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str, str, str], list[float]] = defaultdict(list)
    mfe_groups: dict[tuple[str, str, str, str], list[float]] = defaultdict(list)
    mae_groups: dict[tuple[str, str, str, str], list[float]] = defaultdict(list)
    for record in records:
        setup = str(record.get("setup") or "unclassified")
        cohort = (
            "promotion_cohort" if record.get("promotion_statistics_eligible")
            else "promotion_legacy_diagnostic" if record.get("promotion_cohort")
            else "diagnostic"
        )
        for horizon, metric in (record.get("horizons") or {}).items():
            if not metric.get("cross_exchange_ok"):
                continue
            value = number(metric.get("return_pct"))
            mfe = number(metric.get("mfe_pct"))
            mae = number(metric.get("mae_pct"))
            if value is None:
                continue
            key = (record["lane"], record["side"], setup, f"{cohort}:{horizon}")
            groups[key].append(value)
            if mfe is not None:
                mfe_groups[key].append(mfe)
            if mae is not None:
                mae_groups[key].append(mae)

    summary: list[dict[str, Any]] = []
    for key in sorted(groups):
        lane, side, setup, cohort_horizon = key
        cohort, horizon = cohort_horizon.split(":", 1)
        values = groups[key]
        summary.append({
            "lane": lane,
            "side": side,
            "setup": setup,
            "cohort": cohort,
            "horizon": horizon,
            "n": len(values),
            "win_rate": round(sum(value > 0 for value in values) / len(values), 6),
            "avg_return_pct": round(mean(values), 6),
            "median_return_pct": round(median(values), 6),
            "avg_mfe_pct": round(mean(mfe_groups[key]), 6) if mfe_groups[key] else None,
            "avg_mae_pct": round(mean(mae_groups[key]), 6) if mae_groups[key] else None,
        })
    return summary


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--observation-dir", required=True)
    parser.add_argument("--min-age-hours", type=float, default=24.0)
    parser.add_argument("--max-age-hours", type=float, default=72.0)
    parser.add_argument("--out", default="crypto-forward-outcome-v128.json")
    args = parser.parse_args()

    now = datetime.now(timezone.utc)
    observations = load_observations(Path(args.observation_dir), now, args.min_age_hours, args.max_age_hours)
    candidates = [candidate for observation in observations for candidate in candidate_rows(observation)]
    bases = sorted({candidate["base"] for candidate in candidates})

    contracts = kucoin_contract_map() if bases else {}
    market: dict[str, dict[str, list[dict[str, float]]]] = {}
    source_health: list[dict[str, Any]] = []
    if observations:
        earliest = min(parse_time(row["observed_at"]) for row in observations) - timedelta(minutes=15)
        latest = max(parse_time(row["observed_at"]) for row in observations) + timedelta(hours=24, minutes=15)
        start_ms = int(earliest.timestamp() * 1000)
        end_ms = int(latest.timestamp() * 1000)
        for base in bases:
            symbol = contracts.get(base)
            entry: dict[str, list[dict[str, float]]] = {}
            kucoin_ok = False
            kucoin_error = None
            if symbol:
                try:
                    entry["kucoin"] = fetch_kucoin_bars(symbol, start_ms, end_ms)
                    kucoin_ok = len(entry["kucoin"]) > 0
                except Exception as exc:
                    kucoin_error = str(exc)
            else:
                kucoin_error = "contract_not_found"
            mexc_symbol = mexc_symbol_for_base(base, symbol)
            mexc_ok = False
            mexc_error = None
            try:
                entry["mexc"] = fetch_mexc_bars(mexc_symbol, start_ms, end_ms)
                mexc_ok = len(entry["mexc"]) > 0
            except Exception as exc:
                mexc_error = str(exc)
            market[base] = entry
            source_health.append({
                "base": base,
                "kucoin_symbol": symbol,
                "mexc_symbol": mexc_symbol,
                "kucoin_ok": kucoin_ok,
                "mexc_ok": mexc_ok,
                "required_pair_ok": kucoin_ok and mexc_ok,
                "kucoin_error": kucoin_error,
                "mexc_error": mexc_error,
            })

    records = [evaluate_candidate(candidate, market, now) for candidate in candidates]
    observation_versions = sorted({str((row.get("shadow") or {}).get("version") or "unknown") for row in observations})
    report = {
        "schema_version": "crypto-forward-outcome-v1",
        "generated_at": iso(now),
        "shadow_version": (observation_versions[0] if len(observation_versions) == 1 else "mixed"),
        "observation_shadow_versions": observation_versions,
        "research_only": True,
        "production_promotion": False,
        "observation_window": {
            "min_age_hours": args.min_age_hours,
            "max_age_hours": args.max_age_hours,
            "observation_count": len(observations),
            "candidate_count": len(candidates),
            "first_observed_at": observations[0]["observed_at"] if observations else None,
            "last_observed_at": observations[-1]["observed_at"] if observations else None,
        },
        "price_evaluation": {
            "sources": ["kucoin_futures_5m", "mexc_futures_5m"],
            "reference": "last_closed_5m_at_or_before_observation_per_exchange_then_median",
            "horizons_hours": list(HORIZONS_HOURS),
            "raw_market_series_persisted": False,
            "rr_policy_metrics": "not_computed_without_frozen_entry_stop_receipt",
        },
        "source_health": source_health,
        "records": records,
        "summary": aggregate(records),
        "storage_policy": {
            "raw_tickers": "not_persisted",
            "raw_klines": "not_persisted",
            "raw_oi_series": "not_persisted",
            "aggregate_outcomes_only": True,
            "permanent_archive": False,
        },
    }
    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    required_pair_ok = sum(1 for row in source_health if row["required_pair_ok"])
    promotion_records = sum(1 for row in records if row["promotion_cohort"])
    eligible_promotion_records = sum(1 for row in records if row["promotion_statistics_eligible"])
    print("CRYPTO_FORWARD_SHADOW_OUTCOME_V128")
    print(json.dumps({
        "observation_count": len(observations),
        "candidate_count": len(candidates),
        "unique_bases": len(bases),
        "required_pair_ok": f"{required_pair_ok}/{len(source_health)}",
        "promotion_cohort_records": promotion_records,
        "promotion_statistics_eligible": eligible_promotion_records,
        "result": "PASS_FORWARD_OUTCOME_EVALUATION",
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
