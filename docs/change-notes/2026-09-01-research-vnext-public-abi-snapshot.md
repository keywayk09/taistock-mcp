# Change Note — Research VNext Public ABI / Tool Snapshot Freeze

- Date: 2026-09-01
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` (must remain Draft during this phase)
- Prerequisite Resource/Fault seal: commit `fbdb96fdf17c1883e9500fa5cb08c0c9b955633e`
- Prerequisite CI: Incremental `33501396809` SUCCESS; Type check `33501396747` SUCCESS; Isolation `33501396857` SUCCESS
- Production mutation: **NONE**
- Production registration change: **NONE**

## Purpose

Freeze the current public MCP ABI before any shared registration change is allowed.

The snapshot must be semantic rather than a protected-source file hash: Phase 10 may legitimately change registration wiring, but it must not change the externally visible tool count, tool names, descriptions, input/output schemas, Owner identity, ingress/OAuth roles, or protected domain contracts.

## Before baseline

Validated prerequisite head: `fbdb96fdf17c1883e9500fa5cb08c0c9b955633e`.

At this baseline:

- Phase 1–8 Research VNext gates: PASS;
- Research VNext remains `SHADOW_UNREGISTERED`;
- public MCP registration remains Legacy;
- Owner/Family/OAuth/Market Data/FORMAL/Ops isolation fan-out: PASS;
- no Production deployment or registration mutation has occurred.

## TEST BEFORE BUILD

The RED test must be committed before the frozen snapshot fixture exists.

Target test:

- `tests/research-vnext-public-abi-snapshot.test.ts`

Target snapshot fixture:

- `tests/fixtures/research-vnext-public-abi-snapshot.json`

Expected RED behavior:

1. instantiate no Worker and perform no network request;
2. invoke the current Owner `MyMCP.prototype.init` against a fake in-memory `registerTool` recorder;
3. collect the actual Owner registration graph, including inherited Base MCP tools and all current Owner additions;
4. canonicalize MCP-visible tool metadata and Zod input/output schemas;
5. print one machine-readable `ACTUAL_PUBLIC_ABI_SNAPSHOT=` line;
6. fail precisely because the snapshot fixture does not yet exist (`ENOENT`);
7. downstream incremental type-check / full research regression / Wrangler dry-run remain blocked after the expected RED.

If registration capture fails for another reason, implementation must stop and the test must be diagnosed before a fixture is created.

## Frozen semantic contract

The snapshot must freeze:

- Owner server identity currently declared by `owner-content-handler.ts`;
- total Owner MCP tool count;
- every Owner MCP tool name;
- canonical hash of every tool's MCP-visible metadata:
  - title when present;
  - description;
  - input schema;
  - output schema when present;
  - annotations when present;
  - `_meta` when present;
- one aggregate Owner ABI digest;
- public ingress/OAuth guard presence;
- isolation domain guard presence for:
  - VNEXT
  - FAMILY
  - MARKET_DATA
  - FORMAL_BLIND
  - OWNER_OPS
  - BUNDLE.

Existing public ingress/OAuth semantics remain independently covered by `tests/public-ingress-freeze.test.ts`; Owner live-tool exposure remains covered by `tests/owner-live-tool-exposure.test.ts`.

## Why hashes instead of copying full schemas

The fixture records per-tool SHA-256 digests of canonical JSON schema metadata. This freezes the actual schema while keeping the snapshot compact and reviewable. A Phase 10 wiring change passes only if the resulting public tool metadata is byte-equivalent after canonicalization.

## Explicitly not changed

This phase must not modify:

- `src/v6/research-tools.ts`
- `src/v6/owner-content-handler.ts`
- `src/v6/mcp-runtime-composition.ts`
- `src/index-v6.ts`
- Family runtime
- OAuth runtime
- Market Data runtime
- FORMAL Blind runtime
- OHLC Production Worker `tv-fugle-1d`
- `wrangler.jsonc`
- Production deploy workflows/topology
- Legacy research runtime
- public MCP ABI itself.

## Risk

The main risk is a false snapshot caused by a test harness that does not follow the real Owner registration graph. The RED therefore executes the actual Owner `init` method with only `server.registerTool` replaced by an in-memory recorder; handlers are registered but never invoked.

## Tests

After GREEN:

- new public ABI snapshot test;
- all Research VNext tests;
- type-check;
- full `test:research` (including Family/OAuth/Market/FORMAL/Ops contracts);
- Wrangler dry-run;
- full Research VNext Isolation Gate.

## RED evidence

RED test commit: `baf24b1affe3b1315a7d064d94414bed5d5b68a4`.

### Harness diagnostic failure — immutable, not accepted as the Phase 9 RED

Research VNext Incremental Gate:

- Run `33501969431`
- Job `99837144731`
- Change Note / protected-surface scope gate: **PASS**
- existing VNext Boundary / Gateway / Memory Adapter / Isolation / Memory Core tests before the new test: **PASS**
- new public ABI snapshot test: **FAIL before registration capture**
- exact failure: Node strip-types could not resolve the existing extensionless `../index` import from `src/v6/owner-content-handler.ts`
- error: `ERR_MODULE_NOT_FOUND` for `src/index`
- no `ACTUAL_PUBLIC_ABI_SNAPSHOT=` line was produced
- downstream incremental type-check / full research regression / Wrangler dry-run: correctly **SKIPPED**

Disposition of this failed evidence: `HARNESS_FAILURE_IMMUTABLE_NOT_PHASE9_RED`.

The production source is not to be changed to satisfy the test. The next test-only revision must provide a CommonJS TypeScript require hook so the existing extensionless internal imports can be resolved while still executing the real Owner `init()` graph. The fixture remains absent.

## GREEN implementation

Not built. The GREEN artifact for this phase should be the frozen JSON fixture only after a valid fixture-missing RED is observed.

## GREEN evidence

Pending.

## Artifact / hash

Pending.

## Rollback

Remove the Phase 9 test and snapshot fixture. No Production runtime may depend on either.

## Final disposition

`HARNESS_FIX_REQUIRED_FIXTURE_STILL_FORBIDDEN`
