# P8 Experiment Memory + Review Loop

P8 gives the Diamond Engine durable research memory without granting it authority to mutate Production strategy rules.

## Core contract

Every hypothesis test is recorded whether it succeeds or fails. The immutable record contains:

- hypothesis + normalized hypothesis hash
- source
- strategy id/version when applicable
- immutable Signal references
- P2 dataset id/version/hash references
- parameters
- result payload
- PF / win rate / expectancy / MFE / MAE when available
- regime
- validation status
- explicit rejection reason

The content hash becomes `experiment_version = sha256:<hash>`. A changed result or parameter set creates a new immutable version instead of editing history.

## Duplicate-memory gate

`review_hypothesis_history` normalizes the hypothesis and looks up its SHA-256 identity. It tells the Review Engine whether the exact hypothesis has already been tested and whether a previous version was rejected.

This is intentionally deterministic. Semantic/fuzzy similarity may be added later as a secondary advisory layer, but it must never replace exact immutable history.

## Decision ledger

Experiment decisions are append-only. Supported actions:

- `KEEP_RESEARCH`
- `MARK_CANDIDATE`
- `REJECT`
- `NOTE`

There is deliberately no `APPROVE_PRODUCTION` action.

`AI_REVIEW` is not allowed to perform `MARK_CANDIDATE`; that transition requires a human/system approval gate. Promotion from Candidate into a Production Strategy Registry remains a separate future governance workflow.

## Safety boundaries

Experiment Memory does not:

- fetch OHLC or external market data;
- write OHLC;
- modify Signal/Event Ledger history;
- overwrite prior experiment versions;
- delete failed experiments;
- promote a rule into Production.

This makes failed experiments first-class research assets and prevents the Diamond Engine from repeatedly testing known-dead ideas without surfacing that history.
