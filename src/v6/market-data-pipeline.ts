export type MarketDataPhase =
  | "fundamentals"
  | "institutional_prelim"
  | "institutional_final"
  | "margin"
  | "finalize";

type Market = "TWSE" | "TPEx";
type JsonRecord = Record<string, any>;
type SourceState = {
  market: Market;
  status: "READY" | "PRELIMINARY" | "FINAL" | "PENDING" | "FAILED" | "PENDING_SECRET";
  data_date?: string | null;
  row_count?: number;
  source_url?: string;
  source_sha256?: string;
  error?: string;
};

declare global {
  interface Env {
    MARKET_DATA_GITHUB_TOKEN?: string;
    MARKET_DATA_GITHUB_REPO?: string;
    MARKET_DATA_GITHUB_BRANCH?: string;
  }
}

const TWSE_OPENAPI = "https://openapi.twse.com.tw/v1";
const TPEX_OPENAPI = "https://www.tpex.org.tw/openapi/v1";
const DEFAULT_GITHUB_REPO = "keywayk09/tv-papertrader";
const DEFAULT_GITHUB_BRANCH = "main";
const SCHEMA_VERSION = "DIAMOND_MARKET_DATA_V1";

export type InstitutionalRow = {
  symbol: string;
  market: Market;
  name: string;
  foreignNet: number;
  trustNet: number;
  dealerNet: number;
};

export type MarginRow = {
  symbol: string;
  market: Market;
  name: string;
  marginPrev: number;
  marginBuy: number;
  marginSell: number;
  marginCashRepay: number;
  marginBalance: number;
  shortPrev: number;
  shortSell: number;
  shortBuy: number;
  shortRepay: number;
  shortBalance: number;
};

export type OfficialEvent = {
  eventId: string;
  market: Market;
  symbol: string;
  eventDate: string;
  eventTime: string | null;
  eventType: "INVESTOR_CONFERENCE" | "MATERIAL_INFORMATION";
  title: string;
};

