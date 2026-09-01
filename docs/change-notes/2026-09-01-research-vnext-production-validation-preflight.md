# Change Note — Research VNext Production Validation Preflight

- Date: `2026-09-01`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — must remain Draft/open/unmerged
- Prerequisite Switch Stability seal: `6ab68afc95b385e5d2c2a5fb9e194a6fe404e917`
- Switch Stability seal CI: Incremental `33506984946` SUCCESS; Type check `33506984972` SUCCESS; Isolation `33506984873` SUCCESS
- Frozen Owner ABI: `123` tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Legacy retirement: **BLOCKED_UNTIL_PRODUCTION_SWITCH_STABLE**
- Production deploy: **NONE**
- Production mutation: **NONE**

## Why a separate preflight is required

The canonical `.github/workflows/deploy-cloudflare-production.yml` is not an isolated validation workflow. In addition to deploying the Worker it can resolve/create the OAuth KV namespace, inject the binding, PUT the five-minute Cron trigger and run Production health smoke.

The merge-trigger workflow automatically dispatches that canonical Production deploy after a PR is merged into `main`.

Therefore PR #206 must not be merged merely to obtain Production validation evidence. Research VNext needs an independent read-only probe path first.

## Purpose

Build and test a reusable Production MCP validation probe without invoking Production in this phase.

The probe is capable of validating, after a future explicitly authorized deploy:

- Owner MCP connectivity;
- protocol negotiation across the current legacy `McpAgent` lane and newer stateless MCP transport;
- `tools/list` visibility;
- frozen migrated tool names;
- read-only calls for switched lanes where safe;
- bounded auth/protocol/tool failures;
- machine-readable immutable-style receipt generation.

## GREEN implementation

Implementation commit: `a434cc636a7e303a3e99dafba9bc4f4ddc1de8c1`.

Added only:

1. `scripts/research-vnext-production-probe.mjs`
   - Node built-ins only; no new runtime dependency;
   - modern `2026-07-28` stateless `tools/list` attempted first;
   - fallback to `2025-06-18` initialize + `Mcp-Session-Id` when required;
   - JSON and Streamable HTTP SSE `data:` response parsing;
   - optional bearer token propagated only in the request header and never serialized into the receipt;
   - deterministic synthetic Replay input generated locally with a reproducible frozen dataset hash;
   - CLI refuses the default Production origin unless `READ_ONLY_PRODUCTION_PROBE` confirmation is present;
   - no Cloudflare API request, deployment, provider fetch, storage mutation or subprocess execution.

2. `.github/workflows/research-vnext-production-validation.yml`
   - `workflow_dispatch` only;
   - `permissions: contents: read`;
   - no push/pull_request/schedule trigger;
   - no `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`;
   - no `wrangler deploy` or Cloudflare control-plane request;
   - optional dedicated `RESEARCH_VNEXT_PROBE_TOKEN` only for MCP read access;
   - default Production endpoint requires exact manual confirmation `READ_ONLY_PRODUCTION_PROBE`;
   - uploads only the machine-readable probe receipt.

No Owner/shared runtime file, canonical deploy workflow, OAuth, Market Data, FORMAL, OHLC, Family or public MCP contract was changed.

## Safe live-call scope

Future live validation may call only non-mutating operations.

- `tools/list`: always required.
- `resolve_ambiguous_backtest_with_1m`: deterministic synthetic frozen evidence only; no persistence/provider access.
- `finalize_daily_review_run`: only with empty cases and `persist_experiment:false`, so no experiment write occurs.
- `prepare_swing_selection_run`: optional read-only ledger query only after a known-safe trade date is explicitly supplied.

The preflight GREEN tests contacted local mock HTTP servers only. Production was not contacted.

## TEST BEFORE BUILD

RED test:

- `tests/research-vnext-production-validation-preflight.test.ts`
- RED commit: `1732f79fcad321c214a18175e1521fe559f2a167`

A legal RED required:

1. Switch Stability policy still blocks Legacy retirement;
2. frozen ABI remains `123` / frozen digest;
3. canonical deploy contains real deploy + OAuth KV + Cron mutation capability;
4. merge trigger would dispatch canonical Production deploy after merge;
5. marker `PRODUCTION_VALIDATION_PREFLIGHT_RED_READY=PASS` prints first;
6. only then fail because `scripts/research-vnext-production-probe.mjs` does not yet exist.

## RED evidence — ACCEPTED

Research VNext Incremental Gate:

