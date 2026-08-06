import { extractSafeContent } from "./content";
import { validateApprovedUrl, validateRedirect } from "./url-policy";
import { SafeCrawlerError, type SafeCrawlerOptions, type SafeCrawlResult } from "./types";

const HARD_LIMITS = {
	timeoutMs: 12_000,
	maxBytes: 2_000_000,
	maxRedirects: 2,
	maxOutputChars: 80_000,
} as const;

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
	if (value === undefined) return fallback;
	if (!Number.isFinite(value)) return fallback;
	return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function resolveOptions(options: SafeCrawlerOptions) {
	return {
		timeoutMs: boundedInteger(options.timeoutMs, HARD_LIMITS.timeoutMs, 1_000, HARD_LIMITS.timeoutMs),
		maxBytes: boundedInteger(options.maxBytes, HARD_LIMITS.maxBytes, 1_024, HARD_LIMITS.maxBytes),
		maxRedirects: boundedInteger(options.maxRedirects, HARD_LIMITS.maxRedirects, 0, HARD_LIMITS.maxRedirects),
		maxOutputChars: boundedInteger(options.maxOutputChars, HARD_LIMITS.maxOutputChars, 1, HARD_LIMITS.maxOutputChars),
	};
}

async function sha256(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

export async function safeCrawl(input: string, options: SafeCrawlerOptions = {}): Promise<SafeCrawlResult> {
	const config = resolveOptions(options);
	const initial = validateApprovedUrl(input);
	let current = initial.url;
	let redirectCount = 0;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.timeoutMs);

	try {
		while (true) {
			const response = await fetch(current, {
				method: "GET",
				redirect: "manual",
				signal: controller.signal,
				headers: {
					Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
					"User-Agent": "Taistock-Safe-Crawler/1.0 (+public-data-research)",
				},
			});

			if ([301, 302, 303, 307, 308].includes(response.status)) {
				if (redirectCount >= config.maxRedirects) throw new SafeCrawlerError("重新導向次數超限", "REDIRECT_BLOCKED");
				const location = response.headers.get("location");
				if (!location) throw new SafeCrawlerError("重新導向缺少目標", "REDIRECT_BLOCKED");
				current = validateRedirect(current, location);
				redirectCount += 1;
				continue;
			}

			if (!response.ok) throw new SafeCrawlerError(`來源回應 HTTP ${response.status}`, "FETCH_FAILED");
			const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
			if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml") && !contentType.includes("text/plain")) {
				throw new SafeCrawlerError("來源內容類型不允許", "CONTENT_TYPE_BLOCKED");
			}

			const declaredLengthHeader = response.headers.get("content-length");
			if (declaredLengthHeader) {
				const declaredLength = Number(declaredLengthHeader);
				if (Number.isFinite(declaredLength) && declaredLength > config.maxBytes) {
					throw new SafeCrawlerError("來源內容超過大小限制", "CONTENT_TOO_LARGE");
				}
			}

			const reader = response.body?.getReader();
			if (!reader) throw new SafeCrawlerError("來源沒有可讀內容", "FETCH_FAILED");
			const chunks: Uint8Array[] = [];
			let total = 0;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				total += value.byteLength;
				if (total > config.maxBytes) {
					await reader.cancel();
					throw new SafeCrawlerError("來源內容超過大小限制", "CONTENT_TOO_LARGE");
				}
				chunks.push(value);
			}

			const body = new Uint8Array(total);
			let offset = 0;
			for (const chunk of chunks) {
				body.set(chunk, offset);
				offset += chunk.byteLength;
			}

			const raw = new TextDecoder("utf-8", { fatal: false }).decode(body);
			const extracted = contentType.includes("text/plain")
				? {
						title: null,
						text: raw.slice(0, config.maxOutputChars),
						markdown: raw.slice(0, config.maxOutputChars),
						truncated: raw.length > config.maxOutputChars,
					}
				: extractSafeContent(raw, config.maxOutputChars);

			return {
				source: {
					url: current.toString(),
					hostname: initial.source.hostname,
					label: initial.source.label,
					trustScore: initial.source.trustScore,
					fetchedAt: new Date().toISOString(),
				},
				content: { title: extracted.title, text: extracted.text, markdown: extracted.markdown, length: extracted.text.length },
				integrity: { sha256: await sha256(extracted.text) },
				safety: { contentType, redirectCount, truncated: extracted.truncated },
			};
		}
	} catch (error) {
		if (isAbortError(error) || controller.signal.aborted) {
			throw new SafeCrawlerError("抓取逾時", "TIMEOUT");
		}
		if (error instanceof SafeCrawlerError) throw error;
		throw new SafeCrawlerError("網頁抓取失敗", "FETCH_FAILED");
	} finally {
		clearTimeout(timer);
	}
}
