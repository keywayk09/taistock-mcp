import { readGitHubJson } from "./github-data-store";
import { runSubrequestSafeMarketDataCapture as runLegacyCapture } from "./market-data-cloudflare-chunked-runner";
import { runAdaptiveHistoryIndexSlice } from "./market-data-history-index";
import type { MarketManifestLayer } from "./market-data-incremental-controller";

type DailyManifest = {
  layers?: MarketManifestLayer[];
  day_status?: string;
  terminal?: boolean;
  index_state?: {
    status: "PENDING" | "READY";
    completed_prefixes: string[];
    total_prefixes: number | null;
    updated_at: string;
  };
  [key: string]: unknown;
};

function manifestPath(tradeDate: string) {
  const [year, month, day] = tradeDate.split("-");
  return `data/market-data/daily/${year}/${month}/${day}/manifest.json`;
}

/**
 * Daily capture facade.
 *
 * Capture remains one-layer resumable. Once canonical 8/8 is terminal COMPLETE,
 * indexing is handed to the same budget-driven, multi-file atomic indexer used
 * by History. This prevents the legacy 1-prefix/1-commit index path from being
 * exercised by the scheduled Daily lane.
 */
export async function runAdaptiveDailyMarketDataCapture(env: Env, input: {
  tradeDate: string;
  finalAudit?: boolean;
  now?: Date;
  deadlineAtMs?: number;
  subrequestBudget?: number;
}) {
  const now = input.now ?? new Date();
  const read = await readGitHubJson<DailyManifest>(env, manifestPath(input.tradeDate));
  const manifest = read.value;

  if (
    manifest?.terminal === true
    && manifest?.day_status === "COMPLETE"
    && manifest?.index_state?.status !== "READY"
  ) {
    const indexed = await runAdaptiveHistoryIndexSlice(env, {
      tradeDate: input.tradeDate,
      manifest,
      capturedAt: now.toISOString(),
      deadlineAtMs: input.deadlineAtMs ?? (Date.now() + 30_000),
      subrequestBudget: Math.max(0, Math.floor(input.subrequestBudget ?? 32)),
    });
    return {
      ...indexed,
      estimated_subrequests: 1 + Number(indexed.estimated_subrequests ?? 0),
      daily_index_mode: "ADAPTIVE_ATOMIC" as const,
    };
  }

  const result = await runLegacyCapture(env, {
    tradeDate: input.tradeDate,
    finalAudit: input.finalAudit,
    now,
  });
  return {
    ...result,
    preflight_subrequests: 1,
    daily_index_mode: "CAPTURE_OR_TERMINAL" as const,
  };
}
