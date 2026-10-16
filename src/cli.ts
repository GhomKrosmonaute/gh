#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { add, importAccounts, list, prefer, remove } from "./commands/accounts.js";
import { check } from "./commands/check.js";
import { credential } from "./commands/credential.js";
import { push } from "./commands/push.js";
import { run } from "./commands/run.js";
import { setup } from "./commands/setup.js";
import { CliError, c, fail } from "./ui.js";

const HELP = `${c.bold("ghom-gh")}: push to any GitHub repository as the right account, without gh auth switch.

${c.bold("Accounts")} ${c.dim("(tokens stay in gh's keyring; this list only sets which accounts and in what order)")}
  ghom-gh list                       The account list and the state of each gh token
  ghom-gh add [login]                Add an account, signing in through gh auth login if needed
                                     ${c.dim("--hostname <host> for GitHub Enterprise; gh login flags after --")}
  ghom-gh import                     Add every account gh is already signed in to
  ghom-gh remove <login>             Take an account off the list ${c.dim("(--logout also signs it out of gh)")}
  ghom-gh prefer <login>             Move an account first: it wins when permissions are equal

${c.bold("Repositories")}
  ghom-gh check [repo]               Every account's permission on a repository, and the one used
  ghom-gh push [git push args…]      git push as the account with the highest permission
                                     ${c.dim("--as <login> to force an account, --refresh to skip the cache")}
  ghom-gh run [options] -- <cmd…>    Run any command (gh, git…) as that account
                                     ${c.dim("--repo <owner/repo> when not in a clone, --as <login>")}

${c.bold("Plain git")}
  ghom-gh setup                      Make git push / pull / clone over HTTPS pick the account itself
  ghom-gh setup --uninstall          Give git its previous credential helper back

[repo] is owner/repo, host/owner/repo or a clone URL, and defaults to the current clone's remote.
Permissions are cached 10 minutes in the config folder; nothing there is secret.
`;

const commands: Record<string, (args: string[]) => Promise<number>> = {
  list,
  ls: list,
  add,
  import: importAccounts,
  remove,
  rm: remove,
  prefer,
  check,
  push,
  run,
  setup,
  credential,
};

function version(): string {
  const manifest = new URL("../package.json", import.meta.url);
  return (JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version;
}

async function main([name, ...args]: string[]): Promise<number> {
  if (!name || name === "help" || name === "--help" || name === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  if (name === "--version" || name === "-v") {
    process.stdout.write(`${version()}\n`);
    return 0;
  }
  const command = commands[name];
  if (!command) throw new CliError(`Unknown command "${name}". See ghom-gh --help.`);
  if (name !== "run" && (args[0] === "--help" || args[0] === "-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  return command(args);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof CliError) {
      fail(error.message);
      process.exitCode = error.exitCode;
    } else {
      fail(error instanceof Error ? (error.stack ?? error.message) : String(error));
      process.exitCode = 1;
    }
  },
);
