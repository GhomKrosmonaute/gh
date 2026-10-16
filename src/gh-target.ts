import { git, gitConfig } from "./git.js";
import { parseRepoSpec, parseRepoUrl, type RepoRef } from "./remote.js";

/** The -R / --repo value of a gh command line, if it has one. */
export function ghRepoFlag(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--") break;
    if (arg === "-R" || arg === "--repo") return args[i + 1] ?? null;
    if (arg.startsWith("--repo=")) return arg.slice("--repo=".length);
    if (arg.startsWith("-R") && arg.length > 2) return arg.slice(2);
  }
  return null;
}

export interface GhRemote {
  name: string;
  url: string;
  /** `remote.<name>.gh-resolved`, written by `gh repo set-default`. */
  resolved: string | null;
}

// gh prefers these remotes, in this order, over any other.
const PREFERRED = ["upstream", "github", "origin"];

/**
 * The repository gh treats as the base among a clone's remotes: the one `gh repo set-default`
 * picked, else upstream, github, origin, then the others in git's order. In a fork, that is the
 * parent once it is a remote, not the fork the branch is pushed to.
 */
export function pickGhBase(remotes: GhRemote[]): RepoRef | null {
  const parsed = remotes.flatMap((remote) => {
    const ref = parseRepoUrl(remote.url);
    return ref ? [{ ...remote, ref }] : [];
  });
  const chosen = parsed.find((remote) => remote.resolved);
  if (chosen) {
    // Older gh versions store the chosen OWNER/REPO instead of "base".
    if (chosen.resolved === "base") return chosen.ref;
    return parseRepoSpec(chosen.resolved ?? "", chosen.ref.host) ?? chosen.ref;
  }
  const rank = (name: string) => {
    const index = PREFERRED.indexOf(name.toLowerCase());
    return index === -1 ? PREFERRED.length : index;
  };
  return [...parsed].sort((a, b) => rank(a.name) - rank(b.name))[0]?.ref ?? null;
}

/** The repository a gh command acts on: -R, then GH_REPO, then the clone's base remote. */
export async function ghTargetRepo(args: string[]): Promise<RepoRef | null> {
  const defaultHost = process.env.GH_HOST || "github.com";
  const explicit = ghRepoFlag(args) ?? process.env.GH_REPO;
  if (explicit) return parseRepoSpec(explicit, defaultHost);

  const names = (await git(["remote"])).stdout.split("\n").filter(Boolean);
  const remotes = await Promise.all(
    names.map(async (name): Promise<GhRemote> => {
      const url = (await git(["remote", "get-url", name])).stdout.trim();
      return { name, url, resolved: await gitConfig(`remote.${name}.gh-resolved`) };
    }),
  );
  return pickGhBase(remotes);
}
