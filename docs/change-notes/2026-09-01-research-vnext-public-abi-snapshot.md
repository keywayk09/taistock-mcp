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

The snapshot is semantic rather than a protected-source file hash: Phase 10 may legitimately change registration wiring, but it must not change the externally visible tool count, tool names, descriptions, input/output schemas, Owner identity, ingress/OAuth roles, or protected domain contracts.

## Before baseline

Validated prerequisite head: `fbdb96fdf17c1883e9500fa5cb08c0c9b955633e`.

At this baseline:

- Phase 1–8 Research VNext gates: PASS;
- Research VNext remains `SHADOW_UNREGISTERED`;
- public MCP registration remains Legacy;
- Owner/Family/OAuth/Market Data/FORMAL/Ops isolation fan-out: PASS;
- no Production deployment or registration mutation has occurred.

## TEST BEFORE BUILD

The RED test was committed before the frozen snapshot fixture existed.

Target test:

- `tests/research-vnext-public-abi-snapshot.test.ts`

Target snapshot fixture:

- `tests/fixtures/research-vnext-public-abi-snapshot.json`

Required RED behavior:

1. instantiate no Worker and perform no network request;
2. invoke the current Owner `MyMCP.prototype.init` against a fake in-memory `registerTool` recorder;
3. collect the actual Owner registration graph, including inherited Base MCP tools and all current Owner additions;
4. canonicalize MCP-visible tool metadata and Zod input/output schemas;
5. print one machine-readable `ACTUAL_PUBLIC_ABI_SNAPSHOT=` line;
6. fail precisely because the snapshot fixture does not yet exist (`ENOENT`);
7. downstream incremental type-check / full research regression / Wrangler dry-run remain blocked after the expected RED.

## Frozen semantic contract

The snapshot freezes:

- Owner server identity declared by `owner-content-handler.ts`;
- total Owner MCP tool count;
- every Owner MCP tool name;
- every tool's MCP-visible metadata through a deterministic aggregate digest over ordered per-tool hashes:
  - title when present;
  - description;
  - input schema;
  - output schema when present;
  - annotations when present;
  - `_meta` when present;
- public ingress/OAuth guard presence;
- isolation domain guard presence for `VNEXT`, `FAMILY`, `MARKET_DATA`, `FORMAL_BLIND`, `OWNER_OPS`, `BUNDLE`.

Existing public ingress/OAuth semantics remain independently covered by `tests/public-ingress-freeze.test.ts`; Owner live-tool exposure remains covered by `tests/owner-live-tool-exposure.test.ts`.

## Compact fixture format

The test still computes and prints the full ordered per-tool hash material for diagnostics. The committed fixture stores:

- Owner identity;
- tool count;
- complete sorted tool-name list;
- `owner_abi_sha256`;
- ingress/OAuth contract;
- regression guard contract.

`owner_abi_sha256` is SHA-256 over the complete ordered list of per-tool `{name, description_sha256, input_schema_sha256, output_schema_sha256, metadata_sha256}` records. Therefore any public tool metadata/schema/name drift changes the aggregate digest. The compact fixture removes redundant tens-of-thousands-of-characters hash duplication without weakening the semantic freeze.

## Explicitly not changed

This phase does not modify:

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

The main risk was a false snapshot caused by a test harness that did not follow the real Owner registration graph. The final harness executes the real Owner `init()` graph and only stubs external `McpServer` / `McpAgent` runtime classes so Node can execute the repository's existing extensionless TypeScript graph. Internal taistock registration modules remain real; handlers are registered but never invoked.

## RED evidence

Initial RED test commit: `baf24b1affe3b1315a7d064d94414bed5d5b68a4`.

### Harness diagnostic failure #1 — immutable, not accepted as Phase 9 RED

- Run `33501969431`
- Job `99837144731`
- scope gate: PASS
- failure before registration capture: `ERR_MODULE_NOT_FOUND` resolving existing extensionless `../index`
- no `ACTUAL_PUBLIC_ABI_SNAPSHOT=` line
- disposition: `HARNESS_FAILURE_IMMUTABLE_NOT_PHASE9_RED`

### Harness diagnostic failure #2 — immutable, not accepted as Phase 9 RED

Harness revision commit: `6928b3bbc199c9613c02fc461391722c70eb1bc5`.

- Run `33502150892`
- Job `99837731921`
- scope gate: PASS
- failure before registration capture: Node `ERR_INTERNAL_ASSERTION` while bridging ESM dependency graph through CommonJS
- no `ACTUAL_PUBLIC_ABI_SNAPSHOT=` line
- disposition: `HARNESS_FAILURE_IMMUTABLE_NOT_PHASE9_RED`

### Valid Phase 9 RED — accepted

Final harness commit: `108d14e9c74ef5dec4c61073b797bcf7801507ce`.

Research VNext Incremental Gate:

- Run `33502379585`
- Job `99838457322`
- Change Note / protected-surface scope gate: **PASS**
- existing VNext Boundary / Gateway / Memory Adapter / Isolation / Memory Core tests before new snapshot test: **PASS**
- Owner registration capture: **SUCCESS**
- emitted `ACTUAL_PUBLIC_ABI_SNAPSHOT=`: **YES**
- Owner identity: `Taiwan Stock + Crypto AI` / `6.20.0`
- Owner tool count: `123`
- Owner aggregate ABI digest: `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- exact terminal failure: `ENOENT` opening `tests/fixtures/research-vnext-public-abi-snapshot.json`
- downstream incremental type-check / full research regression / Wrangler dry-run: correctly **SKIPPED**

Independent Type check for the same commit:

- Run `33502379624`: **SUCCESS**

Isolation Gate for the same commit:

- Run `33502379695`
- `FAMILY`: PASS
- `MARKET_DATA`: PASS
- `FORMAL_BLIND`: PASS
- `OWNER_OPS`: PASS
- `BUNDLE`: PASS
- `VNEXT`: expected FAIL solely because the Phase 9 fixture is intentionally absent
- fail-closed isolation evidence: PASS behavior (workflow conclusion failure as required when one domain fails)

Disposition: `PHASE9_RED_ACCEPTED_FIXTURE_CREATION_ALLOWED`.

## GREEN implementation

GREEN adds only test/evidence artifacts:

- compact semantic fixture `tests/fixtures/research-vnext-public-abi-snapshot.json`;
- snapshot test comparison projection that keeps full per-tool hash computation/diagnostics while comparing the compact semantic fixture.

No Production runtime, registration, protected surface, strategy semantics, or provider behavior is changed.

## Tests required for GREEN

- new public ABI snapshot test;
- all Research VNext tests;
- type-check;
- full `test:research` including Family/OAuth/Market/FORMAL/Ops contracts;
- Wrangler dry-run;
- full Research VNext Isolation Gate.

## GREEN evidence

Pending.

## Artifact / hash

Frozen baseline values:

- Owner tool count: `123`
- Owner ABI SHA-256: `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`

Workflow artifact/digest: pending GREEN CI.

## Rollback

Remove the Phase 9 test and snapshot fixture. No Production runtime depends on either.

## Final disposition

`GREEN_IMPLEMENTATION_PENDING_VALIDATION`
