import { normalizeTradeDate, normalizeTwseMargin, type MarginRow } from "./tw-market-data.ts";

function rec(value: unknown): Record<string, any> {
  return value !== null && typeof value === "object" ? value as Record<string, any> : {};
}

function normalizeKey(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/<[^>]*>/g, "").replace(/[\s_()（）%％/\\.,:：;；\-]/g, "");
}

function nullableNumber(value: unknown): number | null {
  const text = String(value ?? "").replace(/<[^>]*>/g, "").replace(/,/g, "").replace(/\+/g, "").trim();
  if (!text || ["--", "---", "N/A", "null", "undefined"].includes(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/**
 * TWSE MI_MARGN detailed table parser.
 *
 * The official `融資融券彙總 (全部)` table contains duplicate field names:
 * `前日餘額` / `今日餘額` appear once for margin and once for short sale.
 * Converting the row to an object first loses one group, so this parser keeps
 * the official positional table intact and resolves both repeated groups by
 * their field indexes. If TWSE changes away from this contract, fall back to
 * the generic normalizer instead of silently inventing values.
 */
export function normalizeTwseMiMargnOfficial(body: unknown, requestedDate: string): MarginRow[] {
  const root = rec(body);
  const tradeDate = normalizeTradeDate(root.date) ?? requestedDate;

  if (Array.isArray(root.tables)) {
    for (const tableValue of root.tables) {
      const table = rec(tableValue);
      if (!/融資融券彙總/.test(String(table.title ?? "")) || !Array.isArray(table.fields) || !Array.isArray(table.data)) continue;

      const keys = table.fields.map(normalizeKey);
      const codeAliases = ["代號", "證券代號", "股票代號"].map(normalizeKey);
      const nameAliases = ["名稱", "證券名稱", "股票名稱"].map(normalizeKey);
      const codeIndex = keys.findIndex((key: string) => codeAliases.includes(key));
      const nameIndex = keys.findIndex((key: string) => nameAliases.includes(key));
      const previousIndexes = keys
        .map((key: string, index: number) => key.includes(normalizeKey("前日餘額")) ? index : -1)
        .filter((index: number) => index >= 0);
      const todayIndexes = keys
        .map((key: string, index: number) => key.includes(normalizeKey("今日餘額")) ? index : -1)
        .filter((index: number) => index >= 0);

      if (codeIndex < 0 || previousIndexes.length < 2 || todayIndexes.length < 2) continue;

      return table.data
        .filter(Array.isArray)
        .map((values: any[]): MarginRow | null => {
          const symbol = String(values[codeIndex] ?? "").trim().replace(/\s/g, "");
          if (!/^\d{4,6}$/.test(symbol)) return null;

          const marginPrevious = nullableNumber(values[previousIndexes[0]]);
          const marginToday = nullableNumber(values[todayIndexes[0]]);
          const shortPrevious = nullableNumber(values[previousIndexes[1]]);
          const shortToday = nullableNumber(values[todayIndexes[1]]);

          return {
            trade_date: tradeDate,
            symbol,
            name: nameIndex >= 0 ? String(values[nameIndex] ?? "").trim() : "",
            market: "listed",
            margin_previous_balance_lots: marginPrevious,
            margin_balance_lots: marginToday,
            margin_balance_change_lots: marginToday !== null && marginPrevious !== null ? marginToday - marginPrevious : null,
            short_previous_balance_lots: shortPrevious,
            short_balance_lots: shortToday,
            short_balance_change_lots: shortToday !== null && shortPrevious !== null ? shortToday - shortPrevious : null,
            source: "TWSE_MI_MARGN",
            source_priority: "OFFICIAL",
          };
        })
        .filter((row): row is MarginRow => row !== null);
    }
  }

  return normalizeTwseMargin(body, requestedDate);
}
