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

## Phase 1 intended change

Add only an **unregistered** `src/v6/research-vnext/` foundation and its safety tests. The existing `research-tools.ts`, `owner-content-handler.ts`, public MCP tools, Family, OAuth, Market Data, FORMAL Blind, OHLC, Crypto and deployment topology remain unchanged.

## Explicitly not changed

- `src/v6/owner-content-handler.ts`
- `src/v6/research-tools.ts`
- Family routes/tools
- OAuth
- Market Data writer/read path
- FORMAL Blind behavior
- OHLC ingest/repair/write path
- Crypto gateway
- Cloudflare Production deployment configuration
- Public MCP tool names or input schemas

## Rollback

Delete the unregistered VNext foundation/test/workflow files on this branch. Because Phase 1 does not register VNext in Owner MCP, rollback has no Production runtime dependency.

## Evidence log

| Stage | Evidence | Result |
|---|---|---|
| Baseline | main `20a3579`, Run `33458763695` | PASS |
| RED test | pending | pending |
| Foundation implementation | pending | pending |
| Full regression | pending | pending |

## Final disposition

`IN_PROGRESS_TEST_FIRST`
