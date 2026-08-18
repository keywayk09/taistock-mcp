# Family Access Model V1

## Locked access lanes

The Taiwan Stock AI uses one shared backend/data plane but separates the shared Custom GPT lane from the mother's Family MCP lane.

### Shared `台股引擎` Custom GPT

- Client: shared Custom GPT `台股引擎`
- Intended users: anyone the owner chooses to share the GPT link with
- Integration: GPT Action / OpenAPI
- Schema: `GET /family-openapi.json`
- Read endpoint: `POST /api/family/read`
- Authentication: Worker secret `TAISTOCK_GPT_READ_KEY` as the GPT Action Bearer API key
- Meaning of the key: authenticate the shared GPT client, not identify a specific human user
- Scope: read-only stock analysis, comparison, fundamentals, institutional flow, margin/short, events, industry/supply-chain context, and swing selection
- Canonical enrichment: frozen GitHub Market Data under `keywayk09/tv-papertrader/data/market/tw/...` when available
- Forbidden: Market Data ingestion, GitHub writes, OHLC writes, research writes, strategy promotion, order placement, admin functions

The Action lane fails closed when `TAISTOCK_GPT_READ_KEY` is not configured. Human users do not need to know or type this key; the Custom GPT Action carries it server-to-server.

`SISTER_GPT_API_KEY` is no longer an external Cloudflare secret contract. The current Family Read implementation may retain that old field name behind an internal compatibility adapter during V1 rollout, but the production wrapper maps it from `TAISTOCK_GPT_READ_KEY` and does not require a separate sister secret.

### Mother — Family MCP

- Client: ChatGPT MCP
- Endpoint: `/family-mcp`
- Authentication: OAuth family role
- OAuth login secret: existing mother/family OAuth secret contract
- Granted scope: `taistock.read` only
- Durable Object: `FAMILY_MCP_OBJECT` / `FamilyMCP`
- Scope: read-only Taiwan Stock AI MCP tools
- Forbidden: owner/admin scope and write/admin operations

Mother does not need the shared Custom GPT Action key and is not migrated away from Family MCP.

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
Shared 台股引擎 GPT      Mother MCP
TAISTOCK_GPT_READ_KEY    OAuth family role
Action / read-only       taistock.read
```

## Secret boundary

`GITHUB_TOKEN` remains Worker-side only and is never configured in the Custom GPT. `TAISTOCK_GPT_READ_KEY`, mother OAuth credentials, owner/admin credentials, and GitHub credentials are separate security domains.

The GPT read key does not grant `/market-data/run`, owner MCP, research writes, strategy promotion, OHLC writes, or order placement.

## Feedback / learning boundary

The shared GPT may later record privacy-conscious product telemetry or explicit user feedback so the research system can improve, but that is a separate opt-in research feature. Family Access V1 itself does not treat a user's identity as part of the access key and does not grant write access merely because the GPT is shared.

## Rollout rule

Keep the current mother MCP path intact. Update the shared `台股引擎` GPT Action only after the backend branch has passed TypeScript, regression tests, Wrangler dry-run, Cloudflare version upload, and live read-only validation.
