import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { once } from "node:events";
import { RESEARCH_VNEXT_RETIREMENT_POLICY } from "../src/v6/research-vnext/retirement-readiness.ts";
import { resolveAmbiguousBacktestWith1m } from "../src/v6/selective-1m-replay.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

assert.equal(
  RESEARCH_VNEXT_RETIREMENT_POLICY.legacy_retirement,
  "BLOCKED_UNTIL_PRODUCTION_SWITCH_STABLE",
  "Production validation preflight must not silently authorize Legacy retirement",
);
assert.equal(RESEARCH_VNEXT_RETIREMENT_POLICY.production_switch_validation, "REQUIRED_BEFORE_LEGACY_RETIREMENT");

const fixture = JSON.parse(read("tests/fixtures/research-vnext-public-abi-snapshot.json"));
assert.equal(fixture.owner_tool_count, 123);
assert.equal(
  fixture.owner_abi_sha256,
  "00cdcc742cf147263e138561a59003ed9c2e67b6c3ae115a38764dea58c2735d",
);

// Freeze why canonical deploy cannot be reused as an isolated read-only probe.
const deploy = read(".github/workflows/deploy-cloudflare-production.yml");
assert.match(deploy, /wrangler deploy --config wrangler\.production\.jsonc/, "canonical workflow performs a real deploy");
assert.match(deploy, /storage\/kv\/namespaces/, "canonical workflow manages OAuth KV");
assert.match(deploy, /-X POST[^\n]*\"\$endpoint\"|curl[^\n]*-X POST/, "canonical workflow may create OAuth KV");
assert.match(deploy, /workers\/scripts\/taistock-mcp\/schedules/, "canonical workflow manages Cron schedules");
assert.match(deploy, /-X PUT[^\n]*\"\$endpoint\"|curl[^\n]*-X PUT/, "canonical workflow PUTs Cron schedules");

const mergeTrigger = read(".github/workflows/deploy-cloudflare-merge-trigger.yml");
assert.match(mergeTrigger, /pull_request:/);
assert.match(mergeTrigger, /merged\s*==\s*true/);
assert.match(mergeTrigger, /deploy-cloudflare-production\.yml/);
assert.match(mergeTrigger, /--ref main/);

console.log("PRODUCTION_VALIDATION_PREFLIGHT_RED_READY=PASS");
console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_PRODUCTION_VALIDATION_PREFLIGHT_RED_V1",
  status: "PASS",
  owner_tool_count: fixture.owner_tool_count,
  owner_abi_sha256: fixture.owner_abi_sha256,
  canonical_deploy_is_read_only_probe: false,
  legacy_retirement: RESEARCH_VNEXT_RETIREMENT_POLICY.legacy_retirement,
  production_mutation: "NONE",
}, null, 2));

// TEST BEFORE BUILD: do not create the probe until all prechecks above have
// passed once in CI. The first formal RED must be this missing-module import.
const probe = await import("../scripts/research-vnext-production-probe.mjs");

assert.equal(probe.RESEARCH_VNEXT_PRODUCTION_PROBE_VERSION, "research-vnext-production-probe/v1.0.0");
assert.equal(typeof probe.probeMcpEndpoint, "function");
assert.equal(typeof probe.buildSyntheticReplayArguments, "function");

const migratedTools = [
  "resolve_ambiguous_backtest_with_1m",
  "finalize_daily_review_run",
  "prepare_swing_selection_run",
];

async function startMock(
  handler: (req: http.IncomingMessage, body: any) => Promise<{ status?: number; headers?: Record<string, string>; body?: string }> | { status?: number; headers?: Record<string, string>; body?: string },
) {
  const requests: Array<{ headers: http.IncomingHttpHeaders; body: any }> = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString("utf8");
    const body = text ? JSON.parse(text) : null;
    requests.push({ headers: req.headers, body });
    const reply = await handler(req, body);
    res.writeHead(reply.status ?? 200, reply.headers ?? { "content-type": "application/json" });
    res.end(reply.body ?? "");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    endpoint: `http://127.0.0.1:${address.port}/my-mcp`,
    requests,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

// The synthetic Replay payload shipped with the probe must be accepted by the
// actual deterministic Legacy/VNext parity engine before it is ever used live.
const syntheticReplay = await probe.buildSyntheticReplayArguments();
const localReplay = await resolveAmbiguousBacktestWith1m(syntheticReplay);
assert.equal(localReplay.ok, true);
assert.equal(localReplay.resolved_exit_reason, "TARGET");
assert.equal(localReplay.still_ambiguous_at_1m, false);

// Modern stateless lane: JSON tools/list + safe calls.
const modern = await startMock(async (_req, body) => {
  if (body?.method === "tools/list") {
    return {
      body: JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: migratedTools.map((name) => ({ name })) } }),
    };
  }
  if (body?.method === "tools/call") {
    return {
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: JSON.stringify({ ok: true, tool: body.params?.name }) }] },
      }),
    };
  }
  return { status: 400, body: JSON.stringify({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32601, message: "unsupported" } }) };
});
try {
  const token = "super-secret-probe-token";
  const receipt = await probe.probeMcpEndpoint({
    endpoint: modern.endpoint,
    bearerToken: token,
    expectedTools: migratedTools,
    callReview: true,
    callReplay: true,
    swingTradeDate: "2026-08-31",
  });
  assert.equal(receipt.status, "PASS");
  assert.equal(receipt.protocol_lane, "MODERN_2026");
  assert.deepEqual(receipt.missing_tools, []);
  assert.equal(receipt.calls.resolve_ambiguous_backtest_with_1m.status, "PASS");
  assert.equal(receipt.calls.finalize_daily_review_run.status, "PASS");
  assert.equal(receipt.calls.prepare_swing_selection_run.status, "PASS");
  assert.equal(JSON.stringify(receipt).includes(token), false, "probe receipt must never leak bearer token");
  assert.ok(modern.requests.length >= 4);
  for (const request of modern.requests) {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
  }
  assert.equal(modern.requests[0].headers["mcp-protocol-version"], "2026-07-28");
  assert.equal(modern.requests[0].headers["mcp-method"], "tools/list");
} finally {
  await modern.close();
}

