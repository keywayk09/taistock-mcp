import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fail, num, ok, rec, requireDb, taipeiDate, type Obj } from "../v6/common";
import { CORE_GLOBAL_COMPANIES, CORE_MEMBERSHIPS, CORE_THEMES } from "./global-seed";

const TWSE_COMPANY_URL = "https://openapi.twse.com.tw/v1/opendata/t187ap03_L";
const TPEX_COMPANY_URL = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O";
const ESB_COMPANY_URL = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_R";

const idSchema = z.string().trim().min(1).max(160);
const shortTextSchema = z.string().trim().max(300);
const dateOptionalSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const statusSchema = z.enum(["active", "pending", "stale", "archived", "rejected"]);
const evidenceLevelSchema = z.enum(["official", "high", "medium", "low", "rumor"]);
const themeTypeSchema = z.enum(["sector", "industry", "sub_industry", "theme", "product", "technology", "supply_chain", "official_industry"]);
const relationTypeSchema = z.enum([
  "supplier_of",
  "customer_of",
  "manufactures_for",
  "provides_equipment_to",
  "provides_material_to",
  "technology_partner",
  "competitor",
  "substitute",
  "indirect_supplier",
  "ecosystem_member",
  "rumored_supplier",
]);

const companyInputSchema = z.object({
  company_id: idSchema,
  country: z.string().trim().min(2).max(10),
  exchange: z.string().trim().min(1).max(30),
  ticker: z.string().trim().min(1).max(40),
  company_name: z.string().trim().min(1).max(200),
  company_name_en: z.string().trim().max(200).optional().default(""),
  aliases: z.array(z.string().trim().min(1).max(200)).max(30).optional().default([]),
  official_industry: z.string().trim().max(200).optional().default(""),
  sub_industry: z.string().trim().max(200).optional().default(""),
  website: z.string().url().optional().or(z.literal("")),
  source_url: z.string().url().optional().or(z.literal("")),
  status: statusSchema.optional().default("active"),
});

const themeInputSchema = z.object({
  theme_id: idSchema,
  name_zh: z.string().trim().min(1).max(200),
  name_en: z.string().trim().max(200).optional().default(""),
  parent_theme_id: idSchema.nullable().optional().default(null),
  theme_type: themeTypeSchema.optional().default("theme"),
  aliases: z.array(z.string().trim().min(1).max(200)).max(30).optional().default([]),
  description: z.string().trim().max(3000).optional().default(""),
  status: statusSchema.optional().default("active"),
});

const membershipInputSchema = z.object({
  company_id: idSchema,
  theme_id: idSchema,
  role: z.string().trim().max(200).optional().default("成分股"),
  relevance_score: z.number().min(0).max(100).optional().default(50),
  evidence_level: evidenceLevelSchema.optional().default("medium"),
  status: statusSchema.optional().default("active"),
  valid_from: dateOptionalSchema,
  valid_to: dateOptionalSchema,
  last_verified_at: dateOptionalSchema,
  notes: z.string().trim().max(3000).optional().default(""),
});

const edgeInputSchema = z.object({
  edge_id: idSchema.optional(),
  source_company_id: idSchema,
  target_company_id: idSchema,
  relationship_type: relationTypeSchema,
  product: z.string().trim().max(300).optional().default(""),
  theme_id: idSchema.nullable().optional().default(null),
  confidence: z.number().min(0).max(100).optional().default(50),
  evidence_level: evidenceLevelSchema.optional().default("medium"),
  status: statusSchema.optional().default("active"),
  valid_from: dateOptionalSchema,
  valid_to: dateOptionalSchema,
  last_verified_at: dateOptionalSchema,
  notes: z.string().trim().max(3000).optional().default(""),
});

const evidenceInputSchema = z.object({
  evidence_id: idSchema.optional(),
  entity_type: z.enum(["company", "theme", "membership", "supply_chain_edge"]),
  entity_id: idSchema,
  source_type: z.enum(["company_filing", "annual_report", "investor_conference", "material_information", "company_website", "exchange", "regulator", "media", "research", "manual", "market_rumor"]),
  source_title: z.string().trim().max(500).optional().default(""),
  source_url: z.string().url().optional().or(z.literal("")),
  published_at: z.string().trim().max(40).optional().default(""),
  evidence_text: z.string().trim().min(1).max(8000),
  confidence: z.number().min(0).max(100).optional().default(50),
});

type CompanyInput = z.infer<typeof companyInputSchema>;
type ThemeInput = z.infer<typeof themeInputSchema>;
type MembershipInput = z.infer<typeof membershipInputSchema>;
type EdgeInput = z.infer<typeof edgeInputSchema>;
type EvidenceInput = z.infer<typeof evidenceInputSchema>;

let globalSchemaReady = false;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function valueByAliases(row: Obj, aliases: string[]) {
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== null && String(row[alias]).trim() !== "") return row[alias];
  }
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const normalized = alias.replace(/\s+/g, "").toLowerCase();
    const key = keys.find((candidate) => candidate.replace(/\s+/g, "").toLowerCase() === normalized);
    if (key) return row[key];
  }
  return "";
}

function normalizedDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const match = text.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function deterministicId(prefix: string, values: string[]) {
  const raw = values.join("|").trim().toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index++) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

