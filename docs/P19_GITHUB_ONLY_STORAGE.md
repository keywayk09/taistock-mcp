# P19 GitHub-only canonical storage

P19 makes GitHub the only canonical persistence layer for Diamond application data.

## Canonical branch

- Repository: `keywayk09/taistock-mcp`
- Data branch: `diamond-data`
- Application D1 persistence: forbidden
- R2 persistence: forbidden
- Durable Object lifecycle namespaces remain preserved and are not application data storage.

## Market data archive

GitHub Actions captures official market data at 18:15 and 20:15 Asia/Taipei on weekdays. The archive keeps immutable raw captures, daily content-addressed snapshots, a daily manifest, and symbol/month indexes.

The P19 market-data contract contains eight independent readiness layers:

1. institutional / listed
2. institutional / otc
3. margin / listed
4. margin / otc
5. securities_lending / listed
6. securities_lending / otc
7. sbl_short_sale / listed
8. sbl_short_sale / otc

Official lending sources include TWSE TWT72U (borrow, return/settlement, balance), TWSE TWT93U (listed SBL short sale), and TPEx `tpex_margin_sbl` plus `tpex_short_sell` (OTC SBL short sale). Margin short and securities lending remain separate concepts.

## Other persistent Diamond data

Signal/Event Ledger, Experiment Ledger, GPT Judgment Memory, TXF Signal Ledger, Supply-chain snapshots, watchlists, stock-event outcomes, and portfolios use GitHub canonical records. Immutable collections use content identity plus strict compare-and-swap; HTTP 409/422 requires re-read and re-merge/re-verify rather than blind overwrite.

## Hard boundaries

- Formal OHLC/K-line remains owned by OHLC MCP.
- Market-data degradation never blocks OHLC globally.
- FinMind history may fill institutional/margin history but `TaiwanStockPrice` is not a formal OHLC substitute.
- No force-push is allowed for canonical market-data archive writes.
