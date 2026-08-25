import { sha256Hex, type MemoryGitHubDataStore } from "../src/v6/github-data-store.ts";
import { runIntradayReviewSelection, runNightSelections } from "../src/v6/selection-engine.ts";
import { loadStableMarketUniverse } from "../src/v6/stable-market-tools.ts";

type ShadowEnv = Env & {
  SHADOW_TOKEN: string;
  __GITHUB_DATA_MEMORY?: MemoryGitHubDataStore;
};

function taipeiDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function nextWeekday(date: string) {
  const d = new Date(`${date}T12:00:00+08:00`);
  do d.setUTCDate(d.getUTCDate() + 1); while ([0, 6].includes(d.getUTCDay()));
  return taipeiDate(d);
}

function normalizeDate(value: unknown): string | null {
  const raw = String(value ?? "").trim().split(/\s+/)[0];
  if (/^20\d{2}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^20\d{6}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (/^\d{7}$/.test(raw)) {
    const year = Number(raw.slice(0, 3)) + 1911;
    return `${year}-${raw.slice(3, 5)}-${raw.slice(5, 7)}`;
  }
  return null;
}

function manifestPath(date: string) {
  const [year, month, day] = date.split("-");
  return `data/market-data/daily/${year}/${month}/${day}/manifest.json`;
}

async function rawGitHubFile(path: string) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`https://raw.githubusercontent.com/keywayk09/tv-papertrader/main/${encodedPath}`, {
    headers: { Accept: "application/json,text/plain,*/*", "User-Agent": "taistock-selection-shadow/1.0" },
    cache: "no-store",
  });
  if (response.status === 404) return null;
  const text = await response.text();
  if (!response.ok) throw new Error(`raw_github_http:${response.status}:${path}:${text.slice(0, 200)}`);
  return { text, sha: await sha256Hex(text) };
}

async function preloadCanonicalMarketData(shadowMemory: MemoryGitHubDataStore, date: string) {
  const path = manifestPath(date);
  const manifestRaw = await rawGitHubFile(path);
  if (!manifestRaw) return { manifest: null, path, snapshots_loaded: 0 };
  let manifest: any;
  try { manifest = JSON.parse(manifestRaw.text); }
  catch { throw new Error(`manifest_json_invalid:${path}`); }
  shadowMemory.set(path, { sha: manifestRaw.sha, text: manifestRaw.text });

  let snapshotsLoaded = 0;
  for (const layer of Array.isArray(manifest.layers) ? manifest.layers : []) {
    const snapshotPath = String(layer?.snapshot_path ?? "").trim();
    if (!snapshotPath || shadowMemory.has(snapshotPath)) continue;
    const snapshotRaw = await rawGitHubFile(snapshotPath);
    if (!snapshotRaw) continue;
    shadowMemory.set(snapshotPath, { sha: snapshotRaw.sha, text: snapshotRaw.text });
    snapshotsLoaded += 1;
  }
  return { manifest, path, snapshots_loaded: snapshotsLoaded };
}

function compactResult(value: any) {
  if (!value || typeof value !== "object") return value;
  if (value.status === "FINAL") {
    return {
      status: value.status,
      intraday_review_candidates: value.run?.candidate_count ?? null,
      next_day_intraday_candidates: value.next_day_intraday?.candidate_count ?? null,
      swing_candidates: value.swing?.candidate_count ?? null,
      intraday_symbols: Array.isArray(value.run?.candidates) ? value.run.candidates.slice(0, 10).map((x: any) => x.symbol) : [],
      next_day_symbols: Array.isArray(value.next_day_intraday?.candidates) ? value.next_day_intraday.candidates.slice(0, 10).map((x: any) => x.symbol) : [],
      swing_symbols: Array.isArray(value.swing?.candidates) ? value.swing.candidates.slice(0, 10).map((x: any) => x.symbol) : [],
    };
  }
  if (value.status === "PARTIAL") {
    return {
      status: value.status,
      next_day_intraday_candidates: value.next_day_intraday?.candidate_count ?? null,
      next_day_symbols: Array.isArray(value.next_day_intraday?.candidates) ? value.next_day_intraday.candidates.slice(0, 10).map((x: any) => x.symbol) : [],
      swing_error: value.swing_error?.code ?? value.swing_error?.status ?? null,
    };
  }
  return { status: value.status, code: value.code ?? null, detail: value.detail ?? null };
}

