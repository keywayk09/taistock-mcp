# Family Smart Query Hotfix V1

## Goal

Fix the production `/api/family/query` route so a user entering an individual stock such as `2317` receives individual-stock analysis instead of accidentally invoking the full-market selector.

## Routing contract

- `2317` -> Family Query / stock analysis
- `鴻海怎麼看` -> Family Query / stock analysis
- `2317 跟 2382 哪個好` -> Family Query / stock comparison
- `3189 最近外資投信怎樣` -> Family Query / focused stock question
- `投信連買是什麼` -> Family Query / knowledge question
- `找5檔低位階開始轉強` -> full-market selector
- `有沒有投信連買又沒漲很多的股票` -> full-market selector
- `波段選股 Top 5` -> full-market selector

## Safety

The existing `src/production-entry.ts` is not modified. A thin `src/family-smart-production-entry.ts` wrapper intercepts only non-selection `POST /api/family/query` requests and delegates everything else to the existing production entry.

This preserves:

- existing selector cache/fallback logic;
- `MOM_GPT_API_KEY` authentication contract;
- `/family-mcp` OAuth family lane;
- `MyMCP` and `FamilyMCP` Durable Objects;
- `OAUTH_KV`;
- production D1;
- existing cron schedule;
- no R2.

If individual-stock/general query data fails, the wrapper returns an explicit data error and never falls back to unrelated full-market stock-selection results.

## Presentation

The backend keeps the complete stock-analysis payload. For broad single-stock questions, it adds a presentation contract requesting 11 numbered sections, with backend section 12 folded into the unnumbered final operation conclusion / invalidation / KPI block.
