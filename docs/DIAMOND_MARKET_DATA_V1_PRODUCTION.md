# Diamond Market Data V1 — Production-baseline integration

## Baseline

This branch starts from the actual Cloudflare production branch `feature/twchips-official-v7` and preserves its production contract:

- `src/production-entry.ts`
- `MyMCP` Durable Object migration `v1`
- `FamilyMCP` Durable Object migration `v2`
- `MCP_OBJECT` and `FAMILY_MCP_OBJECT`
- `OAUTH_KV`
- production D1 binding `DB`
- existing weekday 15:40 Asia/Taipei family prewarm cron (`40 7 * * 1-5`)

Market Data V1 is added through `src/market-data-production-entry.ts`, which delegates all non-market-data traffic and non-market-data schedules to the existing production entry.

## Storage

Market Data V1 does not require R2, Google Drive, or a new D1 database.

Canonical output is GitHub:

`keywayk09/tv-papertrader/data/market/tw/...`

The Worker uses the existing worker-scoped `GITHUB_TOKEN` secret. The collector keeps an internal compatibility field, mapped by `market-data-runtime.ts`; no `MARKET_DATA_GITHUB_TOKEN` Cloudflare secret is required.

## Scheduled phases

Taipei weekday schedule:

- 17:10 fundamentals/events + symbol master
- 18:10 institutional preliminary
- 20:10 institutional final refresh
- 21:10 margin
- 21:30 margin retry
- 22:10 finalize
- 22:30 final retry/freeze

The existing 15:40 family prewarm schedule remains unchanged and is not run for Market Data crons.

## Shared read clients

The same frozen Market Data may be consumed by two separate read-only access lanes:

- shared `台股引擎` Custom GPT Action, authenticated with `TAISTOCK_GPT_READ_KEY`;
- mother's existing Family MCP, authenticated through OAuth family role with `taistock.read`.

These access credentials are separate from `GITHUB_TOKEN` and from owner/admin credentials. See `docs/FAMILY_ACCESS_MODEL_V1.md`.

## Verification gates

`MARKET_DAY_VERIFIED` requires:

- TWSE + TPEx symbol master READY
- TWSE + TPEx institutional FINAL/READY
- TWSE + TPEx margin FINAL/READY

TPEx same-day datasets use ROC-date fencing. A prior-day response remains `PENDING` and cannot be promoted as the requested trade date.

## Safety boundaries

- no R2 binding
- no write to `data/OHLC/`
- no 1m/5m universe expansion
- GitHub writes use read-before-write and 409/422 CAS retry
- existing Family/OAuth production behavior remains delegated to the original production entry
- shared Custom GPT is read-only and cannot trigger ingestion/admin/write operations

Before merge, require GitHub CI + Wrangler dry-run + Cloudflare version upload + actual GitHub Shadow output validation + shared GPT read validation + mother MCP regression validation.
