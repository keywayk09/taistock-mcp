# Change Note — Research VNext Isolation / ABI / Regression Gate

- Date: 2026-09-01
- Branch: `refactor/research-vnext-foundation-20260901`
- Prerequisite Shadow Facade: Run `33499196388` — SUCCESS
- Production mutation: **NONE**
- Production registration change: **NONE**

## Purpose

Turn the architecture rule “fix Review/Intraday without breaking Family, Market Data, FORMAL Blind, or Owner/Ops” into an explicit fan-out CI gate. Each domain runs independently so a failure is attributed to a specific boundary instead of being hidden inside one serial regression command.

## Test-before-build proof

RED commit: `0e0f29c540c7004a65e3c3944f94b03848cc3091`.

Research VNext Incremental Gate:

- Run `33499484174`
- Job `99829240513`
- Change Note / protected-surface scope gate: **PASS**
- all previously validated VNext tests before the new isolation test: **PASS**
- isolation gate test: **FAIL (EXPECTED RED)**
- exact failure: `ERR_MODULE_NOT_FOUND` for `src/v6/research-vnext/isolation-manifest.ts`
- downstream type-check / full regression / dry-run: correctly **SKIPPED**

The failed receipt is preserved and must not be relabeled as PASS.

## Frozen rules

- runtime mode remains `SHADOW_UNREGISTERED`;
- Owner ABI remains unchanged during this phase;
- Production registration remains disabled;
- all VNext source files are scanned for forbidden imports into Owner, research-tools, main Worker entry, Family, Market Data, FORMAL Blind, and Jin10 domains;
- VNext source must contain no MCP registration calls;
- production composition files must contain no `research-vnext` reference;
- isolation CI runs independent domains: VNEXT, FAMILY, MARKET_DATA, FORMAL_BLIND, OWNER_OPS, BUNDLE;
- CI uses read-only checkout and no Production credentials;
- bundle check is `wrangler deploy --dry-run` only;
- final evidence job runs even after a failed domain, uploads a receipt, then fails closed if any required domain failed.

## GREEN implementation

This phase adds only:

1. `src/v6/research-vnext/isolation-manifest.ts`
2. `.github/workflows/research-vnext-isolation-gate.yml`
3. this Change Note update

The isolation manifest freezes:

- schema `RESEARCH_VNEXT_ISOLATION_MANIFEST_V1`
- runtime mode `SHADOW_UNREGISTERED`
- Production registration `DISABLED`
- Owner ABI `UNCHANGED`
- GPT reasoning ownership
- direct provider access / OHLC write / automatic strategy promotion all `FORBIDDEN`
- required regression domains `[VNEXT, FAMILY, MARKET_DATA, FORMAL_BLIND, OWNER_OPS, BUNDLE]`

The new workflow uses a fail-fast-disabled matrix so VNEXT, FAMILY, MARKET_DATA, FORMAL_BLIND, and OWNER_OPS run independently. BUNDLE is a separate type-check + Wrangler dry-run job. The final `isolation-evidence` job uses `if: always()` to preserve a machine-readable receipt before failing closed on any unsuccessful domain.

## Credential / deployment safety

- workflow permissions: `contents: read` only;
- checkout uses `persist-credentials: false`;
- no Production Cloudflare or GitHub data credentials are referenced;
- no actual deploy is permitted;
- only `npx wrangler deploy --dry-run` is present;
- bundle hashes and byte size are evidence only.

## Explicitly not changed

- Owner MCP registration/toolset
- `src/v6/research-tools.ts`
- `src/v6/owner-content-handler.ts`
- `src/v6/mcp-runtime-composition.ts`
- `src/index-v6.ts`
- Family runtime
- Market Data runtime
- FORMAL Blind runtime
- OHLC worker/data plane
- `wrangler.jsonc`
- Production deploy topology

## Evidence log

| Stage | Evidence | Result |
|---|---|---|
| Shadow Facade prerequisite | Run `33499196388` | PASS |
| Isolation RED | Run `33499484174`, job `99829240513` | EXPECTED FAIL — missing isolation manifest |
| Isolation implementation | pending commit | built, unregistered |
| Incremental VNext GREEN | pending | pending |
| Independent repo CI | pending | pending |
| Fan-out isolation GREEN | pending | pending |

## Final disposition

`IN_PROGRESS_GREEN_VALIDATION`
