const CUSTOM_GPT_TARGET_BYTES = 48_000;

function text(value: unknown, max = 500) {
  if (value === null || value === undefined) return value;
  const raw = String(value);
  return raw.length <= max ? raw : `${raw.slice(0, max)}…`;
}

function compactUnknown(value: any, depth = 0, stringLimit = 400, arrayLimit = 5): any {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return text(value, stringLimit);
  if (typeof value !== "object") return value;
  if (depth >= 4) return Array.isArray(value) ? `[${value.length} items omitted]` : "[nested object omitted]";
  if (Array.isArray(value)) {
    return value.slice(0, arrayLimit).map((item) => compactUnknown(item, depth + 1, stringLimit, arrayLimit));
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if ([
      "recent_daily_bars",
      "income_statement_rows",
      "balance_sheet_rows",
      "cashflow_rows",
      "trades",
      "recent_trades",
      "trade_tape",
      "books",
      "order_book",
      "five_level_book",
      "raw",
      "rows",
      "levels",
      "seed_queries",
      "web_research_plan",
    ].includes(key)) continue;
    out[key] = compactUnknown(item, depth + 1, stringLimit, arrayLimit);
  }
  return out;
}

function compactJin10(context: any, itemLimit = 5, stringLimit = 600) {
  if (!context || typeof context !== "object") return null;
  const projectItem = (item: any) => ({
    id: item?.id ?? null,
    time: item?.time ?? item?.pub_time ?? null,
    title: text(item?.title, 240) ?? null,
    summary: text(item?.summary ?? item?.content, stringLimit) ?? null,
    important: item?.important ?? null,
  });
  return {
    ok: context.ok === true,
    provider: context.provider ?? "jin10-mcp",
    mode: context.mode ?? "stock_events",
    read_only: true,
    persistence: "NONE",
    query_keywords: Array.isArray(context.query_keywords) ? context.query_keywords.slice(0, 4) : [],
    entity_resolution: compactUnknown(context.entity_resolution, 0, 300, 4) ?? null,
    flash: Array.isArray(context.flash) ? context.flash.slice(0, itemLimit).map(projectItem) : [],
    news: Array.isArray(context.news) ? context.news.slice(0, itemLimit).map(projectItem) : [],
    partial_errors: Array.isArray(context.partial_errors) ? context.partial_errors.slice(0, 6).map((x: unknown) => text(x, 300)) : [],
  };
}

function compactPoint(point: any, aggressive = false) {
  const base = {
    id: point?.id ?? null,
    title: text(point?.title, 160) ?? null,
    status: point?.status ?? null,
  } as Record<string, unknown>;
  if (!aggressive) {
    base.evidence = compactUnknown(point?.evidence, 0, 300, 4);
    if (Array.isArray(point?.guardrails)) base.guardrails = point.guardrails.slice(0, 3).map((x: unknown) => text(x, 180));
  }
  return base;
}

function compactStock(analysis: any, aggressive = false) {
  const intelligence = analysis?.family_intelligence ?? {};
  const eleven = analysis?.eleven_point_analysis ?? {};
  return {
    symbol: analysis?.symbol ?? null,
    company: compactUnknown(analysis?.company, 0, 300, 4),
    market_snapshot: {
      source: analysis?.market_snapshot?.source ?? null,
      quote: compactUnknown(analysis?.market_snapshot?.quote, 0, 220, 4),
      latest_daily_bar: compactUnknown(analysis?.market_snapshot?.latest_daily_bar, 0, 220, 4),
    },
    technical: {
      status: analysis?.technical?.status ?? null,
      source: analysis?.technical?.source ?? null,
      summary: compactUnknown(analysis?.technical?.summary, 0, 260, 4),
    },
    data_quality: compactUnknown(analysis?.data_quality, 0, 220, 4),
    jin10_context: compactJin10(analysis?.jin10_context ?? intelligence?.jin10_context, aggressive ? 3 : 5, aggressive ? 300 : 600),
    decision_readiness: compactUnknown(analysis?.decision_readiness, 0, 180, 4),
    enrichment_diagnostics: compactUnknown(analysis?.enrichment_diagnostics, 0, 220, 4),
    family_intelligence_summary: {
      monthly_revenue: compactUnknown(intelligence?.monthly_revenue, 0, aggressive ? 180 : 300, aggressive ? 3 : 4),
      accounting: compactUnknown(intelligence?.accounting, 0, aggressive ? 180 : 300, aggressive ? 3 : 4),
      official_valuation: compactUnknown(intelligence?.official_valuation, 0, aggressive ? 180 : 300, aggressive ? 3 : 4),
      txf_context_status: intelligence?.txf_context?.status ?? null,
      global_futures_context_status: intelligence?.global_futures_context?.status ?? null,
    },
    eleven_point_analysis: {
      contract: eleven?.contract ?? null,
      coverage: compactUnknown(eleven?.coverage, 0, 180, 4),
      points: Array.isArray(eleven?.points) ? eleven.points.slice(0, 11).map((point: any) => compactPoint(point, aggressive)) : [],
    },
  };
}

function encodedBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function buildCompact(result: any, aggressive = false) {
  const stockAnalyses = Array.isArray(result?.stock_analyses) ? result.stock_analyses : [];
  return {
    ok: result?.ok ?? true,
    service: result?.service ?? "Taiwan Stock AI Family Read-Only API",
    version: result?.version ?? null,
    route: result?.route ?? null,
    question: result?.question ?? null,
    query: result?.query ?? null,
    as_of_date: result?.as_of_date ?? null,
    resolved_symbols: Array.isArray(result?.resolved_symbols) ? result.resolved_symbols.slice(0, 5) : stockAnalyses.map((row: any) => row?.symbol).filter(Boolean),
    adaptive_plan: compactUnknown(result?.adaptive_plan, 0, aggressive ? 180 : 260, aggressive ? 3 : 4),
    stock_analyses: stockAnalyses.slice(0, 5).map((analysis: any) => compactStock(analysis, aggressive)),
    family_policy: {
      read_only: true,
      production_writes: false,
      github_writes: false,
      strategy_changes: false,
      jin10_events_read: result?.family_policy?.jin10_events_read ?? "JIN10_MCP_READ_ONLY_FAIL_SOFT",
      jin10_persistence: "NONE",
    },
    response_meta: {
      compact_for_custom_gpt: true,
      omitted_large_raw_sections: true,
      target_max_bytes: CUSTOM_GPT_TARGET_BYTES,
    },
  };
}

/**
 * Mom Custom GPT uses the legacy queryTaiwanStockSystem Action. The full Family
 * analysis is intentionally richer than an Action transport should return and
 * can exceed ChatGPT's response ceiling. This projection preserves the model's
 * decision inputs and Jin10 diagnostics while dropping duplicated/raw payloads.
 */
export function compactFamilyAnalysisForCustomGpt(result: any) {
  let compact: any = buildCompact(result, false);
  if (encodedBytes(compact) > CUSTOM_GPT_TARGET_BYTES) compact = buildCompact(result, true);
  const bytes = encodedBytes(compact);
  compact.response_meta = {
    ...compact.response_meta,
    encoded_bytes: bytes,
    within_target: bytes <= CUSTOM_GPT_TARGET_BYTES,
  };
  return compact;
}
