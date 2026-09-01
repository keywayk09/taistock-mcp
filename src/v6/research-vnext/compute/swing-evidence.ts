export const RESEARCH_VNEXT_SWING_EVIDENCE_VERSION = "research-vnext-swing-evidence/v1.0.0" as const;

export type SwingEvidenceSignal = {
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

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function stats(values: number[]) {
  if (!values.length) {
    return {
      count: 0,
      avg: null as number | null,
      min: null as number | null,
      max: null as number | null,
    };
  }

  return {
    count: values.length,
    avg: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
  };
}

/**
 * Extract a mechanical score already present in signal evidence.
 *
 * This is not a GPT replacement and does not create a recommendation. During
 * migration the precedence and normalization rules are shadow-locked to the
 * current legacy implementation so architecture and trading semantics are not
 * changed in the same step.
 */
export function scoreSwingEvidence(signal: SwingEvidenceSignal): number {
  const payload = signal.payload ?? {};
  const direct = [payload.swing_score, payload.diamond_score, payload.confidence_score]
    .map(finite)
    .find((value) => value !== null);

  if (direct !== undefined && direct !== null) return direct;

  const probability = finite(payload.probability);
  return probability === null ? 0 : probability <= 1 ? probability * 100 : probability;
}

/**
 * Produce deterministic candidate evidence ordering only.
 *
 * GPT remains the final swing researcher and decides how to interpret or use
 * this evidence. This function performs no market-data fetch, persistence,
 * hypothesis generation, or autonomous trade selection.
 */
export function rankSwingCandidateEvidence(signals: SwingEvidenceSignal[], limit = 10) {
  const deduplicated = new Map<string, SwingEvidenceSignal & { score: number }>();

  for (const signal of signals) {
    if (!/^\d{4,6}$/.test(String(signal.symbol))) continue;
    if (!["LONG", "SHORT"].includes(String(signal.side))) continue;

    const item = {
      ...signal,
      score: round(scoreSwingEvidence(signal)),
    };
    const existing = deduplicated.get(signal.symbol);

    if (
      !existing ||
      item.score > existing.score ||
      (item.score === existing.score && item.signal_ts_ms > existing.signal_ts_ms)
    ) {
      deduplicated.set(signal.symbol, item);
    }
  }

  return Array.from(deduplicated.values())
    .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))
    .slice(0, Math.max(1, Math.min(50, limit)))
    .map((item, index) => ({
      rank: index + 1,
      score: item.score,
      signal_id: item.signal_id,
      signal_version: item.signal_version,
      symbol: item.symbol,
      trade_date: item.trade_date,
      side: item.side,
      strategy: item.strategy,
      stage: item.stage ?? null,
      signal_ts_ms: item.signal_ts_ms,
      reason_codes: Array.isArray(item.reason_codes) ? item.reason_codes : [],
      score_source: item.score === 0 ? "NO_EXPLICIT_SCORE" : "SIGNAL_PAYLOAD",
    }));
}

/**
 * Summarize already-produced swing outcome evidence across horizons.
 *
 * This function is intentionally deterministic and evidence-only. It does not
 * generate observations, hypotheses, strategy rules, or trading decisions.
 */
export function summarizeSwingOutcomeEvidence(results: Array<Record<string, unknown>>) {
  const rows = results.filter((row) => row && row.status === "OK");
  const horizons = new Map<string, number[]>();
  const mfe: number[] = [];
  const mae: number[] = [];

  for (const row of rows) {
    const mfeValue = finite(row.mfe_pct);
    if (mfeValue !== null) mfe.push(mfeValue);

    const maeValue = finite(row.mae_pct);
    if (maeValue !== null) mae.push(maeValue);

    const path = Array.isArray(row.path) ? row.path : [];
    for (const point of path as Array<Record<string, unknown>>) {
      const label = String(point.horizon ?? point.day ?? "");
      const returnValue = finite(point.directional_close_return_pct ?? point.return_pct);
      if (!label || returnValue === null) continue;

      const list = horizons.get(label) ?? [];
      list.push(returnValue);
      horizons.set(label, list);
    }
  }

  return {
    count: results.length,
    ok_count: rows.length,
    failed_count: results.length - rows.length,
    mfe: stats(mfe),
    mae: stats(mae),
    horizons: Array.from(horizons.entries())
      .map(([horizon, values]) => ({
        horizon,
        count: values.length,
        win_rate: round(values.filter((value) => value > 0).length / values.length),
        avg_return_pct: round(values.reduce((sum, value) => sum + value, 0) / values.length),
      }))
      .sort((a, b) => a.horizon.localeCompare(b.horizon)),
  };
}
