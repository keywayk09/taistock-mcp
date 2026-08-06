function decodeEntities(value: string): string {
	return value
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

export function extractSafeContent(html: string, maxOutputChars: number): {
	title: string | null;
	text: string;
	markdown: string;
	truncated: boolean;
} {
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

	const truncated = normalized.length > maxOutputChars;
	const text = truncated ? normalized.slice(0, maxOutputChars) : normalized;
	return { title, text, markdown: text, truncated };
}
