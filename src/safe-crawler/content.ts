function decodeNumericEntity(rawCode: string): string {
	const code = Number(rawCode);
	if (!Number.isInteger(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
		return "�";
	}
	return String.fromCodePoint(code);
}

function decodeEntities(value: string): string {
	return value
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&#(\d+);/g, (_, code: string) => decodeNumericEntity(code));
}

export function extractSafeContent(html: string, maxOutputChars: number): {
	title: string | null;
	text: string;
	markdown: string;
	truncated: boolean;
} {
	const safeLimit = Math.max(1, Math.floor(maxOutputChars));
	const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	const title = titleMatch ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : null;

	const cleaned = html
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<(script|style|noscript|svg|canvas|iframe|object|embed|form|button|nav|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, " ")
		.replace(/<(br|hr)\s*\/?\s*>/gi, "\n")
		.replace(/<\/(p|div|section|article|main|header|h[1-6]|li|tr)>/gi, "\n")
		.replace(/<li[^>]*>/gi, "- ")
		.replace(/<[^>]+>/g, " ");

	const normalized = decodeEntities(cleaned)
		.replace(/\r/g, "")
		.replace(/[\t ]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	const truncated = normalized.length > safeLimit;
	const text = truncated ? normalized.slice(0, safeLimit) : normalized;
	return { title, text, markdown: text, truncated };
}
