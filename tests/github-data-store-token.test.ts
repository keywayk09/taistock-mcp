import assert from "node:assert/strict";
import {
  DEFAULT_GITHUB_DATA_BRANCH,
  DEFAULT_GITHUB_DATA_REPO,
  updateGitHubJson,
} from "../src/v6/github-data-store.ts";

assert.equal(DEFAULT_GITHUB_DATA_REPO, "keywayk09/tv-papertrader");
assert.equal(DEFAULT_GITHUB_DATA_BRANCH, "main");

const originalFetch = globalThis.fetch;
const calls: Array<{ method: string; authorization: string | null }> = [];

globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
  const method = String(init?.method || "GET").toUpperCase();
  const headers = new Headers(init?.headers);
  calls.push({ method, authorization: headers.get("Authorization") });

  if (method === "GET") {
    return new Response(JSON.stringify({ message: "Not Found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  if (method === "PUT") {
    return new Response(JSON.stringify({ content: { sha: "test-sha" } }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error(`unexpected method ${method}`);
};

try {
  const env = {
    GITHUB_TOKEN: "existing-cloudflare-token",
    GITHUB_DATA_REPO: "keywayk09/tv-papertrader",
    GITHUB_DATA_BRANCH: "main",
  } as unknown as Env;

  const result = await updateGitHubJson(env, {
    path: "data/tests/token-fallback.json",
    defaultValue: { value: 0 },
    message: "test token fallback",
    merge: () => ({ value: 1 }),
  });

  assert.equal(result.ok, true);
  const put = calls.find((call) => call.method === "PUT");
  assert.equal(put?.authorization, "Bearer existing-cloudflare-token");
  console.log("github-data-store canonical location + token fallback: ok");
} finally {
  globalThis.fetch = originalFetch;
}
