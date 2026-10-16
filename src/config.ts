import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { CliError } from "./ui.js";

/** A gh account. The token itself never leaves gh's keyring: we ask `gh auth token` each time. */
export interface Account {
  host: string;
  login: string;
}

/** What the global git config held for a host before `ghom-gh setup` replaced it. */
export interface HelperBackup {
  helpers: string[];
  useHttpPath: string | null;
}

export interface Config {
  /** In priority order: when several accounts share the highest permission, the first one wins. */
  accounts: Account[];
  setup?: Record<string, HelperBackup>;
}

export function configDir(): string {
  if (process.env.GHOM_GH_CONFIG_DIR) return process.env.GHOM_GH_CONFIG_DIR;
  if (process.platform === "win32" && process.env.APPDATA) {
    return join(process.env.APPDATA, "ghom-gh");
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "ghom-gh");
}

export function configFile(): string {
  return join(configDir(), "config.json");
}

export async function loadConfig(): Promise<{ config: Config; exists: boolean }> {
  let raw: string;
  try {
    raw = await readFile(configFile(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { config: { accounts: [] }, exists: false };
    }
    throw error;
  }
  let data: Partial<Config>;
  try {
    data = JSON.parse(raw) as Partial<Config>;
  } catch {
    throw new CliError(`${configFile()} is not valid JSON; fix or delete it.`);
  }
  const accounts = (Array.isArray(data.accounts) ? data.accounts : [])
    .filter((a): a is Account => typeof a?.host === "string" && typeof a?.login === "string")
    .map((a) => ({ host: a.host.toLowerCase(), login: a.login }));
  return { config: { accounts, setup: data.setup }, exists: true };
}

export async function saveConfig(config: Config): Promise<void> {
  await writeJson(configFile(), config);
}

/** Writes through a temporary file so a concurrent reader never sees half a file. */
export async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

/** GitHub logins are case-insensitive. */
export function sameAccount(a: Account, b: Account): boolean {
  return a.host === b.host && a.login.toLowerCase() === b.login.toLowerCase();
}

export function findAccount(accounts: Account[], login: string, host?: string): number {
  return accounts.findIndex(
    (a) => a.login.toLowerCase() === login.toLowerCase() && (!host || a.host === host),
  );
}
