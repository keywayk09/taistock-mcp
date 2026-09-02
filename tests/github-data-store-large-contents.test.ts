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
  _fixture_padding: "x".repeat(1_100_000),
};
const logicalText = stableJson(logicalValue);
const logicalBytes = Buffer.byteLength(logicalText, "utf8");
const blobContent = Buffer.from(logicalText, "utf8").toString("base64");
const env = {
  GITHUB_DATA_REPO: "keywayk09/tv-papertrader",
  GITHUB_DATA_BRANCH: "main",
} as Env;

assert.ok(logicalBytes > 1_000_000, "fixture must model a GitHub Contents API large file");

const originalFetch = globalThis.fetch;
try {
  {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);

      if (url.includes("/contents/")) {
        // GitHub Contents API returns this shape for files above its inline-content threshold.
        return Response.json({
          type: "file",
          sha: blobSha,
          size: logicalBytes,
          encoding: "none",
          content: "",
          git_url: `https://api.github.com/repos/keywayk09/tv-papertrader/git/blobs/${blobSha}`,
        });
      }

      if (url === `https://api.github.com/repos/keywayk09/tv-papertrader/git/blobs/${blobSha}`) {
        return Response.json({
          sha: blobSha,
          size: logicalBytes,
          encoding: "base64",
          content: blobContent,
        });
      }

      throw new Error(`unexpected_fetch:${url}`);
    }) as typeof fetch;

    const read = await readGitHubJson<typeof logicalValue>(env, path);

    assert.equal(read.exists, true);
    assert.equal(read.sha, blobSha);
    assert.deepEqual(read.value, logicalValue);
    assert.equal(calls.length, 2, "large Contents API payload must resolve through the Git blob endpoint");
    assert.equal(calls[1], `https://api.github.com/repos/keywayk09/tv-papertrader/git/blobs/${blobSha}`);
  }

  {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);

      if (url.includes("/contents/")) {
        return Response.json({
          type: "file",
          sha: blobSha,
          size: logicalBytes,
          encoding: "none",
          content: "",
          git_url: `https://api.github.com/repos/other-owner/other-repo/git/blobs/${blobSha}`,
        });
      }

      if (url === `https://api.github.com/repos/other-owner/other-repo/git/blobs/${blobSha}`) {
        return Response.json({
          sha: blobSha,
          size: logicalBytes,
          encoding: "base64",
          content: blobContent,
        });
      }

      throw new Error(`unexpected_fetch:${url}`);
    }) as typeof fetch;

    await assert.rejects(
      () => readGitHubJson<typeof logicalValue>(env, path),
      (error: any) => error?.code === "GITHUB_INVALID_LARGE_CONTENT",
      "large-file fallback must reject a cross-repository git_url",
    );
    assert.equal(calls.length, 1, "cross-repository git_url must be rejected before any blob fetch");
  }

  console.log("PASS github data store reads only same-repository large Contents blobs");
} finally {
  globalThis.fetch = originalFetch;
}
