# Family Read API V1

## Goal

Provide one shared read-only Taiwan-stock backend for the owner's GPT, the mother's GPT and the sister's GPT without duplicating market data or granting family clients write/admin credentials.

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

## Identity and secrets

Accepted bearer identities are deliberately separate:

- owner: `MCP_API_KEY`
- mother: `MOM_GPT_API_KEY`
- sister: `SISTER_GPT_API_KEY`

The family clients never receive `GITHUB_TOKEN`. The Worker alone uses `GITHUB_TOKEN` to read canonical GitHub data.

`SISTER_GPT_API_KEY` is optional at code level so the existing production deployment is not blocked before the secret is provisioned. Until it is configured in the `taistock-mcp` Worker, sister access returns `401` and no fallback identity is granted.

## Read-only boundary

Family Read API V1 cannot:

- trigger `/market-data/run` ingestion;
- write GitHub market data;
- write or approve research records;
- promote a strategy;
- place orders;
- modify OHLC data.

The existing owner/admin endpoints remain separate. The existing legacy `/api/family/query` route is left intact to avoid breaking the mother's current GPT while `/api/family/read` is introduced and validated.

## Data-degradation behavior

The main family query does not fail merely because canonical Market Data V1 is unavailable.

- If `GITHUB_TOKEN` is missing, `canonical_market_data.status = PENDING_GITHUB_TOKEN`.
- If the requested daily snapshot has not been frozen yet, status is `NOT_READY`.
- If GitHub read fails, status is `DEGRADED` with the error.

No prior-day institutional or margin data is silently substituted as same-day canonical data.

## Rollout

1. CI: TypeScript type-check, Market Data tests, existing family selector contract, Family Read V1 contract, Wrangler dry-run.
2. Keep PR Draft.
3. Provision a distinct `SISTER_GPT_API_KEY` in the `taistock-mcp` Worker.
4. Shadow-test `/api/family/read` with owner key, mother key and sister key.
5. Verify the family clients cannot access `/market-data/run` or owner/admin MCP tools.
6. Update the mother's and sister's custom GPT Action schema from `/family-openapi.json` only after shadow validation.
