import assert from "node:assert/strict";
import { readGitHubJson, stableJson } from "../src/v6/github-data-store.ts";

const path = "data/market-data/index/2026/08/2.json";
const blobSha = "a".repeat(40);
const logicalValue = {
  schema_version: "diamond-market-data-symbol-shard/v2",
  month: "2026-08",
  prefix: "2",
  symbols: {
    "2330": {
      institutional: [
        {
          trade_date: "2026-08-31",
          symbol: "2330",
          source: "TWSE_T86",
          source_priority: "OFFICIAL",
          foreign_net_shares: 1,
          trust_net_shares: 2,
          dealer_net_shares: 3,
          total_net_shares: 6,
        },
      ],
    },
  },
};
const logicalText = stableJson(logicalValue);
const blobContent = Buffer.from(logicalText, "utf8").toString("base64");

const originalFetch = globalThis.fetch;
const calls: string[] = [];
try {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    if (url.includes("/contents/")) {
      // GitHub Contents API returns this shape for files above its inline-content threshold.
      return Response.json({
        type: "file",
        sha: blobSha,
        size: 3_000_000,
        encoding: "none",
        content: "",
        git_url: `https://api.github.com/repos/keywayk09/tv-papertrader/git/blobs/${blobSha}`,
      });
    }

    if (url.endsWith(`/git/blobs/${blobSha}`)) {
      return Response.json({
        sha: blobSha,
        size: Buffer.byteLength(logicalText, "utf8"),
        encoding: "base64",
        content: blobContent,
      });
    }

    throw new Error(`unexpected_fetch:${url}`);
  }) as typeof fetch;

  const read = await readGitHubJson<typeof logicalValue>({
    GITHUB_DATA_REPO: "keywayk09/tv-papertrader",
    GITHUB_DATA_BRANCH: "main",
  } as Env, path);

  assert.equal(read.exists, true);
  assert.equal(read.sha, blobSha);
  assert.deepEqual(read.value, logicalValue);
  assert.equal(calls.length, 2, "large Contents API payload must resolve through the Git blob endpoint");
  assert.match(calls[1] ?? "", /\/git\/blobs\//);

  console.log("PASS github data store reads large Contents API files through blob fallback");
} finally {
  globalThis.fetch = originalFetch;
}