async function fetchRows(url: string) {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "taistock-mcp/8.0" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text);
  if (!Array.isArray(body)) throw new Error(`官方公司清單格式錯誤：${url}`);
  return body.map((row) => rec(row));
}

function normalizeTaiwanCompany(row: Obj, exchange: "TWSE" | "TPEX" | "ESB", sourceUrl: string): CompanyInput | null {
  const ticker = String(valueByAliases(row, ["公司代號", "公司代碼", "SecuritiesCompanyCode", "Code", "股票代號"])).trim();
  const companyName = String(valueByAliases(row, ["公司簡稱", "公司名稱", "CompanyName", "Name"])).trim();
  if (!ticker || !companyName || !/^[0-9A-Za-z.-]+$/.test(ticker)) return null;
  const fullName = String(valueByAliases(row, ["公司名稱", "公司簡稱", "CompanyName"])).trim() || companyName;
  const english = String(valueByAliases(row, ["英文簡稱", "英文名稱", "英文全名", "EnglishName"])).trim();
  const industry = String(valueByAliases(row, ["產業別", "產業類別", "Industry"])).trim();
  const website = String(valueByAliases(row, ["網址", "公司網址", "Website"])).trim();
  return {
    company_id: `TW:${exchange}:${ticker}`,
    country: "TW",
    exchange,
    ticker,
    company_name: companyName,
    company_name_en: english,
    aliases: [...new Set([fullName, english].filter(Boolean))],
    official_industry: industry,
    sub_industry: "",
    website: /^https?:\/\//i.test(website) ? website : website ? `https://${website}` : "",
    source_url: sourceUrl,
    status: "active",
  };
}

async function upsertCompany(db: D1Database, company: CompanyInput) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO global_companies
    (company_id, country, exchange, ticker, company_name, company_name_en, aliases_json, official_industry, sub_industry, website, source_url, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id) DO UPDATE SET
      country=excluded.country, exchange=excluded.exchange, ticker=excluded.ticker,
      company_name=excluded.company_name, company_name_en=excluded.company_name_en,
      aliases_json=excluded.aliases_json, official_industry=excluded.official_industry,
      sub_industry=excluded.sub_industry, website=excluded.website, source_url=excluded.source_url,
      status=excluded.status, updated_at=excluded.updated_at`)
    .bind(company.company_id, company.country, company.exchange, company.ticker, company.company_name,
      company.company_name_en ?? "", JSON.stringify(company.aliases ?? []), company.official_industry ?? "",
      company.sub_industry ?? "", company.website ?? "", company.source_url ?? "", company.status ?? "active", now, now).run();
}

async function upsertTheme(db: D1Database, theme: ThemeInput) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO industry_themes
    (theme_id, name_zh, name_en, parent_theme_id, theme_type, aliases_json, description, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(theme_id) DO UPDATE SET
      name_zh=excluded.name_zh, name_en=excluded.name_en, parent_theme_id=excluded.parent_theme_id,
      theme_type=excluded.theme_type, aliases_json=excluded.aliases_json, description=excluded.description,
      status=excluded.status, updated_at=excluded.updated_at`)
    .bind(theme.theme_id, theme.name_zh, theme.name_en ?? "", theme.parent_theme_id ?? null,
      theme.theme_type ?? "theme", JSON.stringify(theme.aliases ?? []), theme.description ?? "",
      theme.status ?? "active", now, now).run();
}

async function upsertMembership(db: D1Database, membership: MembershipInput) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO company_theme_memberships
    (company_id, theme_id, role, relevance_score, evidence_level, status, valid_from, valid_to, last_verified_at, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, theme_id) DO UPDATE SET
      role=excluded.role, relevance_score=excluded.relevance_score, evidence_level=excluded.evidence_level,
      status=excluded.status, valid_from=excluded.valid_from, valid_to=excluded.valid_to,
      last_verified_at=excluded.last_verified_at, notes=excluded.notes, updated_at=excluded.updated_at`)
    .bind(membership.company_id, membership.theme_id, membership.role ?? "成分股", membership.relevance_score ?? 50,
      membership.evidence_level ?? "medium", membership.status ?? "active", membership.valid_from ?? null,
      membership.valid_to ?? null, membership.last_verified_at ?? taipeiDate(), membership.notes ?? "", now, now).run();
}

async function upsertEdge(db: D1Database, edge: EdgeInput) {
  const edgeId = edge.edge_id ?? deterministicId("edge", [edge.source_company_id, edge.target_company_id, edge.relationship_type, edge.product ?? "", edge.theme_id ?? ""]);
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO supply_chain_edges
    (edge_id, source_company_id, target_company_id, relationship_type, product, theme_id, confidence, evidence_level, status, valid_from, valid_to, last_verified_at, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(edge_id) DO UPDATE SET
      source_company_id=excluded.source_company_id, target_company_id=excluded.target_company_id,
      relationship_type=excluded.relationship_type, product=excluded.product, theme_id=excluded.theme_id,
      confidence=excluded.confidence, evidence_level=excluded.evidence_level, status=excluded.status,
      valid_from=excluded.valid_from, valid_to=excluded.valid_to, last_verified_at=excluded.last_verified_at,
      notes=excluded.notes, updated_at=excluded.updated_at`)
    .bind(edgeId, edge.source_company_id, edge.target_company_id, edge.relationship_type, edge.product ?? "",
      edge.theme_id ?? null, edge.confidence ?? 50, edge.evidence_level ?? "medium", edge.status ?? "active",
      edge.valid_from ?? null, edge.valid_to ?? null, edge.last_verified_at ?? taipeiDate(), edge.notes ?? "", now, now).run();
  return edgeId;
}

