# Change Note — Research VNext Production Control-Plane One-Shot Connector Bridge

- Date: `2026-09-01`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — remains Draft/open/unmerged
- Canonical sealed manual harness source: `9fa1499eeaeb2ccaa7e118502f8b618c76401a31`
- Initial RED commit: `9b138d10f0a931a125f6d62b546b407896cc0325`
- Same-tree RED verification commit: `218b98f9cd4c423ac00ddd173dc455cf4af77dbc`
- Docs-only PR-sync trigger: `fc3048f8c230a455182602ec019f0aca4f169543`
- Frozen Owner ABI: `123` / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production deploy authorization: **FALSE**
- Production mutation: **NONE**

## Why this temporary bridge exists

The canonical GET-only Production snapshot workflow is intentionally `workflow_dispatch` only and remains unchanged. The connected GitHub tool surface available to ChatGPT does not expose workflow-dispatch, and the workflow is not on `main`, so GitHub cannot dispatch it through the normal default-branch workflow-dispatch registry.

This temporary bridge is a connector-compat execution mechanism only. It does **not** replace or relax the canonical manual harness. It must be removed immediately after one read-only snapshot attempt and evidence capture.

## Safety design

The temporary workflow may run only when all of these are true:

1. push occurs on exactly `refactor/research-vnext-foundation-20260901`;
2. the trigger path is exactly `runtime/research-vnext-production-control-plane-one-shot-authorization.json`;
3. the triggering commit changes exactly that one authorization file and no other file;
4. the authorization JSON has exact frozen schema/mode/source SHA and explicitly keeps deploy authorization false / mutation none;
5. execution checks out the already sealed source SHA `9fa1499eeaeb2ccaa7e118502f8b618c76401a31` into a separate `sealed/` directory;
6. the only Cloudflare-capable program invoked is the already sealed GET-only snapshot client;
7. workflow permissions remain `contents: read`;
8. Cloudflare credentials are exposed only to the snapshot step as runtime secrets;
9. no `gh`, `curl`, Wrangler deploy/rollback, Cloudflare mutation method, Production MCP endpoint, or canonical deploy workflow may be invoked;
10. receipt is uploaded as an artifact;
11. Production deploy authorization remains false and Production mutation remains none.

The bridge workflow is added first **without** the authorization file, so GREEN CI cannot contact Production. Only after bridge GREEN and seal may a separate authorization-file-only commit trigger exactly one live GET-only attempt.

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

## RED evidence — ACCEPTED

Formal RED evidence is the same-tree verification commit `218b98f9cd4c423ac00ddd173dc455cf4af77dbc`. The later docs-only commit `fc3048f8...` only forced GitHub PR synchronize after Git Data ref updates produced no check-suite; RED test semantics were unchanged.

Research VNext Incremental Gate:

- Run `33524162500`
- Job `99910600386`
- Change Note / protected-surface scope gate: **PASS**
- all prior Research VNext tests: **PASS**
- marker: `PRODUCTION_CONTROL_PLANE_ONE_SHOT_BRIDGE_RED_READY=PASS`
- canonical manual harness: `SEALED_UNCHANGED`
- sealed source SHA: `9fa1499eeaeb2ccaa7e118502f8b618c76401a31`
- Owner tool count: `123`
- Owner ABI digest: `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production deploy authorized: `false`
- Production mutation: **NONE**
- terminal result: **EXPECTED RED**
- exact terminal assertion: `temporary one-shot GET-only bridge workflow must exist only after accepted RED`
- downstream incremental type-check / full research regression / dry-runs: correctly **SKIPPED**

Independent validation on the RED commit:

- Type check Run `33524162512`: **SUCCESS**, including type check, full `test:research`, and Wrangler dry-run
- Isolation Run `33524162507`: FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE **PASS**; VNEXT failed only on the same expected missing temporary workflow; isolation finalizer failed closed as designed

Disposition:

`PRODUCTION_CONTROL_PLANE_ONE_SHOT_BRIDGE_RED_ACCEPTED_GREEN_IMPLEMENTATION_ALLOWED`

The RED failure remains immutable and is not rewritten as PASS.

## GREEN implementation

Allowed implementation is limited to:

- `.github/workflows/research-vnext-production-control-plane-one-shot.yml`

The GREEN implementation commit must **not** create the authorization JSON. Therefore it cannot trigger the temporary workflow and cannot contact Production.

The workflow itself must remain pinned to sealed source `9fa1499eeaeb2ccaa7e118502f8b618c76401a31`, validate an authorization-file-only trigger commit, and execute only the sealed GET-only snapshot client.

GREEN CI evidence: pending.

## Cleanup requirement

After the one live read-only snapshot attempt is captured, remove both:

- `.github/workflows/research-vnext-production-control-plane-one-shot.yml`
- `runtime/research-vnext-production-control-plane-one-shot-authorization.json`

No Production deploy, rollback, Legacy retirement, OAuth KV/Cron mutation, OHLC mutation, or PR merge is authorized by this bridge.
