# Change Note — Research VNext Phase 10B Handler Cutover

- Date: `2026-09-01`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` (must remain Draft)
- Prerequisite Phase 10A seal: `bec94f19d7d8632926b6d53161762a2840a47007`
- Phase 9 frozen ABI: `123` Owner tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production deploy: **NONE**
- Production mutation: **NONE**

## Purpose

Wire the already-GREEN Phase 10A compatibility bridge into the existing Legacy research registration graph without changing public tool names, schemas, count, Owner ingress, or unrelated research handlers. Only deterministic lanes with completed strict parity evidence may migrate; Legacy remains fallback and all unproven handlers remain Legacy.

## Allowed protected surface

Exactly one previously protected runtime file changed in Phase 10B:

- `src/v6/research-tools.ts`

It only routes Selective Replay and Review Orchestrator registrars through the VNext compatibility registration server.

Still unchanged / forbidden:

- `src/v6/owner-content-handler.ts`
- `src/index-v6.ts`
- `src/v6/mcp-runtime-composition.ts`
- Family
- OAuth
- Market Data
- FORMAL Blind
- `wrangler.jsonc`
- deploy workflows/topology
- OHLC Production `tv-fugle-1d`

The Incremental Gate contains one exact `PHASE10B_HANDLER_CUTOVER_EXCEPTION`; all other protected surfaces remain fail-closed.

## Migrated public lanes

### `resolve_ambiguous_backtest_with_1m`
- VNext `replay.resolve` is primary.
- Successful VNext compute uses the existing MCP response shape.
- Any bounded VNext/gateway failure falls back exactly once to the original Legacy handler and preserves Legacy domain-error payloads.

### `finalize_daily_review_run` — deterministic summary only
- Legacy handler still owns ledger reads, backtest execution, TXF review, persistence and compatibility interpretation fields.
- Stock/TXF metric summaries may use VNext `review.summary` only when strict semantic parity with Legacy is preserved.
- VNext failure or unexpected parity drift keeps the original Legacy response.
- No interpretation/hypothesis generation moved into VNext.

### `prepare_swing_selection_run` — deterministic rank output
- Legacy handler still owns Signal Ledger access and snapshot orchestration.
- VNext `swing.rank` may replace selected output only when strict semantic parity with Legacy is preserved.
- VNext failure or unexpected drift keeps Legacy selected output.

## Explicitly not migrated

- GPT Judgment Memory public tools
- `finalize_swing_review_run` outcome summary
- backend-generated interpretation/hypothesis fields
- strategy promotion/rule mutation
- any new MCP tool

## TEST BEFORE BUILD / RED evidence

### RED A — shared registration wiring absent
- Commit `e9c54dbad6be155a1273c70994fde774e561d4ba`
- Incremental Run `33503942954`, Job `99843449610`
- protected-surface gate: **PASS**
- Foundation / Phase 10A / Gateway / Memory Adapter before target test: **PASS**
- handler-cutover test: **FAIL (EXPECTED RED)**
- exact assertion: `research-tools must import only the approved VNext compat-cutover surface`
- actual state: all registrars still used Legacy/original `server`
- downstream gates: **SKIPPED**
- Production mutation: **NONE**
- Disposition: `PHASE10B_RED_A_ACCEPTED`

### RED B — runtime registration wrapper absent
- Commit `8df8bfede2450e7d0637c7b38b424c580c73bcc8`
- Incremental Run `33504314943`, Job `99844627926`
- protected-surface gate: **PASS**
- Foundation / Phase 10A before target test: **PASS**
- compat-registration test: **FAIL (EXPECTED RED)**
- exact failure: `compat-cutover.ts does not provide an export named 'createResearchVNextCompatRegistrationServer'`
- downstream gates: **SKIPPED**
- Production mutation: **NONE**
- Disposition: `PHASE10B_RED_B_ACCEPTED_IMPLEMENTATION_ALLOWED`

## GREEN implementation

Atomic implementation commit:

- `95d2005df4e09a24e1453c92f1981ab4197dcac8`

Runtime scope:

- `src/v6/research-vnext/compat-cutover.ts`
- `src/v6/research-tools.ts`

Guard/test scope:

- `tests/research-vnext-boundary.test.ts`
- `tests/research-vnext-handler-cutover.test.ts`
- `.github/workflows/research-vnext-foundation-gate.yml`

### Preserved GREEN attempt 1 — stale Phase 10A expectation
- Run `33505459791`, Job `99848320267`
- Phase 10B protected-surface exception: **PASS**
- Foundation: **PASS**
- failure: `tests/research-vnext-compat-cutover.test.ts`
- exact assertion: `Phase 10A bridge must remain unregistered until its own GREEN`
- cause: stale Phase 10A expectation after intentional Phase 10B integration
- runtime not implicated
- Production mutation: **NONE**
- Disposition: `GREEN_ATTEMPT_1_IMMUTABLE_STALE_TEST_EXPECTATION`

Test-only correction:

- `b33da6a76a3a627ee78ca6b2809975dd15ab863b`

Owner direct registration remains forbidden; `research-tools.ts` may reference VNext only through `./research-vnext/compat-cutover`.

### Preserved GREEN attempt 2 — stale isolation expectation
- Run `33505623445`, Job `99848844628`
- protected-surface exception: **PASS**
- Foundation: **PASS**
- Phase 10A compat-cutover: **PASS**
- Phase 10B compat-registration runtime test: **PASS**
- Phase 10B handler-cutover test: **PASS**
- failure: `tests/research-vnext-isolation-gate.test.ts`
- exact assertion: `src/v6/research-vnext/compat-cutover.ts must remain unregistered`
- cause: stale isolation rule globally forbade the exact Phase 10B registration adapter boundary
- runtime wrapper already passed before the stale assertion
- Production mutation: **NONE**
- Disposition: `GREEN_ATTEMPT_2_IMMUTABLE_STALE_ISOLATION_EXPECTATION`

Test-only isolation correction:

- `01ce2c51e72d6ab9a3f9c5d0d4318941d8d5af8f`

Registration symbols are permitted only in `compat-cutover.ts`; Owner/composition/index direct VNext knowledge remains forbidden.

### Preserved runtime compile failure
Independent Type check on the intermediate branch state:

- Run `33505623338`, Job `99848844658`
- exact compiler error: `src/v6/research-vnext/compat-cutover.ts(172,43): error TS2538: Type 'unique symbol' cannot be used as an index type.`
- cause: internal `JsonRecord = Record<string, any>` did not admit the unique-symbol fallback marker key
- semantic impact: **NONE**
- Production mutation: **NONE**
- Disposition: `GREEN_RUNTIME_TYPE_FIX_ALLOWED_MINIMAL`

Minimal runtime type-only fix:

- Commit `3dc8abc1ac598f2e30c995846afa45d4a32c200f`
- exact semantic-neutral change: `Record<string, any>` → `Record<PropertyKey, any>`
- handler behavior, public ABI, provider access, persistence and strategy semantics unchanged

## Final GREEN evidence

### Research VNext Incremental Gate
- Run `33506039091`
- Job `99850197275`
- Change Note / Phase 10B protected-surface scope gate: **PASS**
- `PHASE10B_HANDLER_CUTOVER_EXCEPTION=PASS`
- all Research VNext tests: **PASS**
- Phase 10A compat-cutover: **PASS**
- Phase 10B compat-registration runtime test: **PASS**
- Phase 10B handler-cutover: **PASS**
- Phase 10B isolation source contract: **PASS**
- actual Owner ABI snapshot: **PASS**
- type-check: **PASS**
- full `test:research`: **PASS**
- Wrangler deploy `--dry-run`: **PASS**
- evidence upload: **PASS**
- Production mutation: **NONE**

Actual measured ABI on the GREEN commit:

- Owner identity: `Taiwan Stock + Crypto AI / 6.20.0`
- Owner tool count: `123`
- Owner ABI SHA-256: `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- public ingress / OAuth guards: unchanged
- `production_registration`: `LEGACY_UNCHANGED`

