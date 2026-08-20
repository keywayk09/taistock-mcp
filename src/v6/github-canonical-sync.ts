import { readGitHubJson } from "./github-data-store.ts";

declare global {
  interface Env {
    GITHUB_DATA_TOKEN?: string;
    GITHUB_TOKEN?: string;
    GITHUB_DATA_REPO?: string;
    GITHUB_DATA_BRANCH?: string;
  }
}

const SOURCE_REPO = "keywayk09/taistock-mcp";
const SOURCE_BRANCH = "diamond-data";
const RECEIPT_PATH = "data/maintenance/diamond-canonical-sync.json";
const BATCH_SIZE = 10;
const ALLOWED_PREFIXES = ["data/market-data/", "data/intraday/"] as const;

export const CANONICAL_SYNC_VERSION = "diamond-canonical-sync/v1";

export type CanonicalSyncReceipt = {
  schema_version: "diamond-canonical-sync-receipt/v1";
  source_repo: string;
  source_branch: string;
  target_repo: string;
  target_branch: string;
  completed_source_commit: string | null;
  active_source_commit: string | null;
  active_base_commit: string | null;
  cursor: number;
  total: number;
  last_batch_paths: string[];
  completed_at: string | null;
  updated_at: string;
};

type SourceCandidate = { path: string; sha: string };

type GitHubApiError = Error & { status?: number; body?: unknown };

function targetConfig(env: Env) {
  return {
    repo: String(env.GITHUB_DATA_REPO || "keywayk09/tv-papertrader").trim(),
    branch: String(env.GITHUB_DATA_BRANCH || "main").trim(),
    token: String(env.GITHUB_DATA_TOKEN || env.GITHUB_TOKEN || "").trim(),
  };
}

function headers(env: Env, json = false): HeadersInit {
  const token = targetConfig(env).token;
  if (!token) throw new Error("GITHUB_DATA_TOKEN or GITHUB_TOKEN is required for canonical GitHub sync");
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "taistock-diamond-canonical-sync/1.0",
    Authorization: `Bearer ${token}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function api<T>(env: Env, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...headers(env, Boolean(init.body)), ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const body = await response.json<any>().catch(() => null);
  if (!response.ok) {
    const error = new Error(`GitHub API ${response.status}: ${url}`) as GitHubApiError;
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body as T;
}

async function apiAllow404<T>(env: Env, url: string): Promise<T | null> {
  const response = await fetch(url, { headers: headers(env), cache: "no-store" });
  if (response.status === 404) return null;
  const body = await response.json<any>().catch(() => null);
  if (!response.ok) {
    const error = new Error(`GitHub API ${response.status}: ${url}`) as GitHubApiError;
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body as T;
}

function approved(path: string) {
  return ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function mutablePath(path: string) {
  return path.startsWith("data/market-data/index/") || path.endsWith("/manifest.json") || path.startsWith("data/intraday/");
}

function pathPriority(path: string) {
  if (path.startsWith("data/market-data/daily/")) return 0;
  if (path.startsWith("data/market-data/raw/")) return 1;
  if (path.startsWith("data/market-data/index/")) return 2;
  if (path.startsWith("data/intraday/")) return 3;
  return 9;
}

function sortCandidates(items: SourceCandidate[]) {
  return items.sort((a, b) => pathPriority(a.path) - pathPriority(b.path) || a.path.localeCompare(b.path));
}

async function sourceHead(env: Env) {
  const ref = await api<any>(env, `https://api.github.com/repos/${SOURCE_REPO}/git/ref/heads/${SOURCE_BRANCH}`);
  return String(ref?.object?.sha ?? "");
}

