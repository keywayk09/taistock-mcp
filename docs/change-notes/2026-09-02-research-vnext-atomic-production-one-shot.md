# Change Note — Research VNext Atomic Production One-Shot

- Date: `2026-09-02`
- Branch: `refactor/research-vnext-foundation-20260901`
- PR: `#206` — must remain Draft/open/unmerged
- Sealed deployment source: `87bf6d22cc9ed9a44a8017aa860d956f1ec6eef7`
- Frozen Owner ABI: `123` / `00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d`
- Production deployment decision: `FAIL_CLOSED_AUTONOMOUS`
- Operator instruction: test/build first; delegate final Production authorization decision only if every gate is proven safe.

## Immutable prerequisites

The corrected read-only Production control-plane recapture and cleanup are sealed before this phase.

Final cleanup seal evidence:

- seal commit: `87bf6d22cc9ed9a44a8017aa860d956f1ec6eef7`
- Research VNext Incremental Gate Run `33532739409`: `SUCCESS`
- Type check Run `33532739410`: `SUCCESS`
- Research VNext Isolation Gate Run `33532739330`: `SUCCESS`
- seal artifact: `9810399696`
- seal artifact digest: `sha256:46b6b9d862e235af0e0f37ea165ce77a66c308a9a65990bf5578ef81f086f1e0`

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

## Execution design

The existing permanent workflow `.github/workflows/research-vnext-atomic-production-execution.yml` remains blocked and unchanged. It is not repurposed for live execution.

A distinct temporary one-shot workflow may be implemented only after accepted RED. Its contract must be:

1. exact branch + exact authorization-file push trigger;
2. authorization commit changes exactly one file;
3. exact sealed source SHA `87bf6d22cc9ed9a44a8017aa860d956f1ec6eef7`;
4. predeploy GET-only control-plane snapshot before any mutation;
5. fail closed unless active version, cron, binding fingerprint, OAuth KV binding, protected exports and DO bindings exactly match the immutable baseline;
6. use the existing OAuth KV namespace from the predeploy snapshot only — no create/list-selection mutation logic;
7. generate atomic Wrangler config through the sealed planner, with resource provisioning disabled and trigger mutation intent none;
8. run Wrangler dry-run before any mutation;
9. permit exactly one real `wrangler deploy` only after all preceding checks pass;
10. no Cron PUT, no KV POST, no resource provisioning, no DO migrations, no automatic rollback;
11. postdeploy GET-only control-plane snapshot must preserve cron, binding fingerprint, OAuth KV and protected DO bindings;
12. postdeploy read-only MCP probe must pass;
13. upload immutable pre/post/plan/probe/deploy receipt bundle;
14. temporary workflow and authorization must be removed immediately after immutable evidence is captured.

Rollback remains manual exact-version only and may be considered only if postdeploy validation fails while DO lifecycle and bindings remain safe.

## TEST BEFORE BUILD — RED-A immutable failure

The first RED candidate was not accepted because a test precondition looked for `token_leak: false` in the live GET client instead of the deterministic snapshot builder that emits the receipt field.

- RED-A head: `35073dfe244cb3772f665e2733cc07f4120e3bc4`
- Research VNext Incremental Gate Run `33533821730`: `FAILURE`
- Type check Run `33533821742`: `SUCCESS`
- Research VNext Isolation Gate Run `33533821597`: `FAILURE`
- Isolation FAMILY / MARKET_DATA / FORMAL_BLIND / OWNER_OPS / BUNDLE: `SUCCESS`
- Isolation VNEXT: `FAILURE`
- unexpected terminal assertion: live snapshot source did not match `/token_leak:\s*false/`
- Production contact: `NONE`
- Production mutation: `NONE`

RED-A remains immutable and is not promoted to an accepted RED.

Single-point test correction commit:

- `06b1d347d1fbbffec915f1c989b185dd30671ab1`
- correction only moves the `token_leak: false` source assertion to `src/v6/research-vnext/production-control-plane-snapshot.ts`
- no workflow implementation
- no authorization file
- no Production contact or mutation

## TEST BEFORE BUILD — formal RED candidate

RED test:

- `tests/research-vnext-atomic-production-one-shot.test.ts`

No temporary execution workflow or authorization file is present. The accepted RED must reach marker:

`ATOMIC_PRODUCTION_ONE_SHOT_RED_READY=PASS`

and then fail only on:

`temporary atomic Production one-shot workflow must exist only after accepted RED`

Until formal RED is accepted and GREEN + seal complete:

- Production deploy authorization: `false`
- Production mutation: `NONE`
- Production rollback: `NONE`
- Legacy retirement: `NONE`
