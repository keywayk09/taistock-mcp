import {
  putImmutableGitHubJson,
  readGitHubJson,
  sha256Hex,
  stableJson,
  updateGitHubJson,
} from "./github-data-store";
import {
  EXPECTED_MARKET_DATA_LAYERS,
  classifyTradingDay,
  dueLayerKeys,
  makePendingLayer,
  marketLayerKey,
  mergeReadyMonotonic,
  parseTwseHolidayCsv,
  summarizeDay,
  type MarketManifestLayer,
  type TradingCalendarEntry,
  type TradingDayOverride,
} from "./market-data-incremental-controller";
import {
  normalizeTpexInstitutional,
  normalizeTpexMargin,
  normalizeTpexSblShortSale,
  normalizeTradeDate,
  normalizeTwseInstitutional,
  normalizeTwseSecuritiesLending,
  normalizeTwseSblShortSale,
  type TwMarketDataKind,
} from "./tw-market-data";
import { normalizeTwseMiMargnOfficial } from "./twse-mi-margin-official";
import { getTpexInstitutionalPayload, getTpexJson, getTpexMarginPayload } from "./tpex-cloudflare-transport";

const VERSION = "diamond-tw-market-data/v2.3.1-cloudflare-one-layer-resumable";
const USER_AGENT = "Diamond-Cloudflare-Market-Data/2.3.1";
export const MARKET_DATA_CAPTURE_BATCH_SIZE = 1;
export const MARKET_DATA_INDEX_PREFIX_BATCH_SIZE = 1;

type IndexState = {
  status: "PENDING" | "READY";
  completed_prefixes: string[];
  total_prefixes: number | null;
  updated_at: string;
};

type ExistingManifest = {
  layers?: MarketManifestLayer[];
  day_status?: string;
  terminal?: boolean;
  index_state?: IndexState;
  [key: string]: unknown;
};

type SymbolMonthShard = {
  schema_version: "diamond-market-data-symbol-shard/v2";
  month: string;
  prefix: string;
  symbols: Record<string, Partial<Record<TwMarketDataKind, any[]>>>;
  updated_at: string;
};

type ObservedLayer = {
  kind: TwMarketDataKind;
  market: "listed" | "otc";
  source: string;
  rows: any[];
  raw: Array<{ source: string; body: any }>;
};

type PersistedLayer = {
  layer: MarketManifestLayer;
  observed: ObservedLayer;
};

function manifestPath(tradeDate: string) {
  const [year, month, day] = tradeDate.split("-");
  return `data/market-data/daily/${year}/${month}/${day}/manifest.json`;
}

function shardPath(tradeDate: string, prefix: string) {
  const [year, month] = tradeDate.split("-");
  return `data/market-data/index/${year}/${month}/${prefix}.json`;
}

function sourceDate(body: any) {
  const direct = normalizeTradeDate(body?.date ?? body?.Date ?? body?.["資料日期"] ?? body?.["日期"]);
  if (direct) return direct;
  const rows = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
  for (const row of rows) {
    const value = normalizeTradeDate(row?.Date ?? row?.date ?? row?.["資料日期"] ?? row?.["日期"] ?? row?.TradeDate);
    if (value) return value;
  }
  return null;
}

async function getJson(url: string, label: string) {
  const response = await fetch(url, {
    headers: { Accept: "application/json,text/plain,*/*", "User-Agent": USER_AGENT },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${label}_http_${response.status}:${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}_invalid_json:${text.slice(0, 200)}`);
  }
}

async function getText(url: string, label: string) {
  const response = await fetch(url, {
    headers: { Accept: "text/csv,text/plain,*/*", "User-Agent": USER_AGENT },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${label}_http_${response.status}:${text.slice(0, 200)}`);
  return text;
}

function validateDate(body: any, tradeDate: string, label: string) {
  const date = sourceDate(body);
  if (date !== tradeDate) throw new Error(`${label}_source_date_mismatch:${date}`);
}

function pendingFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    error: message,
    status: (/source_date_mismatch|official_rows_empty|not_published|no data|沒有符合條件/i.test(message) ? "PENDING" : "ERROR") as "PENDING" | "ERROR",
  };
}

