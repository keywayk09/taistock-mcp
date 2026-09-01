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

The probe must be capable of validating, after a future explicitly authorized deploy:

- Owner MCP connectivity;
- protocol negotiation across the current legacy `McpAgent` lane and newer stateless MCP transport;
- `tools/list` visibility;
- frozen migrated tool names;
- read-only calls for switched lanes where safe;
- bounded auth/protocol/tool failures;
- machine-readable immutable-style receipt generation.

## GREEN implementation scope

Authorized after legal RED:

1. `scripts/research-vnext-production-probe.mjs`
   - Node built-ins only; no new runtime dependency;
   - modern `2026-07-28` stateless `tools/list` attempted first;
   - falls back to `2025-06-18` initialize + `Mcp-Session-Id` when required;
   - parses JSON and Streamable HTTP SSE `data:` payloads;
   - optional bearer token is propagated only in the request header and never serialized into the receipt;
   - deterministic synthetic Replay input is generated locally with a reproducible frozen dataset hash;
   - no Cloudflare API request, no deployment, no provider fetch, no storage mutation;
   - exports testable helpers and a CLI entry point.

2. `.github/workflows/research-vnext-production-validation.yml`
   - `workflow_dispatch` only;
   - `permissions: contents: read`;
   - no push/pull_request/schedule trigger;
   - no `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`;
   - no `wrangler deploy` or Cloudflare control-plane request;
   - optional dedicated `RESEARCH_VNEXT_PROBE_TOKEN` only for MCP read access;
   - default Production endpoint requires exact manual confirmation `READ_ONLY_PRODUCTION_PROBE`;
   - uploads only the machine-readable probe receipt.

## Safe live-call scope

Future live validation may call only non-mutating operations.

- `tools/list`: always required.
- `resolve_ambiguous_backtest_with_1m`: deterministic synthetic frozen evidence only; no persistence/provider access.
- `finalize_daily_review_run`: only with empty cases and `persist_experiment:false`, so no experiment write occurs.
- `prepare_swing_selection_run`: optional read-only ledger query only after a known-safe trade date is explicitly supplied.

The preflight harness itself is tested only against local mock HTTP servers in CI. It must not contact Production automatically.

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

## GREEN requirements

The local mock harness must prove:

- modern stateless negotiation and `tools/list`;
- legacy initialize/session fallback and session propagation;
- JSON response parsing;
- SSE `data:` response parsing;
- bearer header propagation without receipt/token leakage;
- non-2xx / JSON-RPC errors fail closed;
- expected migrated tool visibility checks;
- synthetic Replay payload is accepted by the actual deterministic replay engine;
- manual workflow safety contract.

Then run:

- all Research VNext tests;
- frozen public ABI snapshot;
- type-check;
- full `test:research`;
- Wrangler dry-run;
- six-domain Isolation Gate.

## Explicitly forbidden in this phase

- merge PR #206;
- dispatch `deploy-cloudflare-production.yml`;
- dispatch the new manual Production validation workflow during preflight CI;
- real `wrangler deploy`;
- Cloudflare API writes;
- OAuth KV mutation;
- Cron mutation;
- Production MCP invocation from automatic CI;
- Legacy deletion;
- Owner/Family/OAuth/Market Data/FORMAL/OHLC runtime changes;
- public ABI changes.

## GREEN evidence

Pending.

## Artifact / hash

Pending.

## Production blocker after GREEN

Even if this preflight is GREEN, actual Production validation remains blocked until both are explicitly resolved:

1. a deployment path that does not unexpectedly mutate unrelated OAuth/Cron resources, or explicit approval to use the canonical deployment side effects;
2. a dedicated read-only MCP credential if Production Owner MCP requires OAuth.

## Rollback

Delete the probe script/manual workflow/test/Change Note. No Production state exists to roll back.

## Final disposition

`PRODUCTION_VALIDATION_PREFLIGHT_GREEN_IMPLEMENTATION_ALLOWED`
