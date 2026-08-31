import { readGitHubJson } from "./github-data-store.ts";
import {
  getMarketDataCaptureTradeDate,
  setMarketDataCapturePolicy,
  setMarketDataCaptureTradeDate,
} from "./market-data-capture-context.ts";
import { runAdaptiveDailyMarketDataCapture } from "./market-data-daily-capture.ts";

export const ONE_SHOT_MARKET_DATA_REPAIR_DATE = "2026-08-31";
export const ONE_SHOT_MARKET_DATA_REPAIR_VERSION = "market-data-one-shot-repair/2026-08-31-v1";

const EXPECTED_LAYER_COUNT = 8;
const ALLOWED_REPAIR_KEYS = new Set([
  "institutional-otc",
  "margin-otc",
  "sbl_short_sale-otc",
]);

type RepairManifestLayer = {
  kind?: string;
  market?: string;
  status?: string;
  [key: string]: unknown;
};

type RepairManifest = {
  trade_date?: string;
  day_status?: string;
  terminal?: boolean;
  expected_layers?: number;
  ready_layers?: number;
  missing_layers?: string[];
  index_state?: {
    status?: string;
    completed_prefixes?: string[];
    total_prefixes?: number | null;
    [key: string]: unknown;
  };
  layers?: RepairManifestLayer[];
  [key: string]: unknown;
};

type RepairInspection = {
  status: "COMPLETE" | "CAPTURE_REQUIRED" | "INDEX_REQUIRED" | "BLOCKED";
  reason: string;
  ready_layers: number;
  missing_layers: string[];
  index_status: string | null;
};

type RepairDependencies = {
  readManifest?: (env: Env) => Promise<RepairManifest | null>;
  capture?: typeof runAdaptiveDailyMarketDataCapture;
};

function manifestPath() {
  return "data/market-data/daily/2026/08/31/manifest.json";
}

function layerKey(layer: RepairManifestLayer) {
  return `${String(layer.kind ?? "")}-${String(layer.market ?? "")}`;
}

export function inspectOneShotMarketDataRepairManifest(manifest: RepairManifest | null): RepairInspection {
  if (!manifest) {
    return {
      status: "BLOCKED",
      reason: "canonical_manifest_missing",
      ready_layers: 0,
      missing_layers: [],
      index_status: null,
    };
  }
  if (manifest.trade_date !== ONE_SHOT_MARKET_DATA_REPAIR_DATE) {
    return {
      status: "BLOCKED",
      reason: `canonical_trade_date_mismatch:${String(manifest.trade_date ?? "missing")}`,
      ready_layers: 0,
      missing_layers: [],
      index_status: String(manifest.index_state?.status ?? "") || null,
    };
  }

  const layers = Array.isArray(manifest.layers) ? manifest.layers : [];
  if (layers.length !== EXPECTED_LAYER_COUNT) {
    return {
      status: "BLOCKED",
      reason: `canonical_layer_count_mismatch:${layers.length}`,
      ready_layers: layers.filter((layer) => layer.status === "READY").length,
      missing_layers: [],
      index_status: String(manifest.index_state?.status ?? "") || null,
    };
  }

  const readyLayers = layers.filter((layer) => layer.status === "READY").length;
  const missingLayers = layers
    .filter((layer) => layer.status !== "READY")
    .map(layerKey)
    .sort();
  const unexpectedMissing = missingLayers.filter((key) => !ALLOWED_REPAIR_KEYS.has(key));
  const indexStatus = String(manifest.index_state?.status ?? "") || null;

  if (
    manifest.day_status === "COMPLETE"
    && manifest.terminal === true
    && readyLayers === EXPECTED_LAYER_COUNT
    && missingLayers.length === 0
  ) {
    if (indexStatus === "READY") {
      return {
        status: "COMPLETE",
        reason: "canonical_8_of_8_and_compact_index_ready",
        ready_layers: readyLayers,
        missing_layers: [],
        index_status: indexStatus,
      };
    }
    return {
      status: "INDEX_REQUIRED",
      reason: "canonical_8_of_8_index_not_ready",
      ready_layers: readyLayers,
      missing_layers: [],
      index_status: indexStatus,
    };
  }

  if (unexpectedMissing.length) {
    return {
      status: "BLOCKED",
      reason: `unexpected_missing_layers:${unexpectedMissing.join(",")}`,
      ready_layers: readyLayers,
      missing_layers: missingLayers,
      index_status: indexStatus,
    };
  }

  if (readyLayers < 5 || readyLayers >= EXPECTED_LAYER_COUNT) {
    return {
      status: "BLOCKED",
      reason: `unexpected_partial_ready_count:${readyLayers}`,
      ready_layers: readyLayers,
      missing_layers: missingLayers,
      index_status: indexStatus,
    };
  }

  return {
    status: "CAPTURE_REQUIRED",
    reason: "only_verified_2026_08_31_otc_layers_missing",
    ready_layers: readyLayers,
    missing_layers: missingLayers,
    index_status: indexStatus,
  };
}

