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

## Planned artifacts after legal RED

1. `scripts/research-vnext-production-probe.mjs`
   - Node built-ins only; no new runtime dependency;
   - auto-negotiates modern stateless MCP first and legacy initialize/session fallback;
   - supports JSON and Streamable HTTP SSE response bodies;
   - supports optional bearer token through environment only;
   - never logs the bearer token;
   - performs no Cloudflare API requests and no deployment;
   - exports testable client helpers and a CLI entry point.

2. `.github/workflows/research-vnext-production-validation.yml`
   - `workflow_dispatch` only;
   - `permissions: contents: read`;
   - no push/pull_request/schedule trigger;
   - no `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` or other Cloudflare control-plane secret;
   - no `wrangler deploy`;
   - no Cloudflare API mutation;
   - optional dedicated `RESEARCH_VNEXT_PROBE_TOKEN` only for MCP read access;
   - explicit manual confirmation required before the default Production URL may be contacted;
   - uploads only a probe receipt artifact.

## Safe live-call scope

Future live validation may call only non-mutating operations.

- `tools/list`: always required.
- `resolve_ambiguous_backtest_with_1m`: deterministic synthetic frozen evidence only; no persistence/provider access.
- `finalize_daily_review_run`: only with empty cases and `persist_experiment:false`, so no experiment write occurs.
- `prepare_swing_selection_run`: optional read-only ledger query only after a known-safe trade date is explicitly supplied.

The preflight harness itself will be tested only against local mock HTTP servers in CI. It must not contact Production automatically.

## TEST BEFORE BUILD

RED test:

- `tests/research-vnext-production-validation-preflight.test.ts`

A legal RED requires:

1. verify Switch Stability policy still blocks Legacy retirement;
2. verify frozen ABI remains `123` / frozen digest;
3. verify canonical deploy contains real deploy + OAuth KV + Cron mutation capability;
4. verify merge trigger would dispatch canonical Production deploy after merge;
5. print `PRODUCTION_VALIDATION_PREFLIGHT_RED_READY=PASS`;
6. only then fail precisely because `scripts/research-vnext-production-probe.mjs` does not yet exist.

Any earlier failure is not an accepted RED.

## GREEN requirements

After accepted RED, add only the probe script and manual validation workflow plus test-only adjustments if necessary.

The test must use local mock HTTP servers to prove:

- modern stateless negotiation and `tools/list`;
- legacy initialize/session fallback and session propagation;
- JSON response parsing;
- SSE `data:` response parsing;
- bearer header propagation without receipt/token leakage;
- non-2xx / JSON-RPC errors fail closed;
- expected migrated tool visibility checks;
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
- real `wrangler deploy`;
- Cloudflare API writes;
- OAuth KV mutation;
- Cron mutation;
- Production MCP invocation from CI;
- Legacy deletion;
- Owner/Family/OAuth/Market Data/FORMAL/OHLC runtime changes;
- public ABI changes.

## RED evidence

Pending.

## GREEN evidence

Pending.

## Production blocker after GREEN

Even if this preflight is GREEN, actual Production validation remains blocked until both are explicitly resolved:

1. a deployment path that does not unexpectedly mutate unrelated OAuth/Cron resources, or explicit approval to use the canonical deployment side effects;
2. a dedicated read-only MCP credential (if Production Owner MCP requires OAuth).

## Rollback

Delete the probe script/manual workflow/test/Change Note. No Production state exists to roll back.

## Final disposition

`RED_PENDING`
