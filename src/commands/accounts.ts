import { parseArgs, stringFlag } from "../args.js";
import {
  type Account,
  type Config,
  configFile,
  findAccount,
  loadConfig,
  sameAccount,
  saveConfig,
} from "../config.js";
import { ghLogin, ghLogout, ghSwitch, listGhAccounts } from "../gh.js";
import { normalizeHost } from "../remote.js";
import { CliError, c, info, print, table, warn } from "../ui.js";
import { integrationStatus, reinstallHelpers } from "./setup.js";

/**
 * The account list, created on first use from every account gh is signed in to, so that the tool
 * works out of the box; afterwards the list is only changed on purpose.
 */
export async function ensureAccounts(): Promise<Config> {
  const { config, exists } = await loadConfig();
  if (exists) {
    if (!config.accounts.length) {
      throw new CliError("The account list is empty: add one with ghom-gh add or ghom-gh import.");
    }
    return config;
  }
  config.accounts = (await listGhAccounts()).map(({ host, login }) => ({ host, login }));
  if (!config.accounts.length) {
    throw new CliError("gh is not signed in to any account yet: run ghom-gh add.");
  }
  await saveConfig(config);
  info(
    `First run: imported ${config.accounts.map((a) => c.bold(a.login)).join(", ")} from gh ` +
      `(manage the list with ghom-gh add / remove / prefer).`,
  );
  return config;
}

