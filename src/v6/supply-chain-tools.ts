import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getSupplyChainContract,
  querySupplyChainSnapshot,
  validateSupplyChainSnapshot,
  type SupplyChainSnapshotInput,
} from "./supply-chain-graph";

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

export function registerSupplyChainTools(server: McpServer) {
  server.registerTool("get_supply_chain_contract", {
    description: "取得鑽石引擎跨市場供應鏈圖譜契約。供應鏈建立在公司 Entity 層，再映射台股/美股/港股/A股/日股/韓股等 Instrument；所有關係必須有 evidence、時間水位與驗證狀態。",
    inputSchema: {},
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async () => out(getSupplyChainContract()));

  server.registerTool("validate_supply_chain_snapshot", {
    description: "驗證並凍結跨市場 Supply Chain Snapshot，建立 deterministic dataset_id/version。拒絕未來資訊、缺證據、未知實體、自我關聯；LLM suggestion 不得成為 VERIFIED/CORROBORATED evidence。",
    inputSchema: snapshotShape,
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async (input) => out(await validateSupplyChainSnapshot(input as SupplyChainSnapshotInput)));

  server.registerTool("query_supply_chain_graph", {
    description: "從已提供的 supply-chain snapshot 查詢任一台股或海外標的的上游/下游/雙向供應鏈，支援 entity_id、instrument_id 或 symbol 作為 anchor；預設排除未驗證 Candidate edge。",
    inputSchema: {
      ...snapshotShape,
      anchor: z.string().trim().min(1).max(160),
      direction: z.enum(["UPSTREAM","DOWNSTREAM","BOTH"]).optional().default("BOTH"),
      max_depth: z.number().int().min(1).max(4).optional().default(2),
      include_candidates: z.boolean().optional().default(false),
    },
    annotations: { readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false },
  }, async (input) => out(await querySupplyChainSnapshot(input as SupplyChainSnapshotInput & {
    anchor:string;
    direction?:"UPSTREAM"|"DOWNSTREAM"|"BOTH";
    max_depth?:number;
    include_candidates?:boolean;
  })));
}
