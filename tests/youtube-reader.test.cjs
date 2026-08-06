const test = require("node:test");
const assert = require("node:assert/strict");

const {
	YouTubeReaderError,
	parseYouTubeVideoId,
	readYouTubePublicTranscript,
} = require("../.tmp-youtube-reader/index.js");

const originalFetch = global.fetch;

test.afterEach(() => { global.fetch = originalFetch; });

function playerHtml(baseUrl, options = {}) {
	const payload = {
		videoDetails: {
			videoId: "tM3peHJbHSw",
			title: "測試影片",
			author: "測試頻道",
			lengthSeconds: "120",
		},
		captions: {
			playerCaptionsTracklistRenderer: {
				captionTracks: [{
					baseUrl,
					languageCode: options.languageCode ?? "zh-TW",
					kind: options.kind,
				}],
			},
		},
	};
	return `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(payload)};</script></html>`;
}

function json3() {
	return JSON.stringify({ events: [
		{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "第一段內容" }] },
		{ tStartMs: 3000, dDurationMs: 1500, segs: [{ utf8: "第二段內容" }] },
	] });
}

test("只接受標準 YouTube 公開網址並解析影片 ID", () => {
	const expected = "tM3peHJbHSw";
	assert.equal(parseYouTubeVideoId(`https://www.youtube.com/watch?v=${expected}`), expected);
	assert.equal(parseYouTubeVideoId(`https://youtu.be/${expected}`), expected);
	assert.equal(parseYouTubeVideoId(`https://www.youtube.com/shorts/${expected}`), expected);
	for (const url of [
		"https://example.com/watch?v=tM3peHJbHSw",
		"http://www.youtube.com/watch?v=tM3peHJbHSw",
		"https://user:pass@www.youtube.com/watch?v=tM3peHJbHSw",
		"https://www.youtube.com/watch?v=bad",
	]) assert.throws(() => parseYouTubeVideoId(url), YouTubeReaderError);
});

test("讀取公開 json3 字幕且不請求影音檔", async () => {
	const calls = [];
	global.fetch = async (url) => {
		calls.push(String(url));
		if (String(url).includes("/watch?")) return new Response(playerHtml("https://www.youtube.com/api/timedtext?v=tM3peHJbHSw&lang=zh-TW"), { status: 200 });
		return new Response(json3(), { status: 200, headers: { "content-type": "application/json" } });
	};
	const result = await readYouTubePublicTranscript("https://www.youtube.com/watch?v=tM3peHJbHSw");
	assert.equal(result.title, "測試影片");
	assert.equal(result.language, "zh-TW");
	assert.equal(result.segments.length, 2);
	assert.match(result.transcript, /第一段內容 第二段內容/);
	assert.equal(calls.some((url) => /videoplayback|googlevideo\.com/.test(url)), false);
});

test("頁面無字幕時使用受限 Innertube player fallback", async () => {
	const calls = [];
	const watchHtml = `<html><script>var ytInitialPlayerResponse = ${JSON.stringify({ videoDetails: { title: "頁面無字幕" } })};</script><script>ytcfg.set(${JSON.stringify({ INNERTUBE_API_KEY: "A".repeat(39), INNERTUBE_CLIENT_VERSION: "2.20260801.00.00", VISITOR_DATA: "visitor" })});</script></html>`;
	global.fetch = async (url, init = {}) => {
		calls.push({ url: String(url), method: init.method ?? "GET", body: init.body });
		if (String(url).includes("/watch?")) return new Response(watchHtml, { status: 200 });
		if (String(url).includes("/youtubei/v1/player")) {
			return new Response(JSON.stringify({
				playabilityStatus: { status: "OK" },
				videoDetails: { title: "備援成功", author: "測試頻道", lengthSeconds: "60" },
				captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: "https://www.youtube.com/api/timedtext?v=tM3peHJbHSw&lang=zh-TW", languageCode: "zh-TW" }] } },
			}), { status: 200, headers: { "content-type": "application/json" } });
		}
		return new Response(json3(), { status: 200, headers: { "content-type": "application/json" } });
	};
	const result = await readYouTubePublicTranscript("https://www.youtube.com/watch?v=tM3peHJbHSw");
	assert.equal(result.title, "備援成功");
	assert.equal(result.segments.length, 2);
	const apiCall = calls.find((call) => call.url.includes("/youtubei/v1/player"));
	assert.equal(apiCall.method, "POST");
	assert.match(String(apiCall.body), /"videoId":"tM3peHJbHSw"/);
	assert.equal(calls.some((call) => /videoplayback/.test(call.url)), false);
});

test("沒有公開字幕時明確停止", async () => {
	global.fetch = async () => new Response(`<script>var ytInitialPlayerResponse = ${JSON.stringify({ videoDetails: { title: "無字幕" } })};</script>`, { status: 200 });
	await assert.rejects(
		() => readYouTubePublicTranscript("https://www.youtube.com/watch?v=tM3peHJbHSw"),
		(error) => error instanceof YouTubeReaderError && error.code === "NO_PUBLIC_TRANSCRIPT",
	);
});

test("阻擋非 YouTube/GoogleVideo 字幕來源", async () => {
	global.fetch = async () => new Response(playerHtml("https://evil.example/caption"), { status: 200 });
	await assert.rejects(
		() => readYouTubePublicTranscript("https://www.youtube.com/watch?v=tM3peHJbHSw"),
		(error) => error instanceof YouTubeReaderError && error.code === "CAPTION_HOST_BLOCKED",
	);
});

test("字幕與影片頁面都有硬大小限制", async () => {
	global.fetch = async () => new Response("x".repeat(3_000_001), { status: 200 });
	await assert.rejects(
		() => readYouTubePublicTranscript("https://www.youtube.com/watch?v=tM3peHJbHSw"),
		(error) => error instanceof YouTubeReaderError && error.code === "CONTENT_TOO_LARGE",
	);
});