async function addEvidence(db: D1Database, evidence: EvidenceInput) {
  const evidenceId = evidence.evidence_id ?? deterministicId("evidence", [evidence.entity_type, evidence.entity_id, evidence.source_url ?? "", evidence.evidence_text]);
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO industry_evidence
    (evidence_id, entity_type, entity_id, source_type, source_title, source_url, published_at, evidence_text, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(evidence_id) DO UPDATE SET
      source_type=excluded.source_type, source_title=excluded.source_title, source_url=excluded.source_url,
      published_at=excluded.published_at, evidence_text=excluded.evidence_text, confidence=excluded.confidence`)
    .bind(evidenceId, evidence.entity_type, evidence.entity_id, evidence.source_type, evidence.source_title ?? "",
      evidence.source_url ?? "", evidence.published_at ?? "", evidence.evidence_text, evidence.confidence ?? 50, now).run();
  return evidenceId;
}

async function seedCoreKnowledge(db: D1Database) {
  for (const theme of CORE_THEMES) {
    await upsertTheme(db, { ...theme, status: "active" });
  }
  for (const company of CORE_GLOBAL_COMPANIES) {
    await upsertCompany(db, { ...company, source_url: company.website, status: "active" });
  }
  for (const membership of CORE_MEMBERSHIPS) {
    await upsertMembership(db, { ...membership, status: "active", last_verified_at: taipeiDate(), notes: "V8核心全球產業種子資料；後續以公司公告與官方文件持續驗證。" });
  }
}

export async function ensureGlobalIndustrySchema(env: Env) {
  const db = requireDb(env);
  if (globalSchemaReady) return db;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS global_companies (
      company_id TEXT PRIMARY KEY,
      country TEXT NOT NULL,
      exchange TEXT NOT NULL,
      ticker TEXT NOT NULL,
      company_name TEXT NOT NULL,
      company_name_en TEXT NOT NULL DEFAULT '',
      aliases_json TEXT NOT NULL DEFAULT '[]',
      official_industry TEXT NOT NULL DEFAULT '',
      sub_industry TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_global_company_market_ticker ON global_companies(country, exchange, ticker);
    CREATE INDEX IF NOT EXISTS idx_global_company_name ON global_companies(company_name);
    CREATE INDEX IF NOT EXISTS idx_global_company_country ON global_companies(country, exchange);

    CREATE TABLE IF NOT EXISTS industry_themes (
      theme_id TEXT PRIMARY KEY,
      name_zh TEXT NOT NULL,
      name_en TEXT NOT NULL DEFAULT '',
      parent_theme_id TEXT,
      theme_type TEXT NOT NULL DEFAULT 'theme',
      aliases_json TEXT NOT NULL DEFAULT '[]',
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_industry_theme_parent ON industry_themes(parent_theme_id);
    CREATE INDEX IF NOT EXISTS idx_industry_theme_name ON industry_themes(name_zh);

    CREATE TABLE IF NOT EXISTS company_theme_memberships (
      company_id TEXT NOT NULL,
      theme_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '成分股',
      relevance_score REAL NOT NULL DEFAULT 50,
      evidence_level TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'active',
      valid_from TEXT,
      valid_to TEXT,
      last_verified_at TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (company_id, theme_id)
    );
    CREATE INDEX IF NOT EXISTS idx_membership_theme ON company_theme_memberships(theme_id, status, relevance_score DESC);
    CREATE INDEX IF NOT EXISTS idx_membership_company ON company_theme_memberships(company_id, status);

    CREATE TABLE IF NOT EXISTS supply_chain_edges (
      edge_id TEXT PRIMARY KEY,
      source_company_id TEXT NOT NULL,
      target_company_id TEXT NOT NULL,
      relationship_type TEXT NOT NULL,
      product TEXT NOT NULL DEFAULT '',
      theme_id TEXT,
      confidence REAL NOT NULL DEFAULT 50,
      evidence_level TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'active',
      valid_from TEXT,
      valid_to TEXT,
      last_verified_at TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_supply_source ON supply_chain_edges(source_company_id, status);
    CREATE INDEX IF NOT EXISTS idx_supply_target ON supply_chain_edges(target_company_id, status);
    CREATE INDEX IF NOT EXISTS idx_supply_theme ON supply_chain_edges(theme_id, status);

    CREATE TABLE IF NOT EXISTS industry_evidence (
      evidence_id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_title TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      published_at TEXT NOT NULL DEFAULT '',
      evidence_text TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 50,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_industry_evidence_entity ON industry_evidence(entity_type, entity_id, published_at DESC);

    CREATE TABLE IF NOT EXISTS classification_candidates (
      candidate_id TEXT PRIMARY KEY,
      candidate_type TEXT NOT NULL,
      company_id TEXT,
      theme_id TEXT,
      payload_json TEXT NOT NULL,
      proposed_by TEXT NOT NULL DEFAULT 'mcp',
      confidence REAL NOT NULL DEFAULT 50,
      status TEXT NOT NULL DEFAULT 'pending',
      review_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      reviewed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_classification_candidate_status ON classification_candidates(status, confidence DESC);

    CREATE TABLE IF NOT EXISTS theme_daily_metrics (
      theme_id TEXT NOT NULL,
      metric_date TEXT NOT NULL,
      market TEXT NOT NULL DEFAULT 'TW',
      member_count INTEGER NOT NULL DEFAULT 0,
      advancers INTEGER NOT NULL DEFAULT 0,
      decliners INTEGER NOT NULL DEFAULT 0,
      median_change_percent REAL,
      average_change_percent REAL,
      total_trade_value REAL,
      volume_ratio REAL,
      turnover_rate REAL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      PRIMARY KEY (theme_id, metric_date, market)
    );

    CREATE TABLE IF NOT EXISTS knowledge_import_runs (
      run_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      companies INTEGER NOT NULL DEFAULT 0,
      themes INTEGER NOT NULL DEFAULT 0,
      memberships INTEGER NOT NULL DEFAULT 0,
      edges INTEGER NOT NULL DEFAULT 0,
      evidence INTEGER NOT NULL DEFAULT 0,
      errors_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
  `);
  await seedCoreKnowledge(db);
  globalSchemaReady = true;
  return db;
}

