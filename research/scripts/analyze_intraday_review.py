from __future__ import annotations

import json
import math
import statistics
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

DATE = "2026-08-06"
ROOT = Path(f"data/intraday/{DATE}/yahoo-5m")
OUT = Path("research/daily")
OUT.mkdir(parents=True, exist_ok=True)

NAMES = {
    "2330": "台積電",
    "2337": "旺宏",
    "2408": "南亞科",
    "2454": "聯發科",
    "3081": "聯亞",
    "3481": "群創",
    "5347": "世界",
    "6147": "頎邦",
    "6196": "帆宣",
    "TAIEX": "加權指數",
}


def fnum(x: Any) -> float:
    try:
        v = float(x)
        return v if math.isfinite(v) else 0.0
    except Exception:
        return 0.0


def pct(a: float, b: float) -> float | None:
    return round((a / b - 1) * 100, 3) if b else None


def ema(values: list[float], period: int) -> list[float]:
    if not values:
        return []
    alpha = 2 / (period + 1)
    out = [values[0]]
    for v in values[1:]:
        out.append(alpha * v + (1 - alpha) * out[-1])
    return out


def linear_slope(values: list[float]) -> float:
    n = len(values)
    if n < 2:
        return 0.0
    xbar = (n - 1) / 2
    ybar = sum(values) / n
    den = sum((i - xbar) ** 2 for i in range(n))
    return sum((i - xbar) * (v - ybar) for i, v in enumerate(values)) / den if den else 0.0


def pivots(bars: list[dict[str, Any]], window: int = 2) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    lows, highs = [], []
    for i in range(window, len(bars) - window):
        lo = fnum(bars[i]["low"])
        hi = fnum(bars[i]["high"])
        if lo <= min(fnum(bars[j]["low"]) for j in range(i - window, i + window + 1)):
            lows.append({"i": i, "time": bars[i]["time"], "price": lo})
        if hi >= max(fnum(bars[j]["high"]) for j in range(i - window, i + window + 1)):
            highs.append({"i": i, "time": bars[i]["time"], "price": hi})
    return lows, highs


def event_result(bars: list[dict[str, Any]], idx: int, side: str, stop: float) -> dict[str, Any]:
    entry = fnum(bars[idx]["close"])
    future = bars[idx + 1 :]
    if not future or entry <= 0:
        return {"entry": entry, "stop": stop, "mfe_pct": None, "mae_pct": None, "mfe_r": None, "mae_r": None}
    if side == "long":
        best = max(fnum(x["high"]) for x in future)
        worst = min(fnum(x["low"]) for x in future)
        risk = max(entry - stop, 0)
        mfe = best - entry
        mae = entry - worst
    else:
        best = min(fnum(x["low"]) for x in future)
        worst = max(fnum(x["high"]) for x in future)
        risk = max(stop - entry, 0)
        mfe = entry - best
        mae = worst - entry
    return {
        "entry": entry,
        "stop": stop,
        "mfe_pct": round(mfe / entry * 100, 3),
        "mae_pct": round(mae / entry * 100, 3),
        "mfe_r": round(mfe / risk, 3) if risk > 0 else None,
        "mae_r": round(mae / risk, 3) if risk > 0 else None,
    }


def first_breakout(bars: list[dict[str, Any]], direction: str) -> dict[str, Any] | None:
    opening = [b for b in bars if b["time"][11:16] <= "09:25"]
    if len(opening) < 3:
        return None
    or_high = max(fnum(b["high"]) for b in opening)
    or_low = min(fnum(b["low"]) for b in opening)
    for i, b in enumerate(bars):
        if b["time"][11:16] <= "09:25":
            continue
        close = fnum(b["close"])
        if direction == "up" and close > or_high:
            stop = min(fnum(x["low"]) for x in bars[max(0, i - 2) : i + 1])
            return {"type": "opening_range_breakout_up", "side": "long", "time": b["time"], "index": i, "or_high": or_high, "or_low": or_low, **event_result(bars, i, "long", stop)}
        if direction == "down" and close < or_low:
            stop = max(fnum(x["high"]) for x in bars[max(0, i - 2) : i + 1])
            return {"type": "opening_range_breakout_down", "side": "short", "time": b["time"], "index": i, "or_high": or_high, "or_low": or_low, **event_result(bars, i, "short", stop)}
    return None


