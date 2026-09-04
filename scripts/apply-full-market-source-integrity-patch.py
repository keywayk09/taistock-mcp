from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"replace_count_mismatch:{path}:{count}:expected=1")
    target.write_text(text.replace(old, new, 1))


stable = "src/v6/stable-market-tools.ts"
replace_once(
    stable,
    'const MIN_COVERAGE = { TWSE: 400, TPEx: 250 } as const;\nconst CACHE_TTL_MS = 15_000;',
    'const MIN_COVERAGE = { TWSE: 400, TPEx: 250 } as const;\n'
    '// A low absolute floor protects against total source loss, while the dynamic\n'
    '// TPEx completeness ratio prevents a fulfilled-but-truncated MIS response from\n'
    '// being mistaken for a complete market. Clean Production probes currently\n'
    '// normalize 887 of 890 ordinary-stock symbols (>99.6%).\n'
    'const MIN_TPEX_COMPLETENESS_RATIO = 0.98;\n'
    'const CACHE_TTL_MS = 15_000;',
)
replace_once(
    stable,
    '    const rows = [...deduped.values()];\n'
    '    if (rows.length < MIN_COVERAGE.TPEx) errors.push(`MOPSFIN+MIS normalized TPEx coverage only ${rows.length}/${universe.length}`);\n'
    '    return {',
    '    const rows = [...deduped.values()];\n'
    '    const completenessRatio = universe.length ? rows.length / universe.length : 0;\n'
    '    if (rows.length < MIN_COVERAGE.TPEx) errors.push(`MOPSFIN+MIS normalized TPEx coverage only ${rows.length}/${universe.length}`);\n'
    '    if (completenessRatio < MIN_TPEX_COMPLETENESS_RATIO) {\n'
    '      errors.push(`MOPSFIN+MIS TPEx completeness ${(completenessRatio * 100).toFixed(2)}% (${rows.length}/${universe.length}) below ${(MIN_TPEX_COMPLETENESS_RATIO * 100).toFixed(0)}%`);\n'
    '    }\n'
    '    return {',
)
replace_once(
    stable,
    '    usable: twse.normalized_count >= MIN_COVERAGE.TWSE && tpex.normalized_count >= MIN_COVERAGE.TPEx,',
    '    usable: twse.normalized_count >= MIN_COVERAGE.TWSE\n'
    '      && tpex.normalized_count >= MIN_COVERAGE.TPEx\n'
    '      && twse.errors.length === 0\n'
    '      && tpex.errors.length === 0,',
)
replace_once(
    stable,
    '      status: stable.TWSE.normalized_count >= MIN_COVERAGE.TWSE ? "ok" : "error",',
    '      status: stable.TWSE.normalized_count >= MIN_COVERAGE.TWSE && stable.TWSE.errors.length === 0 ? "ok" : "error",',
)
replace_once(
    stable,
    '      status: stable.TPEx.normalized_count >= MIN_COVERAGE.TPEx ? "ok" : "error",',
    '      status: stable.TPEx.normalized_count >= MIN_COVERAGE.TPEx && stable.TPEx.errors.length === 0 ? "ok" : "error",',
)
replace_once(
    stable,
    '    const breadth = universe ? aggregateMarket(universe.rows) : null;',
    '    const breadth = universe?.usable ? aggregateMarket(universe.rows) : null;',
)

source_test = "tests/stable-market-source-contract.test.ts"
replace_once(
    source_test,
    'assert.match(stable, /Math\\.min\\(MIS_MAX_CONCURRENCY, batches\\.length\\)/);',
    'assert.match(stable, /Math\\.min\\(MIS_MAX_CONCURRENCY, batches\\.length\\)/);\n'
    'assert.match(stable, /const MIN_TPEX_COMPLETENESS_RATIO = 0\\.98/);\n'
    'assert.match(stable, /completenessRatio < MIN_TPEX_COMPLETENESS_RATIO/);\n'
    'assert.match(stable, /twse\\.errors\\.length === 0/);\n'
    'assert.match(stable, /tpex\\.errors\\.length === 0/);\n'
    'assert.match(stable, /const breadth = universe\\?\\.usable \\? aggregateMarket\\(universe\\.rows\\) : null/);',
)

note = Path("docs/changes/2026-09-04-full-market-source-integrity.md")
note.parent.mkdir(parents=True, exist_ok=True)
note.write_text(
    """# 2026-09-04 Full-Market Source Integrity Hardening

## Evidence

Read-only Production probe run `33832421857` executed three fresh `/health/full-market` observations, each separated beyond the 15-second success cache TTL.

- Probe 1: TWSE 1086, TPEx 0/890; all 9 MIS batches returned HTTP 502; endpoint correctly returned 503.
- Probe 2: TWSE 1086, TPEx 887/890; no source errors; endpoint returned 200.
- Probe 3: TWSE 1086, TPEx 199/890; 7 of 9 MIS batches returned HTTP 502; endpoint correctly returned 503.

A prior successful Production smoke had returned TPEx 687 while the same code also produced 887 on another run. Because MIS batches contain 100 symbols and the old `usable` rule only required TPEx >=250, two failed 100-symbol batches could still be silently accepted as a healthy market.

## Root cause

TWSE MIS can intermittently return HTTP 502 to Cloudflare-originated batch requests. `loadTpexMopsMis()` already retained each rejected batch in `TPEx.errors`, but `StableMarketUniverse.usable` ignored those errors and used only the low absolute coverage floors (TWSE 400 / TPEx 250).

This created a fail-open integrity gap: a materially partial TPEx universe could be cached and consumed by market-wide tools as usable.

## Change

- Preserve the frozen provider contract: TWSE OpenAPI + MOPSFIN TPEx universe + TWSE MIS OTC quotes.
- Require both TWSE and TPEx required-source error arrays to be empty before a universe is usable.
- Add a dynamic TPEx completeness guard of 98% against the current MOPSFIN ordinary-stock universe. This catches silent/truncated HTTP-200 responses without hard-coding a fixed OTC stock count.
- Keep the existing absolute floors as a secondary total-loss guard.
- Align `get_data_health` with the same source-error semantics.
- Make the macro dashboard fail closed: no market breadth/regime is calculated from an unusable partial universe.

## Why 98%

The clean live probe normalized 887 of 890 TPEx ordinary-stock symbols (99.66%). A 98% threshold tolerates a small number of legitimate non-normalizable symbols while rejecting loss of any full 100-symbol MIS batch by a wide margin. It is relative to the live MOPSFIN universe, so it does not become stale as listed company counts change.

## Retry/cache behavior

No inner retry storm is added. A degraded universe is not cached by the existing loader. The canonical Production smoke already retries the full endpoint up to three times. Once this runtime gate is active, any required-source error makes `/health/full-market` return 503, so the existing smoke path will fail/retry rather than accept partial data.

## Invariants

- No new market-data source or fallback.
- No FinMind or Fugle market-wide dependency.
- No change to OHLC.
- No chip persistence or cron restoration.
- No stale/previous-day substitution.
- Production workflow permissions are unchanged.
- Source contract remains `tw-full-market-source-contract/v1.0.0`.
"""
)

Path(__file__).unlink()
