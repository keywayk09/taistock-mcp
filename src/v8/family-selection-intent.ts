export type FamilyMode = "stable" | "balanced" | "aggressive";

export type FamilySelectionObjective =
  | "balanced"
  | "low_position_turning_up"
  | "pullback_entry"
  | "breakout_confirmed"
  | "steady_trend"
  | "aggressive_momentum";

export type FamilySelectionIntent = {
  family_mode: FamilyMode;
  objective: FamilySelectionObjective;
  top_n: number;
  avoid_chasing: boolean;
  position_preference: "low" | "mid" | "high" | "any";
  momentum_preference: "turning_up" | "strong" | "steady" | "any";
  matched_terms: string[];
  explanation: string;
  signature: string;
};

export type FamilyIntentMetrics = {
  technical_score: number;
  return_5d_percent: number | null;
  return_20d_percent: number | null;
  return_60d_percent: number | null;
  annualized_volatility_60d_percent: number | null;
  distance_to_sma20_atr: number | null;
  distance_to_prior_20d_high_percent: number | null;
  distance_to_prior_60d_high_percent: number | null;
  range_position_120d_percent: number | null;
  sma20_slope_5d_percent: number | null;
};

export type FamilyIntentFit = {
  fit_score: number;
  hard_mismatch: boolean;
  position_band: "LOW" | "MID" | "HIGH" | "UNKNOWN";
  reasons: string[];
  cautions: string[];
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function requestedTopN(query: string) {
  const match = query.match(/(?:top\s*|前\s*)(\d{1,2})/i);
  return match ? Math.max(1, Math.min(10, Number(match[1]) || 5)) : 5;
}

function classifyMode(query: string): FamilyMode {
  if (/穩健|保守|比較穩|低風險|穩一點|防守/.test(query)) return "stable";
  if (/積極|進攻|強勢|可以冒險|高風險/.test(query)) return "aggressive";
  return "balanced";
}

function terms(query: string, patterns: Array<[RegExp, string]>) {
  return patterns.flatMap(([pattern, label]) => pattern.test(query) ? [label] : []);
}

export function inferFamilySelectionIntent(rawQuery: string): FamilySelectionIntent {
  const query = String(rawQuery ?? "").trim();
  const family_mode = classifyMode(query);
  const top_n = requestedTopN(query);

  const lowTerms = terms(query, [
    [/低位階|低檔|底部|低基期/, "低位階"],
    [/還沒漲|還沒大漲|漲不多|尚未大漲/, "未大漲"],
    [/剛轉強|開始轉強|起漲|初升段|轉折向上/, "轉強"],
    [/落後補漲|補漲/, "補漲"],
  ]);
  const pullbackTerms = terms(query, [
    [/回檔|拉回|回踩|回測/, "回檔"],
    [/支撐附近|靠近支撐|整理後/, "支撐/整理"],
  ]);
  const breakoutTerms = terms(query, [
    [/突破|過高|創高|突破確認/, "突破"],
  ]);
  const steadyTerms = terms(query, [
    [/穩定走升|穩定趨勢|趨勢穩|多頭趨勢/, "穩定趨勢"],
  ]);
  const momentumTerms = terms(query, [
    [/強勢動能|動能股|強勢股|噴出|主升段/, "強勢動能"],
  ]);

  let objective: FamilySelectionObjective = "balanced";
  let position_preference: FamilySelectionIntent["position_preference"] = "any";
  let momentum_preference: FamilySelectionIntent["momentum_preference"] = "any";
  let matched_terms: string[] = [];
  let explanation = "平衡考量趨勢、位置、流動性與風險。";

  // Specific entry-location requests take precedence over generic risk/momentum wording.
  if (lowTerms.length) {
    objective = "low_position_turning_up";
    position_preference = "low";
    momentum_preference = "turning_up";
    matched_terms = lowTerms;
    explanation = "尋找相對低位階、尚未明顯追高，但趨勢已有轉強證據的股票；避免把仍在下跌的弱勢股誤當低位階。";
  } else if (pullbackTerms.length) {
    objective = "pullback_entry";
    position_preference = "mid";
    momentum_preference = "steady";
    matched_terms = pullbackTerms;
    explanation = "尋找原趨勢仍在、但價格已拉回或回踩到較合理位置的股票。";
  } else if (breakoutTerms.length) {
    objective = "breakout_confirmed";
    position_preference = "high";
    momentum_preference = "strong";
    matched_terms = breakoutTerms;
    explanation = "尋找接近關鍵高點且趨勢、均線斜率與動能支持突破的股票，但仍避免過度乖離。";
  } else if (steadyTerms.length || family_mode === "stable") {
    objective = "steady_trend";
    position_preference = "mid";
    momentum_preference = "steady";
    matched_terms = steadyTerms.length ? steadyTerms : ["穩健模式"];
    explanation = "偏好波動較可控、均線持續向上、漲幅不過度擴張的穩定趨勢。";
  } else if (momentumTerms.length || family_mode === "aggressive") {
    objective = "aggressive_momentum";
    position_preference = "high";
    momentum_preference = "strong";
    matched_terms = momentumTerms.length ? momentumTerms : ["進攻模式"];
    explanation = "偏好較強趨勢與動能，但仍把過度乖離與單日急漲列為追價風險。";
  }

  const avoid_chasing = /不追|不要追|別追|低位階|還沒漲|還沒大漲|回檔|拉回|回踩|合理位置/.test(query)
    || objective === "low_position_turning_up"
    || objective === "pullback_entry";

  const signature = `${family_mode}:${objective}:chase${avoid_chasing ? 0 : 1}`;
  return {
    family_mode,
    objective,
    top_n,
    avoid_chasing,
    position_preference,
    momentum_preference,
    matched_terms,
    explanation,
    signature,
  };
}

function positionBand(position: number | null): FamilyIntentFit["position_band"] {
  if (position == null || !Number.isFinite(position)) return "UNKNOWN";
  if (position <= 40) return "LOW";
  if (position <= 72) return "MID";
  return "HIGH";
}

export function scoreFamilyIntentFit(row: FamilyIntentMetrics, intent: FamilySelectionIntent): FamilyIntentFit {
  const technical = clamp(row.technical_score);
  const r5 = row.return_5d_percent;
  const r20 = row.return_20d_percent;
  const r60 = row.return_60d_percent;
  const vol = row.annualized_volatility_60d_percent;
  const ext = row.distance_to_sma20_atr;
  const d20 = row.distance_to_prior_20d_high_percent;
  const d60 = row.distance_to_prior_60d_high_percent;
  const pos = row.range_position_120d_percent;
  const slope = row.sma20_slope_5d_percent;
  const band = positionBand(pos);
  const reasons: string[] = [];
  const cautions: string[] = [];
  let score = 45;
  let hardMismatch = false;

  switch (intent.objective) {
    case "low_position_turning_up": {
      score = 20;
      if (pos != null && pos >= 15 && pos <= 42) { score += 28; reasons.push(`近120日區間位置約 ${Math.round(pos)}%，仍屬相對低位階`); }
      else if (pos != null && pos > 42 && pos <= 62) { score += 19; reasons.push(`近120日區間位置約 ${Math.round(pos)}%，尚未進入高位區`); }
      else if (pos != null && pos < 15) { score += 10; cautions.push("位置很低，但需防止仍是下跌趨勢中的弱勢反彈"); }
      else if (pos != null && pos > 78) { score -= 28; cautions.push("目前已位於近120日高位區，不符合低位階要求"); hardMismatch = true; }

      if (r20 != null && r20 >= -5 && r20 <= 12) { score += 18; reasons.push(`近20日漲幅 ${r20}% 尚未過熱`); }
      else if (r20 != null && r20 > 18) { score -= 22; cautions.push("近20日漲幅已大，不符合尚未大漲的條件"); if (r20 > 24) hardMismatch = true; }
      if (slope != null && slope >= 0) { score += 17; reasons.push("20日均線近5日斜率已轉正"); }
      else if (slope != null && slope >= -0.6) { score += 7; reasons.push("20日均線已接近平坦，觀察轉正確認"); }
      else if (slope != null && slope < -1.5) { score -= 18; cautions.push("20日均線仍明顯向下，尚不能只因低位就視為轉強"); hardMismatch = true; }
      if (ext != null && ext >= -0.7 && ext <= 1.4) { score += 12; reasons.push("價格仍靠近20日均線，乖離未過大"); }
      else if (ext != null && ext > 2.3) { score -= 18; cautions.push("已離20日均線過遠，不像低位階轉強"); hardMismatch = true; }
      if (technical >= 55) score += 8;
      if (r5 != null && r5 > 0 && r5 <= 8) { score += 7; reasons.push("近5日已有溫和轉強，而非急拉噴出"); }
      break;
    }
    case "pullback_entry": {
      score = 25;
      if (d20 != null && d20 >= -14 && d20 <= -3) { score += 28; reasons.push(`距前20日高點 ${d20}%，已有合理拉回空間`); }
      else if (d20 != null && d20 > -3) { score -= 8; cautions.push("仍太靠近近期高點，回檔幅度不足"); }
      if (ext != null && ext >= -0.8 && ext <= 1.2) { score += 22; reasons.push("價格回到20日均線附近，較適合觀察承接"); }
      else if (ext != null && ext > 2.2) { score -= 22; cautions.push("乖離仍大，尚未回到合理位置"); hardMismatch = true; }
      if (slope != null && slope >= 0) { score += 18; reasons.push("20日均線仍向上，拉回尚未破壞中期趨勢"); }
      else if (slope != null && slope < -1.2) { score -= 20; cautions.push("均線已明顯下彎，可能不是健康回檔"); hardMismatch = true; }
      if (technical >= 60) score += 10;
      if (r20 != null && r20 > 25) { score -= 12; cautions.push("前段漲幅過大，拉回後仍需防高檔震盪"); }
      break;
    }
    case "breakout_confirmed": {
      score = 20;
      if (d20 != null && d20 >= -3 && d20 <= 2.5) { score += 30; reasons.push("價格已靠近20日關鍵高點，具突破觀察條件"); }
      else if (d20 != null && d20 < -9) { score -= 22; cautions.push("距離近期高點仍遠，還不能稱為突破型"); hardMismatch = true; }
      if (slope != null && slope > 0) { score += 18; reasons.push("20日均線斜率向上"); }
      if (technical >= 70) { score += 18; reasons.push("技術趨勢分數支持強勢結構"); }
      if (r20 != null && r20 >= 2 && r20 <= 28) score += 10;
      if (ext != null && ext <= 2.2) score += 8;
      else if (ext != null && ext > 3) { score -= 20; cautions.push("突破前乖離過大，追價風險高"); }
      break;
    }
    case "steady_trend": {
      score = 20;
      if (technical >= 65) { score += 22; reasons.push("中期趨勢結構穩定"); }
      if (slope != null && slope >= 0) { score += 20; reasons.push("20日均線維持向上"); }
      if (vol != null && vol <= 55) { score += 18; reasons.push("近60日波動相對可控"); }
      else if (vol != null && vol > 75) { score -= 20; cautions.push("波動過高，不符合穩健取向"); hardMismatch = true; }
      if (r20 != null && r20 >= -2 && r20 <= 18) score += 12;
      else if (r20 != null && r20 > 28) { score -= 18; cautions.push("短中期漲幅過度擴張"); }
      if (ext != null && ext >= -0.5 && ext <= 1.8) score += 10;
      break;
    }
    case "aggressive_momentum": {
      score = 20;
      if (technical >= 75) { score += 25; reasons.push("技術趨勢分數強"); }
      if (r20 != null && r20 >= 5 && r20 <= 35) { score += 20; reasons.push(`近20日動能強（${r20}%）`); }
      if (d20 != null && d20 >= -5 && d20 <= 3) { score += 18; reasons.push("接近近期強勢高點"); }
      if (slope != null && slope > 0) { score += 12; reasons.push("20日均線持續向上"); }
      if (r60 != null && r60 > 8) score += 8;
      if (ext != null && ext > 3.2) { score -= 20; cautions.push("動能雖強但乖離過大"); }
      break;
    }
    case "balanced":
    default: {
      score = 35;
      if (technical >= 65) score += 20;
      if (slope != null && slope >= 0) score += 12;
      if (ext != null && ext >= -0.8 && ext <= 1.8) score += 12;
      if (d20 != null && d20 >= -10 && d20 <= 2.5) score += 12;
      if (vol != null && vol <= 70) score += 9;
      break;
    }
  }

  if (intent.avoid_chasing) {
    if (r20 != null && r20 > 22) { score -= 12; cautions.push("使用者要求避免追高，但近20日漲幅已偏大"); }
    if (ext != null && ext > 2.2) { score -= 12; cautions.push("使用者要求避免追高，但價格乖離偏大"); }
  }
  if (d60 != null && d60 > 5) cautions.push("價格已高於先前60日高點較多，需留意突破後過熱");

  return {
    fit_score: Math.round(clamp(score) * 10) / 10,
    hard_mismatch: hardMismatch,
    position_band: band,
    reasons: [...new Set(reasons)].slice(0, 5),
    cautions: [...new Set(cautions)].slice(0, 5),
  };
}