function authorized(request: Request, env: ShadowEnv) {
  return request.headers.get("authorization") === `Bearer ${env.SHADOW_TOKEN}`;
}

export default {
  async fetch(request: Request, env: ShadowEnv): Promise<Response> {
    const url = new URL(request.url);
    if (!authorized(request, env)) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "selection-real-data-shadow",
        cron: false,
        persistence: "MEMORY_ONLY",
        fugle_key_present: Boolean(env.FUGLE_API_KEY),
      });
    }
    if (url.pathname !== "/shadow" || request.method !== "POST") return Response.json({ error: "not_found" }, { status: 404 });

    try {
      const now = new Date();
      const sourceTradeDate = taipeiDate(now);
      const targetSessionDate = nextWeekday(sourceTradeDate);
      const shadowMemory: MemoryGitHubDataStore = new Map();
      const shadowEnv = {
        ...env,
        GITHUB_DATA_REPO: "keywayk09/tv-papertrader",
        GITHUB_DATA_BRANCH: "main",
        GITHUB_DATA_TOKEN: undefined,
        GITHUB_TOKEN: undefined,
        FUGLE_API_KEY: env.FUGLE_API_KEY || "",
        FINMIND_TOKEN: "",
        __GITHUB_DATA_MEMORY: shadowMemory,
      } as ShadowEnv & { __GITHUB_DATA_MEMORY: MemoryGitHubDataStore };

      const preload = await preloadCanonicalMarketData(shadowMemory, sourceTradeDate);
      const universe = await loadStableMarketUniverse(true);
      const quoteDates = [...new Set(
        universe.rows.map((row) => normalizeDate(row.last_updated)).filter((date): date is string => Boolean(date)),
      )].sort();

      const intradayReview = await runIntradayReviewSelection(shadowEnv, {
        source_trade_date: sourceTradeDate,
        now,
      });
      const night = await runNightSelections(shadowEnv, {
        source_trade_date: sourceTradeDate,
        target_session_date: targetSessionDate,
        now,
      });

      const shadowSelectionPaths = [...shadowMemory.keys()].filter((path) => path.startsWith("research/selection/")).sort();
      return Response.json({
        ok: true,
        mode: "EXACT_SELECTOR_REAL_DATA_MEMORY_ONLY",
        source_trade_date: sourceTradeDate,
        target_session_date: targetSessionDate,
        market_usable: universe.usable,
        market_quote_dates: quoteDates,
        manifest_present: Boolean(preload.manifest),
        manifest_day_status: preload.manifest?.day_status ?? null,
        manifest_terminal: preload.manifest?.terminal ?? null,
        manifest_ready_layers: preload.manifest?.ready_layers ?? [],
        snapshots_loaded: preload.snapshots_loaded,
        fugle_key_present: Boolean(env.FUGLE_API_KEY),
        intraday_review: compactResult(intradayReview),
        night: compactResult(night),
        shadow_selection_paths: shadowSelectionPaths,
        guarantees: {
          github_write_token_present: false,
          formal_journal_write_possible: false,
          stale_prior_day_substitution_allowed: false,
        },
      });
    } catch (error) {
      return Response.json({
        ok: false,
        mode: "EXACT_SELECTOR_REAL_DATA_MEMORY_ONLY",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? String(error.stack ?? "").split("\n").slice(0, 8) : [],
      }, { status: 500 });
    }
  },
};
