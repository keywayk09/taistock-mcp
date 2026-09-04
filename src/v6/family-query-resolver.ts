export const FAMILY_QUERY_RESOLVER_VERSION = "family-query-resolver/v1.0.0";

export type FamilyBrokerWindowDays = 1 | 5 | 10 | 20 | 40 | 60 | 120 | 240;

const BROKER_WINDOWS = [1, 5, 10, 20, 40, 60, 120, 240] as const;
const DATE_PATTERN = /(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/g;
const SYMBOL_PATTERN = /(?<!\d)\d{4,6}(?!\d)/g;
const BROKER_QUERY_PATTERN = /券商\s*分點|買超\s*分點|賣超\s*分點|分點(?:進出|排行|排名|買超|賣超)?|broker\s*(?:branch|window|chip)/i;

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function normalizeDateParts(yearText: string, monthText: string, dayText: string) {
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function resolveDateSpans(query: string) {
  const spans: Array<{ start: number; end: number; raw: string; normalized: string }> = [];
  for (const match of query.matchAll(DATE_PATTERN)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    const normalized = normalizeDateParts(match[1], match[2], match[3]);
    if (!normalized) continue;
    spans.push({ start, end: start + match[0].length, raw: match[0], normalized });
  }
  return spans;
}

function maskSpans(query: string, spans: Array<{ start: number; end: number }>) {
  if (!spans.length) return query;
  const chars = [...query];
  for (const span of spans) {
    for (let index = span.start; index < span.end && index < chars.length; index += 1) chars[index] = " ";
  }
  return chars.join("");
}

export function isFamilyBrokerWindowQueryText(query: string) {
  return BROKER_QUERY_PATTERN.test(String(query ?? ""));
}

function extractBrokerWindows(maskedQuery: string, isBrokerQuery: boolean): FamilyBrokerWindowDays[] {
  if (!isBrokerQuery) return [];
  const found = new Set<FamilyBrokerWindowDays>();

  const grouped = /((?:1|5|10|20|40|60|120|240)(?:\s*[/、,，]\s*(?:1|5|10|20|40|60|120|240))+)[\s]*(?:日|天|[dD])/g;
  for (const match of maskedQuery.matchAll(grouped)) {
    for (const value of match[1].match(/\d+/g) ?? []) {
      const number = Number(value) as FamilyBrokerWindowDays;
      if ((BROKER_WINDOWS as readonly number[]).includes(number)) found.add(number);
    }
  }

  const single = /(?<!\d)(1|5|10|20|40|60|120|240)\s*(?:日|天|[dD])(?![A-Za-z])/g;
  for (const match of maskedQuery.matchAll(single)) {
    const number = Number(match[1]) as FamilyBrokerWindowDays;
    if ((BROKER_WINDOWS as readonly number[]).includes(number)) found.add(number);
  }

  // A plain broker-branch question is one-day by definition. When the user asks
  // for extra horizons (for example "並列出5/10/20/60日"), preserve the exact
  // one-day observation and add the requested server-ranked windows.
  found.add(1);
  return BROKER_WINDOWS.filter((window) => found.has(window));
}

export function resolveFamilyQuery(query: string) {
  const normalizedQuery = String(query ?? "").trim();
  const dateSpans = resolveDateSpans(normalizedQuery);
  const maskedQuery = maskSpans(normalizedQuery, dateSpans);
  const symbols = unique(maskedQuery.match(SYMBOL_PATTERN) ?? []).slice(0, 5);
  const brokerIntent = isFamilyBrokerWindowQueryText(maskedQuery);

  return {
    version: FAMILY_QUERY_RESOLVER_VERSION,
    query: normalizedQuery,
    masked_query: maskedQuery,
    as_of_date: dateSpans[0]?.normalized ?? null,
    explicit_dates: dateSpans.map((span) => span.normalized),
    symbols,
    is_broker_window_query: brokerIntent && symbols.length === 1,
    broker_windows: extractBrokerWindows(maskedQuery, brokerIntent && symbols.length === 1),
  } as const;
}
