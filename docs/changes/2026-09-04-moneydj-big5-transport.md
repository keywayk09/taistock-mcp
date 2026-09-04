# 2026-09-04 MoneyDJ Big5 transport hardening

## Symptom

After the historical Owner `get_broker_chips` name was correctly bridged away from FinMind to the MoneyDJ ranked-only adapter, live calls still failed in two ways:

- `last_updated_date_not_found`
- transient `HTTP 520`

The official TWSE/TPEx exact-date chip layers were unaffected.

## Diagnostic evidence

A read-only one-shot GitHub runner probe fetched the exact production adapter URL three times and observed:

- HTTP 200 on all three attempts
- `Content-Type: text/html;Charset=big5`
- 22,134 response bytes
- Big5/CP950 decoding found `最後更新日`, `券商分點`, source date `2026/09/04`, and 27 table rows
- UTF-8 decoding found none of the Chinese markers

The same result held for the public stock-named representation. No raw market page was persisted by the production application.

## Root cause

The adapter used `response.text()`. MoneyDJ serves this legacy page as Big5, while the runtime string decode path did not preserve the declared legacy charset. The parser therefore received mojibake and could not identify the last-updated marker. Separately, the MoneyDJ transport can return transient 5xx/520 responses.

## Fix

`tw-broker-ranked-on-demand/v1.1.0` now:

- reads response bytes with `arrayBuffer()`
- decodes according to the declared response charset (`big5` for the observed MoneyDJ page)
- exposes `source_charset` and `transport_attempts` on decoded responses
- retries only transient HTTP 502/503/504/520 once
- uses `cache: no-store` for the origin read while preserving the existing short-lived per-isolate application cache

## Safety boundaries retained

- MoneyDJ remains `PUBLIC_SECONDARY / RANKED_ONLY`
- missing branches are never interpreted as zero activity
- requested date must exactly equal the parsed source date
- no previous-day substitution
- no alternate-period URL is used as a fallback
- no current chip persistence
- no CAPTCHA / anti-bot bypass
- `/my-mcp`, `/mcp`, `/family-mcp`, Family permissions, and the OHLC canonical pipeline are unchanged
