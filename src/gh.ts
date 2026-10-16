import type { Account } from "./config.js";
import { type Captured, capture, isNotFound, passthrough } from "./exec.js";
import { CliError } from "./ui.js";

export interface GhAccount extends Account {
  active: boolean;
  /** "success" when gh could use the token; anything else means gh had trouble with it. */
  state: string;
}

// A token in the environment makes gh ignore its keyring. `ghom-gh run` sets GH_TOKEN for the
// command it runs, so nested calls (git -> credential helper -> gh) must not inherit it.
const TOKEN_VARIABLES = [
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
];

function ghEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of TOKEN_VARIABLES) delete env[name];
  return env;
}

const NOT_INSTALLED = "The GitHub CLI (gh) is not installed or not in PATH: https://cli.github.com";

async function gh(args: string[]): Promise<Captured> {
  try {
    return await capture("gh", args, { env: ghEnv() });
  } catch (error) {
    if (isNotFound(error)) throw new CliError(NOT_INSTALLED);
    throw error;
  }
}

export async function listGhAccounts(): Promise<GhAccount[]> {
  const result = await gh(["auth", "status", "--json", "hosts"]);
  if (!result.stdout.trimStart().startsWith("{")) {
    if (/unknown flag/i.test(result.stderr)) {
      throw new CliError("This gh is too old for `gh auth status --json`; please upgrade gh.");
    }
    throw new CliError(`gh auth status failed: ${result.stderr.trim()}`);
  }
  const data = JSON.parse(result.stdout) as {
    hosts?: Record<string, Array<Partial<GhAccount>>>;
  };
  return Object.entries(data.hosts ?? {})
    .flatMap(([host, accounts]) =>
      accounts.map((account) => ({
        host: (account.host ?? host).toLowerCase(),
        login: account.login ?? "",
        active: account.active === true,
        state: account.state ?? "unknown",
      })),
    )
    .filter((account) => account.login);
}

/** The account's token from gh's store, without touching which account is active in gh. */
export async function ghToken(host: string, login: string): Promise<string | null> {
  const result = await gh(["auth", "token", "--hostname", host, "--user", login]);
  const token = result.stdout.trim();
  return result.code === 0 && token ? token : null;
}

/** Interactive `gh auth login`; gh makes the new account the active one. */
export async function ghLogin(host: string, extraArgs: string[]): Promise<number> {
  try {
    return await passthrough("gh", ["auth", "login", "--hostname", host, ...extraArgs], {
      env: ghEnv(),
    });
  } catch (error) {
    if (isNotFound(error)) throw new CliError(NOT_INSTALLED);
    throw error;
  }
}

export async function ghSwitch(host: string, login: string): Promise<boolean> {
  return (await gh(["auth", "switch", "--hostname", host, "--user", login])).code === 0;
}

export async function ghLogout(host: string, login: string): Promise<boolean> {
  return (await gh(["auth", "logout", "--hostname", host, "--user", login])).code === 0;
}
