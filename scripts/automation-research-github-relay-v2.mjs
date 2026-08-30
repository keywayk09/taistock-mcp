#!/usr/bin/env node
// GitHub relay V2 for ChatGPT automation research.
// Security contract:
// - fixed Production bridge only; no caller-supplied URL/path
// - GET only; no research writer
// - immutable source_revision is preserved for market/OHLC
// - transient 429/5xx retries are bounded; semantic failures remain fail-closed

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const RELAY_VERSION = 'automation-research-github-relay/v2.0.0';
export const REQUEST_SCHEMA = 'AUTOMATION_RESEARCH_RELAY_REQUEST_V1';
export const BRIDGE_BASE = 'https://taistock-mcp.keywayk09.workers.dev/research/automation';

const REQUEST_ROOT = 'runtime/automation-research-relay/requests';
const RESPONSE_ROOT = 'runtime/automation-research-relay/responses';
const MAX_BLIND_ITEMS = 80;
const MAX_OHLC_SYMBOLS = 80;
const MAX_HTTP_BYTES = 8 * 1024 * 1024;
const RETRY_DELAYS_MS = [0, 900, 2200];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function assert(condition, message) { if (!condition) throw new Error(message); }
function validRequestId(value) { return /^[a-z0-9][a-z0-9._-]{7,79}$/.test(String(value ?? '')); }
function validItemId(value) { return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(value ?? '')); }
function validSymbol(value) { return /^\d{4,6}$/.test(String(value ?? '')); }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')); }
function validRevision(value) { return /^[0-9a-f]{40}$/i.test(String(value ?? '')); }
function validDecisionTime(value) { return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(value ?? '')); }

function boundedInt(value, fallback, min, max) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Math.trunc(Number(value));
  assert(Number.isFinite(n), 'INVALID_INTEGER');
  return Math.max(min, Math.min(max, n));
}

function query(params) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') q.set(key, String(value));
  }
  return q.toString();
}

async function fetchBridge(route, params = {}, expect = 'json') {
  assert(/^\/[a-z0-9-]+$/i.test(route), 'INVALID_FIXED_ROUTE');
  const suffix = query(params);
  const url = `${BRIDGE_BASE}${route}${suffix ? `?${suffix}` : ''}`;
  let lastError = null;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    if (RETRY_DELAYS_MS[attempt]) await sleep(RETRY_DELAYS_MS[attempt]);
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(70_000),
        headers: { 'user-agent': `${RELAY_VERSION} github-actions` },
      });
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(declared) && declared > MAX_HTTP_BYTES) throw new Error(`BRIDGE_RESPONSE_TOO_LARGE:${route}`);
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_HTTP_BYTES) throw new Error(`BRIDGE_RESPONSE_TOO_LARGE:${route}`);

      if (!response.ok) {
        const retriable = response.status === 429 || response.status >= 500;
        const error = new Error(`BRIDGE_HTTP_${response.status}:${route}`);
        if (retriable && attempt < RETRY_DELAYS_MS.length - 1) {
          lastError = error;
          continue;
        }
        throw error;
      }
      if (expect === 'text') return text;
      try { return JSON.parse(text); }
      catch { throw new Error(`BRIDGE_INVALID_JSON:${route}`); }
    } catch (error) {
      lastError = error;
      const message = String(error?.message ?? error);
      const retriableNetwork = /fetch failed|timeout|aborted|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message);
      if (retriableNetwork && attempt < RETRY_DELAYS_MS.length - 1) continue;
      throw error;
    }
  }
  throw lastError ?? new Error(`BRIDGE_FETCH_FAILED:${route}`);
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

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
async function writeText(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, value, 'utf8');
}

function validateBlindItem(item) {
  assert(isObject(item), 'INVALID_BLIND_ITEM');
  assert(validItemId(item.id), 'INVALID_BLIND_ITEM_ID');
  assert(validSymbol(item.symbol), 'INVALID_BLIND_SYMBOL');
  assert(validDate(item.trade_date), 'INVALID_BLIND_TRADE_DATE');
  assert(item.timeframe === '1m' || item.timeframe === '5m', 'INVALID_BLIND_TIMEFRAME');
  assert(validDecisionTime(item.decision_time), 'INVALID_BLIND_DECISION_TIME');
  return {
    id: String(item.id), symbol: String(item.symbol), trade_date: String(item.trade_date),
    timeframe: item.timeframe, decision_time: String(item.decision_time),
    limit: boundedInt(item.limit, 300, 1, 600),
  };
}

function parseMarketLatest(html) {
  assert(/formal_research_eligible=true/.test(html), 'MARKET_LATEST_NOT_FORMAL');
  const asOf = html.match(/as_of=(\d{4}-\d{2}-\d{2})/i)?.[1] ?? '';
  const revision = html.match(/source_revision=([0-9a-f]{40})/i)?.[1] ?? '';
  const manifestSha = html.match(/manifest_sha=([0-9a-f]{40})/i)?.[1] ?? null;
  assert(validDate(asOf), 'MARKET_LATEST_DATE_MISSING');
  assert(validRevision(revision), 'MARKET_LATEST_REVISION_MISSING');
  return { as_of: asOf, source_revision: revision, manifest_sha: manifestSha };
}

