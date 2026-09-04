# 2026-09-04 Family Shared Chip Read Plane migration

## Purpose

Unify Owner and Family current Taiwan-stock chip reads behind the same read-only on-demand facade without changing public ingress, OHLC ownership, historical replay semantics, or Family permissions.

## User-visible symptom that triggered this migration

A Family/Custom GPT query for recent 2330 broker branches reported that formal chip data only reached an older Published date and returned recent broker evidence as UNKNOWN. Another response incorrectly described broker-branch availability as blocked by a FinMind token. Those answers exposed semantic drift between the newer Owner on-demand chip plane and older Family Published-only wiring/instructions.

## Root causes found during test-first migration

1. `family-mcp.ts` still called the deterministic Published gateway directly for `get_family_market_chip_summary`.
2. `family-action-compat.ts` still built stock reads from Published-only chip data.
3. `family-smart-rest.ts` `/api/family/chips` also called Published directly.
4. Family planner/research/shared-read/evidence/OpenAPI/instructions still described Published generation as the current formal chip truth.
5. `family-custom-gpt-compact.ts` removed the entire `chip` section during Custom GPT response compaction, so a backend current-chip fix alone could still be invisible to the model.
6. The first new regression file was created but was not listed in `test:family-selection`; therefore `test:research` initially passed without executing it. The test was explicitly wired into the CI script before implementation was accepted.
7. Existing regressions later failed on stale implementation details such as Family MCP version `v3.5.0`; these are migrated only where they encode the retired Published-only current architecture. Formal Published replay/history tests remain unchanged.
8. `family-eleven-point.ts` still emitted user-visible point-8 and final-answer policies saying Published generation was the current formal chip layer. This could reintroduce the stale answer even after provider wiring was fixed. The 11-point contract was migrated to current official on-demand evidence while keeping Published as history/replay context.
9. The active `docs/FAMILY-UNIFIED-EVIDENCE-V4.md` specification also retained Published-only semantics. It was migrated so code, OpenAPI, instructions, tests and the active evidence specification share one identity contract.
10. `family-cloudflare-startup-graph.test.ts` still asserted `formal_market_chip: "PUBLISHED_GENERATION_ONLY"`. The runtime had already moved to the new current/history identity, so full `test:research` correctly failed. Only that stale source-identity assertion was migrated; the original lazy-loading, Cloudflare 10021, read-only, OHLC and no-Service-Binding startup guards remain unchanged.

## New evidence contract

### `current_chip` — FORMAL_TRUTH

Current institutional, margin/short, securities lending and SBL short-sale evidence comes from exact-date TWSE/TPEx on-demand official sources. Requested-date mismatch remains fail-closed/PENDING; previous-day substitution is forbidden. Current raw/normalized payloads are not persisted.

### `broker_branch` — GOVERNED_CONTEXT

MoneyDJ public broker output is `PUBLIC_SECONDARY` and `RANKED_ONLY`. Missing branches are not zero activity and the ranked page is not a complete broker inventory. Broker evidence has no FinMind-token dependency and remains fail-soft.

### `warrant_activity` — GOVERNED_CONTEXT

TWSE/TPEx official warrant turnover/volume may be used as activity/anomaly evidence only. It does not establish buy aggressor, broker net buying, dealer inventory direction or dealer hedge direction.

### `published_chip` — HISTORY / REPLAY CONTEXT

Existing Published generations remain immutable and readable for historical context, deterministic replay and research reproducibility. They are not deleted, rewritten or used to override available current official evidence.

### maintenance ratio

A true customer-account maintenance ratio is not reconstructed from public market aggregates. Any calculated value remains an explicitly labelled proxy and must fail closed when required price/cost inputs are absent.

## Wiring changes

- Owner existing tool names continue using `getTwMarketChipSummaryOnDemand`.
- Family MCP `get_family_market_chip_summary` now uses the same facade.
- Legacy Family Action stock reads now use the same facade.
- Family Smart REST `/api/family/chips` now uses the same facade.
- Family Unified Evidence separates official current chip, broker ranked context, warrant activity and Published history instead of treating them as interchangeable.
- Family Custom GPT compact transport retains a bounded `chip` summary.
- Family planner, research policy, shared-read manifest, OpenAPI, 11-point answer contract and Custom GPT instructions use the same current/history identity contract.
- The active Family Unified Evidence specification was aligned to the same contract.

## Frozen boundaries / unchanged behavior

- Owner primary ingress remains `/my-mcp`.
- Owner legacy alias remains `/mcp`.
- Family MCP remains `/family-mcp`.
- Legacy Family Custom GPT query remains `/api/family/query`.
- No user reconnect/reconfiguration is required by this migration.
- Family remains read-only: no Production write, GitHub write/branch/PR mutation, strategy mutation, OHLC canonical write, Diamond Judgment write or order placement.
- OHLC canonical pipeline and ownership are unchanged.
- Deterministic Published gateway remains unchanged for formal replay/history.
- Current chip raw/normalized persistence remains NONE.

## Test/CI protections

`shared-chip-read-plane-family-contract.test.ts` is part of `test:family-selection` and therefore `test:research`. It requires Family MCP, legacy Action and Family Smart REST current-chip routes to use the shared on-demand facade; rejects direct Published-gateway imports in those current-facing paths; rejects `PUBLISHED_GENERATION_ONLY` and equivalent Published-only current-decision wording across MCP, REST, OpenAPI, analysis, planner, research policy, shared-read plane and 11-point output; preserves public ingress and read-only boundaries; checks compact chip transport, MoneyDJ ranked-only/no-FinMind-token semantics and non-directional warrant semantics.

`family-cloudflare-startup-graph.test.ts` continues to protect the lazy startup graph, Cloudflare 10021 isolation, Family read-only boundaries, canonical OHLC identity and no cross-account Service Binding. Its market-chip identity assertion now matches `OFFICIAL_EXACT_DATE_ON_DEMAND_CURRENT+PUBLISHED_HISTORY_CONTEXT` instead of the retired Published-only current model.

Final pre-merge head `12fb65d1ecb0c5caa9d4ec461f72b874c26f6acf` passed TypeScript type-check, full `test:research`, Wrangler deploy dry-run, Market Data Cloudflare Cron CI and the P7/P8/P9/P11/P12/P13/P13b/P14/P15/P16 PR workflows before merge.

Existing Family isolation/OAuth/public-ingress tests remain in force. Formal Published replay tests remain deterministic and are not repurposed for live reads.

## Recent-N-trading-day broker window

This migration does **not** claim that a MoneyDJ query parameter has been verified to mean exactly N trading days. The public page exposes period/self-defined interval controls, but parameter/date semantics must be independently verified before implementing an exact `recent N trading days` adapter. Until then the existing broker adapter remains exact-date/ranked-only/fail-soft; no guessed `b=` mapping is allowed and no daily raw-page persistence is introduced.

## Rollback

Rollback the Family/REST provider wiring to the previous commit while leaving the deterministic Published archive untouched. Public ingress and OHLC require no rollback because neither is changed here. If current external sources are unavailable, the facade must report PENDING/DEGRADED/UNAVAILABLE and may expose Published only as labelled history context; it must not silently promote old history into current truth.