async function ensureOfficialIndustry(db: D1Database, company: CompanyInput) {
  if (!company.official_industry) return;
  const themeId = `official.tw.${company.exchange.toLowerCase()}.${company.official_industry}`;
  await upsertTheme(db, {
    theme_id: themeId,
    name_zh: company.official_industry,
    name_en: "",
    parent_theme_id: null,
    theme_type: "official_industry",
    aliases: [],
    description: `${company.exchange} 官方產業分類`,
    status: "active",
  });
  await upsertMembership(db, {
    company_id: company.company_id,
    theme_id: themeId,
    role: "官方產業分類",
    relevance_score: 100,
    evidence_level: "official",
    status: "active",
    last_verified_at: taipeiDate(),
    notes: company.source_url ?? "",
  });
}

export async function syncTaiwanCompanyUniverse(env: Env) {
  const db = await ensureGlobalIndustrySchema(env);
  const sources = [
    { exchange: "TWSE" as const, url: TWSE_COMPANY_URL },
    { exchange: "TPEX" as const, url: TPEX_COMPANY_URL },
    { exchange: "ESB" as const, url: ESB_COMPANY_URL },
  ];
  const result: Record<string, number> = {};
  const errors: { exchange: string; error: string }[] = [];
  for (const source of sources) {
    try {
      const rawRows = await fetchRows(source.url);
      const rows = rawRows.map((row) => normalizeTaiwanCompany(row, source.exchange, source.url)).filter((row): row is CompanyInput => Boolean(row));
      for (const company of rows) {
        await upsertCompany(db, company);
        await ensureOfficialIndustry(db, company);
      }
      result[source.exchange] = rows.length;
    } catch (error) {
      errors.push({ exchange: source.exchange, error: errorText(error) });
      result[source.exchange] = 0;
    }
  }
  const total = Object.values(result).reduce((sum, value) => sum + value, 0);
  if (!total) throw new Error(`台股公司主檔同步全部失敗：${JSON.stringify(errors)}`);
  return { synced_at: new Date().toISOString(), counts: result, total, partial_errors: errors };
}

async function queryAll(db: D1Database, sql: string, values: unknown[] = []) {
  return (await db.prepare(sql).bind(...values).all<Obj>()).results ?? [];
}

async function queryFirst(db: D1Database, sql: string, values: unknown[] = []) {
  return await db.prepare(sql).bind(...values).first<Obj>();
}

