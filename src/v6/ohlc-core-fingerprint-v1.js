// Shared OHLC_CORE_FINGERPRINT_V1 algorithm from tv-papertrader/cloudflare/ohlc-tv-fugle-1d/src/research-verification-receipt-v1.js.
/* Formal research verification receipt contract.
 *
 * Official TWSE/TPEx OHLC is checked once by the post-close receipt builder.
 * Runtime research never contacts an official endpoint. Instead it recomputes a
 * canonical OHLC-core fingerprint and accepts only a matching immutable VERIFIED
 * receipt. Indicator columns and other derived metadata are intentionally omitted
 * from the fingerprint so indicator recalculation cannot invalidate market-data
 * provenance.
 */

export const RESEARCH_VERIFICATION_MANIFEST_SCHEMA = 'OHLC_RESEARCH_VERIFICATION_MANIFEST_V1';
export const RESEARCH_VERIFICATION_RECEIPT_SCHEMA = 'OHLC_RESEARCH_VERIFICATION_RECEIPT_V1';
export const RESEARCH_VERIFICATION_FINGERPRINT_SCHEMA = 'OHLC_CORE_FINGERPRINT_V1';
export const RESEARCH_VERIFICATION_VERSION = 'research-verification-receipt/v1.0.0';

export function researchVerificationManifestPath(tradeDate) {
  const value = String(tradeDate || '');
  const m = value.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`research_verification_bad_trade_date:${value}`);
  return `data/OHLC/tw/verification/v1/${m[1]}/${m[2]}/${m[3]}/manifest.json`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

export function researchVerificationCanonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function finitePrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (!text) return NaN;
  const valueNumber = Number(text);
  return Number.isFinite(valueNumber) ? valueNumber : NaN;
}

function normalizedPrice(value) {
  const n = finitePrice(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(8));
}

function rowDate(row) {
  return String(row?.trade_date || row?.date || row?.bar_time_tw || '').slice(0, 10);
}