async function fullSourceCandidates(env: Env, commitSha: string): Promise<SourceCandidate[]> {
  const commit = await api<any>(env, `https://api.github.com/repos/${SOURCE_REPO}/git/commits/${commitSha}`);
  const treeSha = String(commit?.tree?.sha ?? "");
  if (!treeSha) throw new Error(`source commit has no tree: ${commitSha}`);
  const tree = await api<any>(env, `https://api.github.com/repos/${SOURCE_REPO}/git/trees/${treeSha}?recursive=1`);
  if (tree?.truncated) throw new Error("source canonical tree was truncated");
  return sortCandidates((Array.isArray(tree?.tree) ? tree.tree : [])
    .filter((entry: any) => entry?.type === "blob" && approved(String(entry.path ?? "")))
    .map((entry: any) => ({ path: String(entry.path), sha: String(entry.sha) })));
}

async function changedSourceCandidates(env: Env, base: string, head: string): Promise<SourceCandidate[]> {
  const compare = await api<any>(env, `https://api.github.com/repos/${SOURCE_REPO}/compare/${base}...${head}?per_page=100`);
  const files = Array.isArray(compare?.files) ? compare.files : [];
  if (files.length >= 300) return fullSourceCandidates(env, head);
  return sortCandidates(files
    .filter((file: any) => file?.status !== "removed" && approved(String(file?.filename ?? "")) && file?.sha)
    .map((file: any) => ({ path: String(file.filename), sha: String(file.sha) })));
}

async function targetFileSha(env: Env, path: string) {
  const { repo, branch } = targetConfig(env);
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const found = await apiAllow404<any>(env, `https://api.github.com/repos/${repo}/contents/${encoded}?ref=${encodeURIComponent(branch)}`);
  if (!found) return null;
  if (Array.isArray(found) || typeof found?.sha !== "string") throw new Error(`target path is not a file: ${path}`);
  return String(found.sha);
}

async function copyBlob(env: Env, sourceSha: string) {
  const { repo } = targetConfig(env);
  const source = await api<any>(env, `https://api.github.com/repos/${SOURCE_REPO}/git/blobs/${sourceSha}`);
  const encoding = String(source?.encoding ?? "base64");
  const content = String(source?.content ?? "");
  if (!content) throw new Error(`source blob is empty/unreadable: ${sourceSha}`);
  const target = await api<any>(env, `https://api.github.com/repos/${repo}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content, encoding }),
  });
  const targetSha = String(target?.sha ?? "");
  if (!targetSha) throw new Error(`target blob creation failed for ${sourceSha}`);
  if (targetSha !== sourceSha) throw new Error(`blob SHA mismatch source=${sourceSha} target=${targetSha}`);
  return targetSha;
}

async function createTextBlob(env: Env, text: string) {
  const { repo } = targetConfig(env);
  const blob = await api<any>(env, `https://api.github.com/repos/${repo}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content: text, encoding: "utf-8" }),
  });
  return String(blob?.sha ?? "");
}

