import { safeCrawl } from "./fetcher";
import { SafeCrawlerError, type SafeCrawlerOptions } from "./types";

export { APPROVED_SOURCES, validateApprovedUrl } from "./url-policy";
export { SafeCrawlerError } from "./types";
export type { SafeCrawlerOptions, SafeCrawlResult } from "./types";

function buildApprovedUrl(base: string, path: string): string {
	const value = path.trim();
	if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith("//")) {
		throw new SafeCrawlerError("固定來源入口只接受站內路徑", "URL_NOT_ALLOWED");
	}

	const baseUrl = new URL(base);
	const url = new URL(value || "/", baseUrl);
	if (url.origin !== baseUrl.origin) {
		throw new SafeCrawlerError("禁止透過路徑切換來源網域", "URL_NOT_ALLOWED");
	}
	return url.toString();
}

/** Fixed entrypoint for approved TWSE pages. */
export function crawlTwse(path = "/", options?: SafeCrawlerOptions) {
	return safeCrawl(buildApprovedUrl("https://www.twse.com.tw", path), options);
}

/** Fixed entrypoint for approved MOPS pages. */
export function crawlMops(path = "/", options?: SafeCrawlerOptions) {
	return safeCrawl(buildApprovedUrl("https://mops.twse.com.tw", path), options);
}

/** Fixed entrypoint for approved TPEx pages. */
export function crawlTpex(path = "/", options?: SafeCrawlerOptions) {
	return safeCrawl(buildApprovedUrl("https://www.tpex.org.tw", path), options);
}

/** Internal-only low-level function. Never expose it as an arbitrary-URL MCP tool. */
export { safeCrawl } from "./fetcher";