// Legacy McpAgent lane: modern attempt rejected, then initialize/session fallback.
let legacySessionChecks = 0;
const legacy = await startMock(async (_req, body) => {
  const latest = legacy.requests.at(-1)!;
  if (body?.method === "tools/list" && !latest.headers["mcp-session-id"]) {
    return { status: 400, body: JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32600, message: "legacy session required" } }) };
  }
  if (body?.method === "initialize") {
    return {
      headers: { "content-type": "application/json", "mcp-session-id": "legacy-session-1" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mock-legacy", version: "1" } },
      }),
    };
  }
  if (body?.method === "notifications/initialized") {
    assert.equal(latest.headers["mcp-session-id"], "legacy-session-1");
    legacySessionChecks += 1;
    return { status: 202, body: "" };
  }
  if (body?.method === "tools/list") {
    assert.equal(latest.headers["mcp-session-id"], "legacy-session-1");
    legacySessionChecks += 1;
    return {
      headers: { "content-type": "text/event-stream" },
      body: `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: migratedTools.map((name) => ({ name })) } })}\n\n`,
    };
  }
  if (body?.method === "tools/call") {
    assert.equal(latest.headers["mcp-session-id"], "legacy-session-1");
    legacySessionChecks += 1;
    return {
      body: JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] } }),
    };
  }
  return { status: 400, body: JSON.stringify({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32601, message: "unknown" } }) };
});
try {
  const receipt = await probe.probeMcpEndpoint({
    endpoint: legacy.endpoint,
    expectedTools: migratedTools,
    callReview: true,
    callReplay: true,
    swingTradeDate: "2026-08-31",
  });
  assert.equal(receipt.status, "PASS");
  assert.equal(receipt.protocol_lane, "LEGACY_2025_SESSION");
  assert.deepEqual(receipt.missing_tools, []);
  assert.ok(legacySessionChecks >= 5, "legacy session id must propagate to initialized/list/calls");
} finally {
  await legacy.close();
}

// JSON-RPC / HTTP failures must fail closed rather than create a false PASS.
const failing = await startMock(async (_req, body) => ({
  status: 503,
  body: JSON.stringify({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32000, message: "unavailable" } }),
}));
try {
  await assert.rejects(
    () => probe.probeMcpEndpoint({ endpoint: failing.endpoint, expectedTools: migratedTools }),
    /503|unavailable|protocol/i,
  );
} finally {
  await failing.close();
}

const scriptSource = read("scripts/research-vnext-production-probe.mjs");
assert.doesNotMatch(scriptSource, /api\.cloudflare\.com/i);
assert.doesNotMatch(scriptSource, /wrangler\s+deploy/i);
assert.doesNotMatch(scriptSource, /child_process|exec\(|spawn\(/i);
assert.doesNotMatch(scriptSource, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID/);

const workflow = read(".github/workflows/research-vnext-production-validation.yml");
assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /^\s*(push|pull_request|schedule):/m, "Production probe workflow must be manual-only");
assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
assert.match(workflow, /RESEARCH_VNEXT_PROBE_TOKEN/);
assert.match(workflow, /READ_ONLY_PRODUCTION_PROBE/);
assert.match(workflow, /research-vnext-production-probe\.mjs/);
assert.match(workflow, /actions\/upload-artifact/);
assert.doesNotMatch(workflow, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID/);
assert.doesNotMatch(workflow, /wrangler\s+deploy/);
assert.doesNotMatch(workflow, /api\.cloudflare\.com/i);
assert.doesNotMatch(workflow, /-X\s+(POST|PUT|PATCH|DELETE)/i);

console.log(JSON.stringify({
  schema: "RESEARCH_VNEXT_PRODUCTION_VALIDATION_PREFLIGHT_TEST_V1",
  status: "PASS",
  modern_protocol_mock: "PASS",
  legacy_protocol_mock: "PASS",
  synthetic_replay_fixture: "PASS",
  workflow_mode: "MANUAL_READ_ONLY",
  production_contacted: false,
  production_mutation: "NONE",
}, null, 2));