function rowTs(row) {
  const direct = Number(row?.ts_ms || 0);
  if (Number.isFinite(direct) && direct > 0) return Math.trunc(direct);
  const raw = String(row?.bar_time_tw || '').trim();
  if (!raw) return 0;
  const parsed = Date.parse(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}+08:00`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function validCore(open, high, low, close) {
  return [open, high, low, close].every(Number.isFinite)
    && high >= Math.max(open, close)
    && low <= Math.min(open, close)
    && high >= low;
}

function normalizeRows(timeframe, rows, symbol, tradeDate) {
  const tf = String(timeframe || '').toLowerCase();
  const stock = String(symbol || '').trim();
  const date = String(tradeDate || '');
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (rowDate(row) !== date) continue;
    const rowSymbol = String(row?.symbol || stock).trim();
    if (rowSymbol && rowSymbol !== stock) continue;
    const open = finitePrice(row?.open);
    const high = finitePrice(row?.high);
    const low = finitePrice(row?.low);
    const close = finitePrice(row?.close);
    if (!validCore(open, high, low, close)) continue;
    if (tf === '1d') {
      out.push({ key:date, open:normalizedPrice(open), high:normalizedPrice(high), low:normalizedPrice(low), close:normalizedPrice(close) });
      continue;
    }
    const ts = rowTs(row);
    if (!ts) continue;
    out.push({ key:ts, open:normalizedPrice(open), high:normalizedPrice(high), low:normalizedPrice(low), close:normalizedPrice(close) });
  }
  out.sort((a, b) => tf === '1d' ? String(a.key).localeCompare(String(b.key)) : Number(a.key) - Number(b.key));
  return out;
}

function priceEqual(a, b) {
  const x = Number(a), y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-8;
}

function aggregate(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  return {
    open:rows[0].open,
    high:Math.max(...rows.map(row => Number(row.high))),
    low:Math.min(...rows.map(row => Number(row.low))),
    close:rows.at(-1).close
  };
}

function aggregateFiveFromMinute(rows) {
  const buckets = new Map();
  for (const row of rows || []) {
    const ts = Number(row.key || 0);
    if (!ts) continue;
    const local = new Date(ts + 8 * 60 * 60 * 1000);
    const hour = local.getUTCHours();
    const minute = local.getUTCMinutes();
    // Taiwan's final 13:30 bar is its own terminal bucket.
    const bucketTs = hour === 13 && minute === 30 ? ts : ts - (minute % 5) * 60000;
    let bucket = buckets.get(bucketTs);
    if (!bucket) {
      bucket = { key:bucketTs, open:row.open, high:row.high, low:row.low, close:row.close };
      buckets.set(bucketTs, bucket);
    } else {
      bucket.high = Math.max(Number(bucket.high), Number(row.high));
      bucket.low = Math.min(Number(bucket.low), Number(row.low));
      bucket.close = row.close;
    }
  }
  return [...buckets.values()].sort((a, b) => Number(a.key) - Number(b.key));
}

function sameBar(a, b) {
  return !!a && !!b
    && String(a.key) === String(b.key)
    && ['open','high','low','close'].every(key => priceEqual(a[key], b[key]));
}

export function auditResearchCanonicalOhlc({ symbol, tradeDate, dailyRows, fiveRows, minuteRows }) {
  const daily = normalizeRows('1d', dailyRows, symbol, tradeDate);
  const five = normalizeRows('5m', fiveRows, symbol, tradeDate);
  const minute = normalizeRows('1m', minuteRows, symbol, tradeDate);
  if (daily.length !== 1) return { ok:false, reason:`canonical_daily_count:${daily.length}` };
  if (!five.length) return { ok:false, reason:'canonical_5m_empty' };
  if (!minute.length) return { ok:false, reason:'canonical_1m_empty' };

  const derivedFive = aggregateFiveFromMinute(minute);
  if (derivedFive.length !== five.length) {
    return { ok:false, reason:'canonical_1m_5m_bucket_count_mismatch', expected:derivedFive.length, actual:five.length };
  }
  for (let i = 0; i < five.length; i++) {
    if (!sameBar(derivedFive[i], five[i])) {
      return { ok:false, reason:'canonical_1m_5m_ohlc_mismatch', bucket:String(five[i]?.key || derivedFive[i]?.key || '') };
    }
  }

  const dailyBar = daily[0];
  const fromFive = aggregate(five);
  const fromMinute = aggregate(minute);
  for (const [name, candidate] of [['5m', fromFive], ['1m', fromMinute]]) {
    if (!candidate || !['open','high','low','close'].every(key => priceEqual(dailyBar[key], candidate[key]))) {
      return { ok:false, reason:`canonical_${name}_daily_ohlc_mismatch` };
    }
  }
  return { ok:true, daily:dailyBar, normalized:{ '1d':daily, '5m':five, '1m':minute } };
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function buildResearchVerificationFingerprint({ symbol, tradeDate, dailyRows, fiveRows, minuteRows }) {
  const audit = auditResearchCanonicalOhlc({ symbol, tradeDate, dailyRows, fiveRows, minuteRows });
  if (!audit.ok) return { ok:false, reason:audit.reason, audit };
  const payload = {
    schema:RESEARCH_VERIFICATION_FINGERPRINT_SCHEMA,
    symbol:String(symbol),
    trade_date:String(tradeDate),
    timeframes:audit.normalized
  };
  return {
    ok:true,
    fingerprint:await sha256Hex(researchVerificationCanonicalJson(payload)),
    fingerprint_schema:RESEARCH_VERIFICATION_FINGERPRINT_SCHEMA,
    daily:audit.daily,
    row_counts:{ '1d':audit.normalized['1d'].length, '5m':audit.normalized['5m'].length, '1m':audit.normalized['1m'].length }
  };
}