### Independent Type check
- Run `33506039166`
- Job `99850197583`
- `npm run type-check`: **PASS**
- full `test:research`: **PASS**
- Wrangler deploy `--dry-run`: **PASS**

### Research VNext Isolation Gate
- Run `33506039093`: **SUCCESS**
- FAMILY job `99850197045`: **PASS**
- BUNDLE job `99850197268`: **PASS**
- VNEXT job `99850197301`: **PASS**
- OWNER_OPS job `99850197480`: **PASS**
- FORMAL_BLIND job `99850197482`: **PASS**
- MARKET_DATA job `99850197568`: **PASS**
- isolation evidence job `99850372857`: **PASS**

### Additional shared-research regression workflows
All triggered workflows on `3dc8abc1ac598f2e30c995846afa45d4a32c200f` are **SUCCESS**:

- P7 Swing Outcome Path `33506039079`
- P8 Experiment Memory `33506039128`
- P9 Diamond Capability Registry `33506039111`
- P11 Research Validation `33506039125`
- P12 Strategy Lab Governance `33506039102`
- P13 Cross-market Supply Chain Graph `33506039071`
- P13b Supply Chain Data Plane `33506039086`
- P14 TXF Dual-market Review `33506039136`
- P15 Review Swing Orchestration `33506039100`
- P16 GPT Judgment Memory `33506039076`

## Artifact / hash

Incremental evidence:

- Artifact ID `9799644873`
- `research-vnext-evidence-33506039091`
- digest `sha256:39d80d6b10858345d0e7202ce451eb8cc97945237d54c9f4a193dc8b7e3bf1ee`

Isolation evidence:

- Artifact ID `9799639274`
- `research-vnext-isolation-evidence-33506039093`
- digest `sha256:6773d5cf6c55b48a15a74b899c1618fbceae61009e4706bcaf2982d0dff15617`

Isolation bundle:

- Artifact ID `9799635293`
- `research-vnext-isolation-bundle-33506039093`
- digest `sha256:d3dd5d5903ea023b8a2f4925b979cd01a3fa5653cc20931e23cb20039c178bb0`

## Rollback

Revert `src/v6/research-tools.ts` to pass the original server directly to Selective Replay and Review Orchestrator. The VNext compatibility bridge is harmless when unreferenced. No Production deployment exists to roll back.

## Final disposition

`PHASE10B_GREEN_SEALED`

Phase 10B is accepted on branch evidence. PR `#206` remains Draft/unmerged and Production remains untouched. The seal commit itself must still pass Incremental / Type check / Isolation before moving to the next phase.
