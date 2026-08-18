# Family Read API V1

## Goal

Provide one shared read-only Taiwan-stock backend for the `台股引擎` Custom GPT without duplicating market data or exposing owner/admin credentials. The mother's ChatGPT access remains on the separate Family MCP/OAuth lane.

## Endpoint

`POST /api/family/read`

Public schema: `GET /family-openapi.json`

The endpoint accepts the user's original natural-language question and automatically routes it to:

- the existing family stock-selection engine for broad selection requests; or
- the existing general Family Read query engine for symbol analysis, comparison, fundamentals, financials, chips, themes and supply-chain questions.

When available, the response is enriched from the frozen GitHub canonical Market Data V1 daily snapshot:

- `manifest.json`
- `institutional.json`
- `margin.json`
- `events.json`

Canonical path:

`keywayk09/tv-papertrader/data/market/tw/daily/YYYY/MM/DD/...`

## Shared GPT authentication

The external production contract is one Worker secret:

- `TAISTOCK_GPT_READ_KEY`

This key identifies the shared `台股引擎` GPT Action as an approved read-only client. It does **not** identify an individual human user. Anyone the owner shares the GPT with uses the same GPT Action invisibly; users do not type or receive the key.

The Custom GPT read lane does not accept the mother's OAuth credentials or owner/admin credentials as substitutes.

The family clients never receive `GITHUB_TOKEN`. The Worker alone uses `GITHUB_TOKEN` to read canonical GitHub data.

During V1 rollout the underlying Family Read module retains the old `SISTER_GPT_API_KEY` field name as an internal compatibility alias only. The production wrapper maps `TAISTOCK_GPT_READ_KEY` into that legacy field. A separate `SISTER_GPT_API_KEY` Cloudflare secret is not required.

## Mother access remains MCP

The mother's access is unchanged:

- endpoint: `/family-mcp`
- authentication: OAuth `family` role
- scope: `taistock.read`
- Durable Object: `FAMILY_MCP_OBJECT` / `FamilyMCP`

Mother does not use `TAISTOCK_GPT_READ_KEY` directly.

## Read-only boundary

Family Read API V1 cannot:

- trigger `/market-data/run` ingestion;
- write GitHub market data;
- write or approve research records;
- promote a strategy;
- place orders;
- modify OHLC data.

The existing owner/admin endpoints remain separate. The existing legacy `/api/family/query` route is left intact during rollout to avoid breaking older clients.

## Data-degradation behavior

The main read query does not fail merely because canonical Market Data V1 is unavailable.

- If `GITHUB_TOKEN` is missing, `canonical_market_data.status = PENDING_GITHUB_TOKEN`.
- If the requested daily snapshot has not been frozen yet, status is `NOT_READY`.
- If GitHub read fails, status is `DEGRADED` with the error.

No prior-day institutional or margin data is silently substituted as same-day canonical data.

## Rollout

1. CI: TypeScript type-check, Market Data tests, existing family selector contract, shared GPT Read contract, Wrangler dry-run.
2. Keep PR Draft.
3. Provision `TAISTOCK_GPT_READ_KEY` in the `taistock-mcp` Worker.
4. Cloudflare version-upload and live-test the read endpoint with the shared key.
5. Verify the shared GPT cannot access `/market-data/run`, owner/admin MCP tools, research writes, strategy changes, OHLC writes or order placement.
6. Keep the mother's `/family-mcp` OAuth regression green.
7. Update the existing `台股引擎` Custom GPT Action only after live read-only validation.
