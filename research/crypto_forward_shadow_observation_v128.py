#!/usr/bin/env python3
"""Aggregate-only Forward Shadow observation collector for Crypto V1.3.0.

This collector intentionally stores no raw ticker payloads, K-lines, or OI time
series. It records only source health, aggregate market participation, candidate
state summaries, request budgets, and latency so forward evidence can accumulate
without creating a second market-data store.
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_PREVIEW = "https://7d75ff6c-tv-crypto-engine.keikei99887.workers.dev"


def fetch_json(base: str, path: str, timeout: int = 180) -> tuple[int, dict[str, Any], int]:
    """Fetch one Shadow JSON route and return HTTP status, JSON, and latency."""
    started = time.time()
    request = urllib.request.Request(
        base.rstrip("/") + path,
        headers={
            "Accept": "application/json",
            "User-Agent": "taistock-mcp-forward-shadow-observation-v130/1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
            status = response.status
            content_type = response.headers.get("content-type", "")
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        status = error.code
        content_type = error.headers.get("content-type", "")

    latency_ms = round((time.time() - started) * 1000)
    if "application/json" not in content_type.lower():
        raise RuntimeError(f"non_json_response status={status} content_type={content_type!r}")
    payload = json.loads(body)
    return status, payload, latency_ms


def compact_source_status(rows: Any) -> list[dict[str, Any]]:
    """Keep source health metadata only; never retain source market rows."""
    result: list[dict[str, Any]] = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        result.append(
            {
                "exchange": row.get("exchange"),
                "role": row.get("role"),
                "ok": row.get("ok"),
                "records": row.get("records", row.get("tickers")),
                "latency_ms": row.get("latency_ms"),
                "mode": row.get("mode"),
                "upstream_status": row.get("upstream_status"),
                "error": row.get("error"),
            }
        )
    return result


def stable_candidate_summary(candidate: dict[str, Any]) -> dict[str, Any]:
    """Persist only decision/evidence summaries, not raw exchange history."""
    mtf = candidate.get("multi_timeframe") or {}
    deep = candidate.get("deep") or {}
    metrics = deep.get("metrics") or {}
    return {
        "base": candidate.get("base"),
        "side": candidate.get("selected_side"),
        "core_stage": candidate.get("core_diagnostic_stage"),
        "final_stage": candidate.get("final_stage"),
        "final_stage_reason": candidate.get("final_stage_reason"),
        "mtf_alignment": mtf.get("alignment"),
        "mtf_score": mtf.get("score"),
        "mtf_directions": mtf.get("directions"),
        "research_setup": candidate.get("research_setup"),
        "research_actionability": candidate.get("research_actionability"),
        "research_reason": candidate.get("research_reason"),
        "light_score": candidate.get("light_score"),
        "deep_score": candidate.get("deep_score"),
        "opposite_deep_score": candidate.get("opposite_deep_score"),
        "regime_5m": candidate.get("regime_5m"),
        "regime_15m": candidate.get("regime_15m"),
        "price_5m_pct": metrics.get("price_5m_pct"),
        "price_15m_pct": metrics.get("price_15m_pct"),
        "trend_30m_pct": metrics.get("trend_30m_pct"),
        "trend_60m_pct": metrics.get("trend_60m_pct"),
        "oi_5m_pct": metrics.get("oi_5m_pct"),
        "oi_15m_pct": metrics.get("oi_15m_pct"),
    }


def volatile_candidate_summary(candidate: dict[str, Any]) -> dict[str, Any]:
    """Persist setup/actionability summaries only for the volatile lane."""
    mtf = candidate.get("multi_timeframe") or {}
    light = candidate.get("light") or {}
    deep = candidate.get("deep") or {}
    metrics = deep.get("metrics") or {}
    return {
        "base": candidate.get("base"),
        "side": candidate.get("side"),
        "setup": candidate.get("setup"),
        "original_setup": candidate.get("original_setup"),
        "action_state": candidate.get("action_state"),
        "risk": candidate.get("risk"),
        "volatile_score": candidate.get("volatile_score"),
        "mtf_alignment": mtf.get("alignment"),
        "mtf_score": mtf.get("score"),
        "mtf_directions": mtf.get("directions"),
        "research_actionability": candidate.get("research_actionability"),
        "research_reason": candidate.get("research_reason"),
        "kucoin_symbol": deep.get("kucoin_symbol"),
        "median_change_pct_24h": light.get("median_change_pct_24h"),
        "turnover_quote_24h_sum": light.get("turnover_quote_24h_sum"),
        "funding_rate_mean": light.get("funding_rate_mean"),
        "spread_bps_mean": light.get("spread_bps_mean"),
        "price_5m_pct": metrics.get("price_5m_pct"),
        "price_15m_pct": metrics.get("price_15m_pct"),
        "oi_5m_pct": metrics.get("oi_5m_pct"),
        "oi_15m_pct": metrics.get("oi_15m_pct"),
    }


def assert_no_legacy_bybit(payload: Any, label: str) -> None:
    """Fail the observation if blocked Bybit data-plane identifiers reappear."""
    serialized = json.dumps(payload, ensure_ascii=False).lower()
    forbidden = [
        "api.bybit.com",
        "api.bytick.com",
        "bybit_kline_5m",
        "bybit_oi_5m",
        "bybit_1h",
    ]
    leaked = [value for value in forbidden if value in serialized]
    if leaked:
        raise RuntimeError(f"{label}_legacy_bybit_leak={leaked}")


def classify_failure(payload: dict[str, Any], status: int) -> str:
    """Classify compact source failures without persisting raw market payloads."""
    serialized = json.dumps(payload, ensure_ascii=False).lower()
    if status == 429 or "upstream_http_429" in serialized or "rate limit" in serialized:
        return "rate_limited"
    if any(token in serialized for token in ("insufficient_closed_bars", "history_insufficient", "insufficient_history")):
        return "history_insufficient"
    if any(token in serialized for token in ("contract_not_found", "symbol_not_found", "invalid_symbol")):
        return "contract_unavailable"
    if status in (500, 502, 503, 504) or any(token in serialized for token in ("timeout", "timed out", "network", "connectionreset", "remotedisconnected")):
        return "transport_failure"
    return "data_incomplete"


def collect(base: str) -> dict[str, Any]:
    """Collect one V1.3.0 forward observation with fail-fast lane ordering."""
    health_status, health, health_latency = fetch_json(base, "/health", timeout=60)
    if health_status != 200 or health.get("ok") is not True:
        raise RuntimeError(f"health_failed status={health_status} class={classify_failure(health, health_status)}")
    if health.get("version") != "1.3.0-shadow":
        raise RuntimeError(f"unexpected_shadow_version={health.get('version')!r}")
    if health.get("production_promotion") is not False:
        raise RuntimeError("production_promotion_must_remain_false")

    # Promotion-relevant stable lane runs first. A stable failure stops here so
    # the collector does not double the upstream request burst with volatile.
    stable_status, stable, stable_latency = fetch_json(
        base,
        "/market/candidate-scan?profile=stable_quality&per_side=1&light_limit=12",
    )
    if stable_status != 200 or stable.get("ok") is not True or stable.get("core_pipeline_ok") is not True:
        raise RuntimeError(f"stable_failed status={stable_status} class={classify_failure(stable, stable_status)}")

    volatile_status, volatile, volatile_latency = fetch_json(
        base,
        "/market/candidate-scan?profile=volatile&per_side=1&setup=all",
    )
    if volatile_status != 200 or volatile.get("ok") is not True:
        raise RuntimeError(f"volatile_failed status={volatile_status} class={classify_failure(volatile, volatile_status)}")

    assert_no_legacy_bybit(stable, "stable")
    assert_no_legacy_bybit(volatile, "volatile")

    participation = stable.get("market_participation_shadow") or {}
    if participation.get("added_market_requests") != 0:
        raise RuntimeError("market_participation_must_add_zero_requests")
    if participation.get("threshold") is not None or participation.get("decision_effect") != "none":
        raise RuntimeError("market_participation_must_remain_observation_only")

    stable_candidates = stable.get("candidates") or []
    volatile_candidates = volatile.get("candidates") or []

    # Preserve the demotion-only safety invariant in every forward observation.
    for candidate in stable_candidates:
        actionability = str(candidate.get("research_actionability") or "")
        if actionability.startswith("shadow_preferred_long"):
            if candidate.get("selected_side") != "long":
                raise RuntimeError("stable_preferred_must_be_long")
            if candidate.get("final_stage") not in ("watch", "strong_watch"):
                raise RuntimeError("stable_preferred_cannot_promote_non_watch_core")
    for candidate in volatile_candidates:
        if candidate.get("side") == "short" and candidate.get("research_actionability") != "observation_only":
            raise RuntimeError("volatile_short_must_remain_observation_only")

    observed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "schema_version": "crypto-forward-observation-v1",
        "observed_at": observed_at,
        "shadow": {
            "base": base.rstrip("/"),
            "version": health.get("version"),
            "production_promotion": health.get("production_promotion"),
            "health_latency_ms": health_latency,
            "source_reliability_repair": stable.get("source_reliability_repair"),
        },
        "market_participation": {
            "mode": participation.get("mode"),
            "added_market_requests": participation.get("added_market_requests"),
            "decision_effect": participation.get("decision_effect"),
            "universe": participation.get("universe"),
            "turnover_participation": participation.get("turnover_participation"),
            "funding_crowding": participation.get("funding_crowding"),
            "cross_exchange_direction": participation.get("cross_exchange_direction"),
            "liquidity_quality": participation.get("liquidity_quality"),
            "kucoin_open_interest_observation": participation.get("kucoin_open_interest_observation"),
            "source_health": participation.get("source_health"),
        },
        "stable_quality": {
            "http_status": stable_status,
            "latency_ms": stable_latency,
            "selected_count": stable.get("selected_count"),
            "watchable_count": stable.get("watchable_count"),
            "final_watchable_count": stable.get("final_watchable_count"),
            "research_preferred_count": stable.get("research_preferred_count"),
            "research_wait_confirmation_count": stable.get("research_wait_confirmation_count"),
            "diagnostic_stage_counts": stable.get("diagnostic_stage_counts"),
            "subrequest_budget": stable.get("subrequest_budget"),
            "candidates": [stable_candidate_summary(row) for row in stable_candidates],
        },
        "volatile": {
            "http_status": volatile_status,
            "latency_ms": volatile_latency,
            "light_pool_count": volatile.get("light_pool_count"),
            "selected_count": volatile.get("selected_count"),
            "setup_counts": volatile.get("setup_counts"),
            "research_preferred_count": volatile.get("research_preferred_count"),
            "source_status": compact_source_status(volatile.get("source_status")),
            "subrequest_budget": volatile.get("subrequest_budget"),
            "candidates": [volatile_candidate_summary(row) for row in volatile_candidates],
        },
        "storage_policy": {
            "raw_tickers": "not_persisted",
            "raw_klines": "not_persisted",
            "raw_oi_series": "not_persisted",
            "aggregate_snapshot_only": True,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default=os.environ.get("PREVIEW_BASE", DEFAULT_PREVIEW))
    parser.add_argument("--out", default="forward-observation.json")
    args = parser.parse_args()

    observation = collect(args.base)
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(observation, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("CRYPTO_FORWARD_SHADOW_OBSERVATION_V130")
    print(json.dumps({
        "observed_at": observation["observed_at"],
        "version": observation["shadow"]["version"],
        "market_universe": (observation["market_participation"].get("universe") or {}).get("eligible_count"),
        "stable_selected": observation["stable_quality"].get("selected_count"),
        "stable_preferred": observation["stable_quality"].get("research_preferred_count"),
        "volatile_selected": observation["volatile"].get("selected_count"),
        "volatile_preferred": observation["volatile"].get("research_preferred_count"),
        "output": str(output),
        "result": "PASS_AGGREGATE_FORWARD_OBSERVATION",
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
