import {
  DEFAULT_GITHUB_DATA_BRANCH,
  DEFAULT_GITHUB_DATA_REPO,
  GitHubDataStoreError,
  sha256Hex,
  stableJson,
  type MemoryGitHubDataStore,
} from "./github-data-store.ts";
import {
  decodeGitHubCompressedJsonText,
  isGitHubCompressedJsonEnvelope,
} from "./github-compressed-json.ts";

type TestEnv = Env & { __GITHUB_DATA_MEMORY?: MemoryGitHubDataStore };

type AtomicJsonUpdate<T = unknown> = {
  path: string;
  defaultValue: T;
  merge: (current: T) => T | Promise<T>;
};

export type AtomicGitHubJsonResult = {
  ok: true;
  idempotent: boolean;
  commit_sha: string | null;
  changed_paths: string[];
  attempts: number;
  estimated_subrequests: number;
};

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
  if (!out || out.includes("..")) {
    throw new GitHubDataStoreError("INVALID_PATH", `invalid GitHub data path: ${path}`);
  }
  return out;
}

function headers(env: Env, write = false): HeadersInit {
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
    "User-Agent": "taistock-diamond-github-atomic/1.0",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function utf8FromBase64(value: string) {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function logicalJsonText(storedText: string) {
  const parsed = JSON.parse(storedText);
  return isGitHubCompressedJsonEnvelope(parsed)
    ? await decodeGitHubCompressedJsonText(parsed)
    : storedText;
}

export async function parseAtomicStoredJsonText<T>(storedText: string, input: {
  path: string;
  ref: string;
}): Promise<T> {
  const normalized = normalizePath(input.path);
  try {
    const logical = await logicalJsonText(storedText);
    return JSON.parse(logical) as T;
  } catch (error) {
    throw new GitHubDataStoreError(
      "GITHUB_ATOMIC_JSON_INVALID",
      "GitHub atomic exact-ref JSON is invalid or truncated",
      undefined,
      {
        path: normalized,
        ref: input.ref,
        stored_bytes: new TextEncoder().encode(storedText).byteLength,
        error: String(error),
      },
    );
  }
}

async function jsonRequest<T>(env: Env, url: string, init: RequestInit, allowedConflict = false): Promise<{
  ok: boolean;
  conflict: boolean;
  status: number;
  body: T | null;
}> {
  const response = await fetch(url, init);
  const body = await response.json<T>().catch(() => null);
  const conflict = allowedConflict && (response.status === 409 || response.status === 422);
  if (!response.ok && !conflict) {
    throw new GitHubDataStoreError(
      "GITHUB_ATOMIC_REQUEST_FAILED",
      `GitHub atomic request failed (${response.status})`,
      response.status,
      { url, body },
    );
  }
  return { ok: response.ok, conflict, status: response.status, body };
}

function apiBase(env: Env) {
  const { repo } = config(env);
  return `https://api.github.com/repos/${repo}`;
}

function branchRefPath(branch: string) {
  return branch.split("/").map(encodeURIComponent).join("/");
}

async function readJsonAtRef<T>(env: Env, path: string, ref: string): Promise<{
  exists: boolean;
  sha: string | null;
  value: T | null;
}> {
  const normalized = normalizePath(path);
  const mem = memory(env);
  if (mem) {
    const entry = mem.get(normalized);
    if (!entry) return { exists: false, sha: null, value: null };
    return {
      exists: true,
      sha: entry.sha,
      value: await parseAtomicStoredJsonText<T>(entry.text, { path: normalized, ref }),
    };
  }

  const encodedPath = normalized.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${apiBase(env)}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`, {
    method: "GET",
    headers: {
      ...headers(env),
      Accept: "application/vnd.github.raw+json",
    },
    cache: "no-store",
  });
  if (response.status === 404) return { exists: false, sha: null, value: null };
  const storedText = await response.text();
  if (!response.ok) {
    throw new GitHubDataStoreError(
      "GITHUB_ATOMIC_READ_FAILED",
      `GitHub atomic raw read failed (${response.status})`,
      response.status,
      {
        path: normalized,
        ref,
        body_preview: storedText.slice(0, 500),
      },
    );
  }
  return {
    exists: true,
    // The Git-data transaction does not require the source blob SHA here;
    // exact-ref consistency comes from the immutable commit SHA in the URL.
    sha: null,
    value: await parseAtomicStoredJsonText<T>(storedText, { path: normalized, ref }),
  };
}

export function estimateAtomicJsonTransactionSubrequests(fileCount: number) {
  const count = Math.max(0, Math.floor(fileCount));
  if (!count) return 0;
  // ref + parent commit + N exact-ref reads + N blob creates + tree + commit + ref CAS
  return 2 * count + 5;
}

export async function readGitHubBlobJson<T>(env: Env, blobSha: string): Promise<T> {
  if (!/^[0-9a-f]{40}$/i.test(blobSha) && !blobSha.startsWith("seed-") && !blobSha.startsWith("memory-")) {
    throw new GitHubDataStoreError("INVALID_BLOB_SHA", `invalid Git blob sha: ${blobSha}`);
  }
  const mem = memory(env);
  if (mem) {
    const entry = [...mem.values()].find((candidate) => candidate.sha === blobSha);
    if (!entry) throw new GitHubDataStoreError("GITHUB_BLOB_MISSING", `memory Git blob not found: ${blobSha}`, 404);
    return await parseAtomicStoredJsonText<T>(entry.text, { path: `blob:${blobSha}`, ref: blobSha });
  }

  const response = await fetch(`${apiBase(env)}/git/blobs/${encodeURIComponent(blobSha)}`, {
    method: "GET",
    headers: headers(env),
    cache: "no-store",
  });
  const body = await response.json<any>().catch(() => null);
  if (!response.ok || !body || typeof body.content !== "string") {
    throw new GitHubDataStoreError(
      "GITHUB_BLOB_READ_FAILED",
      `GitHub blob read failed (${response.status})`,
      response.status,
      { blob_sha: blobSha, body },
    );
  }
  const storedText = body.encoding === "base64" ? utf8FromBase64(body.content) : String(body.content);
  return await parseAtomicStoredJsonText<T>(storedText, { path: `blob:${blobSha}`, ref: blobSha });
}

export async function atomicUpdateGitHubJsonFiles(
  env: Env,
  input: {
    message: string;
    updates: AtomicJsonUpdate[];
    retries?: number;
  },
): Promise<AtomicGitHubJsonResult> {
  const updates = input.updates.map((update) => ({ ...update, path: normalizePath(update.path) }));
  const uniquePaths = new Set(updates.map((update) => update.path));
  if (uniquePaths.size !== updates.length) {
    throw new GitHubDataStoreError("ATOMIC_DUPLICATE_PATH", "atomic GitHub transaction contains duplicate paths");
  }
  if (!updates.length) {
    return { ok: true, idempotent: true, commit_sha: null, changed_paths: [], attempts: 1, estimated_subrequests: 0 };
  }

  const mem = memory(env);
  if (mem) {
    const staged: Array<{ path: string; text: string; sha: string }> = [];
    for (const update of updates) {
      const current = await readJsonAtRef<any>(env, update.path, "memory");
      const base = current.exists && current.value !== null ? current.value : structuredClone(update.defaultValue);
      const next = await update.merge(base);
      const text = stableJson(next);
      if (current.exists && current.value !== null && stableJson(current.value) === text) continue;
      staged.push({ path: update.path, text, sha: `memory-${(await sha256Hex(text)).slice(0, 32)}` });
    }
    for (const entry of staged) mem.set(entry.path, { sha: entry.sha, text: entry.text });
    const commitSha = staged.length
      ? `memory-commit-${(await sha256Hex(staged.map((entry) => `${entry.path}:${entry.sha}`).join("|"))).slice(0, 24)}`
      : null;
    return {
      ok: true,
      idempotent: staged.length === 0,
      commit_sha: commitSha,
      changed_paths: staged.map((entry) => entry.path),
      attempts: 1,
      estimated_subrequests: 0,
    };
  }

  const retries = Math.max(1, Math.min(8, input.retries ?? 4));
  const { branch } = config(env);
  const base = apiBase(env);
  for (let attempt = 1; attempt <= retries; attempt++) {
    const refRead = await jsonRequest<any>(
      env,
      `${base}/git/ref/heads/${branchRefPath(branch)}`,
      { method: "GET", headers: headers(env), cache: "no-store" },
    );
    const headSha = String(refRead.body?.object?.sha ?? "");
    if (!/^[0-9a-f]{40}$/i.test(headSha)) {
      throw new GitHubDataStoreError("GITHUB_ATOMIC_HEAD_INVALID", "GitHub branch head SHA is invalid", undefined, { branch, body: refRead.body });
    }

    const commitRead = await jsonRequest<any>(
      env,
      `${base}/git/commits/${headSha}`,
      { method: "GET", headers: headers(env), cache: "no-store" },
    );
    const baseTreeSha = String(commitRead.body?.tree?.sha ?? "");
    if (!/^[0-9a-f]{40}$/i.test(baseTreeSha)) {
      throw new GitHubDataStoreError("GITHUB_ATOMIC_TREE_INVALID", "GitHub parent tree SHA is invalid", undefined, { head_sha: headSha });
    }

    const staged: Array<{ path: string; text: string }> = [];
    for (const update of updates) {
      const current = await readJsonAtRef<any>(env, update.path, headSha);
      const baseValue = current.exists && current.value !== null ? current.value : structuredClone(update.defaultValue);
      const next = await update.merge(baseValue);
      const text = stableJson(next);
      if (current.exists && current.value !== null && stableJson(current.value) === text) continue;
      staged.push({ path: update.path, text });
    }

    if (!staged.length) {
      return {
        ok: true,
        idempotent: true,
        commit_sha: headSha,
        changed_paths: [],
        attempts: attempt,
        estimated_subrequests: 2 + updates.length,
      };
    }

    const blobs = await Promise.all(staged.map(async (entry) => {
      const created = await jsonRequest<any>(env, `${base}/git/blobs`, {
        method: "POST",
        headers: { ...headers(env, true), "Content-Type": "application/json" },
        body: JSON.stringify({ content: entry.text, encoding: "utf-8" }),
      });
      const sha = String(created.body?.sha ?? "");
      if (!/^[0-9a-f]{40}$/i.test(sha)) {
        throw new GitHubDataStoreError("GITHUB_ATOMIC_BLOB_INVALID", "GitHub created blob SHA is invalid", undefined, { path: entry.path });
      }
      return { ...entry, sha };
    }));

    const treeWrite = await jsonRequest<any>(env, `${base}/git/trees`, {
      method: "POST",
      headers: { ...headers(env, true), "Content-Type": "application/json" },
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: blobs.map((entry) => ({ path: entry.path, mode: "100644", type: "blob", sha: entry.sha })),
      }),
    });
    const treeSha = String(treeWrite.body?.sha ?? "");
    if (!/^[0-9a-f]{40}$/i.test(treeSha)) {
      throw new GitHubDataStoreError("GITHUB_ATOMIC_TREE_CREATE_INVALID", "GitHub created tree SHA is invalid");
    }

    const commitWrite = await jsonRequest<any>(env, `${base}/git/commits`, {
      method: "POST",
      headers: { ...headers(env, true), "Content-Type": "application/json" },
      body: JSON.stringify({ message: input.message, tree: treeSha, parents: [headSha] }),
    });
    const newCommitSha = String(commitWrite.body?.sha ?? "");
    if (!/^[0-9a-f]{40}$/i.test(newCommitSha)) {
      throw new GitHubDataStoreError("GITHUB_ATOMIC_COMMIT_INVALID", "GitHub created commit SHA is invalid");
    }

    const refWrite = await jsonRequest<any>(
      env,
      `${base}/git/refs/heads/${branchRefPath(branch)}`,
      {
        method: "PATCH",
        headers: { ...headers(env, true), "Content-Type": "application/json" },
        body: JSON.stringify({ sha: newCommitSha, force: false }),
      },
      true,
    );
    if (refWrite.conflict) continue;

    return {
      ok: true,
      idempotent: false,
      commit_sha: newCommitSha,
      changed_paths: staged.map((entry) => entry.path),
      attempts: attempt,
      estimated_subrequests: estimateAtomicJsonTransactionSubrequests(updates.length),
    };
  }

  throw new GitHubDataStoreError(
    "GITHUB_ATOMIC_CAS_EXHAUSTED",
    "GitHub atomic multi-file CAS retries exhausted",
    409,
    { paths: updates.map((update) => update.path), retries },
  );
}
