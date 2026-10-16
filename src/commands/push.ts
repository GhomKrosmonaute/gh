import { parseArgs, stringFlag } from "../args.js";
import { forget } from "../cache.js";
import { passthrough } from "../exec.js";
import { ghToken } from "../gh.js";
import {
  defaultPushRemote,
  pushRepository,
  remotePushUrl,
  sessionGitConfig,
  withGitConfig,
} from "../git.js";
import { parseRepoUrl, repoName } from "../remote.js";
import { resolve } from "../resolve.js";
import { CliError, c, info } from "../ui.js";
import { ensureAccounts } from "./accounts.js";
import { printChecks } from "./check.js";

/** `git push` with the credentials of the account that has the highest permission on the target. */
export async function push(args: string[]): Promise<number> {
  // Only our own flags are taken out; every other argument goes to git push as given.
  const parsed = parseArgs(args, { as: { type: "string" }, refresh: { type: "boolean" } });
  const gitArgs = parsed.tail ? [...parsed.rest, "--", ...parsed.tail] : parsed.rest;
  const forced = stringFlag(parsed, "as");
  const config = await ensureAccounts();

  const target = pushRepository(gitArgs) ?? (await defaultPushRemote());
  const url = (await remotePushUrl(target)) ?? target;
  const ref = parseRepoUrl(url);
  if (!ref || (!forced && !config.accounts.some((a) => a.host === ref.host))) {
    info(`${url} is not a GitHub repository ghom-gh has accounts for: plain git push.`);
    return passthrough("git", ["push", ...gitArgs]);
  }

  let login: string;
  let reason: string;
  if (forced) {
    if (!(await ghToken(ref.host, forced))) {
      throw new CliError(`gh has no token for ${forced} on ${ref.host} (ghom-gh add ${forced}).`);
    }
    login = forced;
    reason = "--as";
  } else {
    const resolution = await resolve(ref, config.accounts, {
      refresh: parsed.flags.refresh === true,
      minimum: "write",
    });
    if (!resolution.best) {
      printChecks(resolution);
      throw new CliError(`None of the listed accounts can push to ${repoName(ref)}.`);
    }
    login = resolution.best.login;
    reason = resolution.best.level;
  }

  info(`Pushing to ${repoName(ref)} as ${c.bold(login)} ${c.dim(`(${reason})`)}`);
  const env = withGitConfig(
    { ...process.env, GHOM_GH_USER: login, GHOM_GH_HOST: ref.host },
    sessionGitConfig(ref.host),
  );
  const code = await passthrough("git", ["push", ...gitArgs], { env });
  // The cached permissions may be what made this push fail; the next attempt asks GitHub again.
  if (code !== 0 && !forced) await forget(ref).catch(() => {});
  return code;
}
