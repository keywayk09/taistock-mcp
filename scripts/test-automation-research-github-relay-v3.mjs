#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  formalBlindTransientReason,
  fetchFormalBlindWithSemanticRetry,
} from './automation-research-github-relay-v3.mjs';

const transient503 = {
  formal_blind_eligible: false,
  formal_research_eligible: false,
  scorecard_eligible: false,
  eligibility_reason: 'CANONICAL_VERIFICATION_HTTP_503',
};
const transient429 = {
  formal_blind_eligible: false,
  formal_research_eligible: false,
  scorecard_eligible: false,
  eligibility_reason: 'CANONICAL_VERIFICATION_HTTP_429',
};
const permanentMismatch = {
  formal_blind_eligible: false,
  formal_research_eligible: false,
  scorecard_eligible: false,
  eligibility_reason: 'verification_required',
  canonical_verification_receipt: {
    quality_gate: { reason: 'official_ohlc_mismatch' },
  },
};
const pass = {
  formal_blind_eligible: true,
  formal_research_eligible: true,
  scorecard_eligible: true,
  leakage_validated: true,
  eligibility_reason: 'CANONICAL_OHLC_RESEARCH_GATE_VERIFIED',
};

assert.equal(formalBlindTransientReason(transient503), 'CANONICAL_VERIFICATION_HTTP_503');
assert.equal(formalBlindTransientReason(transient429), 'CANONICAL_VERIFICATION_HTTP_429');
assert.equal(formalBlindTransientReason(permanentMismatch), null);
assert.equal(formalBlindTransientReason(pass), null);

{
  const sequence = [transient503, transient503, pass];
  const sleeps = [];
  let calls = 0;
  const out = await fetchFormalBlindWithSemanticRetry(
    { symbol: '3624' },
    {
      load: async () => sequence[calls++],
      sleepImpl: async (ms) => sleeps.push(ms),
      delays: [0, 10, 20, 30],
    },
  );
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [10, 20]);
  assert.equal(out.attempts, 3);
  assert.equal(out.transient_retries, 2);
  assert.equal(out.last_transient_reason, null);
  assert.equal(out.body.formal_blind_eligible, true);
}

{
  let calls = 0;
  const out = await fetchFormalBlindWithSemanticRetry(
    { symbol: '5425' },
    {
      load: async () => { calls += 1; return permanentMismatch; },
      sleepImpl: async () => { throw new Error('permanent semantic failure must not sleep/retry'); },
      delays: [0, 10, 20, 30],
    },
  );
  assert.equal(calls, 1);
  assert.equal(out.attempts, 1);
  assert.equal(out.transient_retries, 0);
  assert.equal(out.body, permanentMismatch);
}

{
  let calls = 0;
  const sleeps = [];
  const out = await fetchFormalBlindWithSemanticRetry(
    { symbol: '2492' },
    {
      load: async () => { calls += 1; return transient503; },
      sleepImpl: async (ms) => sleeps.push(ms),
      delays: [0, 10, 20, 30],
    },
  );
  assert.equal(calls, 4);
  assert.deepEqual(sleeps, [10, 20, 30]);
  assert.equal(out.attempts, 4);
  assert.equal(out.transient_retries, 3);
  assert.equal(out.last_transient_reason, 'CANONICAL_VERIFICATION_HTTP_503');
}

console.log('Automation Research GitHub Relay V3 semantic retry policy: PASS');
