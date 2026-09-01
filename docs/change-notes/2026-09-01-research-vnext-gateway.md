# Change Note — Research VNext Thin / Lazy Gateway

- Date: 2026-09-01
- Branch: `refactor/research-vnext-foundation-20260901`
- Prerequisite Isolation Gate seal: commit `160953b822de1f607045bc5905d052b36a50a395`
- Prerequisite CI: Incremental `33500321943` SUCCESS; Type check `33500321954` SUCCESS; Isolation `33500321952` SUCCESS
- Production mutation: **NONE**
- Production registration change: **NONE**

## Purpose

Add the Phase 7 internal Research VNext gateway between future MCP registration and the already-validated unregistered shadow facade. The gateway must be thin, lazy, bounded, fail-closed, and still completely unregistered.

It is not a second research brain. GPT remains the sole reasoning owner. The gateway only provides lazy capability dispatch and failure containment around VNext deterministic infrastructure.

## Before baseline

Validated prerequisite head: `160953b822de1f607045bc5905d052b36a50a395`.

At this baseline:

- Memory Core: PASS
- GitHub Memory Adapter: PASS
- Shadow Facade: PASS and unregistered
- Isolation / ABI / regression fan-out: PASS
- Owner ABI: unchanged
- Production registration: disabled
- public MCP ABI/tool count: unchanged

## TEST BEFORE BUILD

RED Change Note commit: `8e4b95d17c2cdcb00bd2a3cbf74d94612dd50c90`.
RED test commit: `cf8fade56d6a9ed52254208f91b82835c0ce3e55`.

The RED test was committed before `src/v6/research-vnext/research-gateway.ts` existed.

## RED evidence

Research VNext Incremental Gate:

- Run `33500497344`
- Job `99832461609`
- Change Note / protected-surface scope gate: **PASS**
- existing Research VNext boundary test: **PASS**
- new gateway test: **FAIL (EXPECTED RED)**
- exact failure: `ERR_MODULE_NOT_FOUND` for `src/v6/research-vnext/research-gateway.ts`
- type-check / full research regression / Wrangler dry-run inside the incremental gate: correctly **SKIPPED** after RED

The failed receipt is immutable and must not be relabeled as PASS.

## Frozen gateway contract

Target module:

`src/v6/research-vnext/research-gateway.ts`

Required properties:

1. version `research-vnext-gateway/v1.0.0`;
2. runtime mode `SHADOW_UNREGISTERED`;
3. Production registration `DISABLED`;
4. GPT reasoning ownership preserved;
5. no static/eager import of `shadow-facade.ts`;
6. facade is loaded only on first capability invocation and then cached;
7. no imports from Owner, `research-tools.ts`, `index-v6.ts`, Family, Market Data, FORMAL Blind, or legacy research runtime;
8. no `registerTool` / MCP registration;
9. no direct provider `fetch`;
10. each capability failure is contained to that invocation and converted to a bounded structured gateway error;
11. configurable per-call timeout with deterministic `TIMEOUT` error;
12. unknown capability fails closed with `UNKNOWN_CAPABILITY`;
13. gateway does not synthesize thesis, interpretation, hypothesis, trading decision, or strategy promotion.

Initial internal capability names are frozen for the gateway layer only and do not change public MCP ABI:

- `review.summary`
- `swing.rank`
- `swing.outcomes`
- `replay.resolve`

Memory remains reachable through the loaded VNext facade, but no public registration change is permitted in this phase.

## GREEN implementation

Implementation commit: `3a1fb62b6f27542c83ac1203cde08f8272276aec`.

Added only `src/v6/research-vnext/research-gateway.ts` after the expected RED was proven.

The gateway now provides:

- a dynamic `import("./shadow-facade.ts")` default loader instead of a static facade import;
- one cached facade promise, created only on the first recognized capability invocation;
- internal dispatch for `review.summary`, `swing.rank`, `swing.outcomes`, and `replay.resolve`;
- bounded structured errors with `UNKNOWN_CAPABILITY`, `CAPABILITY_FAILED`, or `TIMEOUT`;
- configurable per-call timeout and maximum error-message length;
- per-call failure containment so one failed capability does not poison later calls;
- strict object/array input guards at the gateway boundary;
- a contract that remains `SHADOW_UNREGISTERED` with Production registration disabled.