async function loadCalendar(env: Env, tradeDate: string) {
  const [year, month, day] = tradeDate.split("-");
  const calendarPath = `data/market-calendar/${year}.json`;
  const overridePath = `data/market-calendar/overrides/${year}/${month}/${day}.json`;
  const [calendarRead, overrideRead] = await Promise.all([
    readGitHubJson<{ entries?: TradingCalendarEntry[] }>(env, calendarPath),
    readGitHubJson<TradingDayOverride>(env, overridePath),
  ]);

  let entries = Array.isArray(calendarRead.value?.entries) ? calendarRead.value!.entries! : [];
  let verified = entries.length > 0;
  let error: string | null = null;

  if (!verified) {
    try {
      const rocYear = Number(year) - 1911;
      const csv = await getText(
        `https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=csv&queryYear=${rocYear}`,
        "TWSE_HOLIDAY_SCHEDULE",
      );
      const parsed = parseTwseHolidayCsv(csv, year);
      if (parsed.length) {
        entries = parsed;
        verified = true;
        await updateGitHubJson(env, {
          path: calendarPath,
          defaultValue: {
            schema_version: "diamond-market-calendar/v1",
            year,
            source: "TWSE_HOLIDAY_SCHEDULE_CSV",
            entries: [] as TradingCalendarEntry[],
            updated_at: "",
          },
          message: `data(market-calendar): refresh ${year}`,
          merge: (current: any) => ({
            ...current,
            schema_version: "diamond-market-calendar/v1",
            year,
            source: "TWSE_HOLIDAY_SCHEDULE_CSV",
            entries: parsed,
            updated_at: new Date().toISOString(),
          }),
          retries: 2,
        });
      } else {
        error = "holiday_schedule_empty";
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  return {
    entries,
    verified,
    error,
    calendarPath: verified ? calendarPath : null,
    override: overrideRead.value,
  };
}

async function captureOfficialLayers(tradeDate: string, selected: Set<string>) {
  const compact = tradeDate.replaceAll("-", "");
  const ready = new Map<string, ObservedLayer>();
  const failures = new Map<string, { source: string | null; error: string; status: "PENDING" | "ERROR" }>();
  const isDue = (kind: TwMarketDataKind, market: "listed" | "otc") => selected.has(`${kind}-${market}`);
  const addReady = (layer: ObservedLayer) => {
    if (!layer.rows.length) throw new Error(`${layer.kind}-${layer.market}_official_rows_empty`);
    ready.set(`${layer.kind}-${layer.market}`, layer);
  };
  const fail = (kind: TwMarketDataKind, market: "listed" | "otc", source: string | null, error: unknown) => {
    failures.set(`${kind}-${market}`, { source, ...pendingFailure(error) });
  };

  if (isDue("institutional", "listed")) {
    try {
      const body = await getJson(`https://www.twse.com.tw/rwd/zh/fund/T86?date=${compact}&selectType=ALLBUT0999&response=json`, "TWSE_T86");
      validateDate(body, tradeDate, "TWSE_T86");
      addReady({ kind: "institutional", market: "listed", source: "TWSE_T86", rows: normalizeTwseInstitutional(body, tradeDate), raw: [{ source: "TWSE_T86", body }] });
    } catch (error) { fail("institutional", "listed", "TWSE_T86", error); }
  }

  if (isDue("institutional", "otc")) {
    try {
      const body = await getTpexInstitutionalPayload(tradeDate);
      validateDate(body, tradeDate, "TPEX_3INSTI");
      addReady({ kind: "institutional", market: "otc", source: "TPEX_3INSTI_DAILY_TRADING", rows: normalizeTpexInstitutional(body, tradeDate), raw: [{ source: "TPEX_3INSTI_DAILY_TRADING", body }] });
    } catch (error) { fail("institutional", "otc", "TPEX_3INSTI_DAILY_TRADING", error); }
  }

  if (isDue("margin", "listed")) {
    try {
      const body = await getJson(`https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${compact}&selectType=ALL&response=json`, "TWSE_MI_MARGN");
      validateDate(body, tradeDate, "TWSE_MI_MARGN");
      addReady({ kind: "margin", market: "listed", source: "TWSE_MI_MARGN", rows: normalizeTwseMiMargnOfficial(body, tradeDate), raw: [{ source: "TWSE_MI_MARGN", body }] });
    } catch (error) { fail("margin", "listed", "TWSE_MI_MARGN", error); }
  }

  if (isDue("margin", "otc")) {
    try {
      const body = await getTpexMarginPayload(tradeDate);
      validateDate(body, tradeDate, "TPEX_MARGIN");
      addReady({ kind: "margin", market: "otc", source: "TPEX_MAINBOARD_MARGIN_BALANCE", rows: normalizeTpexMargin(body, tradeDate), raw: [{ source: "TPEX_MAINBOARD_MARGIN_BALANCE", body }] });
    } catch (error) { fail("margin", "otc", "TPEX_MAINBOARD_MARGIN_BALANCE", error); }
  }

  if (isDue("securities_lending", "listed") || isDue("securities_lending", "otc")) {
    try {
      const body = await getJson(`https://www.twse.com.tw/exchangeReport/TWT72U?date=${compact}&selectType=SLBNLB&response=json`, "TWSE_TWT72U");
      validateDate(body, tradeDate, "TWSE_TWT72U");
      const rows = normalizeTwseSecuritiesLending(body, tradeDate);
      if (!rows.length) throw new Error("securities_lending_official_rows_empty");
      for (const market of ["listed", "otc"] as const) {
        if (!isDue("securities_lending", market)) continue;
        const marketRows = rows.filter((row) => row.market === market);
        if (marketRows.length) addReady({ kind: "securities_lending", market, source: "TWSE_TWT72U", rows: marketRows, raw: [{ source: "TWSE_TWT72U", body }] });
        else fail("securities_lending", market, "TWSE_TWT72U", "official_rows_empty");
      }
    } catch (error) {
      for (const market of ["listed", "otc"] as const) if (isDue("securities_lending", market)) fail("securities_lending", market, "TWSE_TWT72U", error);
    }
  }

  if (isDue("sbl_short_sale", "listed")) {
    try {
      const body = await getJson(`https://www.twse.com.tw/rwd/zh/marginTrading/TWT93U?date=${compact}&response=json`, "TWSE_TWT93U");
      validateDate(body, tradeDate, "TWSE_TWT93U");
      addReady({ kind: "sbl_short_sale", market: "listed", source: "TWSE_TWT93U", rows: normalizeTwseSblShortSale(body, tradeDate), raw: [{ source: "TWSE_TWT93U", body }] });
    } catch (error) { fail("sbl_short_sale", "listed", "TWSE_TWT93U", error); }
  }

  if (isDue("sbl_short_sale", "otc")) {
    try {
      const [balance, volume] = await Promise.all([
        getTpexJson("https://www.tpex.org.tw/openapi/v1/tpex_margin_sbl", "TPEX_MARGIN_SBL"),
        getTpexJson("https://www.tpex.org.tw/openapi/v1/tpex_short_sell", "TPEX_SHORT_SELL"),
      ]);
      validateDate(balance, tradeDate, "TPEX_MARGIN_SBL");
      addReady({
        kind: "sbl_short_sale",
        market: "otc",
        source: "TPEX_MARGIN_SBL+TPEX_SHORT_SELL",
        rows: normalizeTpexSblShortSale(balance, volume, tradeDate),
        raw: [{ source: "TPEX_MARGIN_SBL", body: balance }, { source: "TPEX_SHORT_SELL", body: volume }],
      });
    } catch (error) { fail("sbl_short_sale", "otc", "TPEX_MARGIN_SBL+TPEX_SHORT_SELL", error); }
  }

  return { ready, failures };
}

async function persistObservedLayers(env: Env, tradeDate: string, capturedAt: string, observed: Map<string, ObservedLayer>, existingLayers: MarketManifestLayer[]) {
  const [year, month, day] = tradeDate.split("-");
  const previousByKey = new Map(existingLayers.map((layer) => [marketLayerKey(layer), layer]));
  const rawPathByIdentity = new Map<string, string[]>();
  const uniqueRaw = new Map<string, { source: string; body: any; identities: string[] }>();

  for (const [identity, layer] of observed) {
    for (const raw of layer.raw) {
      const hash = await sha256Hex(stableJson(raw.body));
      const key = `${raw.source}:${hash}`;
      const current = uniqueRaw.get(key) ?? { source: raw.source, body: raw.body, identities: [] };
      current.identities.push(identity);
      uniqueRaw.set(key, current);
    }
  }

  for (const [key, raw] of uniqueRaw) {
    const hash = key.slice(key.indexOf(":") + 1);
    const path = `data/market-data/raw/${year}/${month}/${day}/${raw.source.toLowerCase()}-${hash}.json`;
    await putImmutableGitHubJson(env, {
      path,
      value: { schema_version: "diamond-official-raw-capture/v1", trade_date: tradeDate, source: raw.source, content_sha256: hash, body: raw.body },
      message: `data(market): raw ${tradeDate} ${raw.source}`,
      retries: 2,
    });
    for (const identity of raw.identities) rawPathByIdentity.set(identity, [...(rawPathByIdentity.get(identity) ?? []), path]);
  }

  const persisted = new Map<string, PersistedLayer>();
  for (const [identity, layer] of observed) {
    layer.rows.sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)));
    const canonical = {
      schema_version: VERSION,
      trade_date: tradeDate,
      market: layer.market,
      kind: layer.kind,
      source: layer.source,
      source_date_verified: true,
      rows: layer.rows,
    };
    const contentSha = await sha256Hex(stableJson(canonical));
    const datasetVersion = `sha256:${contentSha}`;
    const snapshotPath = `data/market-data/daily/${year}/${month}/${day}/snapshots/${layer.kind}-${layer.market}/${contentSha}.json`;
    await putImmutableGitHubJson(env, {
      path: snapshotPath,
      value: { ...canonical, content_sha256: contentSha, dataset_version: datasetVersion },
      message: `data(market): snapshot ${tradeDate} ${identity}`,
      retries: 2,
    });
    const previous = previousByKey.get(identity);
    persisted.set(identity, {
      observed: layer,
      layer: {
        kind: layer.kind,
        market: layer.market,
        status: "READY",
        source: layer.source,
        row_count: layer.rows.length,
        dataset_version: datasetVersion,
        content_sha256: contentSha,
        snapshot_path: snapshotPath,
        raw_paths: rawPathByIdentity.get(identity) ?? [],
        captured_at: capturedAt,
        error: null,
        attempts: Number(previous?.attempts || 0) + 1,
        first_attempt_at: previous?.first_attempt_at || capturedAt,
        last_attempt_at: capturedAt,
        next_retry_at: null,
      },
    });
  }

  return persisted;
}

