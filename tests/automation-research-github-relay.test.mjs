import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  BRIDGE_BASE,
  REQUEST_SCHEMA,
  processRelayRequest,
} from '../scripts/automation-research-github-relay.mjs';

async function tempRepo() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'automation-research-relay-'));
  await fs.mkdir(path.join(cwd, 'runtime/automation-research-relay/requests'), { recursive: true });
  // The production workflow initializes this fixed workspace before invoking the processor.
  await fs.mkdir(path.join(cwd, 'runtime/automation-research-relay/responses'), { recursive: true });
  return cwd;
}

async function writeRequest(cwd, request) {
  const relative = `runtime/automation-research-relay/requests/${request.request_id}.json`;
  await fs.writeFile(path.join(cwd, relative), `${JSON.stringify(request, null, 2)}\n`, 'utf8');
  return relative;
}

test('health relay calls only fixed Production bridge and writes read-only response', async () => {
  const cwd = await tempRepo();
  const request = {
    schema: REQUEST_SCHEMA,
    request_id: 'health-test-0001',
    kind: 'health',
  };
  const relative = await writeRequest(cwd, request);
  const seen = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), method: init?.method });
    return new Response(JSON.stringify({ ok: true, read_only: true, writer_routes: false }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const result = await processRelayRequest(relative, cwd);
    assert.equal(result.index.status, 'PASS');
    assert.equal(result.index.read_only, true);
    assert.equal(result.index.writer_routes, false);
    assert.deepEqual(seen, [{ url: `${BRIDGE_BASE}/health`, method: 'GET' }]);
    const written = JSON.parse(await fs.readFile(path.join(cwd, 'runtime/automation-research-relay/responses/health-test-0001/index.json'), 'utf8'));
    assert.equal(written.request_id, 'health-test-0001');
    assert.equal(written.status, 'PASS');
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('formal blind batch stays bounded and forwards only validated fields', async () => {
  const cwd = await tempRepo();
  const request = {
    schema: REQUEST_SCHEMA,
    request_id: 'blind-test-0001',
    kind: 'formal_blind_batch',
    arbitrary_url: 'https://example.com/should-never-be-used',
    items: [{
      id: 's2426-1000', symbol: '2426', trade_date: '2026-08-27', timeframe: '1m', decision_time: '10:00:00', limit: 300,
    }],
  };
  const relative = await writeRequest(cwd, request);
  const seen = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    return new Response(JSON.stringify({
      ok: true,
      formal_blind_eligible: true,
      formal_research_eligible: true,
      leakage_validated: true,
      scorecard_eligible: true,
      returned: 60,
      rows: [{ ts: 1 }],
    }), { status: 200 });
  };
  try {
    const result = await processRelayRequest(relative, cwd);
    assert.equal(result.index.status, 'PASS');
    assert.equal(result.index.item_count, 1);
    assert.equal(seen.length, 1);
    assert.match(seen[0], /^https:\/\/taistock-mcp\.keywayk09\.workers\.dev\/research\/automation\/formal-blind\?/);
    assert.doesNotMatch(seen[0], /example\.com/);
    const payload = JSON.parse(await fs.readFile(path.join(cwd, 'runtime/automation-research-relay/responses/blind-test-0001/blind/s2426-1000.json'), 'utf8'));
    assert.equal(payload.formal_blind_eligible, true);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('market snapshot pins one immutable revision across all prefixes and pages', async () => {
  const cwd = await tempRepo();
  const request = {
    schema: REQUEST_SCHEMA,
    request_id: 'market-test-0001',
    kind: 'market_snapshot',
  };
  const relative = await writeRequest(cwd, request);
  const revision = 'a'.repeat(40);
  const seen = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    seen.push(value);
    if (value === `${BRIDGE_BASE}/market-latest`) {
      return new Response(`<p>formal_research_eligible=true</p><p>as_of=2026-08-28</p><p>source_revision=${revision}</p><p>manifest_sha=${'b'.repeat(40)}</p>`, { status: 200 });
    }
    const parsed = new URL(value);
    assert.equal(parsed.searchParams.get('source_revision'), revision);
    assert.equal(parsed.searchParams.get('as_of'), '2026-08-28');
    const prefix = parsed.searchParams.get('prefix');
    const page = parsed.searchParams.get('page');
    assert.match(prefix ?? '', /^[0-9]$/);
    assert.equal(page, '1');
    return new Response(`<p>formal_research_eligible=true</p><p>source_revision=${revision}</p><p>symbols=1 page_size=80</p><table><tr><td>${prefix}</td></tr></table>`, { status: 200 });
  };
  try {
    const result = await processRelayRequest(relative, cwd);
    assert.equal(result.index.status, 'PASS');
    assert.equal(result.index.as_of, '2026-08-28');
    assert.equal(result.index.source_revision, revision);
    assert.equal(result.index.prefixes.length, 10);
    assert.equal(seen.length, 11);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('invalid request kind fails before any network call', async () => {
  const cwd = await tempRepo();
  const request = {
    schema: REQUEST_SCHEMA,
    request_id: 'invalid-test-01',
    kind: 'arbitrary_http',
    url: 'https://example.com',
  };
  const relative = await writeRequest(cwd, request);
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('must not run'); };
  try {
    await assert.rejects(() => processRelayRequest(relative, cwd), /INVALID_REQUEST_KIND/);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
