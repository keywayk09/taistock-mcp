import { readGitHubJson, sha256Hex, stableJson } from "./github-data-store.ts";
import {
  getSelectionEvidence,
  recordSelectionEvidence,
  SELECTION_EVIDENCE_VERSION,
  type SelectionEvidenceRecord,
  type SelectionEvidenceSlot,
} from "./selection-journal.ts";
import {
  loadStableMarketUniverse,
  STABLE_MARKET_SOURCE_CONTRACT,
  type StableSnapshotRow,
} from "./stable-market-tools";

export const SELECTION_EVIDENCE_BUILDER_VERSION = "diamond-selection-evidence-builder/v1.0.0";

const MOPSFIN_TWSE_COMPANIES_CSV = "https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv";
const MOPSFIN_TPEX_COMPANIES_CSV = "https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv";
const USER_AGENT = "taistock-diamond-selection/1.0";
const MIN_LISTED = 400;
const MIN_OTC = 250;

type Obj = Record<string, any>;
type CanonicalLayer = {
  kind: string;
  market: "listed" | "otc";
  status: string;
  snapshot_path?: string | null;
  dataset_version?: string | null;
  content_sha256?: string | null;
  row_count?: number | null;
  captured_at?: string | null;
};
type DailyManifest = {
  trade_date?: string;
  day_status?: string;
  terminal?: boolean;
  layers?: CanonicalLayer[];
  ready_layers?: string[];
  missing_layers?: string[];
  updated_at?: string;
};
type CompanyMeta = {
  symbol: string;
  name: string;
  sector: string;
  market: "TWSE" | "TPEx";
  issued_common_shares: number | null;
};

type BuildResult =
  | { status: "READY"; evidence: SelectionEvidenceRecord }
  | { status: "PENDING"; code: string; detail: Record<string, unknown> };

function manifestPath(date: string) {
  const [year, month, day] = date.split("-");
  return `data/market-data/daily/${year}/${month}/${day}/manifest.json`;
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[\s_()（）%％:：/\\.\-]/g, "");
}

function parseNumber(value: unknown): number | null {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text || ["-", "--", "---", "N/A", "null", "undefined"].includes(text)) return null;
  const n = Number(text.replace(/%$/, ""));
  return Number.isFinite(n) ? n : null;
}

