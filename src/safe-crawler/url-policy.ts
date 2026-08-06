import { SafeCrawlerError, type ApprovedSource } from "./types";

export const APPROVED_SOURCES: readonly ApprovedSource[] = [
	{ hostname: "www.twse.com.tw", trustScore: 100, label: "臺灣證券交易所" },
	{ hostname: "mops.twse.com.tw", trustScore: 100, label: "公開資訊觀測站" },
	{ hostname: "www.tpex.org.tw", trustScore: 100, label: "證券櫃檯買賣中心" },
] as const;

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);
const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost"];

function isPrivateIpv4(hostname: string): boolean {
	const parts = hostname.split(".").map(Number);
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
	const [a, b] = parts;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		a >= 224
	);
}

function isUnsafeHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase().replace(/\.$/, "");
	return (
		BLOCKED_HOSTNAMES.has(normalized) ||
		BLOCKED_SUFFIXES.some((suffix) => normalized.endsWith(suffix)) ||
		isPrivateIpv4(normalized) ||
		normalized === "::1" ||
		normalized.startsWith("fe80:") ||
		normalized.startsWith("fc") ||
		normalized.startsWith("fd")
	);
}

export function validateApprovedUrl(input: string): { url: URL; source: ApprovedSource } {
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		throw new SafeCrawlerError("網址格式無效", "URL_NOT_ALLOWED");
	}

	if (url.protocol !== "https:") throw new SafeCrawlerError("只允許 HTTPS", "URL_NOT_ALLOWED");
	if (url.username || url.password) throw new SafeCrawlerError("網址不得包含帳號密碼", "URL_NOT_ALLOWED");
	if (url.port && url.port !== "443") throw new SafeCrawlerError("禁止非標準連接埠", "URL_NOT_ALLOWED");
	if (isUnsafeHostname(url.hostname)) throw new SafeCrawlerError("禁止存取本機、內網或保留位址", "UNSAFE_ADDRESS");

	const source = APPROVED_SOURCES.find((item) => item.hostname === url.hostname.toLowerCase());
	if (!source) throw new SafeCrawlerError("網域尚未列入核准白名單", "URL_NOT_ALLOWED");

	url.hash = "";
	return { url, source };
}

export function validateRedirect(from: URL, location: string): URL {
	const redirected = new URL(location, from);
	const { url } = validateApprovedUrl(redirected.toString());
	if (url.hostname !== from.hostname) {
		throw new SafeCrawlerError("禁止跨網域重新導向", "REDIRECT_BLOCKED");
	}
	return url;
}
