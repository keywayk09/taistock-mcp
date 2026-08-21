export function promoteLegacyCompleteManifest(manifest: any, capturedAt: string) {
  if (!manifest || typeof manifest !== "object") return null;
  if (manifest.terminal === true || manifest.day_status === "COMPLETE" || manifest.day_status === "NO_TRADING_DAY") return null;
  const layers = Array.isArray(manifest.layers) ? manifest.layers : [];
  const ready = layers.filter((layer: any) => layer?.status === "READY");
  if (layers.length < 8 || ready.length !== 8) return null;

  return {
    ...manifest,
    schema_version: "diamond-market-data-manifest/v2",
    storage: "GITHUB_ONLY",
    day_status: "COMPLETE",
    terminal: true,
    expected_layers: 8,
    ready_layers: 8,
    missing_layers: [],
    index_state: manifest.index_state ?? {
      status: "PENDING",
      completed_prefixes: [],
      total_prefixes: null,
      updated_at: capturedAt,
    },
    updated_at: capturedAt,
  };
}
