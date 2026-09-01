# Change Note — Research VNext Atomic Production Cleanup

- Date: `2026-09-02`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — must remain Draft/open/unmerged
- Production deployment run: `33534878858`
- Production deployment version: `0d7a4c8d-0ccf-4d89-9cd4-ab28fab70c5c`
- Production control-plane validation: `PASS`
- Authenticated MCP probe: `BLOCKED_BY_MISSING_GITHUB_SECRET`
- Production rollback: `NONE`
- Legacy retirement: `BLOCKED`

## Temporary-surface cleanup

Immutable deploy evidence was captured before cleanup in artifact `9811214109` with digest `sha256:3ca25cf38fab2e1520e0a5a25688a4c2068aa67c0c670610f0628f7f0b35c8e2`.

Cleanup order was intentionally fail-closed:

1. Workflow cleanup commit: `1845c557bd21d67c5beff4cd04e6d472b1f9a5a9`
2. Authorization cleanup commit: `70073b0da92d33a5b742e85a884ac520ba7fadab`

The workflow was deleted first, so deleting the authorization file could not retrigger the one-shot deployment.

Both temporary paths are now absent:

- `.github/workflows/research-vnext-atomic-production-one-shot.yml`
- `runtime/research-vnext-atomic-production-one-shot-authorization.json`

## Runtime validation blocker classification

The single Worker deploy and exact postdeploy control-plane validation succeeded. The authenticated MCP probe failed because `RESEARCH_VNEXT_PROBE_TOKEN` was empty and both modern and legacy protocol attempts received HTTP 401.

This remains immutable failure evidence and is not rewritten as PASS.

Autonomous decision remains `NO_ROLLBACK` because no runtime defect was demonstrated and all structural/control-plane invariants were preserved.

## TEST BEFORE BUILD — cleanup RED candidate

Cleanup lifecycle test:

- `tests/research-vnext-atomic-production-one-shot-cleanup.test.ts`

The formal RED must prove all deployment, credential-blocker, NO_ROLLBACK, ABI and cleanup preconditions first, then fail only because the final credential-blocked cleanup disposition has not yet been recorded.

No Production mutation is authorized by this cleanup phase.
