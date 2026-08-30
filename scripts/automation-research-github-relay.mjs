#!/usr/bin/env node
// Read-only GitHub relay for ChatGPT automation research.
// The relay accepts only a small fixed schema and only calls the fixed Production
// Automation Research Bridge. It never accepts arbitrary URLs or repository paths.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const RELAY_VERSION = 'automation-research-github-relay/v1.0.0';
export const REQUEST_SCHEMA = 'AUTOMATION_RESEARCH_RELAY_REQUEST_V1';
export const BRIDGE_BASE = 'https://taistock-mcp.keywayk09.workers.dev/research/automation';

const MAX_BLIND_ITEMS = 80;
const MAX_OHLC_SYMBOLS = 80;
const MAX_HTTP_BYTES = 8 * 1024 * 1024;
const REQUEST_ROOT = 'runtime/automation-research-relay/requests';
const RESPONSE_ROOT = 'runtime/automation-research-relay/responses';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validRequestId(value) {
  return /^[a-z0-9][a-z0-9._-]{7,79}$/.test(String(value ?? ''));
}

function validItemId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(value ?? ''));
}

function validSymbol(value) {
  return /^\d{4,6}$/.test(String(value ?? ''));
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''));
}

function validDecisionTime(value) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(value ?? ''));
}

function validRevision(value) {
  return /^[0-9a-f]{40}$/i.test(String(value ?? ''));
}

function boundedInt(value, fallback, min, max) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Math.trunc(Number(value));
  assert(Number.isFinite(n), 'INVALID_INTEGER');
  return Math.max(min, Math.min(max, n));
}

function encodeQuery(params) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') q.set(key, String(value));
  }
  return q.toString();
}

async function fetchBridge(route, params = {}, expect = 'json') {
  assert(/^\/[a-z0-9-]+$/i.test(route), 'INVALID_FIXED_ROUTE');
  const url = `${BRIDGE_BASE}${route}?${encodeQuery(params)}`.replace(/\?$/, '');
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(70_000),
    headers: { 'user-agent': `${RELAY_VERSION} github-actions` },
  });
  const length = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > MAX_HTTP_BYTES) throw new Error('BRIDGE_RESPONSE_TOO_LARGE');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_HTTP_BYTES) throw new Error('BRIDGE_RESPONSE_TOO_LARGE');
  if (!response.ok) throw new Error(`BRIDGE_HTTP_${response.status}`);
  if (expect === 'text') return text;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('BRIDGE_INVALID_JSON');
  }
}

async function mapLimit(items, limit, fn) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker));
  return output;
}

function validateBlindItem(item) {
  assert(isObject(item), 'INVALID_BLIND_ITEM');
  assert(validItemId(item.id), 'INVALID_BLIND_ITEM_ID');
  assert(validSymbol(item.symbol), 'INVALID_BLIND_SYMBOL');
  assert(validDate(item.trade_date), 'INVALID_BLIND_TRADE_DATE');
  assert(item.timeframe === '1m' || item.timeframe === '5m', 'INVALID_BLIND_TIMEFRAME');
  assert(validDecisionTime(item.decision_time), 'INVALID_BLIND_DECISION_TIME');
  return {
    id: String(item.id),
    symbol: String(item.symbol),
    trade_date: String(item.trade_date),
    timeframe: item.timeframe,
    decision_time: String(item.decision_time),
    limit: boundedInt(item.limit, 300, 1, 600),
  };
}

function validateOhlcSymbol(value) {
  const symbol = String(value ?? '');
  assert(validSymbol(symbol), 'INVALID_OHLC_SYMBOL');
  return symbol;
}

function parseMarketLatest(html) {
  assert(/formal_research_eligible=true/.test(html), 'MARKET_LATEST_NOT_FORMAL');
  const date = html.match(/as_of=(\d{4}-\d{2}-\d{2})/i)?.[1] ?? '';
  const revision = html.match(/source_revision=([0-9a-f]{40})/i)?.[1] ?? '';
  const manifestSha = html.match(/manifest_sha=([0-9a-f]{40})/i)?.[1] ?? null;
  assert(validDate(date), 'MARKET_LATEST_DATE_MISSING');
  assert(validRevision(revision), 'MARKET_LATEST_REVISION_MISSING');
  return { as_of: date, source_revision: revision, manifest_sha: manifestSha };
}

