# Family Access Model V1

## Locked access lanes

The family-facing Taiwan Stock AI uses one shared backend/data plane but two different client lanes.

### Sister — 台股引擎 Custom GPT

- Client: shared Custom GPT `台股引擎`
- Integration: GPT Action / OpenAPI
- Schema: `GET /family-openapi.json`
- Read endpoint: `POST /api/family/read`
- Authentication: dedicated Worker secret `SISTER_GPT_API_KEY` as Bearer API key
- Scope: read-only stock analysis, comparison, fundamentals, institutional flow, margin/short, events, industry/supply-chain context, and family swing selection
- Canonical enrichment: frozen GitHub Market Data under `keywayk09/tv-papertrader/data/market/tw/...` when available
- Forbidden: Market Data ingestion, GitHub writes, OHLC writes, research writes, strategy promotion, order placement, admin functions

The Action lane fails closed when `SISTER_GPT_API_KEY` is not configured. It does not accept `MOM_GPT_API_KEY` at the production wrapper.

### Mother — Family MCP

- Client: ChatGPT MCP
- Endpoint: `/family-mcp`
- Authentication: OAuth family role
- OAuth login secret: existing mother/family OAuth secret contract
- Granted scope: `taistock.read` only
- Durable Object: `FAMILY_MCP_OBJECT` / `FamilyMCP`
- Scope: read-only Taiwan Stock AI MCP tools
- Forbidden: owner/admin scope and write/admin operations

Mother does not need the Custom GPT Action key and is not migrated to the sister Action lane.

## Shared backend rule

Both lanes may consume the same central Diamond/Market Data facts. Data is collected once and reused; client credentials are not shared.

```text
TWSE / TPEx / MOPS / OHLC
          |
          v
   Diamond data plane
          |
     GitHub canonical
          |
    +-----+----------------+
    |                      |
Sister Custom GPT       Mother MCP
SISTER_GPT_API_KEY      OAuth family role
Action / read-only      taistock.read
```

## Secret boundary

`GITHUB_TOKEN` remains Worker-side only. It is never configured in either family client. `SISTER_GPT_API_KEY`, mother OAuth credentials, owner credentials, and GitHub credentials are separate security domains.

## Rollout rule

Keep the current mother MCP path intact. Update the shared `台股引擎` GPT Action only after the backend branch has passed TypeScript, regression tests, Wrangler dry-run, Cloudflare version upload, and live read-only validation.
