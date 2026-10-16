import { loadConfig } from "../config.js";
import { ghToken } from "../gh.js";
import { currentRepo, gitConfig, setLocal } from "../git.js";
import { accountIdentity, type Identity } from "../identity.js";
import type { Level } from "../permission.js";
import { repoName } from "../remote.js";
import { resolve } from "../resolve.js";
import { CliError, c, info } from "../ui.js";

/** Marks the repository's user.name / user.email as written by ghom-gh, so it may update them. */
const MARKER = "ghom-gh.account";

type Outcome =
  | { status: "set" | "unchanged"; identity: Identity; level: Level; repo: string }
  | { status: "kept"; email: string }
  | { status: "skipped"; reason: string };

/**
 * Makes the current repository commit as the account with the highest permission on it. A
 * user.email the user set in the repository themselves is left alone.
 */
async function syncIdentity(): Promise<Outcome> {
  if ((await gitConfig("ghom-gh.identity")) === "false") {
    return { status: "skipped", reason: "turned off (git config ghom-gh.identity false)" };
  }
  const ref = await currentRepo().catch(() => null);
  if (!ref) return { status: "skipped", reason: "no GitHub remote here" };
  const { config } = await loadConfig();
  const accounts = config.accounts.filter((account) => account.host === ref.host);
  if (!accounts.length) return { status: "skipped", reason: `no listed account on ${ref.host}` };

  const { best } = await resolve(ref, accounts);
  if (!best) return { status: "skipped", reason: `no listed account can see ${repoName(ref)}` };
  const token = await ghToken(best.host, best.login);
  const identity = token && (await accountIdentity(best.host, best.login, token));
  if (!identity) return { status: "skipped", reason: `could not read ${best.login}'s profile` };

  const email = await gitConfig("user.email", "local");
  const marker = await gitConfig(MARKER, "local");
  if (email && !marker) return { status: "kept", email };
  const name = await gitConfig("user.name", "local");
  const repo = repoName(ref);
  if (email === identity.email && name === identity.name) {
    return { status: "unchanged", identity, level: best.level, repo };
  }
  await setLocal("user.name", identity.name);
  await setLocal("user.email", identity.email);
  await setLocal(MARKER, `${best.host}/${best.login}`);
  return { status: "set", identity, level: best.level, repo };
}

const describe = (identity: Identity) => `${identity.name} <${identity.email}>`;

/** Hooks must never break git: anything unexpected lets the commit or checkout go on. */
async function hook(event: string, args: string[]): Promise<number> {
  try {
    if (event === "post-checkout") {
      // Only right after a clone, where the previous HEAD is the null commit.
      if (!/^0+$/.test(args[0] ?? "")) return 0;
      const outcome = await syncIdentity();
      if (outcome.status === "set") {
        process.stderr.write(
          `ghom-gh: commits here are authored as ${describe(outcome.identity)} (${outcome.identity.login}, ${outcome.level})\n`,
        );
      }
      return 0;
    }
    if (event === "pre-commit") {
      // Already set up: no API call on every commit.
      if (await gitConfig(MARKER, "local")) return 0;
      const outcome = await syncIdentity();
      if (outcome.status !== "set") return 0;
      // git read the author before this hook ran, so this commit would still go out under the old
      // name: stop it once, the next attempt uses the new identity.
      process.stderr.write(
        `ghom-gh: this repository now commits as ${describe(outcome.identity)} ` +
          `(${outcome.identity.login}, ${outcome.level} on ${outcome.repo}).\n` +
          "ghom-gh: nothing was committed; run the same git commit again.\n",
      );
      return 1;
    }
  } catch {
    // fall through
  }
  return 0;
}

export async function identity(args: string[]): Promise<number> {
  const [event, ...rest] = args;
  if (event === "pre-commit" || event === "post-checkout") return hook(event, rest);
  if (event) throw new CliError("Usage: ghom-gh identity");

  const outcome = await syncIdentity();
  switch (outcome.status) {
    case "set":
      info(`Commits in ${outcome.repo} are now authored as ${c.bold(describe(outcome.identity))}`);
      return 0;
    case "unchanged":
      info(`Commits in ${outcome.repo} are authored as ${c.bold(describe(outcome.identity))}`);
      return 0;
    case "kept":
      info(
        `This repository sets its own user.email (${outcome.email}); ghom-gh leaves it.\n` +
          "  git config --unset user.email lets ghom-gh pick the account's identity.",
      );
      return 0;
    case "skipped":
      throw new CliError(`No identity to set: ${outcome.reason}.`);
  }
}
