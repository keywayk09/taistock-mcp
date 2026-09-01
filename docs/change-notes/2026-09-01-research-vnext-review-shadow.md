# Change Note — Research VNext Review Metrics Shadow

- Date: 2026-09-01
- Branch: `refactor/research-vnext-foundation-20260901`
- Parent foundation commit: `3d710c8cbfd655bd5241e07daadc0c16627cd664`
- Foundation verification: Run `33495611664` — SUCCESS
- Production mutation: **NONE**
- Production registration change: **NONE**

## Purpose

Migrate the first real Research VNext capability as a deterministic-only slice: review metrics. GPT remains responsible for interpretation, hypotheses, counter-evidence and research decisions.

## Test-before-build proof

RED commit: `92491635900371513e01b3ea25708e781aa77de8`.

Research VNext Incremental Gate Run `33495962952`, job `99818105320`:

- Change Note / protected-surface scope gate: **PASS**
- Existing Research VNext foundation boundary test: **PASS**
- New review metrics shadow test: **FAIL (EXPECTED RED)**
- Failure: `ERR_MODULE_NOT_FOUND` for `src/v6/research-vnext/compute/review-metrics.ts`
- Type-check / full existing research regression / Wrangler dry-run: correctly **SKIPPED** after RED

The failed receipt is preserved and was not rewritten as a pass.

## Frozen shadow contract

Legacy `summarizeReviewRows()` and VNext `summarizeReviewMetrics()` consume the same frozen inputs. Required verdict is `STRICT_DEEP_EQUAL` for every case; approximate parity is not accepted.

Frozen cases cover empty input, mixed TW-stock/TXF units, wins-only PF behavior, losses-only PF behavior, explicit-null legacy semantics and deterministic breakdown ordering.

The test also proves VNext is an independent implementation and does not absorb legacy interpretation/hypothesis generation.

## GREEN implementation

Implementation commit: `65123ddc9cb00c071209b8c6a4a672acd0537a3f`.

Added `src/v6/research-vnext/compute/review-metrics.ts` only.

Responsibilities:

- deterministic normalization of TW-stock percentage units versus TXF point units;
- count / evaluated count / wins / losses / flats;
- win rate / expectancy / profit factor;
- MFE / MAE descriptive statistics;
- 5m ambiguity and 1m replay-required counts;
- deterministic market/strategy/side breakdown sorting.

Hard boundaries:

- no network/provider access;
- no persistence or OHLC writes;
- no hypotheses, observations or strategy decisions;
- no import/delegation to legacy review implementation;
- no Production registration.

### Intentional migration rule

Current legacy numeric semantics are preserved exactly, including explicit-null behavior. Semantic corrections require a separate test-first change; they are not hidden inside architecture migration.

## GREEN verification

Research VNext Incremental Gate Run `33496155753`, job `99818721298`: **SUCCESS**.

Passed:

- protected-surface scope gate;
- all Research VNext tests, including 6 frozen strict-parity review cases;
- type-check;
- full existing `test:research`;
- Wrangler dry-run;
- immutable-style receipt and artifact upload.

Independent repository CI Run `33496155834`, job `99818721933`: **SUCCESS** with type-check, full `test:research`, and Wrangler dry-run all passing.

Evidence artifact:

- Artifact ID: `9795809480`
- Name: `research-vnext-evidence-33496155753`
- Digest: `sha256:76ed3db9367d35096fcabccf20a2de5263a09aa7ee0ef387b680a4f1593587a6`
- Expiry: 2026-10-01

## Explicitly not changed

- legacy `src/v6/review-orchestrator.ts`
- `src/v6/review-orchestrator-tools.ts`
- `src/v6/research-tools.ts`
- `src/v6/owner-content-handler.ts`
- `src/index-v6.ts`
- public MCP tool ABI
- Family / OAuth / Market Data / FORMAL Blind / OHLC / Crypto
- `wrangler.jsonc`
- Production deployment workflow

## Rollback

Remove the unregistered VNext review-metrics module and shadow tests. No Production registration points to VNext.

## Evidence log

| Stage | Evidence | Result |
|---|---|---|
| Foundation prerequisite | Run `33495611664` | PASS |
| Review metrics RED | Run `33495962952`, job `99818105320` | EXPECTED FAIL |
| Implementation | commit `65123ddc` | PASS |
| VNext gate | Run `33496155753`, job `99818721298` | PASS |
| Independent repo CI | Run `33496155834`, job `99818721933` | PASS |
| Artifact | `9795809480`, digest `76ed3d...3587a6` | STORED |

## Final disposition

`PHASE_2_PASS_UNREGISTERED_SHADOW`
