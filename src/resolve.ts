import { readCached, writeCached } from "./cache.js";
import type { Account } from "./config.js";
import { ghToken } from "./gh.js";
import { fetchRepoAccess } from "./github.js";
import { type AccountCheck, type Level, pickBest } from "./permission.js";
import type { RepoRef } from "./remote.js";

export interface Resolution {
  ref: RepoRef;
  /** One entry per account on the repository's host, in priority order. */
  checks: AccountCheck[];
  best: AccountCheck | null;
  /** Set when the checks come from the cache. */
  checkedAt?: number;
}

/** Asks GitHub, with every account of the repository's host, what each one may do there. */
export async function resolve(
  ref: RepoRef,
  accounts: Account[],
  options: { refresh?: boolean; minimum?: Level } = {},
): Promise<Resolution> {
  const candidates = accounts.filter((account) => account.host === ref.host);
  const minimum = options.minimum ?? "read";

  if (!options.refresh) {
    const cached = await readCached(ref, candidates);
    if (cached) {
      const checks = cached.checks.map((check) => ({ host: ref.host, ...check }));
      return { ref, checks, best: pickBest(checks, minimum), checkedAt: cached.checkedAt };
    }
  }

  let transient = false;
  const checks = await Promise.all(
    candidates.map(async (account): Promise<AccountCheck> => {
      const token = await ghToken(account.host, account.login);
      if (!token) {
        transient = true;
        return { ...account, level: "none", note: "not signed in to gh" };
      }
      const access = await fetchRepoAccess(ref, token);
      if (access.transient) transient = true;
      return { ...account, level: access.level, ...(access.note ? { note: access.note } : {}) };
    }),
  );
  if (!transient && checks.length > 0) {
    // A cache we cannot write only costs speed.
    await writeCached(ref, checks).catch(() => {});
  }
  return { ref, checks, best: pickBest(checks, minimum) };
}
