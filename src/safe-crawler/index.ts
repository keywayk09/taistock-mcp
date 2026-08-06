import { safeCrawl } from "./fetcher";
import type { SafeCrawlerOptions } from "./types";

export { APPROVED_SOURCES, validateApprovedUrl } from "./url-policy";
export { SafeCrawlerError } from "./types";
export type { SafeCrawlerOptions, SafeCrawlResult } from "./types";

/**
 * Fixed entrypoint for approved TWSE pages.
 * The caller cannot change the hostname through this function.
 */
export function crawlTwse(path = "/", options?: SafeCrawlerOptions) {
	return safeCrawl(new URL(path, "https://www.twse.com.tw").toString(), options);
}

/** Fixed entrypoint for approved MOPS pages. */
export function crawlMops(path = "/", options?: SafeCrawlerOptions) {
	return safeCrawl(new URL(path, "https://mops.twse.com.tw").toString(), options);
}

/** Fixed entrypoint for approved TPEx pages. */
export function crawlTpex(path = "/", options?: SafeCrawlerOptions) {
	return safeCrawl(new URL(path, "https://www.tpex.org.tw").toString(), options);
}

/**
 * Internal-only low-level function. Do not expose this as an unauthenticated
 * MCP tool that accepts arbitrary user URLs.
 */
export { safeCrawl } from "./fetcher";
