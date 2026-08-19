import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TPEX_OFFICIAL_RELAY_CONTRACT } from "../src/v6/tpex-official-relay.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

assert.deepEqual(TPEX_OFFICIAL_RELAY_CONTRACT, {
  schema: "TPEX_OFFICIAL_RELAY_V1",
  source_owner: "TPEx",
  persistence: "D1_ONLY",
  relay_branch: "market-data-relay",
  relay_repository: "keywayk09/taistock-mcp",
  r2_usage: "FORBIDDEN",
  ohlc_usage: "FORBIDDEN",
});

const relay = read("src/v6/tpex-official-relay.ts");
assert.match(relay, /TPEX_DIRECT/);
assert.match(relay, /GITHUB_OFFICIAL_RELAY/);
assert.match(relay, /raw\.githubusercontent\.com\/keywayk09\/taistock-mcp\/market-data-relay/);
assert.match(relay, /relay_sha_mismatch/);
assert.match(relay, /relay_row_count_mismatch/);
assert.match(relay, /relay_source_date_mismatch/);
assert.match(relay, /source_owner_mismatch/);
assert.match(relay, /r2_usage: "FORBIDDEN"/);
assert.match(relay, /ohlc_usage: "FORBIDDEN"/);
assert.doesNotMatch(relay, /R2Bucket|RESEARCH_BUCKET|r2_key|TaiwanStockPrice/);

const workflow = read(".github/workflows/tpex-official-relay.yml");
assert.match(workflow, /tpex_3insti_daily_trading/);
assert.match(workflow, /tpex_mainboard_margin_balance/);
assert.match(workflow, /TPEX_OFFICIAL_RELAY_V1/);
assert.match(workflow, /market-data-relay/);
assert.match(workflow, /cron: '15 10 \* \* 1-5'/);
assert.match(workflow, /cron: '15 12 \* \* 1-5'/);
assert.match(workflow, /if: github\.event_name != 'pull_request'/);
assert.match(workflow, /contents: write/);

const tpexBackfill = read("src/v6/tpex-market-data-backfill.ts");
assert.match(tpexBackfill, /fetchTpexOfficialPayload/);
assert.match(tpexBackfill, /GITHUB_OFFICIAL_RELAY|relay_sha256/);
assert.doesNotMatch(tpexBackfill, /R2Bucket|RESEARCH_BUCKET|r2_key/);

const twse = read("src/v6/twse-market-data-capture.ts");
assert.match(twse, /TWSE_T86/);
assert.match(twse, /TWSE_MI_MARGN/);
assert.doesNotMatch(twse, /TPEX_|tpex\.org\.tw/);
assert.doesNotMatch(twse, /R2Bucket|RESEARCH_BUCKET|r2_key/);

const index = read("src/index-v6.ts");
assert.match(index, /runTwseMarketDataCapture/);
assert.match(index, /runTpexMarketDataBackfill/);
assert.match(index, /Promise\.allSettled/);
assert.match(index, /TPEX_DIRECT_THEN_GITHUB_OFFICIAL_RELAY/);
assert.match(index, /relay_capture_taipei: \["18:15", "20:15"\]/);
assert.doesNotMatch(index, /runTwMarketDataDaily\(env, tradeDate\)/);

console.log("P18.8 TPEx official relay governance tests passed");
