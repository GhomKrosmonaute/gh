import { parseArgs } from "../args.js";
import { type Config, loadConfig, saveConfig } from "../config.js";
import {
  gitConfig,
  gitConfigAll,
  helperCommand,
  hookCommand,
  isOwnHelper,
  selfScript,
  setGlobal,
} from "../git.js";
import { CliError, c, info, print, warn } from "../ui.js";

const helperKey = (host: string) => `credential.https://${host}.helper`;
const pathKey = (host: string) => `credential.https://${host}.useHttpPath`;

// Config-based hooks (git 2.54+) run next to each repository's own hooks; older git ignores them.
const HOOKS = {
  "ghom-gh-identity-clone": "post-checkout",
  "ghom-gh-identity-commit": "pre-commit",
};

async function installHooks(): Promise<void> {
  for (const [name, event] of Object.entries(HOOKS)) {
    await setAll(`hook.${name}.event`, [event]);
    await setAll(`hook.${name}.command`, [hookCommand(event)]);
  }
}

async function uninstallHooks(): Promise<boolean> {
  let removed = false;
  for (const name of Object.keys(HOOKS)) {
    if (await gitConfig(`hook.${name}.command`, "global")) removed = true;
    await setGlobal(["--unset-all", `hook.${name}.event`]);
    await setGlobal(["--unset-all", `hook.${name}.command`]);
  }
  return removed;
}

export async function integrationStatus(hosts: string[]): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    hosts.map(async (host) => {
      const helpers = await gitConfigAll(helperKey(host), "global");
      return [host, helpers.some(isOwnHelper)] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * Points the global git config of `host` at ghom-gh. The first backup is kept across re-runs so
 * `--uninstall` restores what the user had before ghom-gh, not a previous ghom-gh path.
 */
async function install(config: Config, host: string): Promise<void> {
  const current = await gitConfigAll(helperKey(host), "global");
  const useHttpPath = await gitConfig(pathKey(host), "global");
  if (!config.setup?.[host]) {
    const helpers = current.filter((helper) => !isOwnHelper(helper));
    config.setup = { ...config.setup, [host]: { helpers, useHttpPath } };
  }
  // The empty value drops helpers configured elsewhere (OS keychain) for this host.
  const wanted = ["", helperCommand()];
  if (current.join("\n") !== wanted.join("\n")) await setAll(helperKey(host), wanted);
  // Without it git does not tell the helper which repository it wants credentials for.
  if (useHttpPath !== "true") await setGlobal([pathKey(host), "true"]);
}

/**
 * Replaces every value of a key. --replace-all keeps the key where it was in the file: removing
 * it first would drop the section and re-create it at the end, after helpers it used to precede.
 */
async function setAll(key: string, values: string[]): Promise<void> {
  const [first, ...others] = values;
  if (first === undefined) return setGlobal(["--unset-all", key]);
  await setGlobal(["--replace-all", key, first]);
  for (const value of others) await setGlobal(["--add", key, value]);
}

export async function reinstallHelpers(config: Config): Promise<void> {
  for (const host of new Set([
    ...Object.keys(config.setup ?? {}),
    ...config.accounts.map((a) => a.host),
  ])) {
    await install(config, host);
  }
  if (config.setup) await installHooks();
}

export async function setup(args: string[]): Promise<number> {
  const parsed = parseArgs(args, { uninstall: { type: "boolean" } }, { strict: true });
  const { config } = await loadConfig();
  if (parsed.flags.uninstall) return uninstall(config);

  const hosts = [...new Set(config.accounts.map((a) => a.host))];
  if (!hosts.length) throw new CliError("Add accounts first (ghom-gh import or ghom-gh add).");
  if (/[\\/](_npx|\.bun[\\/]install[\\/]cache|\.cache[\\/]bunx?)[\\/]/.test(selfScript())) {
    throw new CliError(
      "ghom-gh is running from a temporary npx/bunx cache that git cannot rely on: " +
        "install it first (npm install -g @ghom/gh), then run ghom-gh setup.",
    );
  }

  for (const host of hosts) await install(config, host);
  await installHooks();
  await saveConfig(config);

  info(`git now asks ghom-gh for HTTPS credentials on ${hosts.map(c.bold).join(", ")}.`);
  print(
    "  Plain git push / pull / clone use the account with the highest permission on each repo.",
  );
  print(
    "  Commits are authored as that account (its GitHub name and noreply address), set per repo\n" +
      "  on clone or on the first commit; git config ghom-gh.identity false turns it off.",
  );
  print(
    c.dim(
      "  SSH remotes (git@github.com:…) still use your SSH key: use ghom-gh push there, or switch\n" +
        "  them to HTTPS. Undo everything with ghom-gh setup --uninstall.",
    ),
  );
  return 0;
}

async function uninstall(config: Config): Promise<number> {
  const hosts = new Set([
    ...Object.keys(config.setup ?? {}),
    ...config.accounts.map((a) => a.host),
  ]);
  let restored = 0;
  for (const host of hosts) {
    const current = await gitConfigAll(helperKey(host), "global");
    if (!current.some(isOwnHelper)) continue;
    const backup = config.setup?.[host];
    await setAll(helperKey(host), backup?.helpers ?? []);
    if (backup?.useHttpPath != null) await setGlobal([pathKey(host), backup.useHttpPath]);
    else await setGlobal(["--unset-all", pathKey(host)]);
    restored++;
    if (backup?.helpers.length) info(`Restored the previous git credential helper for ${host}.`);
    else {
      warn(
        `${host} has no credential helper any more; gh auth setup-git --hostname ${host} brings back gh's.`,
      );
    }
  }
  if (await uninstallHooks()) {
    restored++;
    info("Removed the commit identity hooks (repositories keep the identity already set).");
  }
  delete config.setup;
  await saveConfig(config);
  if (!restored) info("git was not using ghom-gh; nothing to undo.");
  return 0;
}