function validateMarketPage(html, revision) {
  assert(/formal_research_eligible=true/.test(html), 'MARKET_PAGE_NOT_FORMAL');
  const actualRevision = html.match(/source_revision=([0-9a-f]{40})/i)?.[1] ?? '';
  assert(actualRevision.toLowerCase() === revision.toLowerCase(), 'MARKET_PAGE_REVISION_MISMATCH');
  const symbols = Number(html.match(/symbols=(\d+)/i)?.[1] ?? 'NaN');
  const pageSize = Number(html.match(/page_size=(\d+)/i)?.[1] ?? 'NaN');
  assert(Number.isInteger(symbols) && symbols >= 0, 'MARKET_PAGE_SYMBOL_COUNT_MISSING');
  assert(Number.isInteger(pageSize) && pageSize > 0, 'MARKET_PAGE_SIZE_MISSING');
  assert(/<table\b/i.test(html), 'MARKET_PAGE_TABLE_MISSING');
  return { symbols, page_size: pageSize };
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeText(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, value, 'utf8');
}

async function handleHealth(request, outDir) {
  const body = await fetchBridge('/health');
  await writeJson(path.join(outDir, 'health.json'), body);
  return {
    status: body?.ok === true && body?.read_only === true && body?.writer_routes === false ? 'PASS' : 'BLOCKED',
    file: 'health.json',
  };
}

async function handleBlindBatch(request, outDir) {
  assert(Array.isArray(request.items) && request.items.length > 0, 'BLIND_ITEMS_REQUIRED');
  assert(request.items.length <= MAX_BLIND_ITEMS, 'TOO_MANY_BLIND_ITEMS');
  const items = request.items.map(validateBlindItem);
  const seen = new Set();
  for (const item of items) {
    assert(!seen.has(item.id), 'DUPLICATE_BLIND_ITEM_ID');
    seen.add(item.id);
  }
  const results = await mapLimit(items, 6, async (item) => {
    try {
      const body = await fetchBridge('/formal-blind', item);
      const file = `blind/${item.id}.json`;
      await writeJson(path.join(outDir, file), body);
      return {
        id: item.id,
        symbol: item.symbol,
        trade_date: item.trade_date,
        decision_time: item.decision_time,
        status: body?.formal_blind_eligible === true && body?.leakage_validated === true && body?.scorecard_eligible === true ? 'PASS' : 'BLOCKED',
        returned: Number(body?.returned ?? 0),
        file,
      };
    } catch (error) {
      const file = `blind/${item.id}.json`;
      const body = { ok: false, blocked: true, relay_error: String(error?.message ?? error) };
      await writeJson(path.join(outDir, file), body);
      return { id: item.id, symbol: item.symbol, status: 'ERROR', file, error: body.relay_error };
    }
  });
  return {
    status: results.every((item) => item.status === 'PASS') ? 'PASS' : 'PARTIAL_OR_BLOCKED',
    item_count: results.length,
    items: results,
  };
}

async function handleMarketSnapshot(request, outDir) {
  let asOf = request.as_of ? String(request.as_of) : '';
  let revision = request.source_revision ? String(request.source_revision) : '';
  let manifestSha = null;
  if (asOf || revision) {
    assert(validDate(asOf), 'MARKET_AS_OF_INVALID');
    assert(validRevision(revision), 'MARKET_REVISION_INVALID');
  } else {
    const latestHtml = await fetchBridge('/market-latest', {}, 'text');
    await writeText(path.join(outDir, 'market/latest.html'), latestHtml);
    const latest = parseMarketLatest(latestHtml);
    asOf = latest.as_of;
    revision = latest.source_revision;
    manifestSha = latest.manifest_sha;
  }

  const prefixResults = [];
  for (const prefix of ['0','1','2','3','4','5','6','7','8','9']) {
    const first = await fetchBridge('/market', { as_of: asOf, source_revision: revision, prefix, page: 1 }, 'text');
    const meta = validateMarketPage(first, revision);
    const pageCount = Math.max(1, Math.ceil(meta.symbols / meta.page_size));
    assert(pageCount <= 50, 'MARKET_PAGE_COUNT_EXCEEDS_BOUND');
    const files = [];
    const firstFile = `market/prefix-${prefix}-page-1.html`;
    await writeText(path.join(outDir, firstFile), first);
    files.push(firstFile);
    for (let page = 2; page <= pageCount; page += 1) {
      const html = await fetchBridge('/market', { as_of: asOf, source_revision: revision, prefix, page }, 'text');
      validateMarketPage(html, revision);
      const file = `market/prefix-${prefix}-page-${page}.html`;
      await writeText(path.join(outDir, file), html);
      files.push(file);
    }
    prefixResults.push({ prefix, symbols: meta.symbols, page_size: meta.page_size, page_count: pageCount, files });
  }

  return {
    status: 'PASS',
    as_of: asOf,
    source_revision: revision,
    manifest_sha: manifestSha,
    prefixes: prefixResults,
  };
}

