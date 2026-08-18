import {
  getResearchStatus as getResearchStatusBase,
  getStoredCandles as getStoredCandlesBase,
  isAuthorizedResearchRequest,
  runResearchPipeline as runResearchPipelineBase,
} from "./research-pipeline";

declare global {
  interface Env {
    GITHUB_TOKEN?: string;
    MARKET_DATA_GITHUB_REPO?: string;
    MARKET_DATA_GITHUB_BRANCH?: string;
  }
}

const DEFAULT_GITHUB_REPO = "keywayk09/tv-papertrader";
const DEFAULT_GITHUB_BRANCH = "main";
const RESEARCH_GITHUB_PREFIX = "data/research/diamond-runtime/v1";

type GithubFile = { exists: boolean; sha?: string; content?: string };

function githubRepo(env: Env): string {
  return env.MARKET_DATA_GITHUB_REPO || DEFAULT_GITHUB_REPO;
}

function githubBranch(env: Env): string {
  return env.MARKET_DATA_GITHUB_BRANCH || DEFAULT_GITHUB_BRANCH;
}

function safeResearchKey(key: string): string {
  const normalized = key.replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || normalized.includes("\\")) {
    throw new Error(`invalid research storage key: ${key}`);
  }
  return `${RESEARCH_GITHUB_PREFIX}/${normalized}`;
}

function githubContentsUrl(env: Env, path: string): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `https://api.github.com/repos/${githubRepo(env)}/contents/${encodedPath}`;
}

function githubHeaders(env: Env): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env.GITHUB_TOKEN ?? ""}`,
    "User-Agent": "Taiwan-Stock-AI-Research/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64Utf8(value: string): string {
  const binary = atob(value.replaceAll("\n", ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function readGithubFile(env: Env, path: string): Promise<GithubFile> {
  if (!env.GITHUB_TOKEN) return { exists: false };
  const response = await fetch(`${githubContentsUrl(env, path)}?ref=${encodeURIComponent(githubBranch(env))}`, {
    headers: githubHeaders(env),
  });
  if (response.status === 404) return { exists: false };
  if (!response.ok) throw new Error(`GitHub read ${path} HTTP ${response.status}`);
  const body = await response.json() as Record<string, unknown>;
  return {
    exists: true,
    sha: typeof body.sha === "string" ? body.sha : undefined,
    content: typeof body.content === "string" ? base64Utf8(body.content) : undefined,
  };
}

async function writeGithubFile(env: Env, path: string, content: string, message: string) {
  if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN 尚未設定");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const current = await readGithubFile(env, path);
    if (current.exists && current.content === content) return;
    const body: Record<string, unknown> = {
      message,
      branch: githubBranch(env),
      content: utf8Base64(content),
    };
    if (current.sha) body.sha = current.sha;
    const response = await fetch(githubContentsUrl(env, path), {
      method: "PUT",
      headers: { ...githubHeaders(env), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return;
    if ((response.status === 409 || response.status === 422) && attempt < 3) continue;
    throw new Error(`GitHub write ${path} HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  throw new Error(`GitHub write ${path} CAS retry exhausted`);
}

async function bodyToText(value: unknown): Promise<string> {
  if (typeof value === "string") return value;
  if (value instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) {
    return new TextDecoder().decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) return value.text();
  throw new Error("unsupported research storage payload type");
}

function githubBackedResearchBucket(env: Env): R2Bucket {
  const bucket = {
    async put(key: string, value: unknown) {
      const path = safeResearchKey(key);
      const content = await bodyToText(value);
      await writeGithubFile(env, path, content, `research: persist ${key}`);
      return null;
    },
    async get(key: string) {
      const path = safeResearchKey(key);
      const file = await readGithubFile(env, path);
      if (!file.exists || file.content === undefined) return null;
      const content = file.content;
      return {
        key,
        size: new TextEncoder().encode(content).byteLength,
        etag: file.sha ?? "",
        httpEtag: file.sha ?? "",
        uploaded: new Date(0),
        checksums: {},
        httpMetadata: { contentType: "application/json; charset=utf-8" },
        customMetadata: { storage: "github", github_path: path },
        range: undefined,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(content));
            controller.close();
          },
        }),
        bodyUsed: false,
        async arrayBuffer() { return new TextEncoder().encode(content).buffer; },
        async text() { return content; },
        async json<T>() { return JSON.parse(content) as T; },
        async blob() { return new Blob([content], { type: "application/json" }); },
        writeHttpMetadata() {},
      };
    },
  };
  return bucket as unknown as R2Bucket;
}

function researchRuntimeEnv(env: Env): Env {
  const virtualBucket = githubBackedResearchBucket(env);
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "RESEARCH_BUCKET") return virtualBucket;
      return Reflect.get(target, property, receiver);
    },
  });
}

export { isAuthorizedResearchRequest };

export async function runResearchPipeline(env: Env, mode: "close" | "repair", scheduledAt = new Date()) {
  return runResearchPipelineBase(researchRuntimeEnv(env), mode, scheduledAt);
}

export async function getStoredCandles(env: Env, tradeDate: string, symbol: string, timeframe: "1m" | "5m") {
  return getStoredCandlesBase(researchRuntimeEnv(env), tradeDate, symbol, timeframe);
}

export async function getResearchStatus(env: Env) {
  const status = await getResearchStatusBase(researchRuntimeEnv(env));
  return {
    ...status,
    bindings: {
      ...status.bindings,
      r2: false,
      github: Boolean(env.GITHUB_TOKEN),
    },
    storage_backend: "github",
    storage_prefix: RESEARCH_GITHUB_PREFIX,
  };
}
