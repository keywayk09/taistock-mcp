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

## GREEN implementation — PASS

Temporary workflow implementation commit:

- `38f5be7ab7427c3c881fa790b178bebc45ac134b`

Authorization remained absent, so GREEN validation did not contact Production.

GREEN verification:

- Research VNext Incremental Gate Run `33534534752`: `SUCCESS`
- Type check Run `33534534832`: `SUCCESS`
- Research VNext Isolation Gate Run `33534534860`: `SUCCESS`
- scope/protected-surface gate: `SUCCESS`
- all Research VNext tests: `SUCCESS`
- full existing research regression: `SUCCESS`
- Cloudflare dry-run only: `SUCCESS`
- atomic deploy-config dry-run only: `SUCCESS`
- Owner ABI remains `123` / frozen digest
- Production authorization file: `ABSENT`
- Production deploy authorization: `false`
- Production mutation: `NONE`

Immutable-style GREEN evidence:

- Artifact ID: `9811094118`
- Artifact name: `research-vnext-evidence-33534534752`
- Artifact digest: `sha256:01cfaee1469460d618b525519d8ee9fdef645040f65733a38b17dab34be38751`

The temporary workflow contract is bounded to exact branch + exact authorization-file trigger, exact source/baseline, predeploy drift rejection, pure planner + dry-run, one Worker deploy mutation only, postdeploy read-only validation, read-only MCP probe, immutable evidence upload, no resource provisioning, no Cron mutation, no KV creation and no automatic rollback.

Disposition before seal:

`PASS_ATOMIC_PRODUCTION_ONE_SHOT_HARNESS_GREEN_UNAUTHORIZED`

## Seal requirement

This docs-only seal commit must itself pass:

- Research VNext Incremental Gate;
- Type check;
- Research VNext Isolation Gate.

Only after all three are `SUCCESS` may the autonomous deployment decision be evaluated. Even then, authorization is issued only if PR #206 remains Draft/open/unmerged, the branch head is the seal commit, the authorization path is absent, and no prerequisite has drifted.

Until that decision:

- Production deploy authorization: `false`
- Production mutation: `NONE`
- Production rollback: `NONE`
- Legacy retirement: `NONE`
