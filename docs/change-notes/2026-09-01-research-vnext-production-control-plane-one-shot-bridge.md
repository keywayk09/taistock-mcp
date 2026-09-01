# Change Note — Research VNext Production Control-Plane One-Shot Connector Bridge

- Date: `2026-09-01`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — remains Draft/open/unmerged
- Canonical sealed manual harness source: `9fa1499eeaeb2ccaa7e118502f8b618c76401a31`
- Initial RED commit: `9b138d10f0a931a125f6d62b546b407896cc0325`
- Same-tree RED verification commit: `218b98f9cd4c423ac00ddd173dc455cf4af77dbc`
- Frozen Owner ABI: `123` / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production deploy authorization: **FALSE**
- Production mutation: **NONE**

## Why this temporary bridge exists

The canonical GET-only Production snapshot workflow is intentionally `workflow_dispatch` only and remains unchanged. The connected GitHub tool surface available to ChatGPT does not expose workflow-dispatch, and the workflow is not on `main`, so GitHub cannot dispatch it through the normal default-branch workflow-dispatch registry.

This temporary bridge is a connector-compat execution mechanism only. It does **not** replace or relax the canonical manual harness. It must be removed immediately after one read-only snapshot attempt and evidence capture.

## Safety design

The temporary workflow may run only when all of these are true:

1. push occurs on exactly `refactor/research-vnext-foundation-20260901`;
2. the only trigger path is `runtime/research-vnext-production-control-plane-one-shot-authorization.json`;
3. the authorization JSON has an exact frozen schema/mode/source SHA;
4. execution checks out the already sealed source SHA `9fa1499eeaeb2ccaa7e118502f8b618c76401a31` into a separate `sealed/` directory;
5. the only Cloudflare-capable program invoked is the already sealed GET-only snapshot client;
6. workflow permissions remain `contents: read`;
7. no `gh`, `curl`, Wrangler deploy/rollback, Cloudflare mutation method, Production MCP endpoint, or canonical deploy workflow may be invoked;
8. receipt is uploaded as an artifact;
9. Production deploy authorization remains false and Production mutation remains none.

The bridge workflow itself is added first **without** the authorization file, so GREEN CI cannot contact Production. Only after bridge GREEN/seal may a separate authorization-file commit trigger exactly one live GET-only attempt.

## TEST BEFORE BUILD

RED test:

- `tests/research-vnext-production-control-plane-one-shot-bridge.test.ts`

A valid RED must first prove:

- canonical manual harness remains sealed and `workflow_dispatch` only;
- Owner ABI remains frozen at 123 / frozen digest;
- Production deploy authorization remains false;
- Production mutation remains none;
- marker `PRODUCTION_CONTROL_PLANE_ONE_SHOT_BRIDGE_RED_READY=PASS` prints;
- only then may it fail because `.github/workflows/research-vnext-production-control-plane-one-shot.yml` is absent.

## RED evidence

Pending formal CI. The docs-only commit following `218b98f9...` exists solely to force GitHub PR synchronize after the Git Data ref update produced no check-suite; test semantics are unchanged.

## GREEN implementation

Forbidden until formal RED is accepted.

## Cleanup requirement

After the one live read-only snapshot attempt is captured, remove both:

- `.github/workflows/research-vnext-production-control-plane-one-shot.yml`
- `runtime/research-vnext-production-control-plane-one-shot-authorization.json`

No Production deploy, rollback, Legacy retirement, OAuth KV/Cron mutation, OHLC mutation, or PR merge is authorized by this bridge.
