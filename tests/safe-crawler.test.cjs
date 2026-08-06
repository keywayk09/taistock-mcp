const test = require("node:test");
const assert = require("node:assert/strict");

const {
	SafeCrawlerError,
	crawlTwse,
	safeCrawl,
	validateApprovedUrl,
} = require("../.tmp-safe-crawler/index.js");

const originalFetch = global.fetch;

test.afterEach(() => {
	global.fetch = originalFetch;
});

function textResponse(body, init = {}) {
	return new Response(body, {
		status: init.status ?? 200,
		headers: {
			"content-type": "text/html; charset=utf-8",
			...(init.headers ?? {}),
		},
	});
}

test("拒絕惡意與未核准網址", () => {
	const blocked = [
		"http://www.twse.com.tw/",
		"https://localhost/",
		"https://127.0.0.1/",
		"https://169.254.169.254/latest/meta-data/",
		"https://example.com/",
		"https://user:pass@www.twse.com.tw/",
		"https://www.twse.com.tw:444/",
	];

	for (const url of blocked) {
		assert.throws(() => validateApprovedUrl(url), SafeCrawlerError, url);
	}
});

test("固定 TWSE 入口拒絕完整網址與 protocol-relative 網址", async () => {
	await assert.rejects(() => crawlTwse("https://mops.twse.com.tw/"), /只接受站內絕對路徑/);
	await assert.rejects(() => crawlTwse("//mops.twse.com.tw/"), /只接受站內絕對路徑/);
});

test("阻擋跨網域重新導向", async () => {
	global.fetch = async () =>
		new Response(null, {
			status: 302,
			headers: { location: "https://mops.twse.com.tw/" },
		});

	await assert.rejects(
		() => safeCrawl("https://www.twse.com.tw/"),
		(error) => error instanceof SafeCrawlerError && error.code === "REDIRECT_BLOCKED",
	);
});

test("阻擋超過硬上限的內容，即使呼叫端要求更大上限", async () => {
	const oversized = "x".repeat(2_000_001);
	global.fetch = async () => textResponse(oversized);

	await assert.rejects(
		() => safeCrawl("https://www.twse.com.tw/", { maxBytes: 99_000_000 }),
		(error) => error instanceof SafeCrawlerError && error.code === "CONTENT_TOO_LARGE",
	);
});

test("慢速下載 body 會被完整逾時計時中止", async () => {
	global.fetch = async (_url, init) => {
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("<html><body>partial"));
				init.signal.addEventListener(
					"abort",
					() => controller.error(new DOMException("Aborted", "AbortError")),
					{ once: true },
				);
			},
		});
		return new Response(stream, {
			status: 200,
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	};

	await assert.rejects(
		() => safeCrawl("https://www.twse.com.tw/", { timeoutMs: 1_000 }),
		(error) => error instanceof SafeCrawlerError && error.code === "TIMEOUT",
	);
});

test("正常 HTML 會清除 script 並產生雜湊", async () => {
	global.fetch = async () => textResponse("<title>測試</title><script>bad()</script><main>安全內容</main>");
	const result = await safeCrawl("https://www.twse.com.tw/");

	assert.equal(result.content.title, "測試");
	assert.match(result.content.text, /安全內容/);
	assert.doesNotMatch(result.content.text, /bad/);
	assert.match(result.integrity.sha256, /^[a-f0-9]{64}$/);
});
