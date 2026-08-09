import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  archiveSupplyChainSnapshot,
  findSupplyChainDatasets,
  loadArchivedSupplyChainSnapshot,
  queryArchivedSupplyChain,
} from "./supply-chain-data-plane";
import type { SupplyChainSnapshotInput } from "./supply-chain-graph";

const out = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

const snapshotShape = {
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source_dataset: z.string().trim().min(1).max(240).optional(),
  entities: z.array(z.any()).max(5000),
  evidence: z.array(z.any()).max(20000),
  edges: z.array(z.any()).max(20000),
};

export function registerSupplyChainDataPlaneTools(server: McpServer, env: Env) {
  server.registerTool("archive_supply_chain_snapshot", {
    description: "P13b 將已驗證 Supply Chain Snapshot 以 immutable dataset_version 存入 Research D1 index + R2 archive。需要 human_approved=true；append-only，不寫 OHLC。",
    inputSchema: {
      snapshot: z.object(snapshotShape),
      archive_actor: z.string().trim().min(1).max(200),
      review_note: z.string().trim().min(1).max(2000).optional(),
      human_approved: z.literal(true),
    },
    annotations: { readOnlyHint:false, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async ({ snapshot, archive_actor, review_note, human_approved }) => out(await archiveSupplyChainSnapshot(env, {
    snapshot: snapshot as SupplyChainSnapshotInput,
    archive_actor,
    review_note,
    human_approved,
  })));

  server.registerTool("find_supply_chain_datasets", {
    description: "依 symbol/market/as_of/formal eligibility 查找已封存的跨市場供應鏈 dataset。",
    inputSchema: {
      symbol: z.string().trim().min(1).max(40).optional(),
      market: z.string().trim().min(1).max(40).optional(),
      as_of_lte: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      formal_only: z.boolean().optional().default(false),
      limit: z.number().int().min(1).max(100).optional().default(20),
    },
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async (input) => out(await findSupplyChainDatasets(env, input)));

  server.registerTool("get_archived_supply_chain_snapshot", {
    description: "用 dataset_version 讀取已封存 Supply Chain Snapshot；讀取時重新驗證 hash/version，偵測 R2/D1 漂移或損壞。",
    inputSchema: { dataset_version: z.string().regex(/^sha256:[0-9a-f]{64}$/) },
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async ({ dataset_version }) => out(await loadArchivedSupplyChainSnapshot(env, dataset_version)));

  server.registerTool("query_archived_supply_chain", {
    description: "對已封存 dataset 查任一台股/海外標的的 upstream/downstream 供應鏈；預設排除 Candidate edge。",
    inputSchema: {
      dataset_version: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      anchor: z.string().trim().min(1).max(160),
      direction: z.enum(["UPSTREAM","DOWNSTREAM","BOTH"]).optional().default("BOTH"),
      max_depth: z.number().int().min(1).max(4).optional().default(2),
      include_candidates: z.boolean().optional().default(false),
    },
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async (input) => out(await queryArchivedSupplyChain(env, input)));
}