- Run `33507603168`
- Job `99855296342`
- Change Note / protected-surface gate: **PASS**
- Phase 10B bounded exception: `PHASE10B_HANDLER_CUTOVER_EXCEPTION=PASS`
- all earlier Research VNext tests before this preflight: **PASS**
- preflight marker: `PRODUCTION_VALIDATION_PREFLIGHT_RED_READY=PASS`
- Owner tool count: `123`
- Owner ABI digest: `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- canonical deploy isolated-read-only classification: `false`
- Legacy retirement policy: `BLOCKED_UNTIL_PRODUCTION_SWITCH_STABLE`
- Production mutation: **NONE**
- terminal failure: **EXPECTED RED**
- exact failure: `ERR_MODULE_NOT_FOUND` for `scripts/research-vnext-production-probe.mjs`
- downstream incremental type-check / full `test:research` / Wrangler dry-run: correctly **SKIPPED**

Disposition: `PRODUCTION_VALIDATION_PREFLIGHT_RED_ACCEPTED_IMPLEMENTATION_ALLOWED`.

## GREEN evidence — PASS

Implementation commit `a434cc636a7e303a3e99dafba9bc4f4ddc1de8c1` passed all required gates.

Research VNext Incremental Gate:

- Run `33508182730` — **SUCCESS**
- Job `99857171146` — **SUCCESS**
- Change Note / protected-surface gate: **PASS**
- all Research VNext tests: **PASS**
- Production validation preflight local mock test: **PASS**
- modern stateless protocol mock: **PASS**
- legacy initialize/session + SSE mock: **PASS**
- bearer propagation / receipt redaction: **PASS**
- synthetic Replay accepted by the actual deterministic replay engine: **PASS**
- manual workflow safety contract: **PASS**
- frozen public ABI snapshot test: **PASS** — `123` tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- incremental type-check: **PASS**
- full existing `test:research`: **PASS**
- Wrangler deploy dry-run: **PASS**
- evidence receipt upload: **PASS**

Independent Type check:

- Run `33508182777` — **SUCCESS**
- `npm run type-check`: **PASS**
- full `npm run test:research`: **PASS**
- `wrangler deploy --dry-run`: **PASS**

Isolation Gate:

- Run `33508182811` — **SUCCESS**
- VNEXT: **PASS**
- FAMILY: **PASS**
- MARKET_DATA: **PASS**
- FORMAL_BLIND: **PASS**
- OWNER_OPS: **PASS**
- BUNDLE: **PASS**
- isolation evidence finalizer: **PASS**

Additional triggered research regressions all completed **SUCCESS**:

- P7 Swing Outcome Path `33508182716`
- P8 Experiment Memory `33508182797`
- P9 Diamond Capability Registry `33508182711`
- P11 Research Validation `33508182848`
- P12 Strategy Lab Governance `33508182701`
- P13 Cross-market Supply Chain Graph `33508182754`
- P13b Supply Chain Data Plane `33508182865`
- P14 TXF Dual-market Review `33508182808`
- P15 Review Swing Orchestration `33508182789`
- P16 GPT Judgment Memory `33508182888`

Production contact during GREEN CI: **NONE**.
Production mutation during GREEN CI: **NONE**.

## Artifact / hash

Incremental evidence:

- Artifact ID: `9800492091`
- Name: `research-vnext-evidence-33508182730`
- Digest: `sha256:723d709be5fe634a595d8c3a46aed8077981d5238b693dbad807287706d38b7e`
- Expiry: `2026-10-01`

Isolation evidence:

- Artifact ID: `9800486604`
- Name: `research-vnext-isolation-evidence-33508182811`
- Digest: `sha256:b9c30faf4f0bf180c243b7f927f9c09488ee45d276fa7c2f14f3f21a28dc21c6`

Isolation bundle:

- Artifact ID: `9800480333`
- Digest: `sha256:9bb0dbdd4df0692454ba4accf1bead472943f2c2334682e1a6a82492d26d7560`

## Explicitly not authorized by this PASS

- merge PR #206;
- dispatch `deploy-cloudflare-production.yml`;
- dispatch the manual Production validation workflow without a separately authorized Production validation step;
- real `wrangler deploy`;
- OAuth KV or Cron mutation;
- Legacy deletion;
- declaring Production switched-path stability from branch/mock evidence alone.

## Production blockers after GREEN

Actual Production validation remains blocked until both are resolved:

1. a deployment path that does not unexpectedly mutate unrelated OAuth/Cron resources, or explicit approval to use the canonical deployment side effects;
2. a dedicated read-only MCP credential if Production Owner MCP requires OAuth.

The manual read-only probe is now ready, but readiness is not Production evidence.

## Rollback

Delete the probe script/manual workflow/test/Change Note. No Production state exists to roll back.

## Final disposition

`PASS_PRODUCTION_VALIDATION_PREFLIGHT_HARNESS_READY_PRODUCTION_NOT_CONTACTED`
