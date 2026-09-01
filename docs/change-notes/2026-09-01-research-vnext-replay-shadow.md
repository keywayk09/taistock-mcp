# Change Note — Research VNext Selective 1m Replay Shadow

- Date: 2026-09-01
- Branch: `refactor/research-vnext-foundation-20260901`
- Prerequisite swing evidence commit: `dee1f45e7e5a24894765ce8e6ef9285fed053acd`
- Prerequisite verification: Run `33496676642` — SUCCESS
- Production mutation: **NONE**
- Production registration change: **NONE**

## Purpose

Migrate the selective 1m replay deterministic core into Research VNext while preserving the existing frozen-data and conservative-resolution semantics exactly. GPT remains the interpretation/reasoning owner; replay only resolves factual intrabar ordering when the evidence permits it.

## Test-before-build proof

RED commit: `86c8185296831e9247d811d9b817c5482e82a3eb`.

Research VNext Incremental Gate Run `33496955813`, job `99821231898`:

- Change Note / protected-surface scope gate: **PASS**
- Foundation boundary test: **PASS**
- New replay shadow test: **FAIL (EXPECTED RED)**
- Failure: `ERR_MODULE_NOT_FOUND` for `src/v6/research-vnext/compute/selective-1m-replay.ts`
- Type-check / full existing research regression / Wrangler dry-run: correctly **SKIPPED** after RED.

The failed receipt is preserved and must not be relabeled as a pass.

## Frozen shadow contract

Strict success parity covers:

1. target touched first in chronological 1m bars;
2. stop touched first;
3. both touched in the same 1m bar, preserving conservative `STOP_FIRST`.

Strict error-code parity covers:

1. replay inconsistency where neither stop nor target is reproduced;
2. tampered 1m rows that no longer reproduce the frozen dataset hash;
3. replay requested for a 5m result that is not explicitly ambiguous/replay-required.

## GREEN implementation

Added only `src/v6/research-vnext/compute/selective-1m-replay.ts`.

It independently implements the existing deterministic replay contract while retaining the existing public replay schema and engine identity during migration. A separate internal constant, `RESEARCH_VNEXT_REPLAY_IMPLEMENTATION_VERSION`, identifies the VNext implementation without changing returned evidence.

Required invariants retained:

- exact frozen dataset/version/hash verification;
- exact row count and chronological/duplicate/OHLC validation;
- exact symbol/trade-date/bucket boundary checks;
- no future data outside the ambiguous 5m bucket;
- legacy conservative 5m result preserved in output;
- deterministic replay identity/hash;
- no fetch/provider access;
- no OHLC writes/persistence;
- no runtime-clock dependency;
- no GPT hypothesis/interpretation logic;
- no import/delegation to legacy selective replay;
- no Production registration.

### GREEN validation false-positive receipt

First GREEN validation after implementation:

- Run `33497120218`, job `99821757062`: **FAIL**.
- Scope gate and foundation boundary: **PASS**.
- Failure occurred in the replay boundary assertion before downstream regression.
- Root cause: the static test searched the raw source text for `hypoth|observation|interpretation`; the module comment correctly stated that GPT remains the sole `interpretation` owner, so the comment itself triggered the rule.
- This was a **test false positive**, not replay-semantic drift.
- The failed run remains preserved as a failed receipt.

Correction commit: `754ed97ece6892e1914305905978f3476078c410`.

The boundary gate was not removed or relaxed. It now strips comments before checking executable source for forbidden reasoning ownership, provider access, runtime-clock access, or legacy replay delegation. Therefore actual executable code remains fail-closed while documentation comments no longer create false positives.

### Intentional migration rule

Public replay output semantics and version identity remain unchanged during architecture migration so GPT/tool consumers see strict parity. Any future replay-semantic or public-version change must be a separate test-first change with its own Change Note.

## Explicitly not changed

- legacy `src/v6/selective-1m-replay.ts`
- `src/v6/selective-1m-replay-tool.ts`
- `src/v6/research-tools.ts`
- `src/v6/owner-content-handler.ts`
- `src/index-v6.ts`
- public MCP ABI
- Family / OAuth / Market Data / FORMAL Blind / OHLC / Crypto
- `wrangler.jsonc`
- Production deployment topology

## Evidence log

| Stage | Evidence | Result |
|---|---|---|
| Swing prerequisite | Run `33496676642` | PASS |
| Replay RED | Run `33496955813`, job `99821231898` | EXPECTED FAIL — missing VNext replay module |
| First replay GREEN validation | Run `33497120218`, job `99821757062` | FAIL — static-comment false positive; preserved |
| Gate false-positive correction | Commit `754ed97ece6892e1914305905978f3476078c410` | executable-code-aware boundary check |
| Replay implementation revalidation | pending | pending |
| Full regression | pending | pending |

## Rollback

Remove the unregistered VNext replay module and replay shadow test. No Production runtime depends on VNext.

## Final disposition

`IN_PROGRESS_GREEN_REVALIDATION`