export async function list(args: string[]): Promise<number> {
  const parsed = parseArgs(args, { json: { type: "boolean" } }, { strict: true });
  const [{ config, exists }, ghAccounts] = await Promise.all([loadConfig(), listGhAccounts()]);

  const rows = config.accounts.map((account, index) => {
    const gh = ghAccounts.find((g) => sameAccount(g, account));
    return {
      priority: index + 1,
      host: account.host,
      login: account.login,
      gh: gh ? (gh.state === "success" ? "ready" : gh.state) : "signed-out",
      ghActive: gh?.active ?? false,
    };
  });
  const unlisted = ghAccounts.filter((g) => !config.accounts.some((a) => sameAccount(a, g)));
  const hosts = [...new Set(config.accounts.map((a) => a.host))];
  const integration = await integrationStatus(hosts);

  if (parsed.flags.json) {
    print(
      JSON.stringify(
        {
          accounts: rows,
          unlisted: unlisted.map(({ host, login }) => ({ host, login })),
          integration,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (!exists) {
    info(
      "No account list yet: ghom-gh import copies every account gh is signed in to, ghom-gh add adds one.",
    );
  } else if (!rows.length) {
    info("The account list is empty: ghom-gh add or ghom-gh import.");
  } else {
    print(
      table([
        ["#", "account", "host", "gh"].map(c.dim),
        ...rows.map((row) => [
          String(row.priority),
          c.bold(row.login),
          row.host,
          row.gh === "ready"
            ? c.green("ready") + (row.ghActive ? c.dim(" (active in gh)") : "")
            : row.gh === "signed-out"
              ? c.red(`not signed in to gh: ghom-gh add ${row.login}`)
              : c.yellow(`${row.gh}: ghom-gh add ${row.login} to sign in again`),
        ]),
      ]),
    );
    print();
    print(c.dim("  The first account wins when several share the highest permission."));
  }
  if (unlisted.length) {
    info(
      `Signed in to gh but not listed: ${unlisted.map((a) => a.login).join(", ")} (ghom-gh import)`,
    );
  }
  if (hosts.length) {
    const enabled = hosts.filter((host) => integration[host]);
    print(
      c.dim(
        enabled.length
          ? `  Plain git push/pull uses the best account on ${enabled.join(", ")}.`
          : "  Plain git commands are not routed through ghom-gh (ghom-gh setup to enable).",
      ),
    );
  }
  print(c.dim(`  ${configFile()}`));
  return 0;
}

export async function importAccounts(args: string[]): Promise<number> {
  parseArgs(args, {}, { strict: true });
  const { config } = await loadConfig();
  const added: Account[] = [];
  for (const { host, login } of await listGhAccounts()) {
    if (config.accounts.some((a) => sameAccount(a, { host, login }))) continue;
    config.accounts.push({ host, login });
    added.push({ host, login });
  }
  await saveConfig(config);
  if (added.length) info(`Added ${added.map((a) => c.bold(a.login)).join(", ")}.`);
  else info("Every account gh is signed in to is already listed.");
  return 0;
}

export async function add(args: string[]): Promise<number> {
  const parsed = parseArgs(args, { hostname: { type: "string" } }, { strict: true });
  if (parsed.rest.length > 1) throw new CliError("Usage: ghom-gh add [login] [--hostname <host>]");
  const host = normalizeHost(stringFlag(parsed, "hostname") ?? "github.com");
  const wanted = parsed.rest[0];
  const { config } = await loadConfig();

  const before = await listGhAccounts();
  let account: Account | undefined = wanted
    ? before.find((g) => sameAccount(g, { host, login: wanted }) && g.state === "success")
    : undefined;

  if (!account) {
    const previous = before.find((g) => g.host === host && g.active);
    info(
      wanted
        ? `Sign in as ${c.bold(wanted)} in the gh prompts below.`
        : "Sign in with the account to add in the gh prompts below.",
    );
    const code = await ghLogin(host, parsed.tail ?? []);
    if (code !== 0) throw new CliError("gh auth login did not complete.", code);

    const signedIn = (await listGhAccounts()).find((g) => g.host === host && g.active);
    if (!signedIn) throw new CliError(`gh auth login ended without an active account on ${host}.`);
    account = { host, login: signedIn.login };
    // gh activates the account it just signed in; adding one must not change which one gh uses.
    if (previous && !sameAccount(previous, account) && (await ghSwitch(host, previous.login))) {
      info(`${previous.login} stays the active account in gh.`);
    }
    if (wanted && !sameAccount(account, { host, login: wanted })) {
      warn(`You signed in as ${account.login}, not ${wanted}: adding ${account.login}.`);
    }
  }

  const index = findAccount(config.accounts, account.login, host);
  if (index >= 0) {
    info(`${c.bold(account.login)} is already in the list (#${index + 1}).`);
  } else {
    config.accounts.push({ host, login: account.login });
    info(`Added ${c.bold(account.login)} (#${config.accounts.length}) on ${host}.`);
  }
  // `gh auth login` may have offered to configure git; keep git pointed at ghom-gh if it was.
  if (config.setup) await reinstallHelpers(config);
  await saveConfig(config);
  return 0;
}

export async function remove(args: string[]): Promise<number> {
  const parsed = parseArgs(
    args,
    { hostname: { type: "string" }, logout: { type: "boolean" } },
    { strict: true },
  );
  const login = parsed.rest[0];
  if (!login || parsed.rest.length > 1) {
    throw new CliError("Usage: ghom-gh remove <login> [--hostname <host>] [--logout]");
  }
  const hostname = stringFlag(parsed, "hostname");
  const { config } = await loadConfig();
  const index = findAccount(config.accounts, login, hostname && normalizeHost(hostname));
  const account = config.accounts[index];
  if (!account) throw new CliError(`${login} is not in the account list.`);

  config.accounts.splice(index, 1);
  await saveConfig(config);
  info(`Removed ${c.bold(account.login)} from the list.`);
  if (parsed.flags.logout) {
    if (await ghLogout(account.host, account.login)) info(`Signed ${account.login} out of gh.`);
    else warn(`gh could not sign ${account.login} out.`);
  }
  return 0;
}

export async function prefer(args: string[]): Promise<number> {
  const parsed = parseArgs(args, { hostname: { type: "string" } }, { strict: true });
  const login = parsed.rest[0];
  if (!login || parsed.rest.length > 1) {
    throw new CliError("Usage: ghom-gh prefer <login> [--hostname <host>]");
  }
  const hostname = stringFlag(parsed, "hostname");
  const { config } = await loadConfig();
  const index = findAccount(config.accounts, login, hostname && normalizeHost(hostname));
  const [account] = index >= 0 ? config.accounts.splice(index, 1) : [];
  if (!account) throw new CliError(`${login} is not in the account list.`);

  config.accounts.unshift(account);
  await saveConfig(config);
  info(`Priority: ${config.accounts.map((a, i) => `${i + 1}. ${a.login}`).join("  ")}`);
  return 0;
}
