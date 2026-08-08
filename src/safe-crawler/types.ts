export type ApprovedSource = {
	hostname: string;
	trustScore: number;
	label: string;
};

export type SafeCrawlerOptions = {
	timeoutMs?: number;
	maxBytes?: number;
	maxRedirects?: number;
	maxOutputChars?: number;
};

export type SafeCrawlResult = {
	source: {
		url: string;
		hostname: string;
		label: string;
		trustScore: number;
		fetchedAt: string;
	};
	content: {
		title: string | null;
		text: string;
		markdown: string;
		length: number;
	};
	integrity: {
		sha256: string;
	};
	safety: {
		contentType: string;
		redirectCount: number;
		truncated: boolean;
	};
};

export class SafeCrawlerError extends Error {
	constructor(
		message: string,
		public readonly code:
			| "URL_NOT_ALLOWED"
			| "UNSAFE_ADDRESS"
			| "REDIRECT_BLOCKED"
			| "TIMEOUT"
			| "CONTENT_TOO_LARGE"
			| "CONTENT_TYPE_BLOCKED"
			| "FETCH_FAILED",
	) {
		super(message);
		this.name = "SafeCrawlerError";
	}
}
