# Change Note — Research VNext GitHub Memory Adapter

- Date: 2026-09-01
- Branch: `refactor/research-vnext-foundation-20260901`
- Prerequisite Memory Core: Run `33498386438` — SUCCESS
- Production mutation: **NONE**
- Production registration change: **NONE**

## Purpose

Add a thin persistence adapter around the already-validated pure Research VNext Memory Core. The adapter owns only runtime timestamp acquisition and canonical GitHub immutable-store I/O. It must not own market-data providers, research reasoning, strategy promotion, or MCP registration.

## Test-before-build proof

RED commit: `80499a129ca3d7f077f466cfcdabc832045f65c9`.

Research VNext Incremental Gate:

- Run `33498693317`
- Job `99826716838`
- Change Note / protected-surface scope gate: **PASS**
- Existing VNext foundation: **PASS**
- Adapter test: **FAIL (EXPECTED RED)**
- Exact failure: `ERR_MODULE_NOT_FOUND` for `src/v6/research-vnext/memory/github-memory-adapter.ts`
- downstream type-check / regression / dry-run: correctly **SKIPPED**

The failed receipt is preserved and is not a PASS.

## Frozen adapter responsibilities

- obtain `recorded_at` from an injectable clock, with runtime UTC clock as default;
- call pure Memory Core preparation functions;
- write via canonical `putIndexedImmutableRecord` only;
- read/list via canonical indexed-store functions only;
- preserve immutable conflict and idempotent replay semantics;
- translate `GitHubDataStoreError` into VNext memory errors while preserving error codes;
- preserve `GITHUB_ONLY`, `REVIEW_DOES_NOT_MUTATE_STRATEGY`, and `production_promotion=FORBIDDEN` markers;
- no direct `fetch`;
- no hypothesis/interpretation generation;
- no Production registration.

## GREEN implementation

Implementation commit: `68a2ee9d0c3f79f16fc2d07e5b7e76fadbbf2ecb`.

Added only `src/v6/research-vnext/memory/github-memory-adapter.ts`.

The adapter exposes:

- `recordMarketJudgment`
- `getMarketJudgment`
- `listMarketJudgments`
- `recordJudgmentReview`
- `recordTradingKnowledge`
- `listTradingKnowledge`

The review write first loads the exact immutable original judgment and then delegates all semantic validation/canonicalization to the pure Memory Core.

## Final GREEN evidence

Validated branch head: `c0659da186ca23e4148187f0653208eba94db01a`.

Research VNext Incremental Gate:

- Run `33498838356`
- Job `99827181438`
- Change Note / protected-surface scope gate: **PASS**
- all Research VNext tests: **PASS**
- in-memory immutable/idempotent/conflict tests: **PASS**
- review and knowledge persistence tests: **PASS**
- Type-check: **PASS**
- Full existing `test:research`: **PASS**
- Wrangler dry-run: **PASS**
- receipt/upload: **PASS**

Independent repository CI:

- Run `33498838310`
- Job `99827181947`
- Type-check: **PASS**
- Full existing `test:research`: **PASS**
- Wrangler dry-run: **PASS**

Artifact:

- ID `9796861323`
- name `research-vnext-evidence-33498838356`
- digest `sha256:519d02fe2e42abafed67e279cdc7a062a85d4b2164c2d689088778534f5b73ad`
- expires `2026-10-01`

## Explicitly not changed

- pure `memory-core.ts` persistence boundary
- legacy `gpt-judgment-memory.ts`
- `research-tools.ts`
- Owner / Family / Market Data / FORMAL / OHLC
- MCP ABI/tool count
- `wrangler.jsonc`
- Production deployment topology

## Evidence log

| Stage | Evidence | Result |
|---|---|---|
| Memory Core prerequisite | Run `33498386438` | PASS |
| Adapter RED | Run `33498693317`, job `99826716838` | EXPECTED FAIL — missing module |
| Adapter implementation | Commit `68a2ee9d0c3f79f16fc2d07e5b7e76fadbbf2ecb` | built, unregistered |
| Adapter GREEN | Run `33498838356`, job `99827181438` | PASS |
| Independent repo regression | Run `33498838310`, job `99827181947` | PASS |
| Immutable-style evidence | Artifact `9796861323` | PASS |

## Final disposition

`PASS_ADAPTER_UNREGISTERED`
