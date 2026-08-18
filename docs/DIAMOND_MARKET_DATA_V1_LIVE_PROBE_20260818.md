# Diamond Market Data V1 — TPEx live probe (2026-08-18)

Probe source: official TPEx OpenAPI, executed from the implementation branch before any production deployment.

## Institutional

Endpoint: `tpex_3insti_daily_trading`

- rows returned: 916
- served `Date`: `1150818` = 2026-08-18
- code field: `SecuritiesCompanyCode`
- foreign net field: `Foreign Investors include Mainland Area Investors (Foreign Dealers excluded)-Difference`
- investment-trust net field: `SecuritiesInvestmentTrustCompanies-Difference`
- dealer net field: `Dealers-Difference`

Result: current-day institutional data was available during the probe.

## Margin / short

Endpoint: `tpex_mainboard_margin_balance`

- rows returned: 918
- served `Date`: `1150817` = 2026-08-17
- at the time of the probe, the endpoint had **not yet rolled to 2026-08-18**
- margin fields observed:
  - `MarginPurchaseBalancePreviousDay`
  - `MarginPurchase`
  - `MarginSales`
  - `CashRedemption`
  - `MarginPurchaseBalance`
- short fields observed:
  - `ShortSaleBalancePreviousDay`
  - `ShortSale`
  - `ShortConvering` (official spelling)
  - `StockRedemption`
  - `ShortSaleBalance`

Result: the staged `PENDING` design is required. A latest-snapshot endpoint must not be assigned to the requested trade date without validating the official row `Date`.

## Parser hardening applied after probe

- TPEx ROC compact date (`1150818`) is converted to ISO (`2026-08-18`).
- TPEx institutional and margin collectors reject a served date different from the requested trade date.
- Core institutional/margin fields are parsed by the observed official names.
- Missing core fields fail open by dropping the row / leaving the dataset pending; they are not silently converted to genuine zero activity.
- Market Data V1 no longer depends on R2. Canonical normalized/archive output is written to GitHub with source SHA metadata after deployment.

This document records source-shape validation only. The branch remains shadow-only until the full PR CI is green and a manual Cloudflare→GitHub shadow run is validated.
