# Change Note — Research VNext Swing Evidence Shadow

- Date: 2026-09-01
- Branch: `refactor/research-vnext-foundation-20260901`
- Prerequisite review-metrics commit: `65123ddc9cb00c071209b8c6a4a672acd0537a3f`
- Production mutation: **NONE**
- Production registration change: **NONE**

## Purpose

Migrate deterministic swing evidence without creating a backend trading brain. GPT remains the swing researcher and final reasoning/selection owner.

## Test-before-build proof

RED commit: `429544872c834868cc17e4e23c76f1458a52f52e`.

Research VNext Incremental Gate Run `33496517952`, job `99819864671`:

- Change Note / protected-surface scope gate: **PASS**
- Foundation boundary test: **PASS**
- Review metrics strict shadow-parity test: **PASS**
- Swing evidence shadow test: **FAIL (EXPECTED RED)**
- Failure: `ERR_MODULE_NOT_FOUND` for `src/v6/research-vnext/compute/swing-evidence.ts`
- downstream checks correctly skipped.

The failed receipt is preserved and was not rewritten as a pass.

## GREEN implementation

Implementation commit: `dee1f45e7e5a24894765ce8e6ef9285fed053acd`.

Added only `src/v6/research-vnext/compute/swing-evidence.ts`:

- `scoreSwingEvidence()` — mechanical score extraction using frozen legacy precedence;
- `rankSwingCandidateEvidence()` — deterministic filtering, deduplication, tie-break, sorting and bounded ranking;
- `summarizeSwingOutcomeEvidence()` — deterministic MFE/MAE and horizon-return summaries.

Hard boundaries:

- no network/provider access;
- no OHLC writes or persistence;
- no observations, hypotheses or narrative interpretation;
- no autonomous strategy promotion;
- no import/delegation to legacy review orchestrator;
- no Production tool registration.

Current legacy deterministic semantics are preserved exactly. Semantic changes require a separate test-first change.

## GREEN verification

Research VNext Incremental Gate Run `33496676642`, job `99820364672`: **SUCCESS**.

Passed:

- protected-surface scope gate;
- all Research VNext tests including strict swing shadow parity;
- type-check;
- full existing `test:research`;
- Wrangler dry-run;
- receipt/artifact upload.

Independent repository CI Run `33496676629`, job `99820364553`: **SUCCESS** with type-check, full `test:research`, and Wrangler dry-run all passing.

Evidence artifact:

- Artifact ID: `9796019468`
- Name: `research-vnext-evidence-33496676642`
- Digest: `sha256:81694d7a99bb626452ccb48008675e67cbcd8e072a0627e2776ab141aea1e9f2`
- Expiry: 2026-10-01

## Explicitly not changed

- legacy `src/v6/review-orchestrator.ts`
- `src/v6/review-orchestrator-tools.ts`
- `src/v6/research-tools.ts`
- `src/v6/owner-content-handler.ts`
- `src/index-v6.ts`
- public MCP ABI
- Family / OAuth / Market Data / FORMAL Blind / OHLC / Crypto
- `wrangler.jsonc`
- Production deployment topology

## Rollback

Remove the unregistered VNext swing evidence module and shadow test. No Production runtime depends on VNext.

## Evidence log

| Stage | Evidence | Result |
|---|---|---|
| Review-metrics prerequisite | Run `33496155753` | PASS |
| Swing RED | Run `33496517952`, job `99819864671` | EXPECTED FAIL |
| Implementation | commit `dee1f45e` | PASS |
| VNext gate | Run `33496676642`, job `99820364672` | PASS |
| Independent repo CI | Run `33496676629`, job `99820364553` | PASS |
| Artifact | `9796019468`, digest `81694d...a1e9f2` | STORED |

## Final disposition

`PHASE_3_PASS_UNREGISTERED_SHADOW`