def first_pullback(bars: list[dict[str, Any]], side: str) -> dict[str, Any] | None:
    lows, highs = pivots(bars, 1)
    if side == "long":
        for p in lows:
            i = p["i"]
            if i < 4 or bars[i]["time"][11:16] > "11:30":
                continue
            prior_high = max(fnum(x["high"]) for x in bars[:i])
            prior_low = min(fnum(x["low"]) for x in bars[:i])
            if prior_high <= prior_low or p["price"] <= prior_low:
                continue
            retrace = (prior_high - p["price"]) / (prior_high - prior_low)
            if not 0.15 <= retrace <= 0.70:
                continue
            for j in range(i + 1, min(i + 6, len(bars))):
                trigger = max(fnum(x["high"]) for x in bars[max(i, j - 2) : j])
                if fnum(bars[j]["close"]) > trigger:
                    return {"type": "first_pullback_continuation_long", "side": "long", "time": bars[j]["time"], "index": j, "pivot_time": p["time"], "pivot_price": p["price"], "retrace": round(retrace, 3), **event_result(bars, j, "long", p["price"])}
    else:
        for p in highs:
            i = p["i"]
            if i < 4 or bars[i]["time"][11:16] > "11:30":
                continue
            prior_high = max(fnum(x["high"]) for x in bars[:i])
            prior_low = min(fnum(x["low"]) for x in bars[:i])
            if prior_high <= prior_low or p["price"] >= prior_high:
                continue
            retrace = (p["price"] - prior_low) / (prior_high - prior_low)
            if not 0.15 <= retrace <= 0.70:
                continue
            for j in range(i + 1, min(i + 6, len(bars))):
                trigger = min(fnum(x["low"]) for x in bars[max(i, j - 2) : j])
                if fnum(bars[j]["close"]) < trigger:
                    return {"type": "first_pullback_continuation_short", "side": "short", "time": bars[j]["time"], "index": j, "pivot_time": p["time"], "pivot_price": p["price"], "retrace": round(retrace, 3), **event_result(bars, j, "short", p["price"])}
    return None


def best_trendline(points: list[dict[str, Any]], bars: list[dict[str, Any]], kind: str, tolerance: float) -> dict[str, Any] | None:
    if len(points) < 2:
        return None
    best = None
    for a in range(len(points) - 1):
        for b in range(a + 1, len(points)):
            p1, p2 = points[a], points[b]
            if p2["i"] - p1["i"] < 4:
                continue
            slope = (p2["price"] - p1["price"]) / (p2["i"] - p1["i"])
            touches = []
            violations = 0
            breakout = None
            for i in range(p1["i"], len(bars)):
                line = p1["price"] + slope * (i - p1["i"])
                probe = fnum(bars[i]["low"] if kind == "support" else bars[i]["high"])
                close = fnum(bars[i]["close"])
                if abs(probe - line) <= tolerance:
                    touches.append({"time": bars[i]["time"], "price": probe})
                if kind == "support" and close < line - tolerance:
                    violations += 1
                    if i > p2["i"] and breakout is None:
                        breakout = {"time": bars[i]["time"], "price": close, "direction": "down"}
                if kind == "resistance" and close > line + tolerance:
                    violations += 1
                    if i > p2["i"] and breakout is None:
                        breakout = {"time": bars[i]["time"], "price": close, "direction": "up"}
            duration = p2["i"] - p1["i"]
            score = len(touches) * 10 + duration - violations * 8
            candidate = {
                "kind": kind,
                "start": p1,
                "end": p2,
                "slope_per_bar": round(slope, 5),
                "touch_count": len(touches),
                "touches": touches[:10],
                "tolerance": round(tolerance, 5),
                "breakout": breakout,
                "score": score,
            }
            if best is None or score > best["score"]:
                best = candidate
    return best


def load_symbol(path: Path) -> dict[str, Any]:
    obj = json.loads(path.read_text(encoding="utf-8"))
    bars = obj.get("data") or []
    bars = [b for b in bars if all(b.get(k) is not None for k in ("open", "high", "low", "close"))]
    return {"symbol": obj.get("symbol") or path.stem, "bars": bars}


