import { YouTubeReaderError, type TranscriptSegment, type YouTubeReadResult } from "./types";

const WATCH_ORIGINS = new Set(["https://www.youtube.com", "https://youtube.com", "https://m.youtube.com", "https://youtu.be"]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const API_KEY = /^[A-Za-z0-9_-]{20,80}$/;
const HARD_LIMITS = { timeoutMs: 12_000, maxWatchBytes: 3_000_000, maxPlayerBytes: 3_000_000, maxCaptionBytes: 5_000_000, maxTranscriptChars: 250_000 } as const;

export { YouTubeReaderError } from "./types";
export type { TranscriptSegment, YouTubeReadResult } from "./types";

export function parseYouTubeVideoId(input: string): string {
	let url: URL;
	try { url = new URL(input); } catch { throw new YouTubeReaderError("YouTube 網址格式錯誤", "INVALID_URL"); }
	if (!WATCH_ORIGINS.has(url.origin)) throw new YouTubeReaderError("只允許 YouTube 公開網址", "INVALID_HOST");
	if (url.username || url.password || (url.port && url.port !== "443")) throw new YouTubeReaderError("YouTube 網址含不允許的欄位", "INVALID_URL");
	let id = "";
	if (url.hostname === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] ?? "";
	else if (url.pathname === "/watch") id = url.searchParams.get("v") ?? "";
	else {
		const parts = url.pathname.split("/").filter(Boolean);
		if (["shorts", "live", "embed"].includes(parts[0] ?? "")) id = parts[1] ?? "";
	}
	if (!VIDEO_ID.test(id)) throw new YouTubeReaderError("找不到有效的 YouTube 影片 ID", "INVALID_VIDEO_ID");
	return id;
}

async function readLimitedResponse(response: Response, maxBytes: number): Promise<string> {
	if (!response.ok) throw new YouTubeReaderError(`YouTube 回應 HTTP ${response.status}`, "FETCH_FAILED");
	const reader = response.body?.getReader();
	if (!reader) throw new YouTubeReaderError("YouTube 回應沒有內容", "FETCH_FAILED");
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) { await reader.cancel(); throw new YouTubeReaderError("YouTube 回應超過安全大小限制", "CONTENT_TOO_LARGE"); }
		chunks.push(value);
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
	return new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(body);
}

async function fetchText(url: string, maxBytes: number, signal: AbortSignal): Promise<string> {
	const response = await fetch(url, { redirect: "error", signal, headers: { Accept: "text/html,application/json,text/plain", "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.5" } });
	return readLimitedResponse(response, maxBytes);
}

async function postJson(url: string, body: unknown, maxBytes: number, signal: AbortSignal): Promise<any> {
	const parsed = new URL(url);
	if (parsed.origin !== "https://www.youtube.com" || parsed.pathname !== "/youtubei/v1/player") {
		throw new YouTubeReaderError("播放器 API 端點不允許", "INVALID_HOST");
	}
	const response = await fetch(parsed, {
		method: "POST",
		redirect: "error",
		signal,
		headers: { Accept: "application/json", "Content-Type": "application/json", "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.5" },
		body: JSON.stringify(body),
	});
	const raw = await readLimitedResponse(response, maxBytes);
	try { return JSON.parse(raw); } catch { throw new YouTubeReaderError("播放器 API 回傳無法解析", "PLAYER_DATA_INVALID"); }
}

