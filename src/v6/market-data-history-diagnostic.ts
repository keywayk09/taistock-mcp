import {
  GitHubDataStoreError,
  readGitHubJson,
  sha256Hex,
  stableJson,
  updateGitHubJson,
} from "./github-data-store.ts";
import type { MarketDataBackfillState } from "./market-data-backfill-policy.ts";

export const HISTORY_FAILURE_DIAGNOSTIC_PATH = "data/market-data/backfill/last-error.json";
export const HISTORY_BACKFILL_STATE_PATH = "data/market-data/backfill/360d-state.json";
export const HISTORY_FAILURE_DIAGNOSTIC_VERSION = "diamond-market-data-history-failure/v1";

export type HistoryFailureDiagnostic = {
  schema_version: typeof HISTORY_FAILURE_DIAGNOSTIC_VERSION;
  stage: string;
  anchor_trade_date: string;
  cursor_date: string | null;
  error_name: string;
  error_code: string | null;
  error_status: number | null;
  error_message: string;
  error_detail: Record<string, unknown> | null;
  fingerprint: string;
  first_observed_at: string;
};

function truncate(text: string, max = 1200) {
  const value = String(text ?? "");
  return value.length <= max ? value : value.slice(0, max);
}

function errorShape(error: unknown) {
  if (error instanceof GitHubDataStoreError) {
    return {
      error_name: error.name || "GitHubDataStoreError",
      error_code: error.code || null,
      error_status: Number.isFinite(Number(error.status)) ? Number(error.status) : null,
      error_message: truncate(error.message || String(error)),
      error_detail: error.detail ?? null,
    };
  }
  if (error instanceof Error) {
    return {
      error_name: error.name || "Error",
      error_code: null,
      error_status: null,
      error_message: truncate(error.message || String(error)),
      error_detail: null,
    };
  }
  return {
    error_name: "UnknownError",
    error_code: null,
    error_status: null,
    error_message: truncate(String(error)),
    error_detail: null,
  };
}

export async function buildHistoryFailureDiagnostic(input: {
  error: unknown;
  stage: string;
  anchorTradeDate: string;
  cursorDate: string | null;
  observedAt: string;
}): Promise<HistoryFailureDiagnostic> {
  const shaped = errorShape(input.error);
  // observedAt is deliberately excluded from the fingerprint. The same
  // five-minute failure must remain byte-for-byte idempotent and must not
  // create a permanent Git commit storm while we are diagnosing Production.
  const fingerprintPayload = {
    stage: input.stage,
    anchor_trade_date: input.anchorTradeDate,
    cursor_date: input.cursorDate,
    error_name: shaped.error_name,
    error_code: shaped.error_code,
    error_status: shaped.error_status,
    error_message: shaped.error_message,
  };
  return {
    schema_version: HISTORY_FAILURE_DIAGNOSTIC_VERSION,
    stage: input.stage,
    anchor_trade_date: input.anchorTradeDate,
    cursor_date: input.cursorDate,
    ...shaped,
    fingerprint: await sha256Hex(stableJson(fingerprintPayload)),
    first_observed_at: input.observedAt,
  };
}

export async function persistHistoryFailureDiagnostic(env: Env, diagnostic: HistoryFailureDiagnostic) {
  return await updateGitHubJson<HistoryFailureDiagnostic>(env, {
    path: HISTORY_FAILURE_DIAGNOSTIC_PATH,
    defaultValue: diagnostic,
    message: `data(market): record History failure ${diagnostic.error_code ?? diagnostic.error_name}`,
    retries: 3,
    merge: (current) => current?.fingerprint === diagnostic.fingerprint ? current : diagnostic,
  });
}

export async function recordHistoryBackfillFailure(env: Env, input: {
  error: unknown;
  stage: string;
  anchorTradeDate: string;
  observedAt?: string;
}) {
  const stateRead = await readGitHubJson<MarketDataBackfillState>(env, HISTORY_BACKFILL_STATE_PATH);
  const diagnostic = await buildHistoryFailureDiagnostic({
    error: input.error,
    stage: input.stage,
    anchorTradeDate: input.anchorTradeDate,
    cursorDate: stateRead.value?.cursor_date ?? null,
    observedAt: input.observedAt ?? new Date().toISOString(),
  });
  const write = await persistHistoryFailureDiagnostic(env, diagnostic);
  return { diagnostic, write };
}
