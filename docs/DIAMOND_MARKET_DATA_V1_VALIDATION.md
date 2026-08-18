# Diamond Market Data V1 validation notes

Official-source contract used by the implementation branch:

- TPEx income-statement variants: `mopsfin_t187ap06_O_{basi,bd,ci,fh,ins,mim}`.
- TPEx balance-sheet variants: `mopsfin_t187ap07_O_{basi,bd,ci,fh,ins,mim}`.
- The separate `mopsfin_t187ap06_O_*A` endpoints are additional financial-information feeds and are not substituted for the balance-sheet endpoints.

Live TPEx institutional/margin field and trade-date validation is recorded in `DIAMOND_MARKET_DATA_V1_LIVE_PROBE_20260818.md`.

The implementation remains shadow-only until the latest PR head passes full CI and a manual Cloudflare shadow run validates D1/R2 writes and official-source behavior.