function extractJsonObject(source: string, marker: string): any {
	const markerIndex = source.indexOf(marker);
	if (markerIndex < 0) throw new YouTubeReaderError("影片頁面沒有公開播放器資料", "PLAYER_DATA_MISSING");
	const start = source.indexOf("{", markerIndex + marker.length);
	if (start < 0) throw new YouTubeReaderError("播放器資料格式錯誤", "PLAYER_DATA_MISSING");
	let depth = 0, inString = false, escaped = false;
	for (let i = start; i < source.length; i++) {
		const ch = source[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') inString = true;
		else if (ch === "{") depth++;
		else if (ch === "}" && --depth === 0) {
			try { return JSON.parse(source.slice(start, i + 1)); }
			catch { throw new YouTubeReaderError("播放器資料無法解析", "PLAYER_DATA_INVALID"); }
		}
	}
	throw new YouTubeReaderError("播放器資料不完整", "PLAYER_DATA_INVALID");
}

function findConfigString(source: string, key: string): string | null {
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const patterns = [
		new RegExp(`"${escaped}"\\s*:\\s*"([^"]+)"`),
		new RegExp(`'${escaped}'\\s*:\\s*'([^']+)'`),
	];
	for (const pattern of patterns) {
		const match = source.match(pattern);
		if (match?.[1]) return match[1].replace(/\\u0026/g, "&");
	}
	return null;
}

async function fetchInnertubePlayer(html: string, videoId: string, signal: AbortSignal): Promise<any | null> {
	const apiKey = findConfigString(html, "INNERTUBE_API_KEY");
	if (!apiKey || !API_KEY.test(apiKey)) return null;
	const clientVersion = findConfigString(html, "INNERTUBE_CLIENT_VERSION") ?? "2.20260730.01.00";
	const visitorData = findConfigString(html, "VISITOR_DATA") ?? undefined;
	const endpoint = new URL("https://www.youtube.com/youtubei/v1/player");
	endpoint.searchParams.set("key", apiKey);
	endpoint.searchParams.set("prettyPrint", "false");
	return postJson(endpoint.toString(), {
		videoId,
		contentCheckOk: true,
		racyCheckOk: true,
		context: {
			client: {
				clientName: "WEB",
				clientVersion,
				hl: "zh-TW",
				gl: "TW",
				visitorData,
			},
		},
	}, HARD_LIMITS.maxPlayerBytes, signal);
}

function captionTracks(player: any): any[] {
	const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
	return Array.isArray(tracks) ? tracks : [];
}

function chooseCaptionTrack(tracks: any[], preferredLanguages: string[]) {
	const rank = (track: any) => {
		const code = String(track.languageCode ?? "").toLowerCase();
		const langIndex = preferredLanguages.findIndex((x) => code === x.toLowerCase() || code.startsWith(`${x.toLowerCase()}-`));
		return (langIndex < 0 ? 100 : langIndex) * 10 + (track.kind === "asr" ? 1 : 0);
	};
	return [...tracks].sort((a, b) => rank(a) - rank(b))[0];
}

function parseJson3Captions(raw: string): TranscriptSegment[] {
	let data: any;
	try { data = JSON.parse(raw); } catch { throw new YouTubeReaderError("字幕資料無法解析", "CAPTION_INVALID"); }
	const events = Array.isArray(data.events) ? data.events : [];
	return events.flatMap((event: any) => {
		if (!Array.isArray(event.segs)) return [];
		const text = event.segs.map((seg: any) => String(seg.utf8 ?? "")).join("").replace(/\s+/g, " ").trim();
		if (!text) return [];
		return [{ startSeconds: Number(event.tStartMs ?? 0) / 1000, durationSeconds: Number(event.dDurationMs ?? 0) / 1000, text }];
	});
}

export async function readYouTubePublicTranscript(input: string, preferredLanguages = ["zh-TW", "zh-Hant", "zh", "en"]): Promise<YouTubeReadResult> {
	const videoId = parseYouTubeVideoId(input);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), HARD_LIMITS.timeoutMs);
	try {
		const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=zh-TW&gl=TW&has_verified=1`;
		const html = await fetchText(watchUrl, HARD_LIMITS.maxWatchBytes, controller.signal);
		let player: any;
		try { player = extractJsonObject(html, "ytInitialPlayerResponse"); }
		catch (error) {
			if (!(error instanceof YouTubeReaderError) || !["PLAYER_DATA_MISSING", "PLAYER_DATA_INVALID"].includes(error.code)) throw error;
			player = null;
		}
		let tracks = captionTracks(player);
		if (tracks.length === 0) {
			const fallback = await fetchInnertubePlayer(html, videoId, controller.signal);
			if (fallback) {
				player = fallback;
				tracks = captionTracks(fallback);
			}
		}
		const details = player?.videoDetails ?? {};
		if (details.isPrivate) throw new YouTubeReaderError("私人影片不可讀取", "VIDEO_UNAVAILABLE");
		const status = String(player?.playabilityStatus?.status ?? "");
		if (status && !["OK", "LIVE_STREAM_OFFLINE"].includes(status) && tracks.length === 0) {
			throw new YouTubeReaderError(String(player?.playabilityStatus?.reason ?? "影片不可讀取"), "VIDEO_UNAVAILABLE");
		}
		if (tracks.length === 0) throw new YouTubeReaderError("影片沒有公開字幕或文字記錄", "NO_PUBLIC_TRANSCRIPT");
		const track = chooseCaptionTrack(tracks, preferredLanguages);
		if (!track?.baseUrl) throw new YouTubeReaderError("公開字幕網址缺失", "NO_PUBLIC_TRANSCRIPT");
		const captionUrl = new URL(String(track.baseUrl));
		const captionHost = captionUrl.hostname.toLowerCase();
		if (!(captionHost === "www.youtube.com" || captionHost === "youtube.com" || captionHost.endsWith(".youtube.com") || captionHost.endsWith(".googlevideo.com"))) {
			throw new YouTubeReaderError("字幕來源網域不允許", "CAPTION_HOST_BLOCKED");
		}
		captionUrl.searchParams.set("fmt", "json3");
		const rawCaption = await fetchText(captionUrl.toString(), HARD_LIMITS.maxCaptionBytes, controller.signal);
		const segments = parseJson3Captions(rawCaption);
		if (segments.length === 0) throw new YouTubeReaderError("公開字幕內容為空", "NO_PUBLIC_TRANSCRIPT");
		const transcript = segments.map((x) => x.text).join(" ").slice(0, HARD_LIMITS.maxTranscriptChars);
		return {
			videoId,
			url: `https://www.youtube.com/watch?v=${videoId}`,
			title: String(details.title ?? ""),
			author: String(details.author ?? ""),
			lengthSeconds: Number.isFinite(Number(details.lengthSeconds)) ? Number(details.lengthSeconds) : null,
			language: String(track.languageCode ?? "unknown"),
			captionKind: track.kind === "asr" ? "asr" : "manual",
			segments,
			transcript,
			fetchedAt: new Date().toISOString(),
		};
	} catch (error) {
		if (controller.signal.aborted) throw new YouTubeReaderError("YouTube 讀取逾時", "TIMEOUT");
		if (error instanceof YouTubeReaderError) throw error;
		throw new YouTubeReaderError(error instanceof Error ? error.message : "YouTube 讀取失敗", "FETCH_FAILED");
	} finally { clearTimeout(timer); }
}
