import { forget } from "../cache.js";
import { loadConfig } from "../config.js";
import { ghToken } from "../gh.js";
import { normalizeHost, parseRepoSpec, type RepoRef, repoName } from "../remote.js";
import { resolve } from "../resolve.js";

/** The `key=value` lines git writes to a credential helper. */
export function parseCredentialRequest(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line) break;
    const equals = line.indexOf("=");
    if (equals > 0) fields[line.slice(0, equals)] = line.slice(equals + 1);
  }
  return fields;
}

async function readRequest(): Promise<string> {
  let text = "";
  for await (const chunk of process.stdin) {
    text += String(chunk);
    // The request ends with a blank line or with the end of stdin.
    if (/(^|\n)\r?\n/.test(text)) break;
  }
  return text;
}

function notify(message: string): void {
  // git shows a helper's stderr; only worth it in a terminal, and never in machine-driven runs.
  if (process.stderr.isTTY && !process.env.GHOM_GH_QUIET) {
    process.stderr.write(`ghom-gh: ${message}\n`);
  }
}

async function chooseLogin(
  host: string,
  ref: RepoRef | null,
  username: string | undefined,
): Promise<string | null> {
  // 1. Pinned by `ghom-gh push` / `ghom-gh run`, which already told the user who acts.
  const pinned = process.env.GHOM_GH_USER;
  if (pinned && (process.env.GHOM_GH_HOST ?? host) === host) return pinned;

  // 2. A login written in the remote URL (https://login@github.com/…) is an explicit choice.
  if (username && (await ghToken(host, username))) return username;

  const { config } = await loadConfig();
  const accounts = config.accounts.filter((account) => account.host === host);
  if (!accounts.length) return null;

  // 3. The best account for the repository.
  if (ref) {
    const { best } = await resolve(ref, accounts);
    if (best) {
      notify(`${repoName(ref)} as ${best.login} (${best.level})`);
      return best.login;
    }
  }
  // 4. No repository path (credential.useHttpPath is off) or no account sees it: first in line,
  //    so git still gets an answer it can report on.
  return accounts[0]?.login ?? null;
}

/**
 * git credential helper (https://git-scm.com/docs/gitcredentials). It must never break git: when
 * it has nothing to offer it prints nothing, and git moves on to its next way of asking.
 */
export async function credential(args: string[]): Promise<number> {
  const action = args[0];
  const request = parseCredentialRequest(await readRequest());
  if (!request.host || (request.protocol !== "https" && request.protocol !== "http")) return 0;
  const host = normalizeHost(request.host);
  const ref = request.path ? parseRepoSpec(request.path, host) : null;

  if (action === "erase") {
    // git rejected what we gave it: permissions changed, look again next time.
    if (ref) await forget(ref).catch(() => {});
    return 0;
  }
  if (action !== "get") return 0;

  try {
    const login = await chooseLogin(host, ref, request.username);
    const token = login && (await ghToken(host, login));
    if (login && token) process.stdout.write(`username=${login}\npassword=${token}\n`);
  } catch (error) {
    process.stderr.write(`ghom-gh: ${(error as Error).message}\n`);
  }
  return 0;
}
