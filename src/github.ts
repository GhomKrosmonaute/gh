import { type Level, levelFromPermissions, type RepoPermissions } from "./permission.js";
import type { RepoRef } from "./remote.js";

export function apiBase(host: string): string {
  if (host === "github.com") return "https://api.github.com";
  if (host.endsWith(".ghe.com")) return `https://api.${host}`;
  return `https://${host}/api/v3`;
}

export interface RepoAccess {
  level: Level;
  note?: string;
  /** The answer may change on retry (network, rate limit), so it must not be cached. */
  transient?: boolean;
}

/** What one token is allowed to do on a repository. */
export async function fetchRepoAccess(ref: RepoRef, token: string): Promise<RepoAccess> {
  const url = `${apiBase(ref.host)}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ghom-gh",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return { level: "none", note: `network error: ${(error as Error).message}`, transient: true };
  }

  if (response.ok) {
    const body = (await response.json()) as { permissions?: RepoPermissions };
    return { level: levelFromPermissions(body.permissions) };
  }
  // GitHub answers 404 rather than 403 for private repositories the token cannot see.
  if (response.status === 404) return { level: "none", note: "no access" };
  if (response.status === 401) return { level: "none", note: "token rejected", transient: true };
  if (response.status === 403 || response.status === 429) {
    const sso = response.headers.get("x-github-sso");
    if (sso) {
      const link = /url=(\S+)/.exec(sso)?.[1];
      return { level: "none", note: `SSO authorization required${link ? `: ${link}` : ""}` };
    }
    if (response.headers.get("x-ratelimit-remaining") === "0" || response.status === 429) {
      return { level: "none", note: "API rate limit reached", transient: true };
    }
    return { level: "none", note: "forbidden" };
  }
  return { level: "none", note: `HTTP ${response.status}`, transient: true };
}
