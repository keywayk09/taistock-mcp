# P13 — Cross-market Supply Chain Graph

## Goal

Allow any Taiwan or overseas security to resolve to a legal/company entity and traverse a shared evidence-backed supply-chain graph.

The graph is intentionally **entity-first**, not ticker-first:

`Instrument (TW/US/HK/CN/JP/KR/Private) -> Legal Entity -> Supply-chain Edges -> Other Entities -> Their Instruments`

This avoids treating different listings, ADRs, private suppliers, subsidiaries, or renamed tickers as unrelated companies.

## Direction semantics

Every directed edge means:

`source_entity -> supplies/provides/manufactures for -> target_entity`

Therefore:
- Upstream of an anchor = incoming edges.
- Downstream of an anchor = outgoing edges.
- BOTH = traverse both directions.

Supported relation families include generic supply, material/component/equipment supplier, foundry, OEM, ODM, assembly, distribution, logistics, cloud platform and manufacturing partner.

## Evidence and time safety

Every non-rejected edge requires evidence. Evidence records:
- source type
- source reference
- published time
- observed time
- SHA-256 evidence hash

Primary evidence types are company/exchange filings, company IR and government disclosures. Licensed providers, reputable news and manually reviewed evidence can supplement primary sources.

LLM-generated relationship suggestions are discovery-only. They may be stored only as `CANDIDATE`; they cannot support `VERIFIED` or `CORROBORATED` edges.

A snapshot is rejected if evidence was published after the requested `as_of` date. This prevents future information from leaking into historical research/backtests.

## Versioned snapshots

`validate_supply_chain_snapshot` canonicalizes the entity/evidence/edge graph and produces:
- `dataset_id`
- `dataset_version = sha256:<hash>`
- edge/evidence counts
- snapshot-specific `formal_research_eligible`

Formal research eligibility requires every active edge in the snapshot to be verified/corroborated and to have primary-source support.

## MCP tools

- `get_supply_chain_contract`
- `validate_supply_chain_snapshot`
- `query_supply_chain_graph`

`query_supply_chain_graph` accepts `entity_id`, `instrument_id`, or `symbol` as the anchor and can traverse UPSTREAM, DOWNSTREAM or BOTH for up to four hops. Candidate edges are excluded by default.

## Hard boundaries

P13 does not:
- fetch external supply-chain data by itself
- trust a single provider automatically
- write OHLC
- mutate historical Signal/Event state
- promote a strategy
- allow future evidence into an older snapshot
- allow an LLM suggestion to become verified evidence

## Next data-plane step

P13 establishes the deterministic graph/evidence contract first. The next step is to add provider/source adapters that populate snapshots from official filings/IR plus independently corroborated sources. Those adapters must feed this evidence gate rather than bypass it.

Strategy formalization from P12 should continue after this shared Research Data capability is stable, because supply-chain context can then be consumed consistently by fundamental, event, thematic and strategy research.
