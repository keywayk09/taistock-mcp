import assert from "node:assert/strict";
import fs from "node:fs";
import { applyCrossVerification } from "../src/v6/supply-chain-cross-verification";
import { getOfficialSupplyChainSourceContract } from "../src/v6/supply-chain-official-source";

const evidence = [
  { evidence_id:"e1", source_type:"COMPANY_IR", source_ref:"https://example-a.com/ir/a", published_at:"2026-01-01T00:00:00Z", observed_at:"2026-01-02T00:00:00Z", evidence_sha256:"1".repeat(64) },
  { evidence_id:"e2", source_type:"EXCHANGE_FILING", source_ref:"https://example-b.com/filing/b", published_at:"2026-01-03T00:00:00Z", observed_at:"2026-01-04T00:00:00Z", evidence_sha256:"2".repeat(64) },
  { evidence_id:"e3", source_type:"LLM_SUGGESTION", source_ref:"llm:discovery", published_at:"2026-01-01T00:00:00Z", observed_at:"2026-01-01T00:00:00Z", evidence_sha256:"3".repeat(64) },
] as const;

const edgeBase = {
  edge_id:"edge-1",
  source_entity_id:"supplier",
  target_entity_id:"customer",
  relation:"COMPONENT_SUPPLIER_TO",
  verification_status:"CANDIDATE",
  confidence:0.99,
} as const;

const verified = applyCrossVerification({
  as_of:"2026-02-01",
  evidence:[...evidence] as any,
  edges:[{ ...edgeBase, evidence_ids:["e1","e2"] } as any],
});
assert.equal(verified.edges[0].verification_status, "VERIFIED");
assert.ok(verified.edges[0].confidence <= 0.98);

const llmOnly = applyCrossVerification({
  as_of:"2026-02-01",
  evidence:[...evidence] as any,
  edges:[{ ...edgeBase, evidence_ids:["e3"] } as any],
});
assert.equal(llmOnly.edges[0].verification_status, "CANDIDATE");
assert.ok(llmOnly.edges[0].confidence <= 0.25);

assert.throws(() => applyCrossVerification({
  as_of:"2025-12-31",
  evidence:[...evidence] as any,
  edges:[{ ...edgeBase, evidence_ids:["e1"] } as any],
}), /future evidence is forbidden/);

const contract = getOfficialSupplyChainSourceContract();
assert.ok(contract.allowed_hosts.includes("data.sec.gov"));
assert.ok(contract.allowed_hosts.includes("mops.twse.com.tw"));
assert.equal(contract.redirect_policy, "REJECT");
assert.equal(contract.sec_user_agent_required, true);
assert.equal(contract.relationship_auto_verification, false);

const sourceAdapter = fs.readFileSync(new URL("../src/v6/supply-chain-official-source.ts", import.meta.url), "utf8");
assert.match(sourceAdapter, /ALLOWED_HOSTS/);
assert.match(sourceAdapter, /redirect:"manual"/);
assert.match(sourceAdapter, /REDIRECT_REJECTED/);
assert.match(sourceAdapter, /SEC_USER_AGENT_REQUIRED/);
assert.match(sourceAdapter, /MAX_BYTES = 2 \* 1024 \* 1024/);
assert.doesNotMatch(sourceAdapter, /method:"POST"|Authorization|Bearer /);

const archiveSource = fs.readFileSync(new URL("../src/v6/supply-chain-data-plane.ts", import.meta.url), "utf8");
assert.match(archiveSource, /HUMAN_APPROVAL_REQUIRED/);
assert.match(archiveSource, /ORPHAN_R2_CONFLICT/);
assert.match(archiveSource, /ARCHIVE_HASH_MISMATCH/);
assert.match(archiveSource, /await env\.RESEARCH_BUCKET\.delete\(r2Key\)/);
assert.match(archiveSource, /supply-chain\/snapshots\/\$\{validated\.as_of\}/);
assert.doesNotMatch(archiveSource, /OHLC|Fugle|github\.com\/repos/i);

console.log("P13b supply-chain data plane tests passed");