async function targetHeadAndTree(env: Env) {
  const { repo, branch } = targetConfig(env);
  const ref = await api<any>(env, `https://api.github.com/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  const head = String(ref?.object?.sha ?? "");
  if (!head) throw new Error("target branch head not found");
  const commit = await api<any>(env, `https://api.github.com/repos/${repo}/git/commits/${head}`);
  const tree = String(commit?.tree?.sha ?? "");
  if (!tree) throw new Error("target branch tree not found");
  return { head, tree };
}

function emptyReceipt(env: Env): CanonicalSyncReceipt {
  const { repo, branch } = targetConfig(env);
  return {
    schema_version: "diamond-canonical-sync-receipt/v1",
    source_repo: SOURCE_REPO,
    source_branch: SOURCE_BRANCH,
    target_repo: repo,
    target_branch: branch,
    completed_source_commit: null,
    active_source_commit: null,
    active_base_commit: null,
    cursor: 0,
    total: 0,
    last_batch_paths: [],
    completed_at: null,
    updated_at: new Date().toISOString(),
  };
}

export async function syncDiamondCanonicalBatch(env: Env) {
  const { repo, branch } = targetConfig(env);
  const read = await readGitHubJson<CanonicalSyncReceipt>(env, RECEIPT_PATH);
  let receipt = read.value ?? emptyReceipt(env);

  let active = receipt.active_source_commit;
  let base = receipt.active_base_commit;
  let cursor = Number(receipt.cursor || 0);

  if (!active) {
    const head = await sourceHead(env);
    if (!head) throw new Error("source branch head not found");
    if (head === receipt.completed_source_commit) {
      return {
        ok: true,
        version: CANONICAL_SYNC_VERSION,
        status: "CAUGHT_UP",
        source_commit: head,
        target_repo: repo,
        target_branch: branch,
      };
    }
    active = head;
    base = receipt.completed_source_commit;
    cursor = 0;
  }

  const candidates = base
    ? await changedSourceCandidates(env, base, active)
    : await fullSourceCandidates(env, active);

  const start = Math.max(0, Math.min(cursor, candidates.length));
  const end = Math.min(candidates.length, start + BATCH_SIZE);
  const slice = candidates.slice(start, end);
  const treeEntries: any[] = [];
  const copied: string[] = [];
  const alreadyCurrent: string[] = [];

  for (const candidate of slice) {
    const existingSha = await targetFileSha(env, candidate.path);
    if (existingSha === candidate.sha) {
      alreadyCurrent.push(candidate.path);
      continue;
    }
    if (existingSha && !mutablePath(candidate.path)) {
      throw new Error(`immutable target conflict: ${candidate.path} source=${candidate.sha} target=${existingSha}`);
    }
    const blobSha = await copyBlob(env, candidate.sha);
    treeEntries.push({ path: candidate.path, mode: "100644", type: "blob", sha: blobSha });
    copied.push(candidate.path);
  }

  const finished = end >= candidates.length;
  const now = new Date().toISOString();
  const nextReceipt: CanonicalSyncReceipt = {
    ...receipt,
    schema_version: "diamond-canonical-sync-receipt/v1",
    source_repo: SOURCE_REPO,
    source_branch: SOURCE_BRANCH,
    target_repo: repo,
    target_branch: branch,
    completed_source_commit: finished ? active : receipt.completed_source_commit,
    active_source_commit: finished ? null : active,
    active_base_commit: finished ? null : base,
    cursor: finished ? 0 : end,
    total: finished ? 0 : candidates.length,
    last_batch_paths: slice.map((item) => item.path),
    completed_at: finished ? now : receipt.completed_at,
    updated_at: now,
  };

  const receiptBlob = await createTextBlob(env, JSON.stringify(nextReceipt, null, 2) + "\n");
  treeEntries.push({ path: RECEIPT_PATH, mode: "100644", type: "blob", sha: receiptBlob });

  const target = await targetHeadAndTree(env);
  const tree = await api<any>(env, `https://api.github.com/repos/${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: target.tree, tree: treeEntries }),
  });
  const treeSha = String(tree?.sha ?? "");
  if (!treeSha) throw new Error("target tree creation failed");

  const commit = await api<any>(env, `https://api.github.com/repos/${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `data(diamond): sync canonical batch ${start}-${Math.max(start, end - 1)} from ${active.slice(0, 12)}`,
      tree: treeSha,
      parents: [target.head],
    }),
  });
  const commitSha = String(commit?.sha ?? "");
  if (!commitSha) throw new Error("target commit creation failed");

  const response = await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    headers: headers(env, true),
    body: JSON.stringify({ sha: commitSha, force: false }),
  });
  if (response.status === 409 || response.status === 422) {
    throw new Error(`canonical sync CAS race (${response.status}); next cron will re-read and re-merge`);
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`canonical sync ref update failed (${response.status}): ${body.slice(0, 300)}`);
  }

  return {
    ok: true,
    version: CANONICAL_SYNC_VERSION,
    status: finished ? "SOURCE_COMMIT_SYNCED" : "BATCH_SYNCED",
    source_commit: active,
    base_commit: base,
    target_repo: repo,
    target_branch: branch,
    cursor_before: start,
    cursor_after: finished ? 0 : end,
    total: candidates.length,
    copied,
    already_current: alreadyCurrent,
    target_commit: commitSha,
  };
}
