import { readGitHubJson, readGitHubText } from "./github-data-store.ts";
import { parseCanonicalCsv } from "./cross-account-read-service.ts";
import {
  buildResearchVerificationFingerprint, researchVerificationManifestPath,
  RESEARCH_VERIFICATION_MANIFEST_SCHEMA, RESEARCH_VERIFICATION_RECEIPT_SCHEMA,
} from "./ohlc-core-fingerprint-v1.js";

type Row = Record<string, any>;
const fields = ["open", "high", "low", "close"];
const digest = /^[a-f0-9]{64}$/;

export async function verifyDailyArchiveReceipt(env: Env, symbol: string, date: string, dailyRows: Row[]) {
  const reject = (reason: string) => ({ verified: false as const, reason });
  if (dailyRows.length !== 1 || String(dailyRows[0].symbol) !== symbol
    || String(dailyRows[0].date ?? dailyRows[0].trade_date) !== date) return reject("DAILY_ROW_IDENTITY_MISMATCH");
  try {
    const path = researchVerificationManifestPath(date);
    const snapshot = await readGitHubJson<Row>(env, path);
    const manifest = snapshot.value;
    if (!snapshot.sha || manifest?.schema !== RESEARCH_VERIFICATION_MANIFEST_SCHEMA
      || manifest.trade_date !== date) return reject("VERIFICATION_MANIFEST_UNAVAILABLE");
    const entry = manifest.symbols?.[symbol];
    if (!entry || entry.active_in_current_universe !== true) return reject("VERIFICATION_MEMBER_UNAVAILABLE");
    if (entry.status !== "VERIFIED") return reject(String(entry.reason ?? entry.status ?? "DATA_NOT_VERIFIED"));
    const fingerprint = entry.current_fingerprint;
    if (typeof fingerprint !== "string" || !digest.test(fingerprint)) return reject("VERIFICATION_FINGERPRINT_MISSING");
    const receipt = (Array.isArray(entry.receipts) ? entry.receipts : []).find((r: Row) =>
      r?.schema === RESEARCH_VERIFICATION_RECEIPT_SCHEMA && r.status === "VERIFIED"
      && r.symbol === symbol && r.trade_date === date && r.canonical_fingerprint === fingerprint
      && r.fingerprint_schema === "OHLC_CORE_FINGERPRINT_V1"
      && ["TWSE_MI_INDEX", "TPEX_HISTORICAL_DAILY"].includes(r.official?.source)
      && fields.every(field => r.official.matched_fields?.includes(field))
      && digest.test(String(r.source_digests?.[r.official.source] ?? "")));
    if (!receipt) return reject("VERIFICATION_RECEIPT_MISSING");
    const directory = date.replaceAll("-", "/");
    const [five, minute] = await Promise.all(["5m", "1m"].map(tf =>
      readGitHubText(env, `data/OHLC/tw/${tf}/${directory}/${symbol}.csv`)));
    if (!five.value || !minute.value || !five.sha || !minute.sha) return reject("INTRADAY_ARCHIVE_UNAVAILABLE");
    const fiveRows = parseCanonicalCsv(five.value);
    const minuteRows = parseCanonicalCsv(minute.value);
    const proof = await buildResearchVerificationFingerprint({ symbol, tradeDate: date, dailyRows, fiveRows, minuteRows });
    if (!proof.ok || proof.fingerprint !== fingerprint
      || proof.row_counts?.["1m"] !== minuteRows.length || proof.row_counts?.["5m"] !== fiveRows.length
      || receipt.row_counts?.["1m"] !== minuteRows.length || receipt.row_counts?.["5m"] !== fiveRows.length
      || receipt.row_counts?.["1d"] !== 1) return reject("VERIFICATION_FINGERPRINT_MISMATCH");
    return { verified: true as const, fingerprint, manifest_path: path, manifest_blob_sha: snapshot.sha,
      verified_fields: fields, official_source: receipt.official.source, source_sha256: receipt.source_digests[receipt.official.source],
      minute_blob_sha: minute.sha, five_minute_blob_sha: five.sha };
  } catch {
    return reject("VERIFICATION_UNAVAILABLE");
  }
}
