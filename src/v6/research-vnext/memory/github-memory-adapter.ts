import {
  GitHubDataStoreError,
  listIndexedRecords,
  putIndexedImmutableRecord,
  readCollectionIndex,
  readIndexedRecord,
} from "../../github-data-store.ts";
import {
  ResearchVNextMemoryError,
  prepareJudgmentReviewMemoryRecord,
  prepareMarketJudgmentMemoryRecord,
  prepareTradingKnowledgeMemoryRecord,
  type JudgmentMarket,
  type JudgmentTimeframe,
  type KnowledgeStatus,
  type RecordJudgmentInput,
  type RecordJudgmentReviewInput,
  type RecordTradingKnowledgeInput,
} from "./memory-core.ts";

export const RESEARCH_VNEXT_GITHUB_MEMORY_ADAPTER_VERSION =
  "research-vnext-github-memory-adapter/v1.0.0" as const;

export type ResearchVNextGitHubMemoryAdapterOptions = {
  now?: () => string;
};

function defaultNow(): string {
  return new Date().toISOString();
}

function wrapStoreError(error: unknown): never {
  if (error instanceof GitHubDataStoreError) {
    throw new ResearchVNextMemoryError(error.code, error.message, {
      ...(error.detail ?? {}),
      store_status: error.status ?? null,
    });
  }
  throw error;
}

function boundedLimit(value: unknown, fallback: number, max: number): number {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(number)));
}

function normalizedMarket(value: unknown): JudgmentMarket | undefined {
  if (value == null || value === "") return undefined;
  const market = String(value).toUpperCase();
  if (market !== "TW_STOCK" && market !== "TXF") {
    throw new ResearchVNextMemoryError("INVALID_INPUT", "invalid market");
  }
  return market;
}

function normalizedSymbol(value: unknown, market?: JudgmentMarket): string | undefined {
  if (value == null || value === "") return undefined;
  const symbol = String(value).trim().toUpperCase();
  const resolvedMarket = market ?? (/^\d{4,6}$/.test(symbol) ? "TW_STOCK" : "TXF");
  if (resolvedMarket === "TXF") {
    if (symbol !== "TXF") {
      throw new ResearchVNextMemoryError("INVALID_INPUT", "TXF judgment symbol must be logical symbol TXF");
    }
    return symbol;
  }
  if (!/^\d{4,6}$/.test(symbol)) {
    throw new ResearchVNextMemoryError("INVALID_INPUT", "TW_STOCK symbol must be 4-6 digits");
  }
  return symbol;
}

function normalizedTimeframe(value: unknown): JudgmentTimeframe | undefined {
  if (value == null || value === "") return undefined;
  const timeframe = String(value) as JudgmentTimeframe;
  if (!["1m", "5m", "15m", "30m", "60m", "1d"].includes(timeframe)) {
    throw new ResearchVNextMemoryError("INVALID_INPUT", "invalid timeframe");
  }
  return timeframe;
}

function dateFilter(value: unknown, field: string): string | undefined {
  if (value == null || value === "") return undefined;
  const output = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(output)) {
    throw new ResearchVNextMemoryError("INVALID_INPUT", `${field} must be YYYY-MM-DD`);
  }
  return output;
}

function exactKey(id: unknown, version: unknown, idField: string, versionField: string): string {
  const normalizedId = String(id ?? "").trim();
  const normalizedVersion = String(version ?? "").trim();
  if (!normalizedId) throw new ResearchVNextMemoryError("INVALID_INPUT", `${idField} is required`);
  if (!normalizedVersion) throw new ResearchVNextMemoryError("INVALID_INPUT", `${versionField} is required`);
  return `${normalizedId}\u0000${normalizedVersion}`;
}

