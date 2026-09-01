# Change Note — Research VNext Switch Stability / Retirement Readiness

- Date: `2026-09-01`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — must remain Draft/open/unmerged
- Prerequisite Phase 10B seal: `73f435690acd441494de4889b1fba23a2f8aed01`
- Phase 10B seal CI: Incremental `33506256261` SUCCESS; Type check `33506256273` SUCCESS; Isolation `33506256402` SUCCESS
- Frozen Owner ABI: `123` tools / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production deploy: **NONE**
- Production mutation: **NONE**

## Roadmap authority

`src/v6/research-vnext/README.md` defines migration phase 4 as **Gateway switch** and phase 5 as **Legacy retirement**, with the hard condition:

> Legacy retirement only after the switched path is proven stable.

Phase 10B completed the bounded Gateway switch for the strict-parity deterministic lanes. This phase exists to prove branch-level switched-path stability and freeze the retirement policy before any Legacy deletion is allowed.

## Purpose

Prove that the switched compatibility path remains stable under repeated calls, bounded VNext failures and recovery while preserving:

- the existing public MCP ABI;
- Legacy fallback;
- Owner/Family/Market Data/FORMAL/OHLC isolation;
- GPT reasoning ownership;
- no direct provider access;
- no automatic strategy promotion;
- no Production deployment or mutation.

This is a **pre-retirement readiness gate**, not Legacy retirement itself.

## Stability cases

The test must exercise the actual Phase 10B compatibility registration adapter and prove:

1. repeated VNext-primary Replay calls do not invoke Legacy fallback;
2. repeated VNext Replay failures fall back exactly once per call;
3. a failed capability does not poison later successful calls;
4. Review summary remains byte/semantic-compatible while deterministic summary is routed through VNext;
5. Swing ranking remains byte/semantic-compatible while deterministic ranking is routed through VNext;
6. non-target handlers pass through untouched;
7. the lazy Gateway loader remains cached across repeated calls;
8. Phase 9 Owner ABI remains exactly `123` tools / frozen aggregate digest;
9. Owner has no direct Research VNext registration;
10. unproven Legacy handlers and Legacy fallback files remain present.

## Retirement policy to freeze

Expected new policy-only module after legal RED:

- `src/v6/research-vnext/retirement-readiness.ts`

It must state, without performing runtime work:

- Legacy retirement remains **BLOCKED** until Production switched-path stability is separately proven;
- branch-level switch validation is required and must have a GREEN receipt;
- Legacy fallback must remain available for rollback;
- public ABI drift is forbidden;
- GPT remains reasoning owner;
- no Production deploy occurs in this phase.

The module must not import Legacy handlers, providers, Owner, Family, Market Data, FORMAL or deployment control surfaces.

## TEST BEFORE BUILD

RED target:

- `tests/research-vnext-switch-stability.test.ts`

A legal RED requires:

- all runtime stability prechecks complete first;
- the test prints `SWITCH_STABILITY_PRECHECK=PASS`;
- only then it fails precisely because `src/v6/research-vnext/retirement-readiness.ts` does not yet exist;
- downstream type-check/full regression/Wrangler dry-run are blocked;
- Production remains untouched.

Any other failure is a harness/runtime failure and does not authorize implementation.

## GREEN target

After accepted RED, add only the policy module needed by the already-written test. No shared Production runtime file should need modification.

GREEN must pass:

- switch stability test;
- all Research VNext tests;
- Phase 9 ABI snapshot;
- type-check;
- full `test:research`;
- Wrangler dry-run;
- full six-domain Isolation Gate.

## Explicitly forbidden in this phase

- deleting or bypassing Legacy fallback;
- modifying `src/v6/owner-content-handler.ts`;
- additional changes to `src/v6/research-tools.ts` unless a new RED proves a defect;
- changing `src/index-v6.ts` or `src/v6/mcp-runtime-composition.ts`;
- Family/OAuth/Market Data/FORMAL/OHLC changes;
- Production deployment;
- merging PR #206;
- changing public MCP names/schemas/count;
- automatic strategy promotion.

## RED evidence

Pending.

## GREEN evidence

Pending.

## Artifact / hash

Pending.

## Rollback

Remove the policy module/test/Change Note. Phase 10B remains the last sealed runtime state, with Legacy fallback intact.

## Final disposition

`RED_PENDING`