async function handleHealth(_request, outDir) {
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
  assert(new Set(items.map((item) => item.id)).size === items.length, 'DUPLICATE_BLIND_ITEM_ID');

  const results = await mapLimit(items, 6, async (item) => {
    const file = `blind/${item.id}.json`;
    try {
      const body = await fetchBridge('/formal-blind', item);
      await writeJson(path.join(outDir, file), body);
      return {
        id: item.id, symbol: item.symbol, trade_date: item.trade_date, decision_time: item.decision_time,
        status: body?.formal_blind_eligible === true && body?.formal_research_eligible === true
          && body?.leakage_validated === true && body?.scorecard_eligible === true ? 'PASS' : 'BLOCKED',
        returned: Number(body?.returned ?? 0), file,
      };
    } catch (error) {
      const body = { ok: false, blocked: true, relay_error: String(error?.message ?? error) };
      await writeJson(path.join(outDir, file), body);
      return { id: item.id, symbol: item.symbol, status: 'ERROR', error: body.relay_error, file };
    }
  });
  return { status: results.every((item) => item.status === 'PASS') ? 'PASS' : 'PARTIAL_OR_BLOCKED', item_count: results.length, items: results };
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

  const prefixes = [];
  for (const prefix of ['0','1','2','3','4','5','6','7','8','9']) {
    const body = await fetchBridge('/market-export', { as_of: asOf, source_revision: revision, prefix });
    assert(body?.ok === true && body?.formal_research_eligible === true, `MARKET_EXPORT_NOT_FORMAL:${prefix}`);
    assert(String(body?.source_revision ?? '').toLowerCase() === revision.toLowerCase(), `MARKET_EXPORT_REVISION_MISMATCH:${prefix}`);
    assert(String(body?.prefix ?? '') === prefix, `MARKET_EXPORT_PREFIX_MISMATCH:${prefix}`);
    assert(Array.isArray(body?.symbols), `MARKET_EXPORT_SYMBOLS_INVALID:${prefix}`);
    const file = `market/prefix-${prefix}.json`;
    await writeJson(path.join(outDir, file), body);
    prefixes.push({ prefix, symbol_count: body.symbols.length, file });
  }
  return { status: 'PASS', as_of: asOf, source_revision: revision, manifest_sha: manifestSha, prefixes };
}

async function handleOhlcBatch(request, outDir) {
  assert(validDate(request.as_of), 'OHLC_AS_OF_INVALID');
  assert(validRevision(request.source_revision), 'OHLC_REVISION_INVALID');
  assert(Array.isArray(request.symbols) && request.symbols.length > 0, 'OHLC_SYMBOLS_REQUIRED');
  assert(request.symbols.length <= MAX_OHLC_SYMBOLS, 'TOO_MANY_OHLC_SYMBOLS');
  const symbols = request.symbols.map((value) => String(value ?? ''));
  for (const symbol of symbols) assert(validSymbol(symbol), 'INVALID_OHLC_SYMBOL');
  assert(new Set(symbols).size === symbols.length, 'DUPLICATE_OHLC_SYMBOL');
  const limit = boundedInt(request.limit, 220, 20, 420);

  const results = await mapLimit(symbols, 6, async (symbol) => {
    const file = `ohlc-1d/${symbol}.json`;
    try {
      const body = await fetchBridge('/ohlc-1d', { symbol, as_of: request.as_of, source_revision: request.source_revision, limit });
      await writeJson(path.join(outDir, file), body);
      const revisionMatches = String(body?.source_revision ?? '').toLowerCase() === String(request.source_revision).toLowerCase();
      return { symbol, status: body?.ok === true && body?.formal_research_eligible === true && revisionMatches ? 'PASS' : 'BLOCKED', returned: Number(body?.returned ?? 0), file };
    } catch (error) {
      const body = { ok: false, blocked: true, relay_error: String(error?.message ?? error) };
      await writeJson(path.join(outDir, file), body);
      return { symbol, status: 'ERROR', error: body.relay_error, file };
    }
  });
  return { status: results.every((item) => item.status === 'PASS') ? 'PASS' : 'PARTIAL_OR_BLOCKED', as_of: request.as_of, source_revision: request.source_revision, symbols: results };
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
  await fs.mkdir(path.dirname(outDir), { recursive: true });
  try {
    const existing = JSON.parse(await fs.readFile(path.join(outDir, 'index.json'), 'utf8'));
    assert(existing.request_sha256 === sha256(raw), 'EXISTING_RESPONSE_REQUEST_MISMATCH');
    return { idempotent: true, index: existing };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
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
  if (!requestPath) throw new Error('USAGE: node scripts/automation-research-github-relay-v2.mjs <request.json>');
  const result = await processRelayRequest(requestPath);
  console.log(JSON.stringify(result.index));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.stack ?? String(error));
    process.exit(1);
  });
}
