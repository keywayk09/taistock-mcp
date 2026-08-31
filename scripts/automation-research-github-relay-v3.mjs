#!/usr/bin/env node
// GitHub relay V3 for ChatGPT automation research.
// FORMAL Blind changes versus V2:
// - cap batch concurrency at 2 to avoid overwhelming canonical verification;
// - retry only transient canonical verification HTTP 429/5xx responses;
// - keep semantic/data failures fail-closed and never retry them into a PASS;
// - preserve the fixed Production bridge, GET-only behavior and response receipts.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  processRelayRequest as processRelayRequestV2,
  REQUEST_SCHEMA,
  BRIDGE_BASE,
} from './automation-research-github-relay-v2.mjs';

export const RELAY_VERSION = 'automation-research-github-relay/v3.0.0';
const REQUEST_ROOT = 'runtime/automation-research-relay/requests';
const RESPONSE_ROOT = 'runtime/automation-research-relay/responses';
const MAX_BLIND_ITEMS = 80;
const MAX_HTTP_BYTES = 8 * 1024 * 1024;
const BLIND_CONCURRENCY = 2;
const HTTP_RETRY_DELAYS_MS = [0, 900, 2200];
export const FORMAL_SEMANTIC_RETRY_DELAYS_MS = [0, 1500, 4000, 9000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function assert(condition, message) { if (!condition) throw new Error(message); }
function validRequestId(value) { return /^[a-z0-9][a-z0-9._-]{7,79}$/.test(String(value ?? '')); }
function validItemId(value) { return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(value ?? '')); }
function validSymbol(value) { return /^\d{4,6}$/.test(String(value ?? '')); }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')); }
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

async function fetchBlindBody(item) {
  const suffix = query(item);
  const url = `${BRIDGE_BASE}/formal-blind?${suffix}`;
  let lastError = null;

  for (let attempt = 0; attempt < HTTP_RETRY_DELAYS_MS.length; attempt += 1) {
    if (HTTP_RETRY_DELAYS_MS[attempt]) await sleep(HTTP_RETRY_DELAYS_MS[attempt]);
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(70_000),
        headers: { 'user-agent': `${RELAY_VERSION} github-actions` },
      });
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(declared) && declared > MAX_HTTP_BYTES) throw new Error('BRIDGE_RESPONSE_TOO_LARGE:/formal-blind');
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_HTTP_BYTES) throw new Error('BRIDGE_RESPONSE_TOO_LARGE:/formal-blind');

      if (!response.ok) {
        const retriable = response.status === 429 || response.status >= 500;
        const error = new Error(`BRIDGE_HTTP_${response.status}:/formal-blind`);
        if (retriable && attempt < HTTP_RETRY_DELAYS_MS.length - 1) {
          lastError = error;
          continue;
        }
        throw error;
      }
      try { return JSON.parse(text); }
      catch { throw new Error('BRIDGE_INVALID_JSON:/formal-blind'); }
    } catch (error) {
      lastError = error;
      const message = String(error?.message ?? error);
      const retriableNetwork = /fetch failed|timeout|aborted|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message);
      if (retriableNetwork && attempt < HTTP_RETRY_DELAYS_MS.length - 1) continue;
      throw error;
    }
  }
  throw lastError ?? new Error('BRIDGE_FETCH_FAILED:/formal-blind');
}

export function formalBlindTransientReason(body) {
  const candidates = [
    body?.eligibility_reason,
    body?.canonical_verification_receipt?.eligibility_reason,
    body?.canonical_verification_receipt?.quality_gate?.reason,
  ].map((value) => String(value ?? '').trim()).filter(Boolean);
  return candidates.find((reason) => /^CANONICAL_VERIFICATION_HTTP_(?:429|5\d\d)$/.test(reason)) ?? null;
}

export async function fetchFormalBlindWithSemanticRetry(item, options = {}) {
  const load = options.load ?? (() => fetchBlindBody(item));
  const sleepImpl = options.sleepImpl ?? sleep;
  const delays = options.delays ?? FORMAL_SEMANTIC_RETRY_DELAYS_MS;
  let body = null;
  let transientReason = null;

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (attempt > 0 && delays[attempt]) await sleepImpl(delays[attempt]);
    body = await load(attempt);
    transientReason = formalBlindTransientReason(body);
    if (!transientReason) {
      return { body, attempts: attempt + 1, transient_retries: attempt, last_transient_reason: null };
    }
  }

  return {
    body,
    attempts: delays.length,
    transient_retries: Math.max(0, delays.length - 1),
    last_transient_reason: transientReason,
  };
}

async function handleBlindBatch(request, outDir) {
  assert(Array.isArray(request.items) && request.items.length > 0, 'BLIND_ITEMS_REQUIRED');
  assert(request.items.length <= MAX_BLIND_ITEMS, 'TOO_MANY_BLIND_ITEMS');
  const items = request.items.map(validateBlindItem);
  assert(new Set(items.map((item) => item.id)).size === items.length, 'DUPLICATE_BLIND_ITEM_ID');

  const results = await mapLimit(items, BLIND_CONCURRENCY, async (item) => {
    const file = `blind/${item.id}.json`;
    try {
      const retry = await fetchFormalBlindWithSemanticRetry(item);
      const body = retry.body;
      await writeJson(path.join(outDir, file), body);
      const status = body?.formal_blind_eligible === true
        && body?.formal_research_eligible === true
        && body?.leakage_validated === true
        && body?.scorecard_eligible === true ? 'PASS' : 'BLOCKED';
      return {
        id: item.id,
        symbol: item.symbol,
        trade_date: item.trade_date,
        decision_time: item.decision_time,
        status,
        returned: Number(body?.returned ?? 0),
        attempts: retry.attempts,
        transient_retries: retry.transient_retries,
        last_transient_reason: retry.last_transient_reason,
        file,
      };
    } catch (error) {
      const body = { ok: false, blocked: true, relay_error: String(error?.message ?? error) };
      await writeJson(path.join(outDir, file), body);
      return {
        id: item.id,
        symbol: item.symbol,
        trade_date: item.trade_date,
        decision_time: item.decision_time,
        status: 'ERROR',
        error: body.relay_error,
        attempts: 0,
        transient_retries: 0,
        last_transient_reason: null,
        file,
      };
    }
  });

  return {
    status: results.every((item) => item.status === 'PASS') ? 'PASS' : 'PARTIAL_OR_BLOCKED',
    item_count: results.length,
    concurrency: BLIND_CONCURRENCY,
    semantic_retry_delays_ms: FORMAL_SEMANTIC_RETRY_DELAYS_MS,
    total_transient_retries: results.reduce((sum, item) => sum + Number(item.transient_retries || 0), 0),
    items: results,
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

  if (request.kind !== 'formal_blind_batch') {
    return processRelayRequestV2(requestPath, cwd);
  }

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
    result = await handleBlindBatch(request, outDir);
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
  if (!requestPath) throw new Error('USAGE: node scripts/automation-research-github-relay-v3.mjs <request.json>');
  const result = await processRelayRequest(requestPath);
  console.log(JSON.stringify(result.index));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.stack ?? String(error));
    process.exit(1);
  });
}
