import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { configDir, writeJson } from "./config.js";
import { apiBase } from "./github.js";

/** Who commits are attributed to: the account's profile name and its GitHub noreply address. */
export interface Identity {
  login: string;
  name: string;
  email: string;
}

interface Entry extends Identity {
  checkedAt: number;
}

export const IDENTITY_TTL_MS = 24 * 60 * 60 * 1000;

const identitiesFile = () => join(configDir(), "identities.json");

/** GitHub links this address to the account without exposing a real mailbox. */
export function noreplyEmail(host: string, id: number, login: string): string {
  return `${id}+${login}@users.noreply.${host}`;
}

async function load(): Promise<Record<string, Entry>> {
  try {
    const data = JSON.parse(await readFile(identitiesFile(), "utf8")) as unknown;
    return data && typeof data === "object" ? (data as Record<string, Entry>) : {};
  } catch {
    return {};
  }
}

/** The identity of an account, cached a day since profiles rarely change. Holds no token. */
export async function accountIdentity(
  host: string,
  login: string,
  token: string,
  now = Date.now(),
): Promise<Identity | null> {
  const key = `${host}/${login}`.toLowerCase();
  const cache = await load();
  const cached = cache[key];
  if (cached && now - cached.checkedAt <= IDENTITY_TTL_MS) {
    return { login: cached.login, name: cached.name, email: cached.email };
  }

  let response: Response;
  try {
    response = await fetch(`${apiBase(host)}/user`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ghom-gh",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const user = (await response.json()) as { id?: number; login?: string; name?: string | null };
  if (typeof user.id !== "number" || !user.login) return null;

  const identity = {
    login: user.login,
    name: user.name?.trim() || user.login,
    email: noreplyEmail(host, user.id, user.login),
  };
  cache[key] = { ...identity, checkedAt: now };
  // A cache we cannot write only costs speed.
  await writeJson(identitiesFile(), cache).catch(() => {});
  return identity;
}