export async function runOneShotMarketDataRepair20260831(
  env: Env,
  input: {
    now?: Date;
    deadlineAtMs?: number;
    subrequestBudget?: number;
    dependencies?: RepairDependencies;
  } = {},
) {
  const now = input.now ?? new Date();
  const dependencies = input.dependencies ?? {};
  const readManifest = dependencies.readManifest ?? (async (runtimeEnv: Env) => {
    const read = await readGitHubJson<RepairManifest>(runtimeEnv, manifestPath());
    return read.value;
  });
  const capture = dependencies.capture ?? runAdaptiveDailyMarketDataCapture;
  const manifest = await readManifest(env);
  const inspection = inspectOneShotMarketDataRepairManifest(manifest);

  if (inspection.status === "COMPLETE") {
    return {
      version: ONE_SHOT_MARKET_DATA_REPAIR_VERSION,
      trade_date: ONE_SHOT_MARKET_DATA_REPAIR_DATE,
      status: "REPAIR_COMPLETE" as const,
      prioritize_repair: false,
      inspection,
      capture: null,
    };
  }
  if (inspection.status === "BLOCKED") {
    return {
      version: ONE_SHOT_MARKET_DATA_REPAIR_VERSION,
      trade_date: ONE_SHOT_MARKET_DATA_REPAIR_DATE,
      status: "REPAIR_BLOCKED" as const,
      prioritize_repair: false,
      inspection,
      capture: null,
    };
  }

  const previousTradeDate = getMarketDataCaptureTradeDate();
  setMarketDataCaptureTradeDate(ONE_SHOT_MARKET_DATA_REPAIR_DATE);
  setMarketDataCapturePolicy({
    allowedKinds: ["institutional", "margin", "sbl_short_sale"],
    checkpointStartedAt: now.toISOString(),
    storageMode: "HISTORY_COMPRESSED",
  });
  try {
    const result = await capture(env, {
      tradeDate: ONE_SHOT_MARKET_DATA_REPAIR_DATE,
      finalAudit: false,
      now,
      deadlineAtMs: input.deadlineAtMs ?? (Date.now() + 30_000),
      subrequestBudget: Math.max(0, Math.floor(input.subrequestBudget ?? 37)),
    });
    return {
      version: ONE_SHOT_MARKET_DATA_REPAIR_VERSION,
      trade_date: ONE_SHOT_MARKET_DATA_REPAIR_DATE,
      status: inspection.status === "INDEX_REQUIRED" ? "REPAIR_INDEX_STEP" as const : "REPAIR_CAPTURE_STEP" as const,
      prioritize_repair: true,
      inspection,
      capture: result,
    };
  } finally {
    setMarketDataCapturePolicy(null);
    setMarketDataCaptureTradeDate(previousTradeDate);
  }
}
