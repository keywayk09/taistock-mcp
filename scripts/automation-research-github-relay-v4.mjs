#!/usr/bin/env node
// GitHub relay V4 for ChatGPT automation research.
// V4 keeps V3's narrow retry semantics but serializes FORMAL Blind verification.
// This avoids burst-loading the canonical verifier and adds a small inter-item
// pacing delay. Semantic/data failures remain fail-closed; only canonical
// verification HTTP 429/5xx responses are retried.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  processRelayRequest as processRelayRequestV3,
  fetchFormalBlindWithSemanticRetry,
} from './automation-research-github-relay-v3.mjs';
import { REQUEST_SCHEMA } from './automation-research-github-relay-v2.mjs';

export const RELAY_VERSION = 'automation-research-github-relay/v4.0.0';
const REQUEST_ROOT = 'runtime/automation-research-relay/requests';
const RESPONSE_ROOT = 'runtime/automation-research-relay/responses';
const MAX_BLIND_ITEMS = 80;
const INTER_ITEM_DELAY_MS = 650;
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

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function handleBlindBatch(request, outDir) {
  assert(Array.isArray(request.items) && request.items.length > 0, 'BLIND_ITEMS_REQUIRED');
  assert(request.items.length <= MAX_BLIND_ITEMS, 'TOO_MANY_BLIND_ITEMS');
  const items = request.items.map(validateBlindItem);
  assert(new Set(items.map((item) => item.id)).size === items.length, 'DUPLICATE_BLIND_ITEM_ID');

  const results = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const file = `blind/${item.id}.json`;
    try {
      const retry = await fetchFormalBlindWithSemanticRetry(item, {
        delays: FORMAL_SEMANTIC_RETRY_DELAYS_MS,
      });
      const body = retry.body;
      await writeJson(path.join(outDir, file), body);
      const status = body?.formal_blind_eligible === true
        && body?.formal_research_eligible === true
        && body?.leakage_validated === true
        && body?.scorecard_eligible === true ? 'PASS' : 'BLOCKED';
      results.push({
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
      });
    } catch (error) {
      const body = { ok: false, blocked: true, relay_error: String(error?.message ?? error) };
      await writeJson(path.join(outDir, file), body);
      results.push({
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
      });
    }
    if (index < items.length - 1) await sleep(INTER_ITEM_DELAY_MS);
  }

  const passCount = results.filter((item) => item.status === 'PASS').length;
  const blocked = results.filter((item) => item.status === 'BLOCKED');
  const errors = results.filter((item) => item.status === 'ERROR');
  return {
    status: passCount === results.length ? 'PASS' : 'PARTIAL_OR_BLOCKED',
    item_count: results.length,
    pass_count: passCount,
    blocked_count: blocked.length,
    error_count: errors.length,
    concurrency: 1,
    inter_item_delay_ms: INTER_ITEM_DELAY_MS,
    semantic_retry_delays_ms: FORMAL_SEMANTIC_RETRY_DELAYS_MS,
    total_transient_retries: results.reduce((sum, item) => sum + Number(item.transient_retries || 0), 0),
    blocked_symbols: blocked.map((item) => item.symbol),
    error_symbols: errors.map((item) => item.symbol),
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
    return processRelayRequestV3(requestPath, cwd);
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
  if (!requestPath) throw new Error('USAGE: node scripts/automation-research-github-relay-v4.mjs <request.json>');
  const result = await processRelayRequest(requestPath);
  console.log(JSON.stringify(result.index));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.stack ?? String(error));
    process.exit(1);
  });
}