export function registerGlobalIndustryTools(server: McpServer, env: Env) {
  server.registerTool("initialize_global_industry_map", {
    description: "初始化全球產業鏈、題材族群與證據資料庫；可同步全部上市、上櫃與興櫃公司主檔。",
    inputSchema: { sync_taiwan: z.boolean().optional().default(true) },
  }, async ({ sync_taiwan }) => {
    try {
      const db = await ensureGlobalIndustrySchema(env);
      const taiwan = sync_taiwan ? await syncTaiwanCompanyUniverse(env) : null;
      const [companies, themes, memberships] = await Promise.all([
        queryFirst(db, "SELECT COUNT(*) count FROM global_companies"),
        queryFirst(db, "SELECT COUNT(*) count FROM industry_themes"),
        queryFirst(db, "SELECT COUNT(*) count FROM company_theme_memberships"),
      ]);
      return ok({
        architecture: "global industry knowledge graph",
        countries: ["TW", "US", "JP", "KR", "NL"],
        core_seed: { companies: num(companies?.count), themes: num(themes?.count), memberships: num(memberships?.count) },
        taiwan_sync: taiwan,
        policy: "官方產業全量同步；題材與供應鏈採證據、信心、有效期間及審核狀態管理。",
      });
    } catch (error) { return fail(error); }
  });

  server.registerTool("sync_taiwan_company_universe", {
    description: "從TWSE與TPEx官方OpenAPI同步全部上市、上櫃及興櫃公司，並建立官方產業分類。",
    inputSchema: {},
  }, async () => {
    try { return ok(await syncTaiwanCompanyUniverse(env)); }
    catch (error) { return fail(error); }
  });

  server.registerTool("import_global_industry_batch", {
    description: "批次匯入全球公司、題材、公司題材關係、供應鏈邊與證據；用於一次性資料建置與後續增量更新。",
    inputSchema: {
      source: z.string().trim().min(1).max(200).optional().default("manual_batch"),
      companies: z.array(companyInputSchema).max(500).optional().default([]),
      themes: z.array(themeInputSchema).max(500).optional().default([]),
      memberships: z.array(membershipInputSchema).max(1000).optional().default([]),
      edges: z.array(edgeInputSchema).max(1000).optional().default([]),
      evidence: z.array(evidenceInputSchema).max(1000).optional().default([]),
    },
  }, async ({ source, companies, themes, memberships, edges, evidence }) => {
    try {
      const db = await ensureGlobalIndustrySchema(env);
      const errors: string[] = [];
      for (const row of companies) { try { await upsertCompany(db, row); } catch (error) { errors.push(`company ${row.company_id}: ${errorText(error)}`); } }
      for (const row of themes) { try { await upsertTheme(db, row); } catch (error) { errors.push(`theme ${row.theme_id}: ${errorText(error)}`); } }
      for (const row of memberships) { try { await upsertMembership(db, row); } catch (error) { errors.push(`membership ${row.company_id}/${row.theme_id}: ${errorText(error)}`); } }
      for (const row of edges) { try { await upsertEdge(db, row); } catch (error) { errors.push(`edge ${row.source_company_id}/${row.target_company_id}: ${errorText(error)}`); } }
      for (const row of evidence) { try { await addEvidence(db, row); } catch (error) { errors.push(`evidence ${row.entity_id}: ${errorText(error)}`); } }
      const runId = crypto.randomUUID();
      await db.prepare(`INSERT INTO knowledge_import_runs
        (run_id, source, companies, themes, memberships, edges, evidence, errors_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(runId, source, companies.length, themes.length, memberships.length, edges.length, evidence.length, JSON.stringify(errors), new Date().toISOString()).run();
      return ok({ run_id: runId, source, imported: { companies: companies.length, themes: themes.length, memberships: memberships.length, edges: edges.length, evidence: evidence.length }, errors });
    } catch (error) { return fail(error); }
  });

  server.registerTool("upsert_global_company", {
    description: "新增或更新全球公司主檔。",
    inputSchema: companyInputSchema.shape,
  }, async (input) => {
    try {
      const company = companyInputSchema.parse(input);
      const db = await ensureGlobalIndustrySchema(env);
      await upsertCompany(db, company);
      return ok({ company_id: company.company_id, saved: true });
    } catch (error) { return fail(error); }
  });

  server.registerTool("upsert_industry_theme", {
    description: "新增或更新產業、產品、技術、題材或供應鏈分類。",
    inputSchema: themeInputSchema.shape,
  }, async (input) => {
    try {
      const theme = themeInputSchema.parse(input);
      const db = await ensureGlobalIndustrySchema(env);
      await upsertTheme(db, theme);
      return ok({ theme_id: theme.theme_id, saved: true });
    } catch (error) { return fail(error); }
  });

  server.registerTool("set_company_theme_membership", {
    description: "設定公司與題材的正式關係、角色、關聯度、證據等級及有效期間。",
    inputSchema: membershipInputSchema.shape,
  }, async (input) => {
    try {
      const membership = membershipInputSchema.parse(input);
      const db = await ensureGlobalIndustrySchema(env);
      await upsertMembership(db, membership);
      return ok({ company_id: membership.company_id, theme_id: membership.theme_id, saved: true });
    } catch (error) { return fail(error); }
  });

  server.registerTool("set_supply_chain_edge", {
    description: "設定兩家公司之供應、客戶、代工、設備、材料、競爭或生態系關係。",
    inputSchema: edgeInputSchema.shape,
  }, async (input) => {
    try {
      const edge = edgeInputSchema.parse(input);
      const db = await ensureGlobalIndustrySchema(env);
      const edgeId = await upsertEdge(db, edge);
      return ok({ edge_id: edgeId, saved: true });
    } catch (error) { return fail(error); }
  });

  server.registerTool("add_industry_evidence", {
    description: "為公司、題材、分類關係或供應鏈關係保存官方文件、法說、年報、媒體或人工證據。",
    inputSchema: evidenceInputSchema.shape,
  }, async (input) => {
    try {
      const evidence = evidenceInputSchema.parse(input);
      const db = await ensureGlobalIndustrySchema(env);
      const evidenceId = await addEvidence(db, evidence);
      return ok({ evidence_id: evidenceId, saved: true });
    } catch (error) { return fail(error); }
  });

  server.registerTool("create_classification_candidate", {
    description: "建立待審核的題材分類或供應鏈候選；候選不會直接進入正式資料。",
    inputSchema: {
      candidate_type: z.enum(["membership", "supply_chain_edge"]),
      company_id: idSchema.optional(),
      theme_id: idSchema.optional(),
      payload: z.record(z.string(), z.any()),
      proposed_by: z.string().trim().max(100).optional().default("mcp"),
      confidence: z.number().min(0).max(100).optional().default(50),
    },
  }, async ({ candidate_type, company_id, theme_id, payload, proposed_by, confidence }) => {
    try {
      const db = await ensureGlobalIndustrySchema(env);
      const candidateId = crypto.randomUUID();
      await db.prepare(`INSERT INTO classification_candidates
        (candidate_id, candidate_type, company_id, theme_id, payload_json, proposed_by, confidence, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
        .bind(candidateId, candidate_type, company_id ?? null, theme_id ?? null, JSON.stringify(payload), proposed_by, confidence, new Date().toISOString()).run();
      return ok({ candidate_id: candidateId, status: "pending" });
    } catch (error) { return fail(error); }
  });

  server.registerTool("review_classification_candidate", {
    description: "核准或拒絕題材／供應鏈候選；核准後才寫入正式關係表。",
    inputSchema: {
      candidate_id: idSchema,
      decision: z.enum(["approve", "reject"]),
      review_note: z.string().trim().max(3000).optional().default(""),
    },
  }, async ({ candidate_id, decision, review_note }) => {
    try {
      const db = await ensureGlobalIndustrySchema(env);
      const candidate = await queryFirst(db, "SELECT * FROM classification_candidates WHERE candidate_id = ?", [candidate_id]);
      if (!candidate) throw new Error("找不到候選資料");
      if (candidate.status !== "pending") throw new Error(`候選已處理：${candidate.status}`);
      const payload = rec(JSON.parse(String(candidate.payload_json ?? "{}")));
      if (decision === "approve") {
        if (candidate.candidate_type === "membership") await upsertMembership(db, membershipInputSchema.parse(payload));
        else await upsertEdge(db, edgeInputSchema.parse(payload));
      }
      await db.prepare("UPDATE classification_candidates SET status = ?, review_note = ?, reviewed_at = ? WHERE candidate_id = ?")
        .bind(decision === "approve" ? "approved" : "rejected", review_note, new Date().toISOString(), candidate_id).run();
      return ok({ candidate_id, decision, applied: decision === "approve" });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_company_industry_map", {
    description: "查詢一家公司的完整全球產業、題材、供應鏈、角色與證據。",
    inputSchema: {
      company_id: idSchema.optional(),
      ticker: z.string().trim().max(40).optional(),
      country: z.string().trim().max(10).optional(),
      include_inactive: z.boolean().optional().default(false),
    },
  }, async ({ company_id, ticker, country, include_inactive }) => {
    try {
      if (!company_id && !ticker) throw new Error("company_id 或 ticker 至少提供一項");
      const db = await ensureGlobalIndustrySchema(env);
      const company = company_id
        ? await queryFirst(db, "SELECT * FROM global_companies WHERE company_id = ?", [company_id])
        : await queryFirst(db, "SELECT * FROM global_companies WHERE ticker = ? AND (? = '' OR country = ?) ORDER BY country = 'TW' DESC LIMIT 1", [ticker, country ?? "", country ?? ""]);
      if (!company) throw new Error("找不到公司");
      const statusFilter = include_inactive ? "" : " AND m.status = 'active'";
      const [memberships, outgoing, incoming, evidence] = await Promise.all([
        queryAll(db, `SELECT m.*, t.name_zh theme_name, t.name_en theme_name_en, t.theme_type, t.parent_theme_id
          FROM company_theme_memberships m JOIN industry_themes t ON t.theme_id = m.theme_id
          WHERE m.company_id = ?${statusFilter} ORDER BY m.relevance_score DESC, t.name_zh`, [company.company_id]),
        queryAll(db, `SELECT e.*, c.company_name target_company_name, c.ticker target_ticker, c.country target_country
          FROM supply_chain_edges e LEFT JOIN global_companies c ON c.company_id = e.target_company_id
          WHERE e.source_company_id = ?${include_inactive ? "" : " AND e.status = 'active'"} ORDER BY e.confidence DESC`, [company.company_id]),
        queryAll(db, `SELECT e.*, c.company_name source_company_name, c.ticker source_ticker, c.country source_country
          FROM supply_chain_edges e LEFT JOIN global_companies c ON c.company_id = e.source_company_id
          WHERE e.target_company_id = ?${include_inactive ? "" : " AND e.status = 'active'"} ORDER BY e.confidence DESC`, [company.company_id]),
        queryAll(db, "SELECT * FROM industry_evidence WHERE (entity_type = 'company' AND entity_id = ?) OR entity_id IN (SELECT company_id || '|' || theme_id FROM company_theme_memberships WHERE company_id = ?) ORDER BY published_at DESC, created_at DESC LIMIT 100", [company.company_id, company.company_id]),
      ]);
      return ok({ company, themes: memberships, supply_chain: { outgoing, incoming }, evidence });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_theme_industry_map", {
    description: "查詢題材樹、全球成分公司、供應鏈關係與相關證據。",
    inputSchema: {
      theme_id: idSchema.optional(),
      query: z.string().trim().max(200).optional(),
      countries: z.array(z.string().trim().max(10)).max(20).optional().default([]),
      min_relevance: z.number().min(0).max(100).optional().default(0),
      include_children: z.boolean().optional().default(true),
      top_n: z.number().int().min(1).max(500).optional().default(200),
    },
  }, async ({ theme_id, query, countries, min_relevance, include_children, top_n }) => {
    try {
      if (!theme_id && !query) throw new Error("theme_id 或 query 至少提供一項");
      const db = await ensureGlobalIndustrySchema(env);
      const theme = theme_id
        ? await queryFirst(db, "SELECT * FROM industry_themes WHERE theme_id = ?", [theme_id])
        : await queryFirst(db, "SELECT * FROM industry_themes WHERE name_zh LIKE ? OR name_en LIKE ? OR aliases_json LIKE ? ORDER BY status = 'active' DESC LIMIT 1", [`%${query}%`, `%${query}%`, `%${query}%`]);
      if (!theme) throw new Error("找不到題材");
      const childRows = include_children ? await queryAll(db, "SELECT * FROM industry_themes WHERE parent_theme_id = ? AND status = 'active'", [theme.theme_id]) : [];
      const themeIds = [String(theme.theme_id), ...childRows.map((row) => String(row.theme_id))];
      const placeholders = themeIds.map(() => "?").join(",");
      const countryFilter = countries.length ? ` AND c.country IN (${countries.map(() => "?").join(",")})` : "";
      const members = await queryAll(db, `SELECT m.*, c.company_name, c.company_name_en, c.ticker, c.country, c.exchange, c.official_industry,
          t.name_zh theme_name, t.theme_type
        FROM company_theme_memberships m
        JOIN global_companies c ON c.company_id = m.company_id
        JOIN industry_themes t ON t.theme_id = m.theme_id
        WHERE m.theme_id IN (${placeholders}) AND m.status = 'active' AND m.relevance_score >= ?${countryFilter}
        ORDER BY m.relevance_score DESC, c.country, c.ticker LIMIT ?`, [...themeIds, min_relevance, ...countries, top_n]);
      const edges = await queryAll(db, `SELECT e.*, s.company_name source_name, s.ticker source_ticker, s.country source_country,
          d.company_name target_name, d.ticker target_ticker, d.country target_country
        FROM supply_chain_edges e
        LEFT JOIN global_companies s ON s.company_id = e.source_company_id
        LEFT JOIN global_companies d ON d.company_id = e.target_company_id
        WHERE e.theme_id IN (${placeholders}) AND e.status = 'active'
        ORDER BY e.confidence DESC LIMIT ?`, [...themeIds, top_n]);
      const evidence = await queryAll(db, `SELECT * FROM industry_evidence WHERE entity_type = 'theme' AND entity_id IN (${placeholders}) ORDER BY published_at DESC LIMIT 100`, themeIds);
      return ok({ theme, children: childRows, members, supply_chain_edges: edges, evidence, member_count: members.length });
    } catch (error) { return fail(error); }
  });

  server.registerTool("search_global_industry_map", {
    description: "跨公司、代號、產業、題材、產品與證據全文搜尋全球產業知識圖譜。",
    inputSchema: {
      query: z.string().trim().min(1).max(200),
      countries: z.array(z.string().trim().max(10)).max(20).optional().default([]),
      top_n: z.number().int().min(1).max(100).optional().default(30),
    },
  }, async ({ query, countries, top_n }) => {
    try {
      const db = await ensureGlobalIndustrySchema(env);
      const like = `%${query}%`;
      const countryFilter = countries.length ? ` AND country IN (${countries.map(() => "?").join(",")})` : "";
      const companies = await queryAll(db, `SELECT * FROM global_companies
        WHERE status = 'active' AND (ticker LIKE ? OR company_name LIKE ? OR company_name_en LIKE ? OR aliases_json LIKE ? OR official_industry LIKE ? OR sub_industry LIKE ?)${countryFilter}
        ORDER BY country = 'TW' DESC, company_name LIMIT ?`, [like, like, like, like, like, like, ...countries, top_n]);
      const themes = await queryAll(db, `SELECT * FROM industry_themes WHERE status = 'active' AND (name_zh LIKE ? OR name_en LIKE ? OR aliases_json LIKE ? OR description LIKE ?) ORDER BY theme_type, name_zh LIMIT ?`, [like, like, like, like, top_n]);
      const evidence = await queryAll(db, `SELECT * FROM industry_evidence WHERE evidence_text LIKE ? OR source_title LIKE ? ORDER BY published_at DESC LIMIT ?`, [like, like, top_n]);
      return ok({ query, companies, themes, evidence });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_supply_chain_network", {
    description: "從指定公司向上游、下游或雙向展開全球供應鏈網路，最多三層。",
    inputSchema: {
      company_id: idSchema,
      direction: z.enum(["upstream", "downstream", "both"]).optional().default("both"),
      depth: z.number().int().min(1).max(3).optional().default(2),
      min_confidence: z.number().min(0).max(100).optional().default(0),
      max_nodes: z.number().int().min(5).max(200).optional().default(80),
    },
  }, async ({ company_id, direction, depth, min_confidence, max_nodes }) => {
    try {
      const db = await ensureGlobalIndustrySchema(env);
      const root = await queryFirst(db, "SELECT * FROM global_companies WHERE company_id = ?", [company_id]);
      if (!root) throw new Error("找不到起始公司");
      const nodes = new Set<string>([company_id]);
      const edges = new Map<string, Obj>();
      let frontier = [company_id];
      for (let level = 1; level <= depth && frontier.length && nodes.size < max_nodes; level++) {
        const next: string[] = [];
        for (const current of frontier) {
          const clauses = direction === "upstream" ? "target_company_id = ?" : direction === "downstream" ? "source_company_id = ?" : "source_company_id = ? OR target_company_id = ?";
          const args = direction === "both" ? [current, current, min_confidence] : [current, min_confidence];
          const rows = await queryAll(db, `SELECT * FROM supply_chain_edges WHERE (${clauses}) AND status = 'active' AND confidence >= ? ORDER BY confidence DESC LIMIT 100`, args);
          for (const row of rows) {
            edges.set(String(row.edge_id), { ...row, level });
            const related = [String(row.source_company_id), String(row.target_company_id)];
            for (const id of related) {
              if (!nodes.has(id) && nodes.size < max_nodes) { nodes.add(id); next.push(id); }
            }
          }
        }
        frontier = [...new Set(next)];
      }
      const nodeIds = [...nodes];
      const nodeRows: Obj[] = [];
      for (const id of nodeIds) {
        const row = await queryFirst(db, "SELECT * FROM global_companies WHERE company_id = ?", [id]);
        if (row) nodeRows.push(row);
      }
      return ok({ root, direction, depth, nodes: nodeRows, edges: [...edges.values()], truncated: nodes.size >= max_nodes });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_global_industry_coverage", {
    description: "檢查全球產業資料庫的國家、公司、題材、供應鏈、證據與台股分類覆蓋率。",
    inputSchema: {},
  }, async () => {
    try {
      const db = await ensureGlobalIndustrySchema(env);
      const [companies, themes, memberships, edges, evidence, candidates, countries, taiwan, classifiedTaiwan] = await Promise.all([
        queryFirst(db, "SELECT COUNT(*) count FROM global_companies WHERE status = 'active'"),
        queryFirst(db, "SELECT COUNT(*) count FROM industry_themes WHERE status = 'active'"),
        queryFirst(db, "SELECT COUNT(*) count FROM company_theme_memberships WHERE status = 'active'"),
        queryFirst(db, "SELECT COUNT(*) count FROM supply_chain_edges WHERE status = 'active'"),
        queryFirst(db, "SELECT COUNT(*) count FROM industry_evidence"),
        queryFirst(db, "SELECT COUNT(*) count FROM classification_candidates WHERE status = 'pending'"),
        queryAll(db, "SELECT country, exchange, COUNT(*) count FROM global_companies WHERE status = 'active' GROUP BY country, exchange ORDER BY country, exchange"),
        queryFirst(db, "SELECT COUNT(*) count FROM global_companies WHERE country = 'TW' AND status = 'active'"),
        queryFirst(db, "SELECT COUNT(DISTINCT c.company_id) count FROM global_companies c JOIN company_theme_memberships m ON m.company_id = c.company_id AND m.status = 'active' WHERE c.country = 'TW' AND c.status = 'active'"),
      ]);
      const twCount = num(taiwan?.count), twClassified = num(classifiedTaiwan?.count);
      return ok({
        totals: { companies: num(companies?.count), themes: num(themes?.count), memberships: num(memberships?.count), supply_chain_edges: num(edges?.count), evidence: num(evidence?.count), pending_candidates: num(candidates?.count) },
        by_market: countries,
        taiwan: { companies: twCount, classified: twClassified, coverage_percent: twCount ? Number((twClassified / twCount * 100).toFixed(2)) : 0 },
        completeness_note: "官方公司與官方產業可全量同步；細題材與供應鏈只在有證據時建立，不以虛構分類追求100%。",
      });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_unclassified_taiwan_companies", {
    description: "列出台股中尚未建立細題材分類的公司，供後續自動研究與人工審核。",
    inputSchema: {
      exchange: z.enum(["all", "TWSE", "TPEX", "ESB"]).optional().default("all"),
      exclude_official_industry_only: z.boolean().optional().default(true),
      top_n: z.number().int().min(1).max(500).optional().default(200),
    },
  }, async ({ exchange, exclude_official_industry_only, top_n }) => {
    try {
      const db = await ensureGlobalIndustrySchema(env);
      const exchangeFilter = exchange === "all" ? "" : " AND c.exchange = ?";
      const membershipFilter = exclude_official_industry_only
        ? "NOT EXISTS (SELECT 1 FROM company_theme_memberships m JOIN industry_themes t ON t.theme_id = m.theme_id WHERE m.company_id = c.company_id AND m.status = 'active' AND t.theme_type <> 'official_industry')"
        : "NOT EXISTS (SELECT 1 FROM company_theme_memberships m WHERE m.company_id = c.company_id AND m.status = 'active')";
      const values: unknown[] = [];
      if (exchange !== "all") values.push(exchange);
      values.push(top_n);
      const rows = await queryAll(db, `SELECT c.* FROM global_companies c WHERE c.country = 'TW' AND c.status = 'active'${exchangeFilter} AND ${membershipFilter} ORDER BY c.exchange, c.ticker LIMIT ?`, values);
      return ok({ exchange, count: rows.length, data: rows });
    } catch (error) { return fail(error); }
  });
}
