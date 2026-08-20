/**
 * GitHub canonical data store for Diamond.
 *
 * Policy:
 * - GitHub is the only formal persistent data layer.
 * - D1/R2 are forbidden for application data persistence.
 * - Writes use strict compare-and-swap. HTTP 409/422 always trigger re-read + re-merge.
 * - Immutable records never overwrite conflicting content.
 */

declare global {
  interface Env {
    GITHUB_DATA_TOKEN?: string;
    GITHUB_TOKEN?: string;
    GITHUB_DATA_REPO?: string;
    GITHUB_DATA_BRANCH?: string;
  }
}

export const GITHUB_DATA_STORE_VERSION = "diamond-github-store/v1";
export const DEFAULT_GITHUB_DATA_REPO = "keywayk09/tv-papertrader";
export const DEFAULT_GITHUB_DATA_BRANCH = "main";

export class GitHubDataStoreError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly detail?: Record<string, unknown>;
  constructor(code: string, message: string, status?: number, detail?: Record<string, unknown>) {
    super(message);
    this.name = "GitHubDataStoreError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export type GitHubJsonRead<T> = {
  exists: boolean;
  path: string;
  sha: string | null;
  value: T | null;
};

type MemoryEntry = { sha: string; text: string };
export type MemoryGitHubDataStore = Map<string, MemoryEntry>;

type TestEnv = Env & { __GITHUB_DATA_MEMORY?: MemoryGitHubDataStore };

function config(env: Env) {
  return {
    repo: String(env.GITHUB_DATA_REPO || DEFAULT_GITHUB_DATA_REPO).trim(),
    branch: String(env.GITHUB_DATA_BRANCH || DEFAULT_GITHUB_DATA_BRANCH).trim(),
    token: String(env.GITHUB_DATA_TOKEN || env.GITHUB_TOKEN || "").trim(),
  };
}

function memory(env: Env): MemoryGitHubDataStore | undefined {
  return (env as TestEnv).__GITHUB_DATA_MEMORY;
}

function normalizePath(path: string) {
  const out = path.replace(/^\/+/, "").replace(/\/{2,}/g, "/").trim();
  if (!out || out.includes("..")) throw new GitHubDataStoreError("INVALID_PATH", `invalid GitHub data path: ${path}`);
  return out;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = stableValue(source[key]);
    return out;
  }
  if (value === undefined) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value), null, 2) + "\n";
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function dataKey(value: string): Promise<string> {
  return (await sha256Hex(value)).slice(0, 40);
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 0x8000)));
  }
  return btoa(binary);
}

