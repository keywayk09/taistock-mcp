import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SupplyChainGraphError,
  getSupplyChainContract,
  querySupplyChainSnapshot,
  validateSupplyChainSnapshot,
} from "../src/v6/supply-chain-graph.ts";

const hash = (char:string) => char.repeat(64);

const base = {
  as_of: "2026-08-08",
  source_dataset: "test-fixture/v1",
  entities: [
    {
      entity_id: "entity:tw-alpha",
      legal_name: "Taiwan Alpha Manufacturing Co.",
      country: "TW",
      instruments: [{ instrument_id:"TW:1234", market:"TW_STOCK" as const, symbol:"1234", exchange:"TWSE", currency:"TWD", primary_listing:true }],
    },
    {
      entity_id: "entity:us-beta",
      legal_name: "US Beta Design Inc.",
      country: "US",
      instruments: [{ instrument_id:"US:BETA", market:"US_STOCK" as const, symbol:"BETA", exchange:"NASDAQ", currency:"USD", primary_listing:true }],
    },
    {
      entity_id: "entity:private-gamma",
      legal_name: "Gamma Equipment Ltd.",
      country: "JP",
      instruments: [{ instrument_id:"PRIVATE:GAMMA", market:"PRIVATE" as const, symbol:"GAMMA", primary_listing:true }],
    },
  ],
  evidence: [
    {
      evidence_id:"ev:alpha-beta",
      source_type:"COMPANY_FILING" as const,
      source_ref:"fixture://alpha-filing",
      published_at:"2026-08-01T00:00:00Z",
      observed_at:"2026-08-02T00:00:00Z",
      evidence_sha256:hash("a"),
    },
    {
      evidence_id:"ev:gamma-alpha",
      source_type:"COMPANY_IR" as const,
      source_ref:"fixture://gamma-ir",
      published_at:"2026-07-20T00:00:00Z",
      observed_at:"2026-07-21T00:00:00Z",
      evidence_sha256:hash("b"),
    },
  ],
  edges: [
    {
      edge_id:"edge:alpha-beta",
      source_entity_id:"entity:tw-alpha",
      target_entity_id:"entity:us-beta",
      relation:"FOUNDRY_FOR" as const,
      product_or_service:"advanced manufacturing",
      verification_status:"VERIFIED" as const,
      confidence:0.95,
      evidence_ids:["ev:alpha-beta"],
    },
    {
      edge_id:"edge:gamma-alpha",
      source_entity_id:"entity:private-gamma",
      target_entity_id:"entity:tw-alpha",
      relation:"EQUIPMENT_SUPPLIER_TO" as const,
      verification_status:"CORROBORATED" as const,
      confidence:0.9,
      evidence_ids:["ev:gamma-alpha"],
    },
  ],
};

{
  const contract = getSupplyChainContract();
  assert.equal(contract.graph_level,"LEGAL_ENTITY_WITH_INSTRUMENT_MAPPING");
  assert.ok(contract.supported_markets.includes("TW_STOCK"));
  assert.ok(contract.supported_markets.includes("US_STOCK"));
  assert.equal(contract.production_write,false);
}

{
  const a = await validateSupplyChainSnapshot(base);
  const b = await validateSupplyChainSnapshot({ ...base, entities:[...base.entities].reverse(), evidence:[...base.evidence].reverse(), edges:[...base.edges].reverse() });
  assert.equal(a.dataset_id,b.dataset_id,"snapshot identity must be order-independent for entities/evidence/edges");
  assert.equal(a.formal_research_eligible,true);
  assert.equal(a.active_edge_count,2);
  assert.match(a.dataset_version,/^sha256:[0-9a-f]{64}$/);
}

{
  const result = await querySupplyChainSnapshot({ ...base, anchor:"BETA", direction:"UPSTREAM", max_depth:2 });
  assert.equal(result.anchor_entity.entity_id,"entity:us-beta");
  assert.equal(result.edge_count,2);
  assert.deepEqual(result.entities.map((x)=>x.entity_id),["entity:private-gamma","entity:tw-alpha","entity:us-beta"]);
  assert.equal(result.formal_research_eligible,true);
}

{
  const candidate = {
    ...base,
    evidence:[...base.evidence,{
      evidence_id:"ev:llm",
      source_type:"LLM_SUGGESTION" as const,
      source_ref:"fixture://llm",
      published_at:"2026-08-01T00:00:00Z",
      observed_at:"2026-08-01T00:00:00Z",
      evidence_sha256:hash("c"),
    }],
    edges:[...base.edges,{
      edge_id:"edge:candidate",
      source_entity_id:"entity:us-beta",
      target_entity_id:"entity:private-gamma",
      relation:"SUPPLIES_TO" as const,
      verification_status:"CANDIDATE" as const,
      confidence:0.4,
      evidence_ids:["ev:llm"],
    }],
  };
  const excluded = await querySupplyChainSnapshot({ ...candidate, anchor:"BETA", direction:"DOWNSTREAM", max_depth:1 });
  assert.equal(excluded.edge_count,0,"candidate edges are excluded by default");
  const included = await querySupplyChainSnapshot({ ...candidate, anchor:"BETA", direction:"DOWNSTREAM", max_depth:1, include_candidates:true });
  assert.equal(included.edge_count,1);
  assert.equal(included.formal_research_eligible,false);
}

{
  await assert.rejects(
    validateSupplyChainSnapshot({
      ...base,
      evidence:[{
        ...base.evidence[0],
        published_at:"2026-08-09T00:00:00Z",
      }],
      edges:[base.edges[0]],
    }),
    (error:unknown)=>error instanceof SupplyChainGraphError && error.code==="LOOKAHEAD_EVIDENCE",
  );
}

{
  await assert.rejects(
    validateSupplyChainSnapshot({
      ...base,
      evidence:[{
        evidence_id:"ev:bad-llm",
        source_type:"LLM_SUGGESTION",
        source_ref:"fixture://llm-only",
        published_at:"2026-08-01T00:00:00Z",
        observed_at:"2026-08-01T00:00:00Z",
        evidence_sha256:hash("d"),
      }],
      edges:[{
        ...base.edges[0],
        evidence_ids:["ev:bad-llm"],
      }],
    }),
    (error:unknown)=>error instanceof SupplyChainGraphError && error.code==="LLM_EVIDENCE_FORBIDDEN",
  );
}

{
  const source = await readFile(new URL("../src/v6/supply-chain-graph.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/\bfetch\s*\(/,"P13 graph engine must not fetch external data directly");
  assert.match(source,/LOOKAHEAD_EVIDENCE/);
  assert.match(source,/LLM_EVIDENCE_FORBIDDEN/);
  assert.match(source,/dataset_version:/);
}

console.log("P13 cross-market supply-chain entity/instrument mapping, evidence gate, time safety and graph query tests passed.");
