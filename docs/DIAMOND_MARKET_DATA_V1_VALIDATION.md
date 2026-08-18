# Diamond Market Data V1 validation notes

Official-source contract used by the implementation branch:

- TPEx income-statement variants: `mopsfin_t187ap06_O_{basi,bd,ci,fh,ins,mim}`.
- TPEx balance-sheet variants: `mopsfin_t187ap07_O_{basi,bd,ci,fh,insA,mimA}`; `ins` and `mim` datasets map to the official `insA` / `mimA` balance endpoints.
- Live TPEx institutional/margin field and trade-date validation is recorded in `DIAMOND_MARKET_DATA_V1_LIVE_PROBE_20260818.md`.

Storage/credential validation contract:

- Market Data V1 canonical archive is GitHub under `keywayk09/tv-papertrader/data/market/tw/`.
- No R2 or Google Drive dependency is required for Market Data V1.
- Public Cloudflare credential name is `GITHUB_TOKEN`, matching the OHLC Worker naming convention.
- Cloudflare secrets are Worker-scoped; `taistock-mcp` needs its own `GITHUB_TOKEN` binding.
- GitHub writes use read-before-write CAS retry for 409/422 conflicts.

The implementation remains shadow-only until the latest PR head passes full CI and a manual Cloudflare→GitHub shadow run validates actual writes, official-source dates, row counts, source SHA/status, manifest state and the `data/OHLC/` no-write boundary.
