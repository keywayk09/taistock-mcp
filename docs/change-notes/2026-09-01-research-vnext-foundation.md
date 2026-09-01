# Change Note — Research VNext Foundation

- Date: 2026-09-01
- Branch: `refactor/research-vnext-foundation-20260901`
- Base SHA: `20a357923a35b495aefa32eee99ebd8eb14f8ee8`
- Baseline CI: Type check Run `33458763695` — SUCCESS
- Production mutation: **NONE**
- Production registration change: **NONE**

## Purpose

Rebuild the internal research architecture without creating a second trading brain. GPT remains the sole reasoning/interpretation layer. `taistock-mcp` provides deterministic data, compute, replay, evidence and research memory. `ai-toolbox` remains an engineering toolbox only.

## Mandatory engineering rules

1. **TEST BEFORE BUILD** — establish baseline and add/execute the failing boundary test before implementing the VNext foundation.
2. **EVERY CHANGE HAS A NOTE** — every VNext code change must update/add a Change Note with before/after evidence.
3. **FAIL CLOSED** — no VNext Production registration until shadow/regression/resource gates pass.
4. **NO SECOND AI BRAIN** — backend must not claim reasoning authority; reasoning owner is GPT.
5. **NO DIRECT MARKET PROVIDER** — VNext cannot directly call Fugle/TWSE/TPEx/FinMind for OHLC.
6. **NO OHLC WRITE** — VNext is research read/compute/memory only.
7. **NO AUTO STRATEGY PROMOTION** — hypotheses/evidence cannot mutate Production strategy rules automatically.

## Baseline before modification

Current main SHA `20a357923a35b495aefa32eee99ebd8eb14f8ee8` passed GitHub Actions Run `33458763695`, whose `type-check` job executed:

- `npm install`
- `npm run type-check`
- `npm run test:research`
- `npx wrangler deploy --dry-run --outdir dist`

All completed successfully.

## RED proof before implementation

Dedicated Research VNext Foundation Gate Run `33495236712`, job `99815763795`:

- Change Note / Phase-1 scope gate: **PASS**
- Research VNext foundation boundary test: **FAIL (EXPECTED RED)**
- Failure: `ERR_MODULE_NOT_FOUND` for `src/v6/research-vnext/contracts/research-contract`
- Type check / full regression / Wrangler dry-run: correctly **SKIPPED** after the failing boundary test

This receipt proves the boundary test existed and failed before the VNext implementation was added. The failed run is retained as evidence and is not rewritten as a pass.

## Phase 1 implementation

GREEN implementation commit: `3d710c8cbfd655bd5241e07daadc0c16627cd664`.

Added only an **unregistered** `src/v6/research-vnext/` foundation:

- `src/v6/research-vnext/contracts/research-contract.ts`
  - freezes the V1 request/evidence schema identity;
  - explicitly assigns reasoning authority to GPT;
  - limits backend authority to data, deterministic compute, replay, evidence and memory;
  - rejects unsupported operations such as `THINK`;
  - bounds request IDs, dataset identities and serialized payload/evidence size;
  - performs no provider access and no writes.
- `src/v6/research-vnext/README.md`
  - records authority, hard boundaries and migration phases.
- `tests/research-vnext-boundary.test.ts`
  - retains the RED assertions and uses the repository's explicit `.ts` import convention for Node strip-types tests.

## GREEN verification

Dedicated VNext Run `33495611664`, job `99816968175`: **SUCCESS**.

Passed:

- Change Note / protected-surface scope gate
- Research VNext boundary test
- TypeScript type-check
- full existing `test:research`
- Wrangler deploy dry-run
- receipt generation and artifact upload

Independent repository CI Run `33495611858`, job `99816968999`: **SUCCESS** with type-check, full `test:research`, and Wrangler dry-run all passing.

Evidence artifact:

- Artifact ID: `9795593263`
- Name: `research-vnext-foundation-evidence-33495611664`
- Digest: `sha256:0e975bf0ed44eee1db1e727462e8203dce8c99f5051b356732167669be3f87f4`
- Expiry: 2026-10-01

## Explicitly not changed

- `src/v6/owner-content-handler.ts`
- `src/v6/research-tools.ts`
- `src/index-v6.ts`
- Family routes/tools
- OAuth
- Market Data writer/read path
- FORMAL Blind behavior
- OHLC ingest/repair/write path
- Crypto gateway
- `wrangler.jsonc`
- Cloudflare Production deployment configuration
- Public MCP tool names or input schemas

## Rollback

Delete the unregistered VNext foundation/test/workflow files on this branch. Because Phase 1 does not register VNext in Owner MCP, rollback has no Production runtime dependency.

## Evidence log

| Stage | Evidence | Result |
|---|---|---|
| Baseline | main `20a3579`, Run `33458763695` | PASS |
| RED test | Run `33495236712`, job `99815763795` | EXPECTED FAIL — missing VNext contract |
| Foundation implementation | commit `3d710c8` | PASS |
| VNext gate | Run `33495611664`, job `99816968175` | PASS |
| Independent repo CI | Run `33495611858`, job `99816968999` | PASS |
| Artifact | `9795593263`, digest `0e975b...f87f4` | STORED |

## Final disposition

`PHASE_1_PASS_UNREGISTERED`