function placeholderLayer(identity: { kind: TwMarketDataKind; market: "listed" | "otc" }): MarketManifestLayer {
  return {
    ...identity,
    status: "PENDING",
    source: null,
    row_count: 0,
    dataset_version: null,
    content_sha256: null,
    snapshot_path: null,
    raw_paths: [],
    captured_at: null,
    error: "not_attempted_in_current_subrequest_window",
    attempts: 0,
    first_attempt_at: null,
    last_attempt_at: null,
    next_retry_at: null,
  };
}

async function processIndexBatch(env: Env, tradeDate: string, manifest: ExistingManifest, capturedAt: string) {
  const layers = (manifest.layers ?? []).filter((layer) => layer.status === "READY" && layer.snapshot_path);
  if (layers.length !== EXPECTED_MARKET_DATA_LAYERS.length) {
    return { trade_date: tradeDate, status: "INDEX_WAITING_FOR_COMPLETE_DAY", indexed_prefixes: 0 };
  }

  const snapshotReads = await Promise.all(layers.map((layer) => readGitHubJson<{ rows?: any[] }>(env, String(layer.snapshot_path))));
  const prefixUpdates = new Map<string, Array<{ kind: TwMarketDataKind; row: any }>>();

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const rows = Array.isArray(snapshotReads[i].value?.rows) ? snapshotReads[i].value!.rows! : [];
    for (const row of rows) {
      const symbol = String(row?.symbol ?? "");
      if (!/^\d{4,6}$/.test(symbol)) continue;
      const prefix = symbol.slice(0, 2);
      const list = prefixUpdates.get(prefix) ?? [];
      list.push({ kind: layer.kind as TwMarketDataKind, row });
      prefixUpdates.set(prefix, list);
    }
  }

  const allPrefixes = [...prefixUpdates.keys()].sort();
  const completed = new Set(manifest.index_state?.completed_prefixes ?? []);
  const pending = allPrefixes.filter((prefix) => !completed.has(prefix));
  const batch = pending.slice(0, MARKET_DATA_INDEX_PREFIX_BATCH_SIZE);

  for (const prefix of batch) {
    const updates = prefixUpdates.get(prefix) ?? [];
    await updateGitHubJson<SymbolMonthShard>(env, {
      path: shardPath(tradeDate, prefix),
      defaultValue: {
        schema_version: "diamond-market-data-symbol-shard/v2",
        month: tradeDate.slice(0, 7),
        prefix,
        symbols: {},
        updated_at: "",
      },
      message: `data(market): index ${tradeDate} ${prefix}`,
      retries: 2,
      merge: (current) => {
        const next: SymbolMonthShard = {
          schema_version: "diamond-market-data-symbol-shard/v2",
          month: tradeDate.slice(0, 7),
          prefix,
          symbols: { ...(current.symbols ?? {}) },
          updated_at: capturedAt,
        };
        for (const { kind, row } of updates) {
          const symbol = String(row.symbol);
          const symbolState = { ...(next.symbols[symbol] ?? {}) };
          const previousRows = Array.isArray(symbolState[kind]) ? [...symbolState[kind]!] : [];
          symbolState[kind] = [...previousRows.filter((item: any) => item.trade_date !== tradeDate), row]
            .sort((a: any, b: any) => String(a.trade_date).localeCompare(String(b.trade_date)));
          next.symbols[symbol] = symbolState;
        }
        return next;
      },
    });
    completed.add(prefix);
  }

  const remaining = allPrefixes.filter((prefix) => !completed.has(prefix));
  const indexStatus = remaining.length ? "PENDING" as const : "READY" as const;
  const write = await updateGitHubJson<any>(env, {
    path: manifestPath(tradeDate),
    defaultValue: manifest,
    message: `data(market): index progress ${tradeDate}`,
    retries: 2,
    merge: (current) => ({
      ...current,
      index_state: {
        status: indexStatus,
        completed_prefixes: [...completed].sort(),
        total_prefixes: allPrefixes.length,
        updated_at: capturedAt,
      },
      updated_at: capturedAt,
    }),
  });

  return {
    trade_date: tradeDate,
    status: indexStatus === "READY" ? "INDEX_COMPLETE" : "INDEX_PROGRESS",
    indexed_prefixes: batch.length,
    completed_prefixes: completed.size,
    total_prefixes: allPrefixes.length,
    remaining_prefixes: remaining.length,
    manifest_sha: write.sha,
  };
}

