# Change Note — Research VNext Atomic Production One-Shot

- Date: `2026-09-02`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — must remain Draft/open/unmerged
- Sealed deployment source: `87bf6d22cc9ed9a44a8017aa860d956f1ec6eef7`
- Frozen Owner ABI: `123` / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production deployment decision: `FAIL_CLOSED_AUTONOMOUS`
- Operator instruction: test/build first; delegate final Production authorization decision only if every gate is proven safe.

## Immutable prerequisites

Final corrected control-plane cleanup seal:

- seal commit: `87bf6d22cc9ed9a44a8017aa860d956f1ec6eef7`
- Research VNext Incremental Gate Run `33532739409`: `SUCCESS`
- Type check Run `33532739410`: `SUCCESS`
- Research VNext Isolation Gate Run `33532739330`: `SUCCESS`
- artifact: `9810399696`
- artifact digest: `sha256:46b6b9d862e235af0e0f37ea165ce77a66c308a9a65990bf5578ef81f086f1e0`

Corrected live baseline from immutable artifact `9809833837`:

- status: `READ_ONLY_SNAPSHOT_VALID`
- expected active version: `75f989b9-e798-4d32-a95f-7253b4e703ec`
- expected cron: `*/5 * * * *`
- expected binding fingerprint: `d1faf34e53a3901c0ca13f4c29ff354194c7a3788bd94aa7a2e37509eaf1a49b`
- protected exports: `MyMCP`, `FamilyMCP`
- read_only_capture: `true`
- token_leak: `false`
- Production deploy authorized in baseline: `false`
- Production mutation in baseline: `NONE`

The permanent `.github/workflows/research-vnext-atomic-production-execution.yml` remains a blocked skeleton and is not repurposed.

## RED-A — immutable, not accepted

Initial RED-A head:

- `35073dfe244cb3772f665e2733cc07f4120e3bc4`
- Research VNext Incremental Gate Run `33533821730`: `FAILURE`
- Type check Run `33533821742`: `SUCCESS`
- Research VNext Isolation Gate Run `33533821597`: `FAILURE`
- Isolation FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE: `SUCCESS`
- Isolation VNEXT: `FAILURE`

RED-A failed before the intended marker because the test looked for `token_leak: false` in the GET client rather than the deterministic snapshot builder. It remains immutable and is not promoted.

Single-point correction:

- test correction commit: `06b1d347d1fbbffec915f1c989b185dd30671ab1`
- evidence-note commit: `5cf9de4f66e99bb55908aefb22f7031000950eb0`
- no workflow implementation at correction time
- no authorization file
- no Production contact or mutation

## Formal RED — accepted

Formal RED head:

- `5cf9de4f66e99bb55908aefb22f7031000950eb0`

Evidence:

- Research VNext Incremental Gate Run `33534062752`: `FAILURE`
- Incremental Job `99943924625`: `FAILURE`
- scope/protected-surface gate: `SUCCESS`
- marker before terminal RED: `ATOMIC_PRODUCTION_ONE_SHOT_RED_READY=PASS`
- source SHA: `87bf6d22cc9ed9a44a8017aa860d956f1ec6eef7`
- expected predeploy version: `75f989b9-e798-4d32-a95f-7253b4e703ec`
- expected binding fingerprint: `d1faf34e53a3901c0ca13f4c29ff354194c7a3788bd94aa7a2e37509eaf1a49b`
- expected cron: `*/5 * * * *`
- Owner ABI: `123` / frozen digest
- permanent execution skeleton: `BLOCKED_UNCHANGED`
- Production deploy authorized: `false`
- Production mutation: `NONE`
- exact terminal assertion: `temporary atomic Production one-shot workflow must exist only after accepted RED`

Independent validation:

- Type check Run `33534062724`: `SUCCESS`
- Research VNext Isolation Gate Run `33534062798`: `FAILURE`
- Isolation FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE: `SUCCESS`
- Isolation VNEXT: `FAILURE`

Disposition:

`ATOMIC_PRODUCTION_ONE_SHOT_RED_ACCEPTED_GREEN_IMPLEMENTATION_ALLOWED`

## GREEN implementation contract

A distinct temporary workflow is now allowed at:

- `.github/workflows/research-vnext-atomic-production-one-shot.yml`

Authorization remains absent during GREEN and seal, so this workflow cannot run against Production yet.

The workflow is required to:

1. trigger only on the exact branch and exact authorization JSON path;
2. reject any trigger commit that changes more than that one file;
3. pin deployment source to `87bf6d22cc9ed9a44a8017aa860d956f1ec6eef7`;
4. capture a GET-only predeploy control-plane snapshot;
5. fail closed unless active version, cron, full binding fingerprint, OAuth KV, protected exports and DO bindings exactly match the immutable baseline;
6. derive the existing OAuth KV namespace from the live snapshot only;
7. generate the deploy config with the sealed pure planner, resource provisioning disabled and trigger mutation intent none;
8. run `wrangler deploy --dry-run` before mutation;
9. permit exactly one real `wrangler deploy` when all prior gates pass;
10. make no Cron/KV API mutation and introduce no DO migrations;
11. capture a GET-only postdeploy snapshot and require cron/OAuth KV/full binding fingerprint/exports/DO bindings to be preserved;
12. require a new 100% active Worker version;
13. run the sealed read-only Production MCP probe;
14. retain pre/post/plan/probe/deploy evidence even on workflow failure;
15. never perform automatic rollback.

If the future one-shot fails before the deploy step, Production mutation remains none. If it fails after the deploy step, the immutable evidence must be inspected before any manual exact-version rollback decision.

Until GREEN and its seal both pass:

- Production authorization file: `ABSENT`
- Production deploy authorization: `false`
- Production mutation: `NONE`
- Production rollback: `NONE`
- Legacy retirement: `NONE`
