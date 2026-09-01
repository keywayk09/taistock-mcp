export const RESEARCH_VNEXT_REVIEW_METRICS_VERSION = "research-vnext-review-metrics/v1.0.0" as const;

export type ReviewMetricInputRow = {
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

function profitFactor(values: number[]): number | null {
  const grossWin = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  if (grossLoss === 0) return grossWin > 0 ? null : 0;
  return round(grossWin / grossLoss);
}

/**
 * Deterministic review evidence only.
 *
 * This module intentionally owns no interpretation, hypothesis generation,
 * strategy promotion, provider access or persistence. GPT remains the reasoning
 * owner. During migration its numeric behavior is shadow-locked to the legacy
 * review metric calculation; semantic corrections require a separate tested
 * change instead of being hidden inside architecture work.
 */
export function summarizeReviewMetrics(rows: ReviewMetricInputRow[]) {
  const normalized = rows.map((row) => {
    const outcome = row.market === "txf" ? finite(row.net_points) : finite(row.net_return_pct);
    const mfe = row.market === "txf" ? finite(row.mfe_points) : finite(row.mfe_pct);
    const mae = row.market === "txf" ? finite(row.mae_points) : finite(row.mae_pct);
    return { ...row, outcome, mfe, mae };
  });

  const outcomes = normalized.map((row) => row.outcome).filter((value): value is number => value !== null);
  const wins = outcomes.filter((value) => value > 0).length;
  const losses = outcomes.filter((value) => value < 0).length;
  const flats = outcomes.length - wins - losses;

  const groups = new Map<string, typeof normalized>();
  for (const row of normalized) {
    const key = `${row.market}|${row.strategy}|${row.side}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const breakdown = Array.from(groups.entries())
    .map(([key, list]) => {
      const [market, strategy, side] = key.split("|");
      const values = list.map((row) => row.outcome).filter((value): value is number => value !== null);
      const mfes = list.map((row) => row.mfe).filter((value): value is number => value !== null);
      const maes = list.map((row) => row.mae).filter((value): value is number => value !== null);

      return {
        market,
        strategy,
        side,
        count: list.length,
        win_rate: values.length ? round(values.filter((value) => value > 0).length / values.length) : null,
        expectancy: values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
        profit_factor: profitFactor(values),
        mfe: stats(mfes),
        mae: stats(maes),
        ambiguous_rate: list.length
          ? round(list.filter((row) => row.ambiguous_intrabar).length / list.length)
          : 0,
        replay_required: list.filter((row) => row.requires_1m_replay).length,
      };
    })
    .sort((a, b) =>
      `${a.market}|${a.strategy}|${a.side}`.localeCompare(`${b.market}|${b.strategy}|${b.side}`),
    );

  return {
    count: rows.length,
    evaluated_count: outcomes.length,
    wins,
    losses,
    flats,
    win_rate: outcomes.length ? round(wins / outcomes.length) : null,
    expectancy: outcomes.length
      ? round(outcomes.reduce((sum, value) => sum + value, 0) / outcomes.length)
      : null,
    profit_factor: profitFactor(outcomes),
    ambiguous_count: rows.filter((row) => row.ambiguous_intrabar).length,
    ambiguous_rate: rows.length
      ? round(rows.filter((row) => row.ambiguous_intrabar).length / rows.length)
      : 0,
    replay_required_count: rows.filter((row) => row.requires_1m_replay).length,
    breakdown,
  };
}
