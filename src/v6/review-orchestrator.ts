export const REVIEW_ORCHESTRATOR_VERSION = "diamond-review-orchestrator/v1.0.0";
export const SWING_SELECTOR_VERSION = "diamond-swing-selector/v1.0.0";

export type ReviewMetricRow = {
  market: "tw-stock" | "txf";
  signal_id: string;
  signal_version: string;
  strategy: string;
  side: string;
  net_return_pct?: number | null;
  net_points?: number | null;
  mfe_pct?: number | null;
  mae_pct?: number | null;
  mfe_points?: number | null;
  mae_points?: number | null;
  ambiguous_intrabar?: boolean;
  requires_1m_replay?: boolean;
};

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value: number, digits = 6): number {
  const f = 10 ** digits;
  return Math.round((value + Number.EPSILON) * f) / f;
}

function stats(values: number[]) {
  if (!values.length) return { count: 0, avg: null as number | null, min: null as number | null, max: null as number | null };
  return {
    count: values.length,
    avg: round(values.reduce((a, b) => a + b, 0) / values.length),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
  };
}

function profitFactor(values: number[]) {
  const grossWin = values.filter((x) => x > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(values.filter((x) => x < 0).reduce((a, b) => a + b, 0));
  if (grossLoss === 0) return grossWin > 0 ? null : 0;
  return round(grossWin / grossLoss);
}

export function summarizeReviewRows(rows: ReviewMetricRow[]) {
  const normalized = rows.map((row) => {
    const outcome = row.market === "txf" ? finite(row.net_points) : finite(row.net_return_pct);
    const mfe = row.market === "txf" ? finite(row.mfe_points) : finite(row.mfe_pct);
    const mae = row.market === "txf" ? finite(row.mae_points) : finite(row.mae_pct);
    return { ...row, outcome, mfe, mae };
  });
  const outcomes = normalized.map((x) => x.outcome).filter((x): x is number => x !== null);
  const wins = outcomes.filter((x) => x > 0).length;
  const losses = outcomes.filter((x) => x < 0).length;
  const flats = outcomes.length - wins - losses;
  const groups = new Map<string, typeof normalized>();
  for (const row of normalized) {
    const key = `${row.market}|${row.strategy}|${row.side}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const breakdown = Array.from(groups.entries()).map(([key, list]) => {
    const [market, strategy, side] = key.split("|");
    const vals = list.map((x) => x.outcome).filter((x): x is number => x !== null);
    const mfes = list.map((x) => x.mfe).filter((x): x is number => x !== null);
    const maes = list.map((x) => x.mae).filter((x): x is number => x !== null);
    return {
      market, strategy, side, count: list.length,
      win_rate: vals.length ? round(vals.filter((x) => x > 0).length / vals.length) : null,
      expectancy: vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
      profit_factor: profitFactor(vals),
      mfe: stats(mfes), mae: stats(maes),
      ambiguous_rate: list.length ? round(list.filter((x) => x.ambiguous_intrabar).length / list.length) : 0,
      replay_required: list.filter((x) => x.requires_1m_replay).length,
    };
  }).sort((a, b) => `${a.market}|${a.strategy}|${a.side}`.localeCompare(`${b.market}|${b.strategy}|${b.side}`));

  return {
    count: rows.length,
    evaluated_count: outcomes.length,
    wins, losses, flats,
    win_rate: outcomes.length ? round(wins / outcomes.length) : null,
    expectancy: outcomes.length ? round(outcomes.reduce((a, b) => a + b, 0) / outcomes.length) : null,
    profit_factor: profitFactor(outcomes),
    ambiguous_count: rows.filter((x) => x.ambiguous_intrabar).length,
    ambiguous_rate: rows.length ? round(rows.filter((x) => x.ambiguous_intrabar).length / rows.length) : 0,
    replay_required_count: rows.filter((x) => x.requires_1m_replay).length,
    breakdown,
  };
}

export function buildReviewInterpretation(summary: ReturnType<typeof summarizeReviewRows>) {
  const observations: Array<Record<string, unknown>> = [];
  const hypotheses: Array<Record<string, unknown>> = [];
  if (!summary.count) observations.push({ code: "NO_CASES", view: "本次沒有可評估訊號，不能據此判斷策略品質。" });
  if (summary.ambiguous_rate >= 0.1) {
    observations.push({ code: "HIGH_5M_AMBIGUITY", view: `5m 同根歧義率 ${(summary.ambiguous_rate * 100).toFixed(1)}%，需優先完成 1m Selective Replay。` });
    hypotheses.push({ id: "reduce_intrabar_ambiguity_bias", status: "HYPOTHESIS_ONLY", test: "比較 5m conservative 與 1m resolved 結果，量化 conservative bias。", risk: "不得以 1m 結果回寫原 5m result。" });
  }
  for (const group of summary.breakdown) {
    if (group.count >= 5 && group.profit_factor !== null && group.profit_factor < 0.8) {
      hypotheses.push({ id: `weak_cluster:${group.market}:${group.strategy}:${group.side}`, status: "HYPOTHESIS_ONLY", evidence_count: group.count, test: "切分時間帶、Regime、TXF Context 與位置條件，確認弱勢是否穩定存在。", risk: "禁止因小樣本直接新增 veto。" });
    }
    if (group.count >= 5 && group.profit_factor !== null && group.profit_factor > 1.3) {
      observations.push({ code: "EDGE_CLUSTER", market: group.market, strategy: group.strategy, side: group.side, count: group.count, view: "此群組暫時呈現較佳 PF，應進 Walk-Forward / Bootstrap / Regime 驗證，不直接升級規則。" });
    }
  }
  if (hypotheses.length > 3) hypotheses.length = 3;
  return { observations, optimization_hypotheses: hypotheses, policy: "REVIEW_ONLY_NO_AUTO_STRATEGY_CHANGE" };
}

export type SwingSignalLike = {
  signal_id: string;
  signal_version: string;
  symbol: string;
  trade_date: string;
  side: string;
  strategy: string;
  stage?: string | null;
  signal_ts_ms: number;
  reason_codes?: unknown[];
  payload?: Record<string, unknown>;
};

export function swingScore(signal: SwingSignalLike): number {
  const payload = signal.payload ?? {};
  const direct = [payload.swing_score, payload.diamond_score, payload.confidence_score].map(finite).find((x) => x !== null);
  if (direct !== undefined && direct !== null) return direct;
  const probability = finite(payload.probability);
  return probability === null ? 0 : probability <= 1 ? probability * 100 : probability;
}

export function selectSwingCandidates(signals: SwingSignalLike[], limit = 10) {
  const dedup = new Map<string, SwingSignalLike & { score: number }>();
  for (const signal of signals) {
    if (!/^\d{4,6}$/.test(String(signal.symbol)) || !["LONG", "SHORT"].includes(String(signal.side))) continue;
    const item = { ...signal, score: round(swingScore(signal)) };
    const existing = dedup.get(signal.symbol);
    if (!existing || item.score > existing.score || (item.score === existing.score && item.signal_ts_ms > existing.signal_ts_ms)) dedup.set(signal.symbol, item);
  }
  return Array.from(dedup.values())
    .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))
    .slice(0, Math.max(1, Math.min(50, limit)))
    .map((item, index) => ({
      rank: index + 1, score: item.score, signal_id: item.signal_id, signal_version: item.signal_version,
      symbol: item.symbol, trade_date: item.trade_date, side: item.side, strategy: item.strategy, stage: item.stage ?? null,
      signal_ts_ms: item.signal_ts_ms, reason_codes: Array.isArray(item.reason_codes) ? item.reason_codes : [],
      score_source: item.score === 0 ? "NO_EXPLICIT_SCORE" : "SIGNAL_PAYLOAD",
    }));
}

export function summarizeSwingResults(results: Array<Record<string, unknown>>) {
  const rows = results.filter((x) => x && x.status === "OK");
  const horizons = new Map<string, number[]>();
  const mfe: number[] = [], mae: number[] = [];
  for (const row of rows) {
    const m1 = finite(row.mfe_pct); if (m1 !== null) mfe.push(m1);
    const m2 = finite(row.mae_pct); if (m2 !== null) mae.push(m2);
    const path = Array.isArray(row.path) ? row.path : [];
    for (const point of path as Array<Record<string, unknown>>) {
      const label = String(point.horizon ?? point.day ?? "");
      const ret = finite(point.directional_close_return_pct ?? point.return_pct);
      if (!label || ret === null) continue;
      const list = horizons.get(label) ?? []; list.push(ret); horizons.set(label, list);
    }
  }
  return {
    count: results.length,
    ok_count: rows.length,
    failed_count: results.length - rows.length,
    mfe: stats(mfe), mae: stats(mae),
    horizons: Array.from(horizons.entries()).map(([horizon, values]) => ({
      horizon, count: values.length,
      win_rate: round(values.filter((x) => x > 0).length / values.length),
      avg_return_pct: round(values.reduce((a, b) => a + b, 0) / values.length),
    })).sort((a, b) => a.horizon.localeCompare(b.horizon)),
  };
}