function parseCsv(text: string) {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index++) {
    const ch = input[index];
    if (quoted) {
      if (ch === '"') {
        if (input[index + 1] === '"') { field += '"'; index++; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field.trim()); field = ""; }
    else if (ch === "\n") {
      row.push(field.trim()); field = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) {
    row.push(field.trim());
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  return rows;
}

async function fetchCompanyMaster(url: string, market: "TWSE" | "TPEx") {
  const response = await fetch(url, {
    redirect: "manual",
    headers: {
      Accept: "text/csv,text/plain,*/*",
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
      "User-Agent": USER_AGENT,
    },
  });
  const text = await response.text();
  if (response.status >= 300 && response.status < 400) throw new Error(`company_master_redirect:${market}:${response.status}`);
  if (!response.ok) throw new Error(`company_master_http:${market}:${response.status}`);
  const table = parseCsv(text);
  if (table.length < 2) throw new Error(`company_master_empty:${market}`);
  const header = table[0];
  const findIndex = (names: string[]) => header.findIndex((value) => names.some((name) => normalizedKey(value).includes(normalizedKey(name))));
  const symbolIndex = findIndex(["公司代號", "證券代號"]);
  const shortNameIndex = findIndex(["公司簡稱", "證券簡稱"]);
  const fullNameIndex = findIndex(["公司名稱", "證券名稱"]);
  const sectorIndex = findIndex(["產業別", "產業類別", "產業"]);
  const sharesIndex = findIndex(["已發行普通股數或TDR原股發行股數", "已發行普通股數", "普通股數"]);
  const out = new Map<string, CompanyMeta>();
  for (const cells of table.slice(1)) {
    const symbol = String(cells[symbolIndex >= 0 ? symbolIndex : 1] ?? "").trim();
    const name = String(cells[shortNameIndex >= 0 ? shortNameIndex : (fullNameIndex >= 0 ? fullNameIndex : 2)] ?? "").trim();
    // Ordinary listed/OTC companies have four-digit codes beginning 1-9.
    // Requiring company-master membership is the strict ETF/ETN exclusion gate.
    if (!/^[1-9]\d{3}$/.test(symbol)) continue;
    if (/(ETF|ETN|指數|債券|權證|正2|反1|槓桿|特別股)/i.test(name)) continue;
    out.set(symbol, {
      symbol,
      name,
      sector: sectorIndex >= 0 ? String(cells[sectorIndex] ?? "").trim() : "",
      market,
      issued_common_shares: sharesIndex >= 0 ? parseNumber(cells[sharesIndex]) : null,
    });
  }
  return out;
}

function normalizeQuoteDate(value: unknown): string | null {
  const raw = String(value ?? "").trim().split(/\s+/)[0];
  if (!raw) return null;
  if (/^20\d{2}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^20\d{6}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (/^\d{7}$/.test(raw)) {
    const year = Number(raw.slice(0, 3)) + 1911;
    return `${year}-${raw.slice(3, 5)}-${raw.slice(5, 7)}`;
  }
  return null;
}

function sameDayRows(rows: StableSnapshotRow[], tradeDate: string, master: Map<string, CompanyMeta>) {
  return rows.filter((row) => master.has(row.symbol) && normalizeQuoteDate(row.last_updated) === tradeDate);
}

function layerKey(layer: CanonicalLayer) {
  return `${layer.kind}:${layer.market}`;
}

const REQUIRED_1830 = ["institutional:listed", "institutional:otc"];
const REQUIRED_2230 = [
  "institutional:listed", "institutional:otc",
  "margin:listed", "margin:otc",
  "securities_lending:listed", "securities_lending:otc",
  "sbl_short_sale:listed", "sbl_short_sale:otc",
];

function requiredKeys(slot: SelectionEvidenceSlot) {
  return slot === "EOD_1830" ? REQUIRED_1830 : REQUIRED_2230;
}

function rowsFromSnapshot(body: unknown): Obj[] {
  if (Array.isArray(body)) return body.filter((row) => row && typeof row === "object") as Obj[];
  const root = body && typeof body === "object" ? body as Obj : {};
  if (Array.isArray(root.rows)) return root.rows.filter((row: unknown) => row && typeof row === "object") as Obj[];
  if (Array.isArray(root.data)) return root.data.filter((row: unknown) => row && typeof row === "object") as Obj[];
  return [];
}

function rowSymbol(row: Obj) {
  return String(row.symbol ?? row.stock_id ?? row.code ?? "").trim();
}

async function loadLayerRows(env: Env, layers: CanonicalLayer[], required: string[]) {
  const refs: SelectionEvidenceRecord["source_refs"] = [];
  const byKey = new Map<string, Obj[]>();
  for (const key of required) {
    const layer = layers.find((item) => layerKey(item) === key);
    if (!layer || layer.status !== "READY" || !layer.snapshot_path) throw new Error(`required_layer_not_ready:${key}`);
    const read = await readGitHubJson<unknown>(env, layer.snapshot_path);
    if (!read.value) throw new Error(`required_snapshot_missing:${key}`);
    const rows = rowsFromSnapshot(read.value);
    if (!rows.length) throw new Error(`required_snapshot_empty:${key}`);
    byKey.set(key, rows);
    refs.push({
      kind: layer.kind,
      market: layer.market,
      path: layer.snapshot_path,
      dataset_version: layer.dataset_version ?? null,
      content_sha256: layer.content_sha256 ?? null,
      row_count: layer.row_count ?? rows.length,
    });
  }
  return { byKey, refs };
}

function indexedBySymbol(rows: Obj[] | undefined) {
  const map = new Map<string, Obj>();
  for (const row of rows ?? []) {
    const symbol = rowSymbol(row);
    if (/^[1-9]\d{3}$/.test(symbol)) map.set(symbol, row);
  }
  return map;
}

function rankMap(rows: Array<Record<string, any>>, field: string, absolute = false) {
  const sorted = rows
    .map((row) => ({ symbol: String(row.symbol), value: Number(row[field]) }))
    .filter((item) => Number.isFinite(item.value))
    .sort((a, b) => (absolute ? Math.abs(b.value) - Math.abs(a.value) : b.value - a.value) || a.symbol.localeCompare(b.symbol));
  return new Map(sorted.map((item, index) => [item.symbol, index + 1]));
}

function ratio(numerator: unknown, denominator: unknown, scale = 1) {
  const n = Number(numerator);
  const d = Number(denominator);
  return Number.isFinite(n) && Number.isFinite(d) && d > 0 ? Math.round((n / d) * scale * 1e6) / 1e6 : null;
}

function buildFeatures(
  marketRows: StableSnapshotRow[],
  master: Map<string, CompanyMeta>,
  layerRows: Map<string, Obj[]>,
) {
  const institutional = new Map<string, Obj>();
  for (const key of ["institutional:listed", "institutional:otc"]) {
    for (const [symbol, row] of indexedBySymbol(layerRows.get(key))) institutional.set(symbol, row);
  }
  const margin = new Map<string, Obj>();
  for (const key of ["margin:listed", "margin:otc"]) for (const [symbol, row] of indexedBySymbol(layerRows.get(key))) margin.set(symbol, row);
  const lending = new Map<string, Obj>();
  for (const key of ["securities_lending:listed", "securities_lending:otc"]) for (const [symbol, row] of indexedBySymbol(layerRows.get(key))) lending.set(symbol, row);
  const sbl = new Map<string, Obj>();
  for (const key of ["sbl_short_sale:listed", "sbl_short_sale:otc"]) for (const [symbol, row] of indexedBySymbol(layerRows.get(key))) sbl.set(symbol, row);

  const features = marketRows.map((quote) => {
    const meta = master.get(quote.symbol)!;
    const inst = institutional.get(quote.symbol) ?? {};
    const mar = margin.get(quote.symbol) ?? {};
    const lend = lending.get(quote.symbol) ?? {};
    const shortSale = sbl.get(quote.symbol) ?? {};
    const volume = quote.trade_volume ?? null;
    const issuedShares = meta.issued_common_shares;
    const amplitudePct = quote.previous_close && quote.high != null && quote.low != null
      ? ((quote.high - quote.low) / quote.previous_close) * 100
      : null;
    const turnoverPct = issuedShares && volume != null ? (volume / issuedShares) * 100 : null;
    const lendingNetChange = parseNumber(lend.borrowed_shares) !== null || parseNumber(lend.returned_shares) !== null
      ? Number(parseNumber(lend.borrowed_shares) ?? 0) - Number(parseNumber(lend.returned_shares) ?? 0)
      : null;
    return {
      symbol: quote.symbol,
      name: meta.name || quote.name,
      market: meta.market,
      sector: meta.sector || quote.sector,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      close: quote.close,
      previous_close: quote.previous_close,
      change_percent: quote.change_percent,
      amplitude_percent: amplitudePct == null ? null : Math.round(amplitudePct * 1e4) / 1e4,
      trade_volume: volume,
      trade_value: quote.trade_value,
      issued_common_shares: issuedShares,
      turnover_percent: turnoverPct == null ? null : Math.round(turnoverPct * 1e4) / 1e4,
      foreign_net_shares: parseNumber(inst.foreign_net_shares),
      trust_net_shares: parseNumber(inst.trust_net_shares),
      dealer_net_shares: parseNumber(inst.dealer_net_shares),
      institutional_total_net_shares: parseNumber(inst.total_net_shares),
      foreign_net_to_volume: ratio(inst.foreign_net_shares, volume),
      trust_net_to_volume: ratio(inst.trust_net_shares, volume),
      dealer_net_to_volume: ratio(inst.dealer_net_shares, volume),
      margin_balance_lots: parseNumber(mar.margin_balance_lots),
      margin_change_lots: parseNumber(mar.margin_balance_change_lots),
      short_balance_lots: parseNumber(mar.short_balance_lots),
      short_change_lots: parseNumber(mar.short_balance_change_lots),
      margin_change_to_volume: ratio(Number(parseNumber(mar.margin_balance_change_lots) ?? 0) * 1000, volume),
      short_change_to_volume: ratio(Number(parseNumber(mar.short_balance_change_lots) ?? 0) * 1000, volume),
      securities_lending_balance_shares: parseNumber(lend.balance_shares),
      securities_lending_net_change_shares: lendingNetChange,
      securities_lending_change_to_volume: ratio(lendingNetChange, volume),
      sbl_short_sale_balance_shares: parseNumber(shortSale.balance_shares),
      sbl_short_sale_sold_shares: parseNumber(shortSale.sold_shares ?? shortSale.sold_volume_shares),
      sbl_short_sale_to_volume: ratio(shortSale.sold_shares ?? shortSale.sold_volume_shares, volume),
      quote_trade_date: normalizeQuoteDate(quote.last_updated),
      quote_source: quote.source,
    };
  });

  const valueRank = rankMap(features, "trade_value");
  const volumeRank = rankMap(features, "trade_volume");
  const turnoverRank = rankMap(features, "turnover_percent");
  const amplitudeRank = rankMap(features, "amplitude_percent");
  const absChangeRank = rankMap(features, "change_percent", true);
  return features.map((row) => ({
    ...row,
    trade_value_rank: valueRank.get(row.symbol) ?? null,
    trade_volume_rank: volumeRank.get(row.symbol) ?? null,
    turnover_rank: turnoverRank.get(row.symbol) ?? null,
    amplitude_rank: amplitudeRank.get(row.symbol) ?? null,
    abs_change_rank: absChangeRank.get(row.symbol) ?? null,
  }));
}

function maxCapturedAtMs(layers: CanonicalLayer[], required: string[], fallbackMs: number) {
  const values = layers
    .filter((layer) => required.includes(layerKey(layer)))
    .map((layer) => Date.parse(String(layer.captured_at ?? "")))
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) : fallbackMs;
}

export async function ensureSelectionEvidence(env: Env, input: {
  source_trade_date: string;
  slot: SelectionEvidenceSlot;
  now?: Date;
}): Promise<BuildResult> {
  const existing = await getSelectionEvidence(env, input.source_trade_date, input.slot);
  if (existing) return { status: "READY", evidence: existing };

  const path = manifestPath(input.source_trade_date);
  const manifestRead = await readGitHubJson<DailyManifest>(env, path);
  const manifest = manifestRead.value;
  if (!manifest) return { status: "PENDING", code: "MARKET_DATA_MANIFEST_MISSING", detail: { path } };
  const layers = Array.isArray(manifest.layers) ? manifest.layers : [];
  const required = requiredKeys(input.slot);
  const ready = layers.filter((layer) => layer.status === "READY").map(layerKey);
  const missingRequired = required.filter((key) => !ready.includes(key));
  if (missingRequired.length) {
    return { status: "PENDING", code: "REQUIRED_LAYERS_NOT_READY", detail: { required, ready, missing_required: missingRequired } };
  }
  if (input.slot === "FULL_2230" && (manifest.terminal !== true || manifest.day_status !== "COMPLETE")) {
    return { status: "PENDING", code: "FULL_DAY_NOT_TERMINAL", detail: { day_status: manifest.day_status ?? null, terminal: manifest.terminal ?? false } };
  }

  let listedMaster: Map<string, CompanyMeta>;
  let otcMaster: Map<string, CompanyMeta>;
  try {
    [listedMaster, otcMaster] = await Promise.all([
      fetchCompanyMaster(MOPSFIN_TWSE_COMPANIES_CSV, "TWSE"),
      fetchCompanyMaster(MOPSFIN_TPEX_COMPANIES_CSV, "TPEx"),
    ]);
  } catch (error) {
    return { status: "PENDING", code: "STRICT_COMPANY_MASTER_UNAVAILABLE", detail: { error: error instanceof Error ? error.message : String(error) } };
  }
  if (listedMaster.size < MIN_LISTED || otcMaster.size < MIN_OTC) {
    return { status: "PENDING", code: "STRICT_COMPANY_MASTER_COVERAGE_LOW", detail: { listed: listedMaster.size, otc: otcMaster.size } };
  }

  const universe = await loadStableMarketUniverse(true);
  if (!universe.usable) {
    return { status: "PENDING", code: "FULL_MARKET_QUOTES_UNAVAILABLE", detail: { listed: universe.TWSE.normalized_count, otc: universe.TPEx.normalized_count, errors: [...universe.TWSE.errors, ...universe.TPEx.errors] } };
  }
  const listedQuotes = sameDayRows(universe.TWSE.rows, input.source_trade_date, listedMaster);
  const otcQuotes = sameDayRows(universe.TPEx.rows, input.source_trade_date, otcMaster);
  if (listedQuotes.length < MIN_LISTED || otcQuotes.length < MIN_OTC) {
    return {
      status: "PENDING",
      code: "QUOTE_TRADE_DATE_STALE_OR_INCOMPLETE",
      detail: {
        expected_trade_date: input.source_trade_date,
        listed_same_day: listedQuotes.length,
        otc_same_day: otcQuotes.length,
        listed_total: universe.TWSE.rows.length,
        otc_total: universe.TPEx.rows.length,
      },
    };
  }

  let loaded: Awaited<ReturnType<typeof loadLayerRows>>;
  try {
    loaded = await loadLayerRows(env, layers, required);
  } catch (error) {
    return { status: "PENDING", code: "REQUIRED_SNAPSHOT_READ_FAILED", detail: { error: error instanceof Error ? error.message : String(error) } };
  }

  const master = new Map<string, CompanyMeta>([...listedMaster, ...otcMaster]);
  const features = buildFeatures([...listedQuotes, ...otcQuotes], master, loaded.byKey);
  const generatedAt = input.now ?? new Date();
  const generatedMs = generatedAt.getTime();
  const sourceProjection = {
    trade_date: input.source_trade_date,
    slot: input.slot,
    manifest_sha: manifestRead.sha,
    required,
    refs: loaded.refs,
    quote_contract: STABLE_MARKET_SOURCE_CONTRACT,
    quote_retrieved_at: universe.retrieved_at,
  };
  const projectionHash = await sha256Hex(stableJson(sourceProjection));
  const evidenceId = `selection-evidence:${input.source_trade_date}:${input.slot}:${projectionHash.slice(0, 16)}`;
  const dataWatermark = Math.min(generatedMs, Math.max(maxCapturedAtMs(layers, required, generatedMs), Date.parse(universe.retrieved_at) || 0));
  const optionalMissing = REQUIRED_2230.filter((key) => !required.includes(key) && !ready.includes(key));

  const evidence = await recordSelectionEvidence(env, {
    evidence_id: evidenceId,
    source_trade_date: input.source_trade_date,
    slot: input.slot,
    generated_at: generatedAt.toISOString(),
    generated_at_ms: generatedMs,
    knowledge_cutoff_ts_ms: generatedMs,
    data_watermark_ts_ms: dataWatermark,
    source_manifest_path: path,
    source_manifest_sha: manifestRead.sha,
    source_manifest_projection_hash: projectionHash,
    source_refs: loaded.refs,
    market_snapshot: {
      source_contract: STABLE_MARKET_SOURCE_CONTRACT,
      retrieved_at: universe.retrieved_at,
      listed_count: listedQuotes.length,
      otc_count: otcQuotes.length,
      quote_trade_date: input.source_trade_date,
    },
    completeness: {
      status: "READY",
      required_layers: required,
      ready_layers: ready,
      optional_missing_layers: optionalMissing,
    },
    universe_feature_schema: "diamond-selection-universe-features/v1.0.0",
    universe_features: features,
  });
  return { status: "READY", evidence };
}
