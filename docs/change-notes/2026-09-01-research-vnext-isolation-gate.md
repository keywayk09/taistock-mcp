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

Implementation commit: `fcf73378557c61dada6d3966812ee28f1bdc73f3`.

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

## Final GREEN evidence

Validated implementation head: `fcf73378557c61dada6d3966812ee28f1bdc73f3`.

Research VNext Incremental Gate:

- Run `33499768843`
- Job `99830154653`
- Change Note / protected-surface scope gate: **PASS**
- all Research VNext tests: **PASS**
- Type-check: **PASS**
- Full existing `test:research`: **PASS**
- Wrangler deploy dry-run: **PASS**
- immutable-style receipt generation/upload: **PASS**

Independent repository CI:

- Run `33499768886`
- Job `99830154858`
- Type-check: **PASS**
- Full existing `test:research`: **PASS**
- Wrangler deploy dry-run: **PASS**

Fan-out Research VNext Isolation Gate:

- Run `33499768983`
- `domain-VNEXT` job `99830155228`: **PASS**
- `domain-FAMILY` job `99830155217`: **PASS**
- `domain-MARKET_DATA` job `99830155424`: **PASS**
- `domain-FORMAL_BLIND` job `99830155157`: **PASS**
- `domain-OWNER_OPS` job `99830155304`: **PASS**
- `domain-BUNDLE` job `99830154951`: **PASS**
- `isolation-evidence` job `99830328690`: **PASS**
- fail-closed final assertion: **PASS**

Artifacts:

- Incremental evidence ID `9797225919`, digest `sha256:5adaa760006a43e8bf1b95c1da0d4647e4660697675dfa4dd400990efd3afc00`
- Isolation evidence ID `9797225965`, digest `sha256:02561b84ad973a7ccdf74d8f1d10880bf039d7eea5feef049a1c96663f6c7417`
- Isolation bundle ID `9797222213`, digest `sha256:898b1f9f60dba81b7f9d2eb5680ec760691043aff958a0d8b9c260eed94d9587`
- All above expire `2026-10-01`

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
- public MCP ABI/tool count

## Evidence log

| Stage | Evidence | Result |
|---|---|---|
| Shadow Facade prerequisite | Run `33499196388` | PASS |
| Isolation RED | Run `33499484174`, job `99829240513` | EXPECTED FAIL — missing isolation manifest |
| Isolation implementation | Commit `fcf73378557c61dada6d3966812ee28f1bdc73f3` | built, unregistered |
| Incremental VNext GREEN | Run `33499768843`, job `99830154653` | PASS |
| Independent repo CI | Run `33499768886`, job `99830154858` | PASS |
| Fan-out isolation GREEN | Run `33499768983` | PASS — all six domains + evidence |
| Incremental immutable-style evidence | Artifact `9797225919` | PASS |
| Isolation immutable-style evidence | Artifacts `9797225965`, `9797222213` | PASS |

## Rollback

Remove the unregistered isolation manifest and the isolation workflow, then revert this Change Note. No Production runtime depends on Research VNext.

## Final disposition

`PASS_ISOLATION_GATE_SHADOW_UNREGISTERED`