export function createResearchVNextGitHubMemoryAdapter(
  options: ResearchVNextGitHubMemoryAdapterOptions = {},
) {
  const now = options.now ?? defaultNow;

  return {
    async recordMarketJudgment(env: Env, raw: RecordJudgmentInput) {
      const prepared = await prepareMarketJudgmentMemoryRecord(raw, now());
      try {
        const write = await putIndexedImmutableRecord(env, {
          collection: prepared.collection,
          key: prepared.key,
          record: prepared.record,
          metadata: prepared.metadata,
        });
        return {
          ok: true as const,
          immutable: true as const,
          idempotent: write.idempotent,
          judgment_id: prepared.record.judgment_id,
          judgment_version: prepared.record.judgment_version,
          content_hash: prepared.content_hash,
          market: prepared.record.market,
          symbol: prepared.record.symbol,
          timeframe: prepared.record.timeframe,
          reason_count: prepared.record.reasons.length,
          pattern_count: prepared.record.patterns.length,
          trendline_count: prepared.record.trendlines.length,
          recorded_at: prepared.record.recorded_at,
          storage: "GITHUB_ONLY" as const,
        };
      } catch (error) {
        wrapStoreError(error);
      }
    },

    async getMarketJudgment(env: Env, judgmentId: string, judgmentVersion?: string) {
      const id = String(judgmentId ?? "").trim();
      if (!id) throw new ResearchVNextMemoryError("INVALID_INPUT", "judgment_id is required");
      try {
        if (judgmentVersion) {
          return await readIndexedRecord<Record<string, any>>(
            env,
            "research/gpt-judgments",
            exactKey(id, judgmentVersion, "judgment_id", "judgment_version"),
          );
        }
        const index = await readCollectionIndex(env, "research/gpt-judgments");
        const hit = index.records
          .filter((entry) => entry.judgment_id === id)
          .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0];
        return hit
          ? await readIndexedRecord<Record<string, any>>(env, "research/gpt-judgments", hit.key)
          : null;
      } catch (error) {
        wrapStoreError(error);
      }
    },

    async listMarketJudgments(
      env: Env,
      filters: {
        market?: JudgmentMarket;
        symbol?: string;
        trade_date?: string;
        timeframe?: JudgmentTimeframe;
        limit?: number;
      } = {},
    ) {
      const market = normalizedMarket(filters.market);
      const symbol = normalizedSymbol(filters.symbol, market);
      const tradeDate = dateFilter(filters.trade_date, "trade_date");
      const timeframe = normalizedTimeframe(filters.timeframe);
      const limit = boundedLimit(filters.limit, 100, 500);
      try {
        const judgments = await listIndexedRecords<Record<string, any>>(
          env,
          "research/gpt-judgments",
          (entry) =>
            (!market || entry.market === market) &&
            (!symbol || entry.symbol === symbol) &&
            (!tradeDate || entry.trade_date === tradeDate) &&
            (!timeframe || entry.timeframe === timeframe),
          limit,
        );
        judgments.sort((a, b) => Number(b.judgment_ts_ms) - Number(a.judgment_ts_ms));
        return { ok: true as const, count: judgments.length, judgments, storage: "GITHUB_ONLY" as const };
      } catch (error) {
        wrapStoreError(error);
      }
    },

    async recordJudgmentReview(env: Env, raw: RecordJudgmentReviewInput) {
      const key = exactKey(raw.judgment_id, raw.judgment_version, "judgment_id", "judgment_version");
      try {
        const judgment = await readIndexedRecord<Record<string, unknown>>(
          env,
          "research/gpt-judgments",
          key,
        );
        if (!judgment) {
          throw new ResearchVNextMemoryError("JUDGMENT_NOT_FOUND", "original judgment not found");
        }
        const prepared = await prepareJudgmentReviewMemoryRecord(raw, judgment, now());
        const write = await putIndexedImmutableRecord(env, {
          collection: prepared.collection,
          key: prepared.key,
          record: prepared.record,
          metadata: prepared.metadata,
        });
        return {
          ok: true as const,
          immutable: true as const,
          idempotent: write.idempotent,
          review_id: prepared.record.review_id,
          review_version: prepared.record.review_version,
          content_hash: prepared.content_hash,
          judgment_id: prepared.record.judgment_id,
          judgment_version: prepared.record.judgment_version,
          recorded_at: prepared.record.recorded_at,
          storage: "GITHUB_ONLY" as const,
          learning_policy: prepared.learning_policy,
        };
      } catch (error) {
        if (error instanceof ResearchVNextMemoryError) throw error;
        wrapStoreError(error);
      }
    },

    async recordTradingKnowledge(env: Env, raw: RecordTradingKnowledgeInput) {
      const prepared = await prepareTradingKnowledgeMemoryRecord(raw, now());
      try {
        const write = await putIndexedImmutableRecord(env, {
          collection: prepared.collection,
          key: prepared.key,
          record: prepared.record,
          metadata: prepared.metadata,
        });
        return {
          ok: true as const,
          immutable: true as const,
          idempotent: write.idempotent,
          knowledge_id: prepared.record.knowledge_id,
          knowledge_version: prepared.record.knowledge_version,
          content_hash: prepared.content_hash,
          status: prepared.record.status,
          recorded_at: prepared.record.recorded_at,
          storage: "GITHUB_ONLY" as const,
          production_promotion: prepared.production_promotion,
        };
      } catch (error) {
        wrapStoreError(error);
      }
    },

    async listTradingKnowledge(
      env: Env,
      filters: {
        market_scope?: "ALL" | JudgmentMarket;
        topic?: string;
        status?: KnowledgeStatus;
        limit?: number;
      } = {},
    ) {
      const marketScope = filters.market_scope == null
        ? undefined
        : String(filters.market_scope).toUpperCase();
      if (marketScope && !["ALL", "TW_STOCK", "TXF"].includes(marketScope)) {
        throw new ResearchVNextMemoryError("INVALID_INPUT", "invalid market_scope");
      }
      const topic = filters.topic == null ? undefined : String(filters.topic).trim().toUpperCase();
      const status = filters.status == null ? undefined : String(filters.status).toUpperCase();
      if (status && !["OBSERVATION", "HYPOTHESIS", "VALIDATED", "REJECTED", "ACCEPTED"].includes(status)) {
        throw new ResearchVNextMemoryError("INVALID_INPUT", "invalid knowledge status");
      }
      const limit = boundedLimit(filters.limit, 100, 500);
      try {
        const knowledge = await listIndexedRecords<Record<string, any>>(
          env,
          "research/gpt-trading-knowledge",
          (entry) =>
            (!marketScope || entry.market_scope === marketScope) &&
            (!topic || entry.topic === topic) &&
            (!status || entry.status === status),
          limit,
        );
        return { ok: true as const, count: knowledge.length, knowledge, storage: "GITHUB_ONLY" as const };
      } catch (error) {
        wrapStoreError(error);
      }
    },
  };
}
