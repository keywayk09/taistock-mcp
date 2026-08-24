import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const stable = readFileSync("src/v6/stable-market-tools.ts", "utf8");
const entry = readFileSync("src/index-v6.ts", "utf8");

assert.match(stable, /tw-full-market-source-contract\/v1\.0\.0/);
assert.match(stable, /exchangeReport\/STOCK_DAY_ALL/);
assert.match(stable, /mopsfin\.twse\.com\.tw\/opendata\/t187ap03_O\.csv/);
assert.match(stable, /mis\.twse\.com\.tw\/stock\/api\/getStockInfo\.jsp/);
assert.match(stable, /MOPSFIN_COMPANY_MASTER_MIS_OTC/);

// Permanent regression guard: these historically blocked Cloudflare egress or
// required a broken token. They may remain elsewhere for optional/individual
// tools, but they must never return to the frozen market-wide module.
assert.doesNotMatch(stable, /fugle\(env,\s*["'`]\/snapshot\/(?:quotes|movers|actives)/);
assert.doesNotMatch(stable, /finmind\(env,/);
assert.doesNotMatch(stable, /www\.tpex\.org\.tw\/openapi\/v1\/tpex_mainboard_quotes/);

for (const name of ["get_market_rankings", "get_market_regime", "get_macro_risk_dashboard", "get_data_health"]) {
  assert.ok(entry.includes(`"${name}"`), `${name} must be explicitly suppressed from legacy registration`);
}
assert.match(entry, /registerStableMarketTools\(this\.server, this\.env\)/);
assert.match(entry, /full_market_scan_policy: "FROZEN_TWSE_OPENAPI_PLUS_MOPSFIN_TWSE_MIS; NO_FUGLE_RANKING; NO_FINMIND_REQUIRED; NO_DIRECT_TPEX_QUOTES"/);

console.log("stable market source contract locked");