def analyze(symbol: str, bars: list[dict[str, Any]]) -> dict[str, Any]:
    opens = [fnum(x["open"]) for x in bars]
    highs = [fnum(x["high"]) for x in bars]
    lows = [fnum(x["low"]) for x in bars]
    closes = [fnum(x["close"]) for x in bars]
    volumes = [fnum(x.get("volume")) for x in bars]
    o, h, l, c = opens[0], max(highs), min(lows), closes[-1]
    day_range = max(h - l, 1e-9)
    close_location = round((c - l) / day_range * 100, 2)
    high_i, low_i = highs.index(h), lows.index(l)
    e10 = ema(closes, 10)
    slope = linear_slope(closes)
    slope_pct = round(slope / o * 100, 4) if o else 0
    opening = [b for b in bars if b["time"][11:16] <= "09:25"]
    or_high = max(fnum(b["high"]) for b in opening)
    or_low = min(fnum(b["low"]) for b in opening)
    pl, ph = pivots(bars, 2)
    median_bar_range = statistics.median([max(fnum(x["high"]) - fnum(x["low"]), 0) for x in bars])
    tolerance = max(day_range * 0.0125, median_bar_range * 0.55)
    support = best_trendline(pl, bars, "support", tolerance)
    resistance = best_trendline(ph, bars, "resistance", tolerance)
    events = [x for x in [first_breakout(bars, "up"), first_breakout(bars, "down"), first_pullback(bars, "long"), first_pullback(bars, "short")] if x]

    judgment = []
    if c > o and close_location >= 78 and slope > 0:
        judgment.append({"verdict": "expected_long_checkpoint", "reason": "收盤位於日內高檔、線性斜率向上；應檢查L1/L2或RBND是否在合理位置出現。"})
        judgment.append({"verdict": "avoid_short_checkpoint", "reason": "趨勢結構偏多；未出現明確失敗前，S1/S2/S5逆勢空標應提高否決門檻。"})
    elif c < o and close_location <= 28 and slope < 0:
        judgment.append({"verdict": "expected_short_checkpoint", "reason": "收盤位於日內低檔、線性斜率向下；應檢查S1/S2/S3/S5是否捕捉轉弱。"})
        judgment.append({"verdict": "avoid_long_checkpoint", "reason": "趨勢結構偏空；反彈多標需要更強的支撐與第二次價格承諾。"})
    else:
        judgment.append({"verdict": "reasonable_no_trade", "reason": "日內方向或收盤位置未形成單邊優勢，應避免因事後漲跌倒推必須交易。"})

    if high_i <= 3 and c < o and close_location < 35:
        judgment.append({"verdict": "expected_short_checkpoint", "reason": "早盤高點形成後無法收復開盤價，屬開高失敗／高檔轉弱研究案例。"})
    if low_i <= 5 and c > o and close_location > 75:
        judgment.append({"verdict": "expected_long_checkpoint", "reason": "早盤低點完成後收在高檔，屬低點承接後趨勢延續研究案例。"})

    usable_volume = sum(1 for v in volumes if v > 0)
    return {
        "symbol": symbol,
        "name": NAMES.get(symbol, symbol),
        "bars": len(bars),
        "open": o,
        "high": h,
        "low": l,
        "close": c,
        "day_return_pct": pct(c, o),
        "range_pct_of_open": round(day_range / o * 100, 3) if o else None,
        "close_location_pct": close_location,
        "high_time": bars[high_i]["time"],
        "low_time": bars[low_i]["time"],
        "opening_range_high": or_high,
        "opening_range_low": or_low,
        "trend_slope_pct_per_bar": slope_pct,
        "above_ema10_ratio": round(sum(1 for x, e in zip(closes, e10) if x >= e) / len(closes), 3),
        "volume_bars_usable": usable_volume,
        "pivot_lows": pl,
        "pivot_highs": ph,
        "events": events,
        "trendlines": {"support": support, "resistance": resistance},
        "judgment": judgment,
    }


analyses: dict[str, Any] = {}
for path in sorted(ROOT.glob("*.json")):
    if path.name == "summary.json":
        continue
    item = load_symbol(path)
    if item["bars"]:
        analyses[item["symbol"]] = analyze(item["symbol"], item["bars"])

market = analyses.get("TAIEX")
individual = {k: v for k, v in analyses.items() if k != "TAIEX"}
ranked = sorted(individual.values(), key=lambda x: (abs(x["day_return_pct"] or 0), x["range_pct_of_open"] or 0), reverse=True)

