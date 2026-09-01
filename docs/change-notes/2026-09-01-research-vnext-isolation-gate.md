# Change Note — Research VNext Isolation / ABI / Regression Gate

- Date: 2026-09-01
- Branch: `refactor/research-vnext-foundation-20260901`
- Prerequisite Shadow Facade: Run `33499196388` — SUCCESS
- Production mutation: **NONE**
- Production registration change: **NONE**

## Purpose

Turn the architecture rule “fix Review/Intraday without breaking Family, Market Data, FORMAL Blind, or Owner/Ops” into an explicit fan-out CI gate. Each domain runs independently so a failure is attributed to a specific boundary instead of being hidden inside one serial regression command.

## Test-before-build

The RED test is added before both `src/v6/research-vnext/isolation-manifest.ts` and `.github/workflows/research-vnext-isolation-gate.yml` exist.

Expected first failure: missing isolation manifest. Preserve the failed receipt before adding the implementation.

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
- final evidence job must aggregate domain results.

## Explicitly not changed

- Owner MCP registration/toolset
- Family runtime
- Market Data runtime
- FORMAL Blind runtime
- OHLC worker/data plane
- Production deploy topology

## Evidence log

| Stage | Evidence | Result |
|---|---|---|
| Shadow Facade prerequisite | Run `33499196388` | PASS |
| Isolation RED | pending | pending |
| Isolation GREEN | not built yet | pending |

## Final disposition

`RED_PENDING`
