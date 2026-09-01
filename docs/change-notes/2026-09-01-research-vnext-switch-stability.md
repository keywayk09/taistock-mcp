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

`src/v6/research-vnext/README.md` defines migration phase 4 as **Gateway switch** and phase 5 as **Legacy retirement**, with the hard condition that Legacy retirement may occur only after the switched path is proven stable.

Phase 10B completed the bounded Gateway switch for the strict-parity deterministic lanes. This phase proves branch-level switched-path stability and freezes the retirement policy before any Legacy deletion is allowed.

## Stability contract

The actual Phase 10B compatibility adapter is exercised under repeated success, bounded VNext failure and recovery. Required invariants:

1. VNext-primary Replay success does not invoke Legacy fallback;
2. Replay failure falls back exactly once per call;
3. failure does not poison later successful calls;
4. Review deterministic summary remains strict-compatible;
5. Swing deterministic ranking remains strict-compatible;
6. non-target handlers remain untouched;
7. lazy Gateway remains cached;
8. public ABI remains frozen;
9. Owner has no direct VNext registration;
10. Legacy fallback and unproven Legacy handlers remain present.

## Retirement policy

Implementation added only:

- `src/v6/research-vnext/retirement-readiness.ts`
- implementation commit `ef3cf1f42cf7a7f633f42035ce793c2f438582a0`

Policy:

- schema `RESEARCH_VNEXT_RETIREMENT_POLICY_V1`
- GPT remains reasoning owner;
- branch switch validation requires GREEN receipt;
- Production switched-path validation is required before Legacy retirement;
- `legacy_retirement = BLOCKED_UNTIL_PRODUCTION_SWITCH_STABLE`;
- `legacy_fallback = MUST_REMAIN_AVAILABLE`;
- public ABI drift, direct market provider access, OHLC writes and automatic strategy promotion remain forbidden;
- Production mutation/deploy in this phase = `NONE`.

The policy module has no imports and performs no runtime work.

## TEST BEFORE BUILD / RED evidence

RED test:

- `tests/research-vnext-switch-stability.test.ts`
- RED commit `df414e7fcf64feb9471df13c55b53c9a66c84765`
- Incremental Run `33506603186`
- Job `99852020134`

Before the expected failure:

- protected-surface gate: **PASS**
- `PHASE10B_HANDLER_CUTOVER_EXCEPTION=PASS`
- all prior VNext tests: **PASS**
- actual ABI snapshot: **PASS** — `123` tools / frozen digest
- `SWITCH_STABILITY_PRECHECK=PASS`
- success burst per migrated lane: `25`
- failure burst per migrated lane: `25`
- recovery after failure: **PASS**
- Gateway loads across success/failure/recovery: `1`
- Legacy fallback: **RETAINED**
- Production mutation: **NONE**

Final RED:

- **EXPECTED FAIL**
- `ERR_MODULE_NOT_FOUND` for `src/v6/research-vnext/retirement-readiness.ts`
- downstream type-check/full regression/Wrangler dry-run correctly **SKIPPED**

Disposition: `SWITCH_STABILITY_RED_ACCEPTED_POLICY_IMPLEMENTATION_ALLOWED`.

## GREEN evidence

### Research VNext Incremental Gate

- Run `33506757582`
- Job `99852512602`
- all Research VNext tests: **PASS**
- switch stability test: **PASS**
- Phase 9 ABI snapshot: **PASS**
- type-check: **PASS**
- full `test:research`: **PASS**
- Wrangler deploy `--dry-run`: **PASS**
- evidence upload: **PASS**
- Production mutation: **NONE**

### Independent Type check

- Run `33506757475`
- Job `99852511921`
- type-check: **PASS**
- full `test:research`: **PASS**
- Wrangler deploy `--dry-run`: **PASS**

### Research VNext Isolation Gate

- Run `33506757502`: **SUCCESS**
- BUNDLE `99852512137`: **PASS**
- OWNER_OPS `99852512399`: **PASS**
- MARKET_DATA `99852512401`: **PASS**
- VNEXT `99852512435`: **PASS**
- FAMILY `99852512517`: **PASS**
- FORMAL_BLIND `99852512627`: **PASS**
- isolation evidence `99852896189`: **PASS**

### Additional shared-research regressions

All triggered workflows on `ef3cf1f42cf7a7f633f42035ce793c2f438582a0` are **SUCCESS**:

- P7 `33506757431`
- P8 `33506757528`
- P9 `33506757413`
- P11 `33506757523`
- P12 `33506757392`
- P13 `33506757490`
- P13b `33506757366`
- P14 `33506757578`
- P15 `33506757577`
- P16 `33506757569`

## Artifact / hash

Incremental evidence:

- Artifact ID `9799948255`
- digest `sha256:24ab48b8b0111a90ca11ac084fe412fd5a8e7e76a96d09d6b4072c011be3430b`

Isolation evidence:

- Artifact ID `9799943058`
- digest `sha256:da362313ffec0832bd832ba869466383b4d0947090d8190264bfab8f73b7f34b`

Isolation bundle:

- Artifact ID `9799934488`
- digest `sha256:245bb80c2bd3f06410b3d6a4f76fbedd6add73fc4d377446c380e219019477ee`

## Explicitly not changed

- Legacy fallback / Legacy handlers
- `src/v6/owner-content-handler.ts`
- `src/v6/research-tools.ts`
- `src/index-v6.ts`
- `src/v6/mcp-runtime-composition.ts`
- Family / OAuth / Market Data / FORMAL Blind
- OHLC Production `tv-fugle-1d`
- `wrangler.jsonc`
- deploy topology
- public MCP ABI

## Rollback

Remove `retirement-readiness.ts`, the stability test and this Change Note. Phase 10B remains the last switched runtime state, with Legacy fallback intact.

## Final disposition

`BRANCH_SWITCH_STABLE_PRODUCTION_VALIDATION_REQUIRED`

Branch-level switched-path stability is proven. **Legacy retirement remains blocked** until a separate Production switched-path stability phase is explicitly executed and passes. PR #206 remains Draft/unmerged and Production remains untouched.

The seal commit itself must pass Incremental / Type check / Isolation before this phase is formally closed.
