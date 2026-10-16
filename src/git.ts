import { realpathSync } from "node:fs";

import { type Captured, capture, isNotFound } from "./exec.js";
import { parseRepoUrl, type RepoRef } from "./remote.js";
import { CliError } from "./ui.js";

export async function git(args: string[]): Promise<Captured> {
  try {
    return await capture("git", args);
  } catch (error) {
    if (isNotFound(error)) throw new CliError("git is not installed or not in PATH.");
    throw error;
  }
}

export async function gitConfig(key: string, scope?: "global"): Promise<string | null> {
  const result = await git(["config", ...(scope ? [`--${scope}`] : []), "--get", key]);
  return result.code === 0 ? result.stdout.replace(/\n$/, "") : null;
}

/** Every value of a multi-valued key, empty strings included (an empty helper is a reset). */
export async function gitConfigAll(key: string, scope?: "global"): Promise<string[]> {
  const result = await git([
    "config",
    ...(scope ? [`--${scope}`] : []),
    "--null",
    "--get-all",
    key,
  ]);
  return result.code === 0 ? result.stdout.split("\0").slice(0, -1) : [];
}

export async function setGlobal(args: string[]): Promise<void> {
  const result = await git(["config", "--global", ...args]);
  // 5 means "nothing to unset", which is fine for --unset-all.
  if (result.code !== 0 && !(result.code === 5 && args[0] === "--unset-all")) {
    throw new CliError(`git config --global ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
}

async function currentBranch(): Promise<string | null> {
  const result = await git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return result.code === 0 ? result.stdout.trim() : null;
}

/** The remote a bare `git push` would use, following git's own precedence. */
export async function defaultPushRemote(): Promise<string> {
  const branch = await currentBranch();
  if (branch) {
    const pushRemote = await gitConfig(`branch.${branch}.pushRemote`);
    if (pushRemote) return pushRemote;
  }
  const pushDefault = await gitConfig("remote.pushDefault");
  if (pushDefault) return pushDefault;
  if (branch) {
    const remote = await gitConfig(`branch.${branch}.remote`);
    if (remote && remote !== ".") return remote;
  }
  return "origin";
}

/** The URL git pushes to for a remote name, with pushurl and insteadOf rules applied. */
export async function remotePushUrl(name: string): Promise<string | null> {
  const result = await git(["remote", "get-url", "--push", name]);
  return result.code === 0 ? result.stdout.trim() : null;
}

/** The GitHub repository the current clone pushes to. */
export async function currentRepo(): Promise<RepoRef> {
  if ((await git(["rev-parse", "--git-dir"])).code !== 0) {
    throw new CliError("Not inside a git repository: pass a repository (owner/repo or URL).");
  }
  let remote = await defaultPushRemote();
  let url = await remotePushUrl(remote);
  if (!url) {
    // No "origin": a clone with a single remote is still unambiguous.
    const remotes = (await git(["remote"])).stdout.split("\n").filter(Boolean);
    if (remotes.length !== 1 || !remotes[0]) {
      throw new CliError(
        remotes.length
          ? `No remote "${remote}" here: pass a repository (owner/repo or URL).`
          : "This repository has no remote: pass a repository (owner/repo or URL).",
      );
    }
    remote = remotes[0];
    url = await remotePushUrl(remote);
  }
  const ref = url ? parseRepoUrl(url) : null;
  if (!ref) throw new CliError(`Remote "${remote}" (${url}) is not a GitHub repository URL.`);
  return ref;
}

// `git push` options whose value is the next argument.
const PUSH_OPTIONS_WITH_VALUE = new Set([
  "--repo",
  "--receive-pack",
  "--exec",
  "-o",
  "--push-option",
]);

/** The <repository> a `git push` command line targets, if it names one. */
export function pushRepository(args: string[]): string | null {
  let repoOption: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--") return args[i + 1] ?? repoOption;
    if (arg === "--repo") repoOption = args[i + 1] ?? null;
    else if (arg.startsWith("--repo=")) repoOption = arg.slice("--repo=".length);
    if (PUSH_OPTIONS_WITH_VALUE.has(arg)) {
      i++;
      continue;
    }
    if (arg.startsWith("-")) continue;
    // A positional repository wins over --repo, as in git.
    return arg;
  }
  return repoOption;
}

/**
 * Config for one git invocation: git asks only ghom-gh for credentials on `host`, and SSH URLs of
 * that host go through HTTPS (over SSH, ssh-agent would pick the key, and so the account).
 */
export function sessionGitConfig(host: string): Array<[string, string]> {
  const helperKey = `credential.https://${host}.helper`;
  return [
    // An empty helper resets the list built from the config files, gh's and the OS keychain's.
    [helperKey, ""],
    [helperKey, helperCommand()],
    [`url.https://${host}/.insteadOf`, `git@${host}:`],
    [`url.https://${host}/.insteadOf`, `ssh://git@${host}/`],
  ];
}

/**
 * Adds config entries through GIT_CONFIG_COUNT, which every git process started with this
 * environment reads, including those started by another program (gh, a hook, a submodule).
 */
export function withGitConfig(
  env: NodeJS.ProcessEnv,
  entries: Array<[string, string]>,
): NodeJS.ProcessEnv {
  const result = { ...env };
  const offset = Number.parseInt(env.GIT_CONFIG_COUNT ?? "", 10) || 0;
  entries.forEach(([key, value], i) => {
    result[`GIT_CONFIG_KEY_${offset + i}`] = key;
    result[`GIT_CONFIG_VALUE_${offset + i}`] = value;
  });
  result.GIT_CONFIG_COUNT = String(offset + entries.length);
  return result;
}

export function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/** This very program, as an absolute path that works without PATH (git GUIs, nvm). */
export function selfScript(): string {
  const script = process.argv[1];
  if (!script) throw new CliError("Cannot tell where ghom-gh is installed.");
  return realpathSync(script);
}

/** The credential.helper value that makes git ask this program for credentials. */
export function helperCommand(): string {
  return `!${shellQuote(process.execPath)} ${shellQuote(selfScript())} credential`;
}

export function isOwnHelper(value: string): boolean {
  if (!/\scredential$/.test(value)) return false;
  return value.includes(selfScript()) || /ghom-gh|@ghom[\\/]gh/.test(value);
}