No public MCP registration is present.

## GREEN evidence

Research VNext Incremental Gate:

- Run `33500666978`
- Job `99832998326`
- Change Note / protected-surface scope gate: **PASS**
- all Research VNext tests including gateway lazy-load/failure/timeout checks: **PASS**
- Type-check: **PASS**
- Full existing `test:research`: **PASS**
- Wrangler deploy dry-run: **PASS**
- immutable-style receipt generation/upload: **PASS**

Independent repository CI:

- Run `33500667027`
- Job `99832998492`
- Type-check: **PASS**
- Full existing `test:research`: **PASS**
- Wrangler deploy dry-run: **PASS**

Research VNext Isolation Gate:

- Run `33500667154`
- `domain-OWNER_OPS` job `99832998807`: **PASS**
- `domain-VNEXT` job `99832999042`: **PASS**
- `domain-MARKET_DATA` job `99832999072`: **PASS**
- `domain-FORMAL_BLIND` job `99832999090`: **PASS**
- `domain-BUNDLE` job `99832999130`: **PASS**
- `domain-FAMILY` job `99832999284`: **PASS**
- `isolation-evidence` job `99833215388`: **PASS**
- fail-closed final assertion: **PASS**

## Artifact / hash

- Incremental evidence artifact ID `9797569514`
  - name `research-vnext-evidence-33500666978`
  - digest `sha256:7002fd1bb47ea4857ef5bf31df234429527c31e2f8ee76e8f49198de33f80573`
  - expires `2026-10-01`
- Isolation evidence artifact ID `9797572440`
  - digest `sha256:5304931251fae7540d5b554218efefe2b5c5b3c8e3beafce666bac81e4c11050`
  - expires `2026-10-01`
- Isolation bundle artifact ID `9797561008`
  - digest `sha256:3ded9f97828094bca6161817cafdc041179374ffd696397516e612ff1f591017`
  - expires `2026-10-01`

## Explicitly not changed

- `src/v6/research-tools.ts`
- `src/v6/owner-content-handler.ts`
- `src/v6/mcp-runtime-composition.ts`
- `src/index-v6.ts`
- Family / OAuth / Market Data / FORMAL Blind
- OHLC Production Worker `tv-fugle-1d`
- `wrangler.jsonc`
- public MCP tool names/count/schemas
- Production deploy topology
- legacy research runtime
- Production deployment or registration

## Risk

Primary risks were accidental eager coupling, unbounded error leakage, and introducing hidden registration or reasoning semantics. The gateway test plus the existing isolation fan-out gate passed without touching shared Production surfaces.

## Tests

- `tests/research-vnext-gateway.test.ts`: **PASS**
- all Research VNext tests: **PASS**
- type-check: **PASS**
- full `test:research`: **PASS**
- Wrangler dry-run: **PASS**
- independent isolation fan-out: **PASS**

## Evidence log

| Stage | Evidence | Result |
|---|---|---|
| Isolation prerequisite seal | Commit `160953b822de1f607045bc5905d052b36a50a395` | PASS |
| Gateway Change Note RED | Commit `8e4b95d17c2cdcb00bd2a3cbf74d94612dd50c90` | scope frozen |
| Gateway RED test | Commit `cf8fade56d6a9ed52254208f91b82835c0ce3e55` | test first |
| Gateway RED | Run `33500497344`, job `99832461609` | EXPECTED FAIL — missing module |
| Gateway implementation | Commit `3a1fb62b6f27542c83ac1203cde08f8272276aec` | built, unregistered |
| Incremental GREEN | Run `33500666978`, job `99832998326` | PASS |
| Independent repo CI | Run `33500667027`, job `99832998492` | PASS |
| Isolation GREEN | Run `33500667154` | PASS — all six domains + evidence |
| Immutable-style evidence | Artifacts `9797569514`, `9797572440`, `9797561008` | PASS |

## Rollback

Remove the unregistered gateway and its test. No Production runtime depends on it during this phase.

## Final disposition

`PASS_GATEWAY_SHADOW_UNREGISTERED`
