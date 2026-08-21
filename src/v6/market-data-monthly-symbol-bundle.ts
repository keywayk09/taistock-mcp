import type { TwMarketDataKind } from "./tw-market-data.ts";

export type MonthlySymbolDay = Partial<Record<TwMarketDataKind, unknown>>;

export type MonthlySymbolBundle = {
  schema_version: "diamond-market-data-monthly-symbol-bundle/v1";
  month: string;
  symbol: string;
  days: Record<string, MonthlySymbolDay>;
};

const KINDS: TwMarketDataKind[] = [
  "institutional",
  "margin",
  "securities_lending",
  "sbl_short_sale",
];

function invariant(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

export function buildMonthlySymbolBundle(input: {
  month: string;
  symbol: string;
  state: Partial<Record<TwMarketDataKind, any[]>> | null | undefined;
}): MonthlySymbolBundle {
  invariant(/^20\d{2}-\d{2}$/.test(input.month), "month_invalid");
  invariant(/^\d{4,6}$/.test(input.symbol), "symbol_invalid");
  const days: Record<string, MonthlySymbolDay> = {};

  for (const kind of KINDS) {
    const rows = Array.isArray(input.state?.[kind]) ? input.state![kind]! : [];
    for (const row of rows) {
      const tradeDate = String(row?.trade_date ?? "");
      invariant(/^20\d{2}-\d{2}-\d{2}$/.test(tradeDate), `trade_date_invalid:${kind}`);
      invariant(tradeDate.slice(0, 7) === input.month, `trade_date_outside_month:${kind}:${tradeDate}`);
      invariant(String(row?.symbol ?? "") === input.symbol, `symbol_mismatch:${kind}:${tradeDate}`);
      const day = days[tradeDate] ?? {};
      invariant(day[kind] === undefined, `duplicate_kind_day:${kind}:${tradeDate}`);
      day[kind] = row;
      days[tradeDate] = day;
    }
  }

  return {
    schema_version: "diamond-market-data-monthly-symbol-bundle/v1",
    month: input.month,
    symbol: input.symbol,
    days: Object.fromEntries(Object.entries(days).sort(([a], [b]) => a.localeCompare(b))),
  };
}

export function monthlySymbolBundleSeries(bundle: MonthlySymbolBundle) {
  const out: Record<TwMarketDataKind, any[]> = {
    institutional: [],
    margin: [],
    securities_lending: [],
    sbl_short_sale: [],
  };
  for (const date of Object.keys(bundle.days).sort()) {
    const day = bundle.days[date];
    for (const kind of KINDS) {
      if (day[kind] !== undefined) out[kind].push(day[kind]);
    }
  }
  return out;
}

export function monthlySymbolBundleLogicalPath(month: string, symbol: string) {
  invariant(/^20\d{2}-\d{2}$/.test(month), "month_invalid");
  invariant(/^\d{4,6}$/.test(symbol), "symbol_invalid");
  const [year, mon] = month.split("-");
  return `market-data/${year}/${mon}/${symbol}.json`;
}

export function estimatePhysicalWriteAmplification(input: {
  symbolCount: number;
  prefixCount: number;
}) {
  invariant(Number.isInteger(input.symbolCount) && input.symbolCount > 0, "symbol_count_invalid");
  invariant(Number.isInteger(input.prefixCount) && input.prefixCount > 0, "prefix_count_invalid");
  return {
    symbol_files_per_generation: input.symbolCount,
    prefix_files_per_generation: input.prefixCount,
    multiplier: input.symbolCount / input.prefixCount,
  };
}
