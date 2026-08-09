# P13b Cross-market Supply Chain Data Plane

P13b turns the P13 entity-first Supply Chain Graph into a governed research data plane.

## Flow

`Official evidence -> Cross Verification -> P13 Graph Validation -> Human Archive Gate -> D1 Index + R2 Immutable Snapshot -> Diamond query/research`

## Official source intake

The first guarded adapter allows HTTPS GET only from:

- `data.sec.gov`
- `www.sec.gov`
- `sec.gov`
- `mops.twse.com.tw`

Redirects are rejected, response size is capped at 2 MiB, timeout is 10 seconds, and no credentials/custom ports are accepted. SEC requests require `SEC_USER_AGENT` in the runtime environment so programmatic access can follow SEC identification guidance.

The adapter returns hashed evidence only. It never creates or verifies a supply-chain relationship automatically.

## Cross verification

Deterministic relationship verification policy:

- two independent primary sources -> `VERIFIED`
- one primary plus independent secondary corroboration -> `CORROBORATED`
- one primary -> `CORROBORATED`
- secondary sources only -> `CANDIDATE`
- LLM suggestion only -> `CANDIDATE`

Future evidence (`published_at > as_of`) is rejected.

Primary evidence types are company/exchange filings, company IR and government disclosures. Licensed providers, reputable news and manual review are corroborating evidence. LLM output is discovery-only.

## Archive

Snapshots are immutable and identified by the existing P13 SHA-256 `dataset_version`.

- D1 stores dataset/instrument/edge indexes.
- R2 stores the canonical snapshot payload.
- archive requires explicit `human_approved=true`.
- duplicate dataset versions are idempotent only when immutable metadata matches.
- orphan R2 objects fail closed.
- D1 failure after R2 write triggers R2 rollback.
- reads re-run P13 validation and verify dataset identity/hash.

No P13b path writes OHLC, Signal/Event history or Production Strategy state.

## Tools

- `get_supply_chain_official_source_contract`
- `fetch_official_supply_chain_evidence`
- `cross_verify_supply_chain_edges`
- `archive_supply_chain_snapshot`
- `find_supply_chain_datasets`
- `get_archived_supply_chain_snapshot`
- `query_archived_supply_chain`

Together with P13 graph tools, Diamond has 10 supply-chain tools.

## Runtime configuration

For SEC official evidence fetches, configure a descriptive `SEC_USER_AGENT` runtime secret/variable before use. Do not hardcode personal contact data in source control.

## Remaining expansion

P13b intentionally does not scrape arbitrary company websites or trust a commercial provider as truth. Additional company-IR/provider adapters must be separately allowlisted, rate-limited, provenance-preserving and regression tested before activation.
