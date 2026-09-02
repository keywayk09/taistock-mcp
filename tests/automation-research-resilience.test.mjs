import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  BRIDGE_BASE,
  REQUEST_SCHEMA,
  processRelayRequest,
} from '../scripts/automation-research-github-relay-v2.mjs';

async function tempRepo() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'automation-research-resilience-'));
  await fs.mkdir(path.join(cwd, 'runtime/automation-research-relay/requests'), { recursive: true });
  return cwd;
}

async function writeRequest(cwd, request) {
  const relative = `runtime/automation-research-relay/requests/${request.request_id}.json`;
  await fs.writeFile(path.join(cwd, relative), `${JSON.stringify(request, null, 2)}\n`, 'utf8');
  return relative;
}

function latestHtml(revision) {
  return `<p>formal_research_eligible=true</p><p>as_of=2026-09-02</p><p>source_revision=${revision}</p><p>manifest_sha=${'b'.repeat(40)}</p>`;
}

function formalPrefix(prefix, revision) {
  return {
    ok: true,
    formal_research_eligible: true,
    source_revision: revision,
    prefix,
    symbols: [{ symbol: `${prefix}001`, institutional: { net_1d: 1 } }],
  };
}

test('market snapshot survives a bounded fourth-attempt 503 without restarting completed prefixes', async () => {
  const cwd = await tempRepo();
  const request = { schema: REQUEST_SCHEMA, request_id: 'resilience-market-503-01', kind: 'market_snapshot' };
  const relative = await writeRequest(cwd, request);
  const revision = 'a'.repeat(40);
  const calls = new Map();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value === `${BRIDGE_BASE}/market-latest`) return new Response(latestHtml(revision), { status: 200 });
    const parsed = new URL(value);
    const prefix = parsed.searchParams.get('prefix');
    calls.set(prefix, (calls.get(prefix) ?? 0) + 1);
    if (prefix === '6' && calls.get(prefix) <= 3) return new Response('temporary upstream outage', { status: 503 });
    return new Response(JSON.stringify(formalPrefix(prefix, revision)), { status: 200 });
  };
  try {
    const result = await processRelayRequest(relative, cwd);
    assert.equal(result.index.status, 'PASS');
    assert.equal(result.index.as_of, '2026-09-02');
    assert.equal(result.index.source_revision, revision);
    assert.equal(result.index.prefixes.length, 10);
    for (const prefix of ['0','1','2','3','4','5','7','8','9']) assert.equal(calls.get(prefix), 1, `prefix ${prefix} must not be restarted`);
    assert.equal(calls.get('6'), 4, 'only the transiently failed prefix should be retried');
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('market snapshot retries transient canonical-reader failure even when legacy bridge wraps it in HTTP 200', async () => {
  const cwd = await tempRepo();
  const request = { schema: REQUEST_SCHEMA, request_id: 'resilience-reader-503-01', kind: 'market_snapshot' };
  const relative = await writeRequest(cwd, request);
  const revision = 'c'.repeat(40);
  const calls = new Map();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value === `${BRIDGE_BASE}/market-latest`) return new Response(latestHtml(revision), { status: 200 });
    const parsed = new URL(value);
    const prefix = parsed.searchParams.get('prefix');
    calls.set(prefix, (calls.get(prefix) ?? 0) + 1);
    if (prefix === '6' && calls.get(prefix) === 1) {
      return new Response(JSON.stringify({
        ok: false,
        blocked: true,
        error: 'MARKET_EXPORT_READER_ERROR',
        reader_error: 'canonical_read_failed:503:data/market-data/index/2026/09/6.json',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(formalPrefix(prefix, revision)), { status: 200 });
  };
  try {
    const result = await processRelayRequest(relative, cwd);
    assert.equal(result.index.status, 'PASS');
    assert.equal(calls.get('6'), 2, 'retry only the transient wrapped reader failure');
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('semantic formal rejection is fail-closed and is not transport-retried', async () => {
  const cwd = await tempRepo();
  const request = { schema: REQUEST_SCHEMA, request_id: 'resilience-semantic-block-01', kind: 'market_snapshot' };
  const relative = await writeRequest(cwd, request);
  const revision = 'd'.repeat(40);
  const calls = new Map();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value === `${BRIDGE_BASE}/market-latest`) return new Response(latestHtml(revision), { status: 200 });
    const parsed = new URL(value);
    const prefix = parsed.searchParams.get('prefix');
    calls.set(prefix, (calls.get(prefix) ?? 0) + 1);
    if (prefix === '6') {
      return new Response(JSON.stringify({
        ok: false,
        blocked: true,
        error: 'MARKET_DATA_NOT_FORMAL',
        formal_research_eligible: false,
        prefix,
        source_revision: revision,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(formalPrefix(prefix, revision)), { status: 200 });
  };
  try {
    const result = await processRelayRequest(relative, cwd);
    assert.notEqual(result.index.status, 'PASS');
    assert.equal(calls.get('6'), 1, 'semantic/formal failures must never be retried as transport');
    assert.equal(calls.has('7'), false, 'fail closed before later prefixes after a semantic rejection');
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('immutable 40-char market revision must bypass moving-ref commit resolution', async () => {
  const source = await fs.readFile(new URL('../src/v6/market-data-cross-section.ts', import.meta.url), 'utf8');
  assert.match(
    source,
    /if\s*\(\/\^\[0-9a-f\]\{40\}\$\/i\.test\(branch\)\)\s*return\s+branch;/,
    'a pinned source_revision should not spend one GitHub /commits lookup per prefix',
  );
});
