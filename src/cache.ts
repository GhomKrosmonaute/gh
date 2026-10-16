import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { type Account, configDir, writeJson } from "./config.js";
import { isLevel, type Level } from "./permission.js";
import { type RepoRef, repoKey } from "./remote.js";

/**
 * Permission checks per repository, so that git calling the credential helper several times in a
 * row does not query the API for every account each time. Holds logins and levels, never tokens.
 */
export interface CachedCheck {
  login: string;
  level: Level;
  note?: string;
}

interface Entry {
  checkedAt: number;
  checks: CachedCheck[];
}

type Cache = Record<string, Entry>;

export const CACHE_TTL_MS = 10 * 60 * 1000;

const cacheFile = () => join(configDir(), "cache.json");

async function load(): Promise<Cache> {
  try {
    const data = JSON.parse(await readFile(cacheFile(), "utf8")) as unknown;
    return data && typeof data === "object" ? (data as Cache) : {};
  } catch {
    return {};
  }
}

export async function readCached(
  ref: RepoRef,
  accounts: Account[],
  now = Date.now(),
): Promise<{ checks: CachedCheck[]; checkedAt: number } | null> {
  const entry = (await load())[repoKey(ref)];
  if (!entry || !Array.isArray(entry.checks) || now - entry.checkedAt > CACHE_TTL_MS) return null;
  // The entry must cover exactly today's accounts: an account added since then could be the best.
  if (entry.checks.length !== accounts.length) return null;
  const checks: CachedCheck[] = [];
  for (const account of accounts) {
    const check = entry.checks.find((c) => c.login.toLowerCase() === account.login.toLowerCase());
    if (!check || !isLevel(check.level)) return null;
    checks.push(check);
  }
  return { checks, checkedAt: entry.checkedAt };
}

export async function writeCached(
  ref: RepoRef,
  checks: CachedCheck[],
  now = Date.now(),
): Promise<void> {
  const cache = await load();
  for (const [key, entry] of Object.entries(cache)) {
    if (now - entry.checkedAt > CACHE_TTL_MS) delete cache[key];
  }
  cache[repoKey(ref)] = {
    checkedAt: now,
    checks: checks.map(({ login, level, note }) =>
      note ? { login, level, note } : { login, level },
    ),
  };
  await writeJson(cacheFile(), cache);
}

export async function forget(ref: RepoRef): Promise<void> {
  const cache = await load();
  if (!(repoKey(ref) in cache)) return;
  delete cache[repoKey(ref)];
  await writeJson(cacheFile(), cache);
}
