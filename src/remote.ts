export interface RepoRef {
  host: string;
  owner: string;
  repo: string;
}

const URL_SCHEMES = new Set(["https", "http", "ssh", "git", "git+ssh", "ssh+git"]);

/** gh and the API know github.com under one name, whatever alias the remote uses. */
export function normalizeHost(host: string): string {
  const bare = host.toLowerCase().replace(/:\d+$/, "");
  if (bare === "ssh.github.com" || bare === "www.github.com") return "github.com";
  return bare;
}

/**
 * Reads owner/repo out of any clone URL git accepts for GitHub:
 * https://[user@]host/owner/repo(.git), ssh://git@host[:port]/owner/repo(.git), git@host:owner/repo(.git).
 * Returns null for local paths and URLs that do not point at exactly one repository.
 */
export function parseRepoUrl(url: string): RepoRef | null {
  const trimmed = url.trim();
  let host: string | undefined;
  let path: string | undefined;

  const full = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(trimmed);
  if (full) {
    if (!URL_SCHEMES.has((full[1] ?? "").toLowerCase())) return null;
    host = full[2];
    path = full[3];
  } else {
    // scp-like syntax. A single letter before the colon is a Windows drive, not a host.
    const scp = /^(?:[^@/]+@)?([^/:]{2,}):(?!\/)(.+)$/.exec(trimmed);
    if (!scp) return null;
    host = scp[1];
    path = scp[2];
  }
  if (!host || !path) return null;
  return fromPath(normalizeHost(host), path);
}

/** Accepts `owner/repo`, `host/owner/repo` or any clone URL. */
export function parseRepoSpec(spec: string, defaultHost = "github.com"): RepoRef | null {
  const url = parseRepoUrl(spec);
  if (url) return url;
  const parts = spec.split("/");
  if (parts.length === 3 && parts[0]) {
    return fromPath(normalizeHost(parts[0]), parts.slice(1).join("/"));
  }
  return fromPath(normalizeHost(defaultHost), spec);
}

function fromPath(host: string, path: string): RepoRef | null {
  const parts = path
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .split("/");
  const [owner, repo] = parts;
  if (parts.length !== 2 || !owner || !repo) return null;
  return { host, owner, repo };
}

export function repoName(ref: RepoRef): string {
  return `${ref.host}/${ref.owner}/${ref.repo}`;
}

/** GitHub owner and repository names are case-insensitive. */
export function repoKey(ref: RepoRef): string {
  return repoName(ref).toLowerCase();
}
