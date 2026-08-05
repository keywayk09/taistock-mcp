import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dateTimeSchema = z.string().min(10).max(40);
const jsonObjectSchema = z.record(z.unknown()).default({});

function ok(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(error: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
  };
}

function requireDb(env: Env) {
  if (!env.DB) throw new Error("D1 DB binding is unavailable");
  return env.DB;
}

async function initialize(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS diamond_candidate_pools (
      pool_id TEXT PRIMARY KEY,
      trade_date TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('swing','daytrade')),
      engine_version TEXT,
      selection_method TEXT NOT NULL,
      candidate_count INTEGER NOT NULL,
      candidates_json TEXT NOT NULL,
      ranking_sources_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_diamond_candidate_pools_date_mode
      ON diamond_candidate_pools(trade_date, mode)`),

    db.prepare(`CREATE TABLE IF NOT EXISTS diamond_swing_decisions (
      decision_id TEXT PRIMARY KEY,
      decision_date TEXT NOT NULL,
      symbol TEXT NOT NULL,
      stock_name TEXT,
      industry TEXT,
      status TEXT NOT NULL DEFAULT 'watching' CHECK(status IN ('watching','planned','entered','exited','cancelled')),
      rank_no INTEGER,
      score REAL,
      confidence REAL,
      maturity_percent REAL,
      selected INTEGER NOT NULL CHECK(selected IN (0,1)),
      selected_reason TEXT,
      rejected_reason TEXT,
      peer_comparison_json TEXT NOT NULL DEFAULT '{}',
      evidence_json TEXT NOT NULL DEFAULT '{}',
      planned_entry REAL,
      actual_entry REAL,
      stop_price REAL,
      target_price REAL,
      entry_time TEXT,
      exit_price REAL,
      exit_time TEXT,
      exit_reason TEXT,
      holding_days INTEGER,
      return_percent REAL,
      mfe_percent REAL,
      mae_percent REAL,
      outcome TEXT CHECK(outcome IN ('win','loss','flat','open','cancelled')),
      review TEXT,
      lesson TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_diamond_swing_date ON diamond_swing_decisions(decision_date)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_diamond_swing_symbol ON diamond_swing_decisions(symbol)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_diamond_swing_status ON diamond_swing_decisions(status)`),

    db.prepare(`CREATE TABLE IF NOT EXISTS diamond_engine_cases (
      case_id TEXT PRIMARY KEY,
      trade_date TEXT NOT NULL,
      symbol TEXT NOT NULL,
      stock_name TEXT,
      engine_version TEXT NOT NULL,
      candidate_rank INTEGER,
      ai_expected_signal INTEGER NOT NULL CHECK(ai_expected_signal IN (0,1)),
      tv_signal INTEGER NOT NULL CHECK(tv_signal IN (0,1)),
      case_type TEXT NOT NULL CHECK(case_type IN ('false_negative','false_positive','consensus_signal','consensus_no_signal','unclassified')),
      signal_side TEXT CHECK(signal_side IN ('long','short','none')),
      signal_name TEXT,
      signal_time TEXT,
      entry_price REAL,
      exit_price REAL,
      return_percent REAL,
      mfe_percent REAL,
      mae_percent REAL,
      exit_reason TEXT,
      expected_reason TEXT,
      actual_gate_reason TEXT,
      gate_trace_json TEXT NOT NULL DEFAULT '{}',
      market_context_json TEXT NOT NULL DEFAULT '{}',
      review TEXT,
      lesson TEXT,
      weight REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_diamond_engine_date ON diamond_engine_cases(trade_date)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_diamond_engine_type ON diamond_engine_cases(case_type)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_diamond_engine_version ON diamond_engine_cases(engine_version)`),

    db.prepare(`CREATE TABLE IF NOT EXISTS diamond_strategy_proposals (
      proposal_id TEXT PRIMARY KEY,
      created_date TEXT NOT NULL,
      engine_version TEXT NOT NULL,
      module_name TEXT NOT NULL,
      problem_statement TEXT NOT NULL,
      evidence_summary TEXT NOT NULL,
      baseline_json TEXT NOT NULL DEFAULT '{}',
      alternatives_json TEXT NOT NULL DEFAULT '[]',
      test_results_json TEXT NOT NULL DEFAULT '{}',
      recommendation TEXT,
      risks TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','tested','discussion_required','approved','rejected','implemented')),
      user_decision TEXT,
      user_decided_at TEXT,
      implementation_commit TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_diamond_proposals_status ON diamond_strategy_proposals(status)`),

    db.prepare(`CREATE TABLE IF NOT EXISTS diamond_engine_versions (
      version TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      commit_sha TEXT,
      is_stable INTEGER NOT NULL DEFAULT 0 CHECK(is_stable IN (0,1)),
      status TEXT NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate','testing','stable','retired')),
      approved_by_user INTEGER NOT NULL DEFAULT 0 CHECK(approved_by_user IN (0,1)),
      approval_note TEXT,
      registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      promoted_at TEXT
    )`),
  ]);
}

export function registerDiamondResearchTools(server: McpServer, env: Env) {
  server.registerTool("initialize_diamond_research_system", {
    description: "建立鑽石研究系統 D1 資料表。包含波段決策日誌、當沖 Engine Lab 案例、候選池、改版備案與引擎版本登錄。",
    inputSchema: {},
  }, async () => {
    try {
      const db = requireDb(env);
      await initialize(db);
      return ok({ initialized: true, system: "Diamond Research System", version: "1.0" });
    } catch (error) { return fail(error); }
  });

  server.registerTool("record_candidate_pool", {
    description: "儲存每日波段或當沖候選池。當沖建議由多個排行榜組成50至100檔，並記錄來源、排名與使用的台股引擎版本。",
    inputSchema: {
      pool_id: z.string().min(6).max(100),
      trade_date: dateSchema,
      mode: z.enum(["swing", "daytrade"]),
      engine_version: z.string().max(80).optional(),
      selection_method: z.string().min(3).max(2000),
      candidates: z.array(z.record(z.unknown())).min(1).max(300),
      ranking_sources: z.array(z.string()).min(1).max(30),
    },
  }, async (input) => {
    try {
      const db = requireDb(env); await initialize(db);
      await db.prepare(`INSERT OR REPLACE INTO diamond_candidate_pools
        (pool_id, trade_date, mode, engine_version, selection_method, candidate_count, candidates_json, ranking_sources_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(input.pool_id, input.trade_date, input.mode, input.engine_version ?? null, input.selection_method,
          input.candidates.length, JSON.stringify(input.candidates), JSON.stringify(input.ranking_sources)).run();
      return ok({ saved: true, pool_id: input.pool_id, candidate_count: input.candidates.length });
    } catch (error) { return fail(error); }
  });

  server.registerTool("record_swing_decision", {
    description: "儲存波段選股決策。必須記錄候選比較、為何選A不選B、缺點、計畫進場、停損、目標與當下證據。",
    inputSchema: {
      decision_id: z.string().min(8).max(100),
      decision_date: dateSchema,
      symbol: z.string().min(2).max(20),
      stock_name: z.string().max(100).optional(),
      industry: z.string().max(100).optional(),
      status: z.enum(["watching", "planned", "entered", "cancelled"]).default("watching"),
      rank_no: z.number().int().positive().optional(),
      score: z.number().min(0).max(100).optional(),
      confidence: z.number().min(0).max(100).optional(),
      maturity_percent: z.number().min(0).max(100).optional(),
      selected: z.boolean(),
      selected_reason: z.string().max(5000).optional(),
      rejected_reason: z.string().max(5000).optional(),
      peer_comparison: jsonObjectSchema,
      evidence: jsonObjectSchema,
      planned_entry: z.number().positive().optional(),
      actual_entry: z.number().positive().optional(),
      stop_price: z.number().positive().optional(),
      target_price: z.number().positive().optional(),
      entry_time: dateTimeSchema.optional(),
    },
  }, async (input) => {
    try {
      const db = requireDb(env); await initialize(db);
      await db.prepare(`INSERT OR REPLACE INTO diamond_swing_decisions
        (decision_id, decision_date, symbol, stock_name, industry, status, rank_no, score, confidence, maturity_percent,
         selected, selected_reason, rejected_reason, peer_comparison_json, evidence_json, planned_entry, actual_entry,
         stop_price, target_price, entry_time, outcome, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
        .bind(input.decision_id, input.decision_date, input.symbol, input.stock_name ?? null, input.industry ?? null,
          input.status, input.rank_no ?? null, input.score ?? null, input.confidence ?? null, input.maturity_percent ?? null,
          input.selected ? 1 : 0, input.selected_reason ?? null, input.rejected_reason ?? null,
          JSON.stringify(input.peer_comparison), JSON.stringify(input.evidence), input.planned_entry ?? null,
          input.actual_entry ?? null, input.stop_price ?? null, input.target_price ?? null, input.entry_time ?? null,
          input.status === "cancelled" ? "cancelled" : "open").run();
      return ok({ saved: true, decision_id: input.decision_id, status: input.status });
    } catch (error) { return fail(error); }
  });

  server.registerTool("close_swing_decision", {
    description: "完成波段決策生命週期，記錄出場價、獲利%、MFE、MAE、出場原因、檢討與下次教訓。",
    inputSchema: {
      decision_id: z.string().min(8).max(100),
      exit_price: z.number().positive(),
      exit_time: dateTimeSchema,
      exit_reason: z.string().min(2).max(3000),
      holding_days: z.number().int().min(0).max(3000),
      return_percent: z.number().min(-1000).max(10000),
      mfe_percent: z.number().min(-1000).max(10000),
      mae_percent: z.number().min(-1000).max(10000),
      outcome: z.enum(["win", "loss", "flat", "cancelled"]),
      review: z.string().max(10000).optional(),
      lesson: z.string().max(10000).optional(),
    },
  }, async (input) => {
    try {
      const db = requireDb(env); await initialize(db);
      const result = await db.prepare(`UPDATE diamond_swing_decisions SET
        status = 'exited', exit_price = ?, exit_time = ?, exit_reason = ?, holding_days = ?, return_percent = ?,
        mfe_percent = ?, mae_percent = ?, outcome = ?, review = ?, lesson = ?, updated_at = CURRENT_TIMESTAMP
        WHERE decision_id = ?`)
        .bind(input.exit_price, input.exit_time, input.exit_reason, input.holding_days, input.return_percent,
          input.mfe_percent, input.mae_percent, input.outcome, input.review ?? null, input.lesson ?? null, input.decision_id).run();
      return ok({ updated: (result.meta?.changes ?? 0) > 0, decision_id: input.decision_id });
    } catch (error) { return fail(error); }
  });

  server.registerTool("record_engine_lab_case", {
    description: "儲存台股引擎當沖案例。比較AI認為應有/不應有訊號與TradingView實際訊號，分類漏訊、假訊或共識，並保留門檻追蹤與結果。",
    inputSchema: {
      case_id: z.string().min(8).max(100),
      trade_date: dateSchema,
      symbol: z.string().min(2).max(20),
      stock_name: z.string().max(100).optional(),
      engine_version: z.string().min(2).max(80),
      candidate_rank: z.number().int().positive().optional(),
      ai_expected_signal: z.boolean(),
      tv_signal: z.boolean(),
      signal_side: z.enum(["long", "short", "none"]).default("none"),
      signal_name: z.string().max(100).optional(),
      signal_time: dateTimeSchema.optional(),
      entry_price: z.number().positive().optional(),
      exit_price: z.number().positive().optional(),
      return_percent: z.number().min(-1000).max(10000).optional(),
      mfe_percent: z.number().min(-1000).max(10000).optional(),
      mae_percent: z.number().min(-1000).max(10000).optional(),
      exit_reason: z.string().max(3000).optional(),
      expected_reason: z.string().max(5000).optional(),
      actual_gate_reason: z.string().max(5000).optional(),
      gate_trace: jsonObjectSchema,
      market_context: jsonObjectSchema,
      review: z.string().max(10000).optional(),
      lesson: z.string().max(10000).optional(),
      weight: z.number().min(0.1).max(100).default(1),
    },
  }, async (input) => {
    try {
      const db = requireDb(env); await initialize(db);
      const caseType = input.ai_expected_signal && !input.tv_signal ? "false_negative"
        : !input.ai_expected_signal && input.tv_signal ? "false_positive"
        : input.ai_expected_signal && input.tv_signal ? "consensus_signal" : "consensus_no_signal";
      await db.prepare(`INSERT OR REPLACE INTO diamond_engine_cases
        (case_id, trade_date, symbol, stock_name, engine_version, candidate_rank, ai_expected_signal, tv_signal,
         case_type, signal_side, signal_name, signal_time, entry_price, exit_price, return_percent, mfe_percent,
         mae_percent, exit_reason, expected_reason, actual_gate_reason, gate_trace_json, market_context_json,
         review, lesson, weight, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`)
        .bind(input.case_id, input.trade_date, input.symbol, input.stock_name ?? null, input.engine_version,
          input.candidate_rank ?? null, input.ai_expected_signal ? 1 : 0, input.tv_signal ? 1 : 0, caseType,
          input.signal_side, input.signal_name ?? null, input.signal_time ?? null, input.entry_price ?? null,
          input.exit_price ?? null, input.return_percent ?? null, input.mfe_percent ?? null, input.mae_percent ?? null,
          input.exit_reason ?? null, input.expected_reason ?? null, input.actual_gate_reason ?? null,
          JSON.stringify(input.gate_trace), JSON.stringify(input.market_context), input.review ?? null,
          input.lesson ?? null, input.weight).run();
      return ok({ saved: true, case_id: input.case_id, case_type: caseType });
    } catch (error) { return fail(error); }
  });

  server.registerTool("create_strategy_proposal", {
    description: "建立策略修改備案與測試結果。只能建立研究提案，絕對不能自行修改正式Pine、Stable版本或合併程式；必須等待使用者討論與明確批准。",
    inputSchema: {
      proposal_id: z.string().min(8).max(100),
      created_date: dateSchema,
      engine_version: z.string().min(2).max(80),
      module_name: z.string().min(1).max(100),
      problem_statement: z.string().min(5).max(10000),
      evidence_summary: z.string().min(5).max(10000),
      baseline: jsonObjectSchema,
      alternatives: z.array(z.record(z.unknown())).min(1).max(20),
      test_results: jsonObjectSchema,
      recommendation: z.string().max(10000).optional(),
      risks: z.string().max(10000).optional(),
    },
  }, async (input) => {
    try {
      const db = requireDb(env); await initialize(db);
      await db.prepare(`INSERT OR REPLACE INTO diamond_strategy_proposals
        (proposal_id, created_date, engine_version, module_name, problem_statement, evidence_summary,
         baseline_json, alternatives_json, test_results_json, recommendation, risks, status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'discussion_required', CURRENT_TIMESTAMP)`)
        .bind(input.proposal_id, input.created_date, input.engine_version, input.module_name,
          input.problem_statement, input.evidence_summary, JSON.stringify(input.baseline),
          JSON.stringify(input.alternatives), JSON.stringify(input.test_results), input.recommendation ?? null,
          input.risks ?? null).run();
      return ok({ saved: true, proposal_id: input.proposal_id, status: "discussion_required", formal_code_modified: false });
    } catch (error) { return fail(error); }
  });

  server.registerTool("record_user_proposal_decision", {
    description: "在使用者完成討論並明確決定後，記錄備案批准或拒絕。此工具只記錄決策，不會修改Pine或Stable版本。",
    inputSchema: {
      proposal_id: z.string().min(8).max(100),
      decision: z.enum(["approved", "rejected"]),
      user_decision: z.string().min(3).max(10000),
      user_decided_at: dateTimeSchema,
    },
  }, async (input) => {
    try {
      const db = requireDb(env); await initialize(db);
      const result = await db.prepare(`UPDATE diamond_strategy_proposals
        SET status = ?, user_decision = ?, user_decided_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE proposal_id = ? AND status IN ('discussion_required','tested','draft')`)
        .bind(input.decision, input.user_decision, input.user_decided_at, input.proposal_id).run();
      return ok({ updated: (result.meta?.changes ?? 0) > 0, proposal_id: input.proposal_id, decision: input.decision, formal_code_modified: false });
    } catch (error) { return fail(error); }
  });

  server.registerTool("register_engine_version", {
    description: "登錄台股引擎版本。Stable只能在使用者明確批准後登錄；本工具不修改Pine程式與GitHub分支。",
    inputSchema: {
      version: z.string().min(2).max(80),
      title: z.string().min(2).max(200),
      commit_sha: z.string().max(80).optional(),
      status: z.enum(["candidate", "testing", "stable", "retired"]),
      approved_by_user: z.boolean(),
      approval_note: z.string().max(5000).optional(),
    },
  }, async (input) => {
    try {
      if (input.status === "stable" && (!input.approved_by_user || !input.approval_note?.trim())) {
        throw new Error("禁止自行升級 Stable：必須有使用者明確批准與 approval_note");
      }
      const db = requireDb(env); await initialize(db);
      if (input.status === "stable") await db.prepare("UPDATE diamond_engine_versions SET is_stable = 0 WHERE is_stable = 1").run();
      await db.prepare(`INSERT OR REPLACE INTO diamond_engine_versions
        (version, title, commit_sha, is_stable, status, approved_by_user, approval_note, promoted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(input.version, input.title, input.commit_sha ?? null, input.status === "stable" ? 1 : 0,
          input.status, input.approved_by_user ? 1 : 0, input.approval_note ?? null,
          input.status === "stable" ? new Date().toISOString() : null).run();
      return ok({ saved: true, version: input.version, status: input.status, approved_by_user: input.approved_by_user });
    } catch (error) { return fail(error); }
  });

  server.registerTool("get_diamond_research_dashboard", {
    description: "讀取波段與當沖研究統計，包含目前Stable版本、波段績效、漏訊、假訊、共識案例與待討論備案。",
    inputSchema: {
      start_date: dateSchema.optional(),
      end_date: dateSchema.optional(),
      engine_version: z.string().max(80).optional(),
    },
  }, async (input) => {
    try {
      const db = requireDb(env); await initialize(db);
      const start = input.start_date ?? "1900-01-01";
      const end = input.end_date ?? "2999-12-31";
      const versionClause = input.engine_version ? " AND engine_version = ?" : "";
      const versionArgs = input.engine_version ? [input.engine_version] : [];
      const [stable, swing, cases, proposals] = await Promise.all([
        db.prepare("SELECT * FROM diamond_engine_versions WHERE is_stable = 1 LIMIT 1").first(),
        db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN outcome='win' THEN 1 ELSE 0 END) wins,
          AVG(return_percent) avg_return, AVG(mfe_percent) avg_mfe, AVG(mae_percent) avg_mae,
          AVG(holding_days) avg_holding_days FROM diamond_swing_decisions
          WHERE decision_date BETWEEN ? AND ? AND status='exited'`).bind(start, end).first(),
        db.prepare(`SELECT case_type, COUNT(*) count, AVG(return_percent) avg_return,
          AVG(mfe_percent) avg_mfe, AVG(mae_percent) avg_mae, SUM(weight) weighted_count
          FROM diamond_engine_cases WHERE trade_date BETWEEN ? AND ?${versionClause}
          GROUP BY case_type`).bind(start, end, ...versionArgs).all(),
        db.prepare(`SELECT proposal_id, created_date, engine_version, module_name, problem_statement,
          recommendation, risks, status, user_decision FROM diamond_strategy_proposals
          WHERE status IN ('discussion_required','approved') ORDER BY created_date DESC LIMIT 50`).all(),
      ]);
      return ok({ range: { start, end }, stable_engine: stable ?? null, swing: swing ?? {}, engine_lab: cases.results ?? [], proposals: proposals.results ?? [] });
    } catch (error) { return fail(error); }
  });
}