function base64ToUtf8(text: string): string {
  const binary = atob(text.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function githubHeaders(env: Env, write = false): HeadersInit {
  const { token } = config(env);
  if (write && !token) {
    throw new GitHubDataStoreError(
      "GITHUB_DATA_TOKEN_REQUIRED",
      "GITHUB_DATA_TOKEN or GITHUB_TOKEN is required for GitHub canonical-data writes",
    );
  }
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "taistock-diamond-github-store/1.0",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function contentUrl(env: Env, path: string) {
  const { repo, branch } = config(env);
  const encodedPath = normalizePath(path).split("/").map(encodeURIComponent).join("/");
  return `https://api.github.com/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
}

function contentPutUrl(env: Env, path: string) {
  const { repo } = config(env);
  const encodedPath = normalizePath(path).split("/").map(encodeURIComponent).join("/");
  return `https://api.github.com/repos/${repo}/contents/${encodedPath}`;
}

async function memorySha(text: string) { return await sha256Hex(`memory:${text}`); }

export async function readGitHubText(env: Env, path: string): Promise<GitHubJsonRead<string>> {
  const normalized = normalizePath(path);
  const mem = memory(env);
  if (mem) {
    const entry = mem.get(normalized);
    return entry
      ? { exists: true, path: normalized, sha: entry.sha, value: entry.text }
      : { exists: false, path: normalized, sha: null, value: null };
  }

  const response = await fetch(contentUrl(env, normalized), {
    method: "GET",
    headers: githubHeaders(env),
    cache: "no-store",
  });
  if (response.status === 404) return { exists: false, path: normalized, sha: null, value: null };
  const body = await response.json<any>().catch(() => null);
  if (!response.ok) {
    throw new GitHubDataStoreError("GITHUB_READ_FAILED", `GitHub read failed (${response.status})`, response.status, { path: normalized, body });
  }
  if (!body || Array.isArray(body) || typeof body.content !== "string" || typeof body.sha !== "string") {
    throw new GitHubDataStoreError("GITHUB_INVALID_CONTENT", "GitHub contents response is not a file", response.status, { path: normalized });
  }
  return { exists: true, path: normalized, sha: body.sha, value: base64ToUtf8(body.content) };
}

export async function readGitHubJson<T>(env: Env, path: string): Promise<GitHubJsonRead<T>> {
  const raw = await readGitHubText(env, path);
  if (!raw.exists || raw.value === null) return { ...raw, value: null } as GitHubJsonRead<T>;
  try {
    return { exists: true, path: raw.path, sha: raw.sha, value: JSON.parse(raw.value) as T };
  } catch (error) {
    throw new GitHubDataStoreError("GITHUB_JSON_INVALID", "Stored GitHub JSON is invalid", undefined, { path: raw.path, error: String(error) });
  }
}

async function putTextOnce(env: Env, path: string, text: string, currentSha: string | null, message: string) {
  const normalized = normalizePath(path);
  const mem = memory(env);
  if (mem) {
    const existing = mem.get(normalized);
    if ((existing?.sha ?? null) !== currentSha) {
      return { ok: false as const, conflict: true as const, status: 409 };
    }
    const sha = await memorySha(text);
    mem.set(normalized, { sha, text });
    return { ok: true as const, conflict: false as const, status: existing ? 200 : 201, sha };
  }

  const { branch } = config(env);
  const response = await fetch(contentPutUrl(env, normalized), {
    method: "PUT",
    headers: { ...githubHeaders(env, true), "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: utf8ToBase64(text),
      branch,
      ...(currentSha ? { sha: currentSha } : {}),
    }),
  });
  if (response.status === 409 || response.status === 422) {
    return { ok: false as const, conflict: true as const, status: response.status };
  }
  const body = await response.json<any>().catch(() => null);
  if (!response.ok) {
    throw new GitHubDataStoreError("GITHUB_WRITE_FAILED", `GitHub write failed (${response.status})`, response.status, { path: normalized, body });
  }
  return { ok: true as const, conflict: false as const, status: response.status, sha: String(body?.content?.sha ?? "") };
}

export async function updateGitHubJson<T>(env: Env, input: {
  path: string;
  defaultValue: T;
  message: string;
  merge: (current: T) => T | Promise<T>;
  retries?: number;
}) {
  const retries = Math.max(1, Math.min(8, input.retries ?? 5));
  for (let attempt = 1; attempt <= retries; attempt++) {
    const current = await readGitHubJson<T>(env, input.path);
    const base = current.exists && current.value !== null ? current.value : structuredClone(input.defaultValue);
    const next = await input.merge(base);
    const text = stableJson(next);
    if (current.exists && current.value !== null && stableJson(current.value) === text) {
      return { ok: true as const, idempotent: true as const, path: normalizePath(input.path), sha: current.sha, attempts: attempt };
    }
    const write = await putTextOnce(env, input.path, text, current.sha, input.message);
    if (write.ok) return { ok: true as const, idempotent: false as const, path: normalizePath(input.path), sha: write.sha, attempts: attempt };
    // Strict CAS: a 409/422 is never ignored. Re-read and re-merge on the next attempt.
  }
  throw new GitHubDataStoreError("GITHUB_CAS_EXHAUSTED", "GitHub CAS retries exhausted", 409, { path: normalizePath(input.path), retries });
}

export async function putImmutableGitHubJson(env: Env, input: {
  path: string;
  value: unknown;
  message: string;
  retries?: number;
}) {
  const incoming = stableJson(input.value);
  const incomingHash = await sha256Hex(incoming);
  const retries = Math.max(1, Math.min(8, input.retries ?? 5));
  for (let attempt = 1; attempt <= retries; attempt++) {
    const current = await readGitHubText(env, input.path);
    if (current.exists && current.value !== null) {
      const currentHash = await sha256Hex(current.value.endsWith("\n") ? current.value : `${current.value}\n`);
      if (currentHash !== incomingHash) {
        throw new GitHubDataStoreError("IMMUTABLE_CONFLICT", "immutable GitHub record already exists with different content", 409, {
          path: normalizePath(input.path), current_hash: currentHash, incoming_hash: incomingHash,
        });
      }
      return { ok: true as const, immutable: true as const, idempotent: true as const, path: normalizePath(input.path), sha: current.sha, content_sha256: incomingHash, attempts: attempt };
    }
    const write = await putTextOnce(env, input.path, incoming, null, input.message);
    if (write.ok) return { ok: true as const, immutable: true as const, idempotent: false as const, path: normalizePath(input.path), sha: write.sha, content_sha256: incomingHash, attempts: attempt };
    // Strict create-CAS race: re-read after 409/422 and verify immutability.
  }
  throw new GitHubDataStoreError("GITHUB_CAS_EXHAUSTED", "GitHub immutable create retries exhausted", 409, { path: normalizePath(input.path), retries });
}

export type CollectionIndexEntry = {
  key: string;
  path: string;
  recorded_at: string;
  [key: string]: unknown;
};

export type CollectionIndex = {
  schema_version: "diamond-github-collection-index/v1";
  collection: string;
  updated_at: string;
  records: CollectionIndexEntry[];
};

export async function readCollectionIndex(env: Env, collection: string) {
  const path = `data/${normalizePath(collection)}/_index.json`;
  const read = await readGitHubJson<CollectionIndex>(env, path);
  return read.value ?? { schema_version: "diamond-github-collection-index/v1" as const, collection, updated_at: "", records: [] };
}

export async function putIndexedImmutableRecord(env: Env, input: {
  collection: string;
  key: string;
  record: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  message?: string;
}) {
  const collection = normalizePath(input.collection);
  const keyHash = await dataKey(input.key);
  const recordPath = `data/${collection}/records/${keyHash}.json`;
  const existingRecord = await readGitHubJson<Record<string, unknown>>(env, recordPath);
  let recordWrite: { ok:true; immutable:true; idempotent:boolean; path:string; sha:string|null; content_sha256:string; attempts:number };
  let canonicalRecord = input.record;
  if (existingRecord.value) {
    const existingHash = String(existingRecord.value.content_hash ?? existingRecord.value.content_sha256 ?? existingRecord.value.dataset_version ?? "");
    const incomingHash = String(input.record.content_hash ?? input.record.content_sha256 ?? input.record.dataset_version ?? "");
    const same = existingHash && incomingHash ? existingHash === incomingHash : stableJson(existingRecord.value) === stableJson(input.record);
    if (!same) {
      throw new GitHubDataStoreError("IMMUTABLE_CONFLICT", "immutable GitHub record already exists with different content", 409, { collection, key: input.key, path: recordPath, existing_hash: existingHash || null, incoming_hash: incomingHash || null });
    }
    canonicalRecord = existingRecord.value;
    recordWrite = { ok:true, immutable:true, idempotent:true, path:recordPath, sha:existingRecord.sha, content_sha256:await sha256Hex(stableJson(existingRecord.value)), attempts:1 };
  } else {
    recordWrite = await putImmutableGitHubJson(env, {
      path: recordPath,
      value: input.record,
      message: input.message ?? `data(${collection}): add immutable ${keyHash}`,
    });
  }
  const recordedAt = String(canonicalRecord.recorded_at ?? canonicalRecord.captured_at ?? new Date().toISOString());
  const indexWrite = await updateGitHubJson<CollectionIndex>(env, {
    path: `data/${collection}/_index.json`,
    defaultValue: { schema_version: "diamond-github-collection-index/v1", collection, updated_at: "", records: [] },
    message: `data(${collection}): index ${keyHash}`,
    merge: (current) => {
      const existing = current.records.find((entry) => entry.key === input.key);
      const nextEntry: CollectionIndexEntry = { key: input.key, path: recordPath, recorded_at: recordedAt, ...(input.metadata ?? {}) };
      if (existing && existing.path !== recordPath) {
        throw new GitHubDataStoreError("INDEX_CONFLICT", "collection key points to a different immutable path", 409, { collection, key: input.key });
      }
      const records = existing ? current.records : [...current.records, nextEntry];
      return { ...current, schema_version: "diamond-github-collection-index/v1", collection, updated_at: new Date().toISOString(), records };
    },
  });
  return { ...recordWrite, index_sha: indexWrite.sha, collection };
}

export async function readIndexedRecord<T>(env: Env, collection: string, key: string): Promise<T | null> {
  const keyHash = await dataKey(key);
  const read = await readGitHubJson<T>(env, `data/${normalizePath(collection)}/records/${keyHash}.json`);
  return read.value;
}

export async function listIndexedRecords<T>(env: Env, collection: string, predicate: (entry: CollectionIndexEntry) => boolean, limit = 100) {
  const index = await readCollectionIndex(env, collection);
  const selected = index.records.filter(predicate).sort((a, b) => b.recorded_at.localeCompare(a.recorded_at)).slice(0, Math.max(1, Math.min(500, limit)));
  const records = await Promise.all(selected.map(async (entry) => (await readGitHubJson<T>(env, entry.path)).value));
  return records.filter((value) => value !== null) as T[];
}

export function githubDataStoreHealth(env: Env) {
  const cfg = config(env);
  return {
    version: GITHUB_DATA_STORE_VERSION,
    persistence: "GITHUB_ONLY" as const,
    repo: cfg.repo,
    branch: cfg.branch,
    write_token: cfg.token ? "configured" : "missing",
    r2: "FORBIDDEN" as const,
    d1: "FORBIDDEN_FOR_APP_DATA" as const,
  };
}