result = {
    "date": DATE,
    "purpose": "台股引擎復盤與優化研究，不是明日選股",
    "data_sources": {
        "daily_official": "TWSE official close data and institutional rankings",
        "intraday_primary_requested": "Fugle",
        "intraday_primary_status": "unavailable: FUGLE_API_KEY missing in GitHub and MCP connector unavailable",
        "intraday_fallback": "Yahoo Finance 5m; price path usable, volume incomplete for most listed stocks",
        "engine_label_comparison": "unavailable: no 2026-08-06 engine label/alert log found",
    },
    "market": market,
    "sample_count": len(individual),
    "samples": individual,
    "priority_cases": [x["symbol"] for x in ranked[:6]],
    "limitations": [
        "無富果原始5分K，因此今天的分K結構判斷屬替代資料初判。",
        "大部分上市股5分K成交量為0，不使用量能做Verdict。",
        "沒有台股引擎當日實際標籤或警報紀錄，無法正式判定Correct/Missed/Wrong，只能建立待比對檢查點。",
        "台指期日夜盤分K尚未取得；今天以加權指數5分K作暫時背景，不視為台指期替代完成。",
    ],
}

(OUT / f"{DATE}-machine-summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

lines = [
    f"# {DATE} 台股引擎手動復盤（初版）",
    "",
    "> 用途：修正與優化台股引擎，不是明日選股。",
    "",
    "## 資料完整度",
    "",
    "- 官方日資料：可用。",
    "- 富果5分K：未取得，GitHub未設定FUGLE_API_KEY，當前MCP連線亦不可用。",
    "- 替代5分K：Yahoo Finance，可用於價格路徑初判；多數上市股量能欄位不可用。",
    "- 引擎實際標籤：未找到2026-08-06警報／標籤紀錄，因此本日先建立應出／不應出訊號檢查點。",
    "- 台指期分K：未取得；加權指數只作暫時背景。",
    "",
    "## 市場結構",
    "",
]
if market:
    lines += [
        f"加權指數5分K：開 {market['open']:.2f}、高 {market['high']:.2f}、低 {market['low']:.2f}、收 {market['close']:.2f}；收盤位於日內區間 {market['close_location_pct']:.1f}% 位置。",
        f"高點時間 {market['high_time'][11:16]}，低點時間 {market['low_time'][11:16]}，日內斜率 {market['trend_slope_pct_per_bar']:.4f}%／bar。",
        "",
    ]
lines += ["## 優先研究案例", ""]
for symbol in result["priority_cases"]:
    x = individual[symbol]
    lines += [
        f"### {symbol} {x['name']}",
        f"開高低收：{x['open']}／{x['high']}／{x['low']}／{x['close']}；開收報酬 {x['day_return_pct']}%，振幅 {x['range_pct_of_open']}%，收盤位置 {x['close_location_pct']}%。",
        f"日高 {x['high_time'][11:16]}、日低 {x['low_time'][11:16]}、斜率 {x['trend_slope_pct_per_bar']}%／bar。",
    ]
    for j in x["judgment"]:
        lines.append(f"- {j['verdict']}：{j['reason']}")
    for e in x["events"][:3]:
        lines.append(f"- 事件 {e['type']} @ {e['time'][11:16]}：進場 {e['entry']}、停損 {e['stop']}、MFE {e['mfe_pct']}%、MAE {e['mae_pct']}%、MFE {e['mfe_r']}R。")
    lines.append("")

lines += [
    "## 今日可驗證假說",
    "",
    "1. 強趨勢收在日內高檔的股票，空方S1／S2／S5必須要求明確失敗與收回，不能只因接近壓力就出標。",
    "2. 開盤即形成日高、之後跌破開盤價並收在低檔的股票，應檢查S1／S2或S5是否漏掉；若標籤太晚，需定位Raw、Seed、Commit哪一層延遲。",
    "3. 第一次回踩延續案例應分開記錄：趨勢背景、回踩深度、重新突破時間與MFE／MAE，累積後再決定L2 Commit是否放寬。",
    "4. 無量能資料時不得修改量能門檻；今日只提出價格結構假說。",
    "5. 在沒有實際引擎標籤紀錄前，不把任何案例正式判為Missed或Wrong。",
    "",
    "## 下一步資料缺口",
    "",
    "- 補上富果API金鑰或恢復台股MCP連線。",
    "- 讓TradingView／紙上交易端保存每個正式標籤：股票、時間、策略、價格與原因碼。",
    "- 接入台指期日盤與夜盤5分K，才能正式建立趨勢線案例與個股背景否決。",
]
(OUT / f"{DATE}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
print(json.dumps({"date": DATE, "samples": len(individual), "priority": result["priority_cases"]}, ensure_ascii=False))