async function handleOhlcBatch(request, outDir) {
  assert(validDate(request.as_of), 'OHLC_AS_OF_INVALID');
  assert(validRevision(request.source_revision), 'OHLC_REVISION_INVALID');
  assert(Array.isArray(request.symbols) && request.symbols.length > 0, 'OHLC_SYMBOLS_REQUIRED');
  assert(request.symbols.length <= MAX_OHLC_SYMBOLS, 'TOO_MANY_OHLC_SYMBOLS');
  const symbols = request.symbols.map(validateOhlcSymbol);
  assert(new Set(symbols).size === symbols.length, 'DUPLICATE_OHLC_SYMBOL');
  const limit = boundedInt(request.limit, 220, 20, 420);
  const results = await mapLimit(symbols, 6, async (symbol) => {
    try {
      const body = await fetchBridge('/ohlc-1d', {
        symbol,
        as_of: request.as_of,
        source_revision: request.source_revision,
        limit,
      });
      const file = `ohlc-1d/${symbol}.json`;
      await writeJson(path.join(outDir, file), body);
      const revisionMatches = String(body?.source_revision ?? '').toLowerCase() === String(request.source_revision).toLowerCase();
      return {
        symbol,
        status: body?.ok === true && body?.formal_research_eligible === true && revisionMatches ? 'PASS' : 'BLOCKED',
        returned: Number(body?.returned ?? 0),
        file,
      };
    } catch (error) {
      const file = `ohlc-1d/${symbol}.json`;
      const body = { ok: false, blocked: true, relay_error: String(error?.message ?? error) };
      await writeJson(path.join(outDir, file), body);
      return { symbol, status: 'ERROR', file, error: body.relay_error };
    }
  });
  return {
    status: results.every((item) => item.status === 'PASS') ? 'PASS' : 'PARTIAL_OR_BLOCKED',
    as_of: request.as_of,
    source_revision: request.source_revision,
    symbols: results,
  };
}

export async function processRelayRequest(requestPath, cwd = process.cwd()) {
  const normalized = requestPath.replaceAll('\\', '/');
  assert(normalized.startsWith(`${REQUEST_ROOT}/`), 'REQUEST_PATH_OUTSIDE_RELAY_ROOT');
  assert(normalized.endsWith('.json'), 'REQUEST_PATH_MUST_BE_JSON');
  const raw = await fs.readFile(path.join(cwd, requestPath), 'utf8');
  const request = JSON.parse(raw);
  assert(isObject(request), 'INVALID_REQUEST_OBJECT');
  assert(request.schema === REQUEST_SCHEMA, 'INVALID_REQUEST_SCHEMA');
  assert(validRequestId(request.request_id), 'INVALID_REQUEST_ID');
  assert(path.basename(normalized) === `${request.request_id}.json`, 'REQUEST_ID_PATH_MISMATCH');
  assert(['health','formal_blind_batch','market_snapshot','ohlc_1d_batch'].includes(request.kind), 'INVALID_REQUEST_KIND');

  const outDir = path.join(cwd, RESPONSE_ROOT, request.request_id);
  try {
    const existing = await fs.readFile(path.join(outDir, 'index.json'), 'utf8');
    const parsed = JSON.parse(existing);
    assert(parsed.request_sha256 === sha256(raw), 'EXISTING_RESPONSE_REQUEST_MISMATCH');
    return { idempotent: true, index: parsed };
  } catch (error) {
    if (error?.code !== 'ENOENT' && !String(error?.message ?? '').includes('EXISTING_RESPONSE_REQUEST_MISMATCH')) throw error;
    if (String(error?.message ?? '').includes('EXISTING_RESPONSE_REQUEST_MISMATCH')) throw error;
  }

  await fs.mkdir(outDir, { recursive: false });
  let result;
  try {
    if (request.kind === 'health') result = await handleHealth(request, outDir);
    if (request.kind === 'formal_blind_batch') result = await handleBlindBatch(request, outDir);
    if (request.kind === 'market_snapshot') result = await handleMarketSnapshot(request, outDir);
    if (request.kind === 'ohlc_1d_batch') result = await handleOhlcBatch(request, outDir);
  } catch (error) {
    result = { status: 'ERROR', error: String(error?.message ?? error) };
  }

  const index = {
    schema: 'AUTOMATION_RESEARCH_RELAY_RESPONSE_V1',
    relay_version: RELAY_VERSION,
    request_schema: REQUEST_SCHEMA,
    request_id: request.request_id,
    request_kind: request.kind,
    request_sha256: sha256(raw),
    generated_at_utc: new Date().toISOString(),
    bridge_base_id: 'taistock-mcp-production-automation-research',
    read_only: true,
    writer_routes: false,
    ...result,
  };
  await writeJson(path.join(outDir, 'index.json'), index);
  return { idempotent: false, index };
}

async function main() {
  const requestPath = process.argv[2];
  if (!requestPath) throw new Error('USAGE: node scripts/automation-research-github-relay.mjs <request.json>');
  const result = await processRelayRequest(requestPath);
  console.log(JSON.stringify(result.index));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.stack ?? String(error));
    process.exit(1);
  });
}