type DailyManifest = {
  schema_version: string;
  trade_date: string;
  generated_at: string;
  universe: string;
  overall: "READY_WITH_PENDING" | "MARKET_DAY_VERIFIED";
  datasets: Record<string, any>;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function rows(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.map(record);
  const root = record(value);
  if (Array.isArray(root.data)) return root.data.map(record);
  return [];
}

function plainKey(value: string): string {
  return value.toLowerCase().replace(/[\s_()（）%％/\-]/g, "");
}

function pick(row: JsonRecord, candidates: string[]): unknown {
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  const normalized = new Map(Object.keys(row).map((key) => [plainKey(key), key]));
  for (const candidate of candidates) {
    const actual = normalized.get(plainKey(candidate));
    if (actual && row[actual] !== undefined && row[actual] !== null && row[actual] !== "") return row[actual];
  }
  return undefined;
}

function numberValue(value: unknown): number {
  const normalized = String(value ?? "").replaceAll(",", "").replaceAll("+", "").trim();
  if (!normalized || normalized === "--" || normalized === "---" || normalized === "X") return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ordinaryStock(symbol: unknown): boolean {
  return /^[1-9]\d{3}$/.test(String(symbol ?? "").trim());
}

function taipeiDate(value = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function compactDate(value: string): string {
  return value.replaceAll("-", "");
}

export function dateFromUnknown(value: unknown, fallback: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const rocCompact = raw.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (rocCompact) return `${Number(rocCompact[1]) + 1911}-${rocCompact[2]}-${rocCompact[3]}`;
  const iso = raw.match(/^(\d{4})[\/-]?(\d{2})[\/-]?(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const roc = raw.match(/^(\d{2,3})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (roc) return `${Number(roc[1]) + 1911}-${String(Number(roc[2])).padStart(2, "0")}-${String(Number(roc[3])).padStart(2, "0")}`;
  return fallback;
}

export function payloadDataDate(body: unknown, fallback = ""): string {
  const first = rows(body)[0];
  return first ? dateFromUnknown(pick(first, ["Date", "date", "資料日期", "日期"]), fallback) : fallback;
}

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function officialJson(url: string, source: string, attempts = 3): Promise<any> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json,text/plain,*/*",
          "User-Agent": "Taiwan-Stock-AI-Market-Data/1.0",
        },
      });
      const text = await response.text();
      let body: any = null;
      try { body = text ? JSON.parse(text) : null; } catch {}
      if (!response.ok) throw new Error(`${source} HTTP ${response.status}: ${text.slice(0, 240)}`);
      if (body === null) throw new Error(`${source} 回傳非 JSON`);
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${source} 取得失敗`);
}

function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64Utf8(value: string): string {
  const binary = atob(value.replaceAll("\n", ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function githubRepo(env: Env): string {
  return env.MARKET_DATA_GITHUB_REPO || DEFAULT_GITHUB_REPO;
}

function githubBranch(env: Env): string {
  return env.MARKET_DATA_GITHUB_BRANCH || DEFAULT_GITHUB_BRANCH;
}

function githubContentsUrl(env: Env, path: string): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `https://api.github.com/repos/${githubRepo(env)}/contents/${encodedPath}`;
}

function githubHeaders(env: Env): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env.MARKET_DATA_GITHUB_TOKEN ?? ""}`,
    "User-Agent": "Taiwan-Stock-AI-Market-Data/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function readGithubFile(env: Env, path: string): Promise<{ exists: boolean; sha?: string; content?: string }> {
  if (!env.MARKET_DATA_GITHUB_TOKEN) return { exists: false };
  const response = await fetch(`${githubContentsUrl(env, path)}?ref=${encodeURIComponent(githubBranch(env))}`, {
    headers: githubHeaders(env),
  });
  if (response.status === 404) return { exists: false };
  if (!response.ok) throw new Error(`GitHub read ${path} HTTP ${response.status}`);
  const body = record(await response.json());
  return {
    exists: true,
    sha: typeof body.sha === "string" ? body.sha : undefined,
    content: typeof body.content === "string" ? base64Utf8(body.content) : undefined,
  };
}

async function writeGithubFile(env: Env, path: string, content: string, message: string) {
  if (!env.MARKET_DATA_GITHUB_TOKEN) return { status: "PENDING_SECRET" as const, path };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const current = await readGithubFile(env, path);
    if (current.exists && current.content === content) return { status: "UNCHANGED" as const, path, sha: current.sha };
    const body: JsonRecord = {
      message,
      branch: githubBranch(env),
      content: utf8Base64(content),
    };
    if (current.sha) body.sha = current.sha;
    const response = await fetch(githubContentsUrl(env, path), {
      method: "PUT",
      headers: { ...githubHeaders(env), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      const result = record(await response.json());
      return { status: "READY" as const, path, commit_sha: record(result.commit).sha ?? null };
    }
    if ((response.status === 409 || response.status === 422) && attempt < 3) continue;
    throw new Error(`GitHub write ${path} HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  throw new Error(`GitHub write ${path} CAS retry exhausted`);
}

async function writeGithubImmutable(env: Env, path: string, content: string, message: string) {
  if (!env.MARKET_DATA_GITHUB_TOKEN) return { status: "PENDING_SECRET" as const, path };
  const current = await readGithubFile(env, path);
  if (current.exists) return { status: "EXISTS" as const, path, sha: current.sha };
  return writeGithubFile(env, path, content, message);
}

async function readGithubJson(env: Env, path: string): Promise<any | null> {
  const current = await readGithubFile(env, path);
  if (!current.exists || !current.content) return null;
  try { return JSON.parse(current.content); } catch { return null; }
}

function dailyRoot(tradeDate: string): string {
  const [year, month, day] = tradeDate.split("-");
  return `data/market/tw/daily/${year}/${month}/${day}`;
}

function emptyManifest(tradeDate: string): DailyManifest {
  return {
    schema_version: SCHEMA_VERSION,
    trade_date: tradeDate,
    generated_at: new Date().toISOString(),
    universe: "TWSE+TPEx COMMON_STOCK (4-digit, non-zero-leading symbol)",
    overall: "READY_WITH_PENDING",
    datasets: {},
  };
}

async function loadManifest(env: Env, tradeDate: string): Promise<DailyManifest> {
  const value = await readGithubJson(env, `${dailyRoot(tradeDate)}/manifest.json`);
  if (!value || record(value).schema_version !== SCHEMA_VERSION) return emptyManifest(tradeDate);
  return value as DailyManifest;
}

function datasetReady(dataset: any, accepted: string[]): boolean {
  const sources = Array.isArray(record(dataset).sources) ? record(dataset).sources : [];
  if (sources.length < 2) return false;
  return sources.every((source: any) => accepted.includes(String(record(source).status ?? "")));
}

export function marketDayOverallFromDatasets(datasets: Record<string, any>): DailyManifest["overall"] {
  const symbolMasterReady = datasetReady(datasets.symbol_master, ["READY"]);
  const institutionalReady = datasetReady(datasets.institutional, ["FINAL", "READY"]);
  const marginReady = datasetReady(datasets.margin, ["FINAL", "READY"]);
  return symbolMasterReady && institutionalReady && marginReady
    ? "MARKET_DAY_VERIFIED"
    : "READY_WITH_PENDING";
}

function recalcOverall(manifest: DailyManifest) {
  manifest.overall = marketDayOverallFromDatasets(manifest.datasets);
  manifest.generated_at = new Date().toISOString();
}

async function saveManifest(env: Env, manifest: DailyManifest) {
  recalcOverall(manifest);
  const path = `${dailyRoot(manifest.trade_date)}/manifest.json`;
  return writeGithubFile(env, path, `${JSON.stringify(manifest, null, 2)}\n`, `data: update Taiwan market manifest ${manifest.trade_date}`);
}

export function normalizeTwseInstitutional(body: unknown): InstitutionalRow[] {
  const root = record(body);
  const fields = Array.isArray(root.fields) ? root.fields.map(String) : [];
  const rawRows = Array.isArray(root.data) ? root.data : [];
  return rawRows.map((item: unknown) => {
    const values = Array.isArray(item) ? item : [];
    const raw = Object.fromEntries(fields.map((field, index) => [field, values[index]]));
    const symbol = String(pick(raw, ["證券代號", "股票代號", "Code"]) ?? "").trim();
    return {
      symbol,
      market: "TWSE" as const,
      name: String(pick(raw, ["證券名稱", "股票名稱", "Name"]) ?? "").trim(),
      foreignNet: numberValue(pick(raw, ["外陸資買賣超股數(不含外資自營商)", "外陸資買賣超股數", "外資及陸資買賣超股數"])),
      trustNet: numberValue(pick(raw, ["投信買賣超股數", "投信買賣超"])),
      dealerNet: numberValue(pick(raw, ["自營商買賣超股數", "自營商買賣超"])),
    };
  }).filter((row) => ordinaryStock(row.symbol));
}

export function normalizeTpexInstitutional(body: unknown): InstitutionalRow[] {
  return rows(body).flatMap((raw) => {
    const symbol = String(pick(raw, ["SecuritiesCompanyCode", "SecurityCode", "Code", "證券代號", "股票代號", "代號"]) ?? "").trim();
    if (!ordinaryStock(symbol)) return [];
    const foreignRaw = pick(raw, [
      "Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference",
      "ForeignInvestorsInclude MainlandAreaInvestors-Difference",
      "ForeignInvestorsNetBuySell",
      "ForeignAndMainlandAreaInvestorsNetBuySell",
    ]);
    const trustRaw = pick(raw, [
      "SecuritiesInvestmentTrustCompanies-Difference",
      "InvestmentTrustNetBuySell",
      "SecuritiesInvestmentTrustCompaniesNetBuySell",
    ]);
    const dealerRaw = pick(raw, ["Dealers-Difference", "DealerNetBuySell", "DealersNetBuySell"]);
    if (foreignRaw === undefined || trustRaw === undefined || dealerRaw === undefined) return [];
    return [{
      symbol,
      market: "TPEx" as const,
      name: String(pick(raw, ["CompanyName", "SecurityName", "Name", "證券名稱", "股票名稱", "名稱"]) ?? "").trim(),
      foreignNet: numberValue(foreignRaw),
      trustNet: numberValue(trustRaw),
      dealerNet: numberValue(dealerRaw),
    }];
  });
}

export function normalizeTwseMargin(body: unknown): MarginRow[] {
  const root = record(body);
  const tables = Array.isArray(root.tables) ? root.tables : [];
  const table = tables.map(record).find((item) => String(item.title ?? "").includes("融資融券彙總"));
  if (!table) return [];
  const fields = Array.isArray(table.fields) ? table.fields.map(String) : [];
  return (Array.isArray(table.data) ? table.data : []).map((item: unknown) => {
    const values = Array.isArray(item) ? item : [];
    const raw = Object.fromEntries(fields.map((field, index) => [field, values[index]]));
    const symbol = String(values[0] ?? pick(raw, ["股票代號", "證券代號"]) ?? "").trim();
    return {
      symbol,
      market: "TWSE" as const,
      name: String(values[1] ?? pick(raw, ["股票名稱", "證券名稱"]) ?? "").trim(),
      marginPrev: numberValue(values[5] ?? pick(raw, ["融資前日餘額"])),
      marginBuy: numberValue(values[2] ?? pick(raw, ["融資買進"])),
      marginSell: numberValue(values[3] ?? pick(raw, ["融資賣出"])),
      marginCashRepay: numberValue(values[4] ?? pick(raw, ["融資現金償還"])),
      marginBalance: numberValue(values[6] ?? pick(raw, ["融資今日餘額", "融資當日餘額"])),
      shortPrev: numberValue(values[11] ?? pick(raw, ["融券前日餘額"])),
      shortSell: numberValue(values[8] ?? pick(raw, ["融券賣出"])),
      shortBuy: numberValue(values[9] ?? pick(raw, ["融券買進"])),
      shortRepay: numberValue(values[10] ?? pick(raw, ["融券現券償還"])),
      shortBalance: numberValue(values[12] ?? pick(raw, ["融券今日餘額", "融券當日餘額"])),
    };
  }).filter((row) => ordinaryStock(row.symbol));
}

export function normalizeTpexMargin(body: unknown): MarginRow[] {
  return rows(body).flatMap((raw) => {
    const symbol = String(pick(raw, ["SecuritiesCompanyCode", "SecurityCode", "Code", "證券代號", "股票代號", "代號"]) ?? "").trim();
    if (!ordinaryStock(symbol)) return [];
    const required = {
      marginPrev: pick(raw, ["MarginPurchaseBalancePreviousDay", "MarginPurchasePreviousBalance", "MarginPreviousBalance"]),
      marginBuy: pick(raw, ["MarginPurchase", "MarginBuy"]),
      marginSell: pick(raw, ["MarginSales", "MarginSale", "MarginSell"]),
      marginCashRepay: pick(raw, ["CashRedemption", "MarginCashRepay"]),
      marginBalance: pick(raw, ["MarginPurchaseBalance", "MarginPurchaseCurrentBalance", "MarginBalance"]),
      shortPrev: pick(raw, ["ShortSaleBalancePreviousDay", "ShortSalePreviousBalance", "ShortPreviousBalance"]),
      shortSell: pick(raw, ["ShortSale", "ShortSell"]),
      shortBuy: pick(raw, ["ShortConvering", "ShortCover", "ShortBuy"]),
      shortRepay: pick(raw, ["StockRedemption", "ShortRepay"]),
      shortBalance: pick(raw, ["ShortSaleBalance", "ShortSaleCurrentBalance", "ShortBalance"]),
    };
    if (Object.values(required).some((value) => value === undefined)) return [];
    return [{
      symbol,
      market: "TPEx" as const,
      name: String(pick(raw, ["CompanyName", "SecurityName", "Name", "證券名稱", "股票名稱", "名稱"]) ?? "").trim(),
      marginPrev: numberValue(required.marginPrev),
      marginBuy: numberValue(required.marginBuy),
      marginSell: numberValue(required.marginSell),
      marginCashRepay: numberValue(required.marginCashRepay),
      marginBalance: numberValue(required.marginBalance),
      shortPrev: numberValue(required.shortPrev),
      shortSell: numberValue(required.shortSell),
      shortBuy: numberValue(required.shortBuy),
      shortRepay: numberValue(required.shortRepay),
      shortBalance: numberValue(required.shortBalance),
    }];
  });
}

export function classifyOfficialEvent(raw: JsonRecord, market: Market, fallbackDate: string): OfficialEvent | null {
  const symbol = String(pick(raw, ["公司代號", "股票代號", "證券代號", "SecuritiesCompanyCode", "CompanyCode", "Code"]) ?? "").trim();
  if (!ordinaryStock(symbol)) return null;
  const title = String(pick(raw, ["主旨", "Title", "Subject", "說明", "Description"]) ?? "").trim();
  const description = String(pick(raw, ["說明", "Description", "內容", "Content"]) ?? "").trim();
  const eventDate = dateFromUnknown(pick(raw, ["發言日期", "公告日期", "事實發生日", "Date", "AnnounceDate"]), fallbackDate);
  const eventTimeRaw = String(pick(raw, ["發言時間", "Time", "AnnounceTime"]) ?? "").trim();
  const eventType = /法人說明會|法說會|業績發表會|investor\s*conference/i.test(`${title} ${description}`)
    ? "INVESTOR_CONFERENCE"
    : "MATERIAL_INFORMATION";
  const seed = `${market}|${symbol}|${eventDate}|${eventTimeRaw}|${title}|${description}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return {
    eventId: `${market}:${symbol}:${eventDate}:${(hash >>> 0).toString(16)}`,
    market,
    symbol,
    eventDate,
    eventTime: eventTimeRaw || null,
    eventType,
    title: title || description.slice(0, 160),
  };
}

function normalizeSymbolMaster(body: unknown, market: Market) {
  return rows(body).map((raw) => {
    const symbol = String(pick(raw, ["公司代號", "股票代號", "證券代號", "SecuritiesCompanyCode", "CompanyCode", "Code"]) ?? "").trim();
    return {
      symbol,
      market,
      name: String(pick(raw, ["公司名稱", "公司簡稱", "股票名稱", "證券名稱", "CompanyName", "Name"]) ?? "").trim(),
      industry: String(pick(raw, ["產業別", "產業類別", "Industry", "IndustryName"]) ?? "").trim(),
      security_type: "COMMON_STOCK",
    };
  }).filter((row) => ordinaryStock(row.symbol));
}

async function fetchSource<T>(
  market: Market,
  url: string,
  tradeDate: string,
  normalize: (body: unknown) => T[],
  options: { requirePayloadDate?: boolean; readyStatus?: SourceState["status"] } = {},
): Promise<{ state: SourceState; rows: T[] }> {
  try {
    const body = await officialJson(url, `${market} market data`);
    const sourceSha = await sha256Text(JSON.stringify(body));
    const servedDate = options.requirePayloadDate ? payloadDataDate(body) : tradeDate;
    if (options.requirePayloadDate && (!servedDate || servedDate !== tradeDate)) {
      return {
        state: {
          market,
          status: "PENDING",
          data_date: servedDate || null,
          row_count: 0,
          source_url: url,
          source_sha256: sourceSha,
          error: `${market} served ${servedDate || "UNKNOWN"}; requested ${tradeDate}`,
        },
        rows: [],
      };
    }
    const normalized = normalize(body);
    if (!normalized.length) throw new Error("normalized ordinary-stock rows = 0");
    return {
      state: {
        market,
        status: options.readyStatus ?? "READY",
        data_date: tradeDate,
        row_count: normalized.length,
        source_url: url,
        source_sha256: sourceSha,
      },
      rows: normalized,
    };
  } catch (error) {
    return {
      state: {
        market,
        status: "PENDING",
        data_date: null,
        row_count: 0,
        source_url: url,
        error: error instanceof Error ? error.message : String(error),
      },
      rows: [],
    };
  }
}

async function collectSymbolMaster(env: Env, tradeDate: string) {
  const sources: Array<{ market: Market; url: string }> = [
    { market: "TWSE", url: `${TWSE_OPENAPI}/opendata/t187ap03_L` },
    { market: "TPEx", url: `${TPEX_OPENAPI}/mopsfin_t187ap03_O` },
  ];
  const allRows: any[] = [];
  const states: SourceState[] = [];
  for (const source of sources) {
    const result = await fetchSource(source.market, source.url, tradeDate, (body) => normalizeSymbolMaster(body, source.market));
    states.push(result.state);
    allRows.push(...result.rows);
  }
  const payload = { schema_version: SCHEMA_VERSION, updated_at: new Date().toISOString(), sources: states, rows: allRows };
  const archive = await writeGithubFile(env, "data/market/tw/reference/symbol-master.json", `${JSON.stringify(payload, null, 2)}\n`, "data: update Taiwan stock symbol master");
  return { sources: states, row_count: allRows.length, archive };
}

async function collectInstitutional(env: Env, tradeDate: string, final: boolean) {
  const compact = compactDate(tradeDate);
  const twseUrl = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${compact}&selectType=ALLBUT0999&response=json`;
  const tpexUrl = `${TPEX_OPENAPI}/tpex_3insti_daily_trading`;
  const twse = await fetchSource("TWSE", twseUrl, tradeDate, normalizeTwseInstitutional, { readyStatus: final ? "FINAL" : "PRELIMINARY" });
  const tpex = await fetchSource("TPEx", tpexUrl, tradeDate, normalizeTpexInstitutional, { requirePayloadDate: true, readyStatus: final ? "FINAL" : "PRELIMINARY" });
  const payload = {
    schema_version: SCHEMA_VERSION,
    trade_date: tradeDate,
    phase: final ? "FINAL" : "PRELIMINARY",
    fetched_at: new Date().toISOString(),
    sources: [twse.state, tpex.state],
    rows: [...twse.rows, ...tpex.rows],
  };
  const archive = await writeGithubFile(env, `${dailyRoot(tradeDate)}/institutional.json`, `${JSON.stringify(payload, null, 2)}\n`, `data: ${final ? "final" : "preliminary"} institutional ${tradeDate}`);
  return { ...payload, archive };
}

async function collectMargin(env: Env, tradeDate: string) {
  const compact = compactDate(tradeDate);
  const twseUrl = `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${compact}&selectType=ALL&response=json`;
  const tpexUrl = `${TPEX_OPENAPI}/tpex_mainboard_margin_balance`;
  const twse = await fetchSource("TWSE", twseUrl, tradeDate, normalizeTwseMargin, { readyStatus: "FINAL" });
  const tpex = await fetchSource("TPEx", tpexUrl, tradeDate, normalizeTpexMargin, { requirePayloadDate: true, readyStatus: "FINAL" });
  const payload = {
    schema_version: SCHEMA_VERSION,
    trade_date: tradeDate,
    fetched_at: new Date().toISOString(),
    sources: [twse.state, tpex.state],
    rows: [...twse.rows, ...tpex.rows],
  };
  const archive = await writeGithubFile(env, `${dailyRoot(tradeDate)}/margin.json`, `${JSON.stringify(payload, null, 2)}\n`, `data: margin ${tradeDate}`);
  return { ...payload, archive };
}

const FINANCIAL_ENDPOINTS: Array<{ market: Market; dataset: string; url: string }> = [
  ...["basi", "bd", "ci", "fh", "ins", "mim"].flatMap((kind) => [
    { market: "TWSE" as const, dataset: `income_${kind}`, url: `${TWSE_OPENAPI}/opendata/t187ap06_L_${kind}` },
    { market: "TWSE" as const, dataset: `balance_${kind}`, url: `${TWSE_OPENAPI}/opendata/t187ap07_L_${kind}` },
  ]),
  ...["basi", "bd", "ci", "fh", "ins", "mim"].map((kind) => ({
    market: "TPEx" as const,
    dataset: `income_${kind}`,
    url: `${TPEX_OPENAPI}/mopsfin_t187ap06_O_${kind}`,
  })),
  ...([
    ["basi", "basi"],
    ["bd", "bd"],
    ["ci", "ci"],
    ["fh", "fh"],
    ["ins", "insA"],
    ["mim", "mimA"],
  ] as const).map(([datasetKind, endpointKind]) => ({
    market: "TPEx" as const,
    dataset: `balance_${datasetKind}`,
    url: `${TPEX_OPENAPI}/mopsfin_t187ap07_O_${endpointKind}`,
  })),
];

async function archiveFundamental(env: Env, dataset: string, market: Market, url: string) {
  try {
    const body = await officialJson(url, `${market} ${dataset}`);
    const rowCount = rows(body).length;
    if (!rowCount) throw new Error("rows = 0");
    const sha256 = await sha256Text(JSON.stringify(body));
    const path = `data/market/tw/fundamentals/${dataset}/${market.toLowerCase()}/${sha256}.json`;
    const archive = await writeGithubImmutable(env, path, `${JSON.stringify(body, null, 2)}\n`, `data: archive ${market} ${dataset} ${sha256.slice(0, 12)}`);
    return { market, dataset, status: archive.status === "PENDING_SECRET" ? "PENDING_SECRET" : "READY_AS_OF", row_count: rowCount, source_url: url, sha256, path, archive };
  } catch (error) {
    return { market, dataset, status: "PENDING", row_count: 0, source_url: url, error: error instanceof Error ? error.message : String(error) };
  }
}

async function collectFundamentals(env: Env) {
  const revenueSources: Array<{ market: Market; dataset: string; url: string }> = [
    { market: "TWSE", dataset: "revenue", url: `${TWSE_OPENAPI}/opendata/t187ap05_L` },
    { market: "TPEx", dataset: "revenue", url: `${TPEX_OPENAPI}/mopsfin_t187ap05_O` },
  ];
  const results = [];
  for (const source of [...revenueSources, ...FINANCIAL_ENDPOINTS]) {
    results.push(await archiveFundamental(env, source.dataset, source.market, source.url));
  }
  return { refreshed_at: new Date().toISOString(), datasets: results };
}

async function collectEvents(env: Env, tradeDate: string) {
  const sources: Array<{ market: Market; url: string }> = [
    { market: "TWSE", url: `${TWSE_OPENAPI}/opendata/t187ap04_L` },
    { market: "TPEx", url: `${TPEX_OPENAPI}/mopsfin_t187ap04_O` },
  ];
  const states: SourceState[] = [];
  const allEvents: OfficialEvent[] = [];
  for (const source of sources) {
    try {
      const body = await officialJson(source.url, `${source.market} events`);
      const sourceSha = await sha256Text(JSON.stringify(body));
      const events = rows(body)
        .map((row) => classifyOfficialEvent(row, source.market, tradeDate))
        .filter((event): event is OfficialEvent => Boolean(event))
        .filter((event) => event.eventDate === tradeDate);
      states.push({ market: source.market, status: "READY", data_date: tradeDate, row_count: events.length, source_url: source.url, source_sha256: sourceSha });
      allEvents.push(...events);
    } catch (error) {
      states.push({ market: source.market, status: "PENDING", data_date: null, row_count: 0, source_url: source.url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const payload = { schema_version: SCHEMA_VERSION, trade_date: tradeDate, fetched_at: new Date().toISOString(), sources: states, rows: allEvents };
  const archive = await writeGithubFile(env, `${dailyRoot(tradeDate)}/events.json`, `${JSON.stringify(payload, null, 2)}\n`, `data: official events ${tradeDate}`);
  return { ...payload, archive };
}

async function collectFundamentalsAndEvents(env: Env, tradeDate: string) {
  const symbolMaster = await collectSymbolMaster(env, tradeDate);
  const fundamentals = await collectFundamentals(env);
  const events = await collectEvents(env, tradeDate);
  return { symbolMaster, fundamentals, events };
}

async function applyResultToManifest(env: Env, tradeDate: string, phase: MarketDataPhase, result: any) {
  const manifest = await loadManifest(env, tradeDate);
  manifest.generated_at = new Date().toISOString();
  if (phase === "fundamentals") {
    manifest.datasets.symbol_master = {
      updated_at: new Date().toISOString(),
      sources: result.symbolMaster?.sources ?? [],
      row_count: result.symbolMaster?.row_count ?? 0,
      archive: result.symbolMaster?.archive ?? null,
    };
    manifest.datasets.fundamentals = {
      status: "AS_OF_NON_BLOCKING",
      refreshed_at: result.fundamentals?.refreshed_at ?? null,
      datasets: result.fundamentals?.datasets ?? [],
    };
    manifest.datasets.events = {
      status: "NON_BLOCKING",
      sources: result.events?.sources ?? [],
      row_count: Array.isArray(result.events?.rows) ? result.events.rows.length : 0,
      archive: result.events?.archive ?? null,
    };
  } else if (phase === "institutional_prelim" || phase === "institutional_final") {
    manifest.datasets.institutional = {
      phase: result.phase,
      fetched_at: result.fetched_at,
      sources: result.sources,
      row_count: Array.isArray(result.rows) ? result.rows.length : 0,
      archive: result.archive,
    };
  } else if (phase === "margin") {
    manifest.datasets.margin = {
      fetched_at: result.fetched_at,
      sources: result.sources,
      row_count: Array.isArray(result.rows) ? result.rows.length : 0,
      archive: result.archive,
    };
  }
  const manifestArchive = await saveManifest(env, manifest);
  return { manifest, manifestArchive };
}

export async function buildMarketDayManifest(env: Env, tradeDate: string) {
  const manifest = await loadManifest(env, tradeDate);
  recalcOverall(manifest);
  return manifest;
}

export async function getMarketDataStatus(env: Env, tradeDate = taipeiDate()) {
  const manifest = await loadManifest(env, tradeDate);
  recalcOverall(manifest);
  return {
    tradeDate,
    storage: "GitHub canonical",
    github_repo: githubRepo(env),
    github_branch: githubBranch(env),
    github_token: env.MARKET_DATA_GITHUB_TOKEN ? "configured" : "pending",
    manifest,
  };
}

export async function runMarketDataPipeline(env: Env, phase: MarketDataPhase, scheduledAt = new Date()) {
  const tradeDate = taipeiDate(scheduledAt);
  const runId = `${tradeDate}:${phase}:${new Date().toISOString()}`;
  try {
    if (!env.MARKET_DATA_GITHUB_TOKEN) {
      return {
        runId,
        tradeDate,
        phase,
        status: "PENDING_SECRET",
        error: "MARKET_DATA_GITHUB_TOKEN 尚未設定；Market Data V1 不使用 R2/Google Drive/D1 作 canonical storage",
      };
    }

    let result: any;
    if (phase === "fundamentals") {
      result = await collectFundamentalsAndEvents(env, tradeDate);
      const receipt = await applyResultToManifest(env, tradeDate, phase, result);
      return { runId, tradeDate, phase, status: "done", result, ...receipt };
    }
    if (phase === "institutional_prelim") {
      result = await collectInstitutional(env, tradeDate, false);
      const receipt = await applyResultToManifest(env, tradeDate, phase, result);
      return { runId, tradeDate, phase, status: "done", result, ...receipt };
    }
    if (phase === "institutional_final") {
      result = await collectInstitutional(env, tradeDate, true);
      const receipt = await applyResultToManifest(env, tradeDate, phase, result);
      return { runId, tradeDate, phase, status: "done", result, ...receipt };
    }
    if (phase === "margin") {
      result = await collectMargin(env, tradeDate);
      const receipt = await applyResultToManifest(env, tradeDate, phase, result);
      return { runId, tradeDate, phase, status: "done", result, ...receipt };
    }

    const institutional = await collectInstitutional(env, tradeDate, true);
    await applyResultToManifest(env, tradeDate, "institutional_final", institutional);
    const margin = await collectMargin(env, tradeDate);
    const receipt = await applyResultToManifest(env, tradeDate, "margin", margin);
    return {
      runId,
      tradeDate,
      phase,
      status: "done",
      institutional,
      margin,
      manifest: receipt.manifest,
      manifestArchive: receipt.manifestArchive,
    };
  } catch (error) {
    return {
      runId,
      tradeDate,
      phase,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function marketDataPhaseForCron(cron: string): MarketDataPhase | null {
  if (cron === "10 9 * * 1-5") return "fundamentals"; // 17:10 Asia/Taipei
  if (cron === "10 10 * * 1-5") return "institutional_prelim"; // 18:10
  if (cron === "10 12 * * 1-5") return "institutional_final"; // 20:10
  if (cron === "10 13 * * 1-5" || cron === "30 13 * * 1-5") return "margin"; // 21:10 / 21:30
  if (cron === "10 14 * * 1-5" || cron === "30 14 * * 1-5") return "finalize"; // 22:10 / 22:30
  return null;
}
