import { parseArgs, stringFlag } from "../args.js";
import { isNotFound, passthrough } from "../exec.js";
import { ghToken } from "../gh.js";
import { currentRepo, sessionGitConfig, withGitConfig } from "../git.js";
import { parseRepoSpec, type RepoRef, repoName } from "../remote.js";
import { resolve } from "../resolve.js";
import { CliError, c, info } from "../ui.js";
import { ensureAccounts } from "./accounts.js";
import { printChecks } from "./check.js";

/** Runs any command (gh, git, a script…) as the best account for a repository. */
export async function run(args: string[]): Promise<number> {
  const parsed = parseArgs(
    args,
    { as: { type: "string" }, repo: { type: "string" }, refresh: { type: "boolean" } },
    { strict: true, stopAtPositional: true },
  );
  const command = parsed.tail ?? parsed.rest;
  const [program, ...programArgs] = command;
  if (!program) {
    throw new CliError("Usage: ghom-gh run [--as <login>] [--repo <owner/repo>] -- <command…>");
  }
  const config = await ensureAccounts();
  const repoSpec = stringFlag(parsed, "repo");
  const forced = stringFlag(parsed, "as");

  let ref: RepoRef | null = null;
  if (repoSpec) {
    ref = parseRepoSpec(repoSpec);
    if (!ref) throw new CliError(`"${repoSpec}" is neither owner/repo nor a clone URL.`);
  } else {
    ref = await currentRepo().catch((error: unknown) => {
      if (forced) return null;
      throw error;
    });
  }

  let host: string;
  let login: string;
  let reason: string;
  if (forced) {
    host = ref?.host ?? config.accounts.find((a) => a.login === forced)?.host ?? "github.com";
    login = forced;
    reason = "--as";
  } else if (ref) {
    const resolution = await resolve(ref, config.accounts, {
      refresh: parsed.flags.refresh === true,
    });
    if (!resolution.best) {
      printChecks(resolution);
      throw new CliError(`None of the listed accounts can see ${repoName(ref)}.`);
    }
    host = ref.host;
    login = resolution.best.login;
    reason = resolution.best.level;
  } else {
    throw new CliError("No repository to pick an account for: pass --repo or --as.");
  }

  const token = await ghToken(host, login);
  if (!token) throw new CliError(`gh has no token for ${login} on ${host} (ghom-gh add ${login}).`);

  info(`Running as ${c.bold(login)} ${c.dim(`(${reason}${ref ? ` on ${repoName(ref)}` : ""})`)}`);
  // gh reads its token from the environment; git reaches it through the credential helper.
  const tokenEnv =
    host === "github.com" ? { GH_TOKEN: token } : { GH_ENTERPRISE_TOKEN: token, GH_HOST: host };
  const env = withGitConfig(
    { ...process.env, ...tokenEnv, GHOM_GH_USER: login, GHOM_GH_HOST: host },
    sessionGitConfig(host),
  );
  try {
    return await passthrough(program, programArgs, { env });
  } catch (error) {
    if (isNotFound(error)) throw new CliError(`Command not found: ${program}`, 127);
    throw error;
  }
}