export async function runSubrequestSafeMarketDataCapture(env: Env, input: { tradeDate: string; finalAudit?: boolean; now?: Date }) {
  const tradeDate = input.tradeDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) throw new Error(`invalid trade date: ${tradeDate}`);
  const capturedAt = (input.now ?? new Date()).toISOString();
  const path = manifestPath(tradeDate);
  const initialRead = await readGitHubJson<ExistingManifest>(env, path);
  const initial = initialRead.value;

  if (initial?.terminal === true && initial?.day_status === "NO_TRADING_DAY") {
    return { trade_date: tradeDate, status: "NOOP_NO_TRADING_DAY", day_status: "NO_TRADING_DAY", terminal: true };
  }

  if (initial?.terminal === true && initial?.day_status === "COMPLETE") {
    if (initial.index_state?.status === "READY") {
      return { trade_date: tradeDate, status: "NOOP_ALREADY_COMPLETE", day_status: "COMPLETE", terminal: true, index_status: "READY" };
    }
    return await processIndexBatch(env, tradeDate, initial, capturedAt);
  }

  const calendar = await loadCalendar(env, tradeDate);
  const gate = classifyTradingDay({ tradeDate, calendarEntries: calendar.entries, calendarVerified: calendar.verified, override: calendar.override });

  if (gate.terminal) {
    const result = await updateGitHubJson<any>(env, {
      path,
      defaultValue: {},
      message: `data(market): no trading day ${tradeDate}`,
      retries: 2,
      merge: (current) => {
        const ready = Array.isArray(current?.layers) ? current.layers.filter((layer: MarketManifestLayer) => layer.status === "READY") : [];
        if (ready.length) return current;
        return {
          schema_version: "diamond-market-data-manifest/v2",
          trade_date: tradeDate,
          storage: "GITHUB_ONLY",
          day_status: "NO_TRADING_DAY",
          terminal: true,
          expected_layers: 0,
          ready_layers: 0,
          missing_layers: [],
          trading_day_gate: gate,
          calendar_path: calendar.calendarPath,
          calendar_error: calendar.error,
          index_state: { status: "READY", completed_prefixes: [], total_prefixes: 0, updated_at: capturedAt },
          layers: [],
          updated_at: capturedAt,
        };
      },
    });
    return { trade_date: tradeDate, status: "NO_TRADING_DAY", terminal: true, gate, manifest_sha: result.sha };
  }

  const initialLayers = initial?.layers ?? [];
  const dueAll = dueLayerKeys(initialLayers, capturedAt);
  if (!dueAll.length) {
    const summary = summarizeDay(initialLayers);
    return { trade_date: tradeDate, status: "NOOP_NOT_DUE", ...summary };
  }

  const selectedKeys = dueAll.slice(0, MARKET_DATA_CAPTURE_BATCH_SIZE);
  const selected = new Set(selectedKeys);
  const observed = await captureOfficialLayers(tradeDate, selected);
  const persisted = await persistObservedLayers(env, tradeDate, capturedAt, observed.ready, initialLayers);

  let finalSummary = {
    ready_layers: 0,
    expected_layers: EXPECTED_MARKET_DATA_LAYERS.length,
    terminal: false,
    day_status: "PARTIAL" as "PARTIAL" | "COMPLETE",
    missing_layers: [] as string[],
  };

  const write = await updateGitHubJson<any>(env, {
    path,
    defaultValue: {},
    message: `data(market): reconcile ${tradeDate}`,
    retries: 2,
    merge: (current) => {
      if (current?.terminal === true && current?.day_status === "COMPLETE") return current;
      const currentLayers: MarketManifestLayer[] = Array.isArray(current?.layers) ? current.layers : [];
      const currentByKey = new Map(currentLayers.map((layer) => [marketLayerKey(layer), layer]));
      const nextLayers: MarketManifestLayer[] = [];

      for (const identity of EXPECTED_MARKET_DATA_LAYERS) {
        const key = marketLayerKey(identity);
        const previous = currentByKey.get(key) ?? null;
        const readyLayer = persisted.get(key)?.layer;
        if (readyLayer) {
          nextLayers.push(mergeReadyMonotonic(previous, readyLayer));
          continue;
        }
        if (previous?.status === "READY") {
          nextLayers.push(previous);
          continue;
        }
        const failure = observed.failures.get(key);
        if (selected.has(key) && failure) {
          nextLayers.push(makePendingLayer(identity, capturedAt, {
            source: failure.source,
            error: failure.error,
            previous,
            status: failure.status,
            retryMinutes: 10,
          }));
          continue;
        }
        if (previous) {
          nextLayers.push(previous);
          continue;
        }
        nextLayers.push(placeholderLayer(identity));
      }

      finalSummary = summarizeDay(nextLayers);
      return {
        schema_version: "diamond-market-data-manifest/v2",
        trade_date: tradeDate,
        storage: "GITHUB_ONLY",
        day_status: finalSummary.day_status,
        terminal: finalSummary.terminal,
        expected_layers: finalSummary.expected_layers,
        ready_layers: finalSummary.ready_layers,
        missing_layers: finalSummary.missing_layers,
        trading_day_gate: gate,
        calendar_path: calendar.calendarPath,
        calendar_error: calendar.error,
        index_state: finalSummary.terminal
          ? (current?.index_state ?? { status: "PENDING", completed_prefixes: [], total_prefixes: null, updated_at: capturedAt })
          : (current?.index_state ?? { status: "PENDING", completed_prefixes: [], total_prefixes: null, updated_at: capturedAt }),
        layers: nextLayers,
        updated_at: capturedAt,
      };
    },
  });

  if (!finalSummary.terminal && input.finalAudit) {
    console.warn("market-data final audit remains partial", { tradeDate, missing: finalSummary.missing_layers });
  }

  return {
    trade_date: tradeDate,
    storage: "GITHUB_ONLY",
    ...finalSummary,
    due_layers: dueAll,
    attempted_layers: selectedKeys,
    capture_batch_size: MARKET_DATA_CAPTURE_BATCH_SIZE,
    index_status: finalSummary.terminal ? "PENDING" : "WAITING_FOR_COMPLETE_DAY",
    final_audit: Boolean(input.finalAudit),
    calendar_error: calendar.error,
    manifest_sha: write.sha,
  };
}
