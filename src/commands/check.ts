import { parseArgs } from "../args.js";
import { currentRepo } from "../git.js";
import { type Level, rank } from "../permission.js";
import { parseRepoSpec, repoName } from "../remote.js";
import { type Resolution, resolve } from "../resolve.js";
import { ago, CliError, c, print, table } from "../ui.js";
import { ensureAccounts } from "./accounts.js";

const paintLevel = (level: Level) =>
  rank(level) >= rank("write") ? c.green(level) : level === "none" ? c.red(level) : c.yellow(level);

export function printChecks(resolution: Resolution): void {
  print(c.bold(repoName(resolution.ref)));
  print(
    table(
      resolution.checks.map((check) => [
        check === resolution.best ? c.green("●") : c.dim("○"),
        check === resolution.best ? c.bold(check.login) : check.login,
        paintLevel(check.level),
        c.dim(check.note ?? ""),
      ]),
    ),
  );
}

export async function check(args: string[]): Promise<number> {
  const parsed = parseArgs(
    args,
    { refresh: { type: "boolean" }, json: { type: "boolean" } },
    { strict: true },
  );
  const spec = parsed.rest[0];
  if (parsed.rest.length > 1) throw new CliError("Usage: ghom-gh check [owner/repo | URL]");
  const config = await ensureAccounts();
  const ref = spec ? parseRepoSpec(spec) : await currentRepo();
  if (!ref) throw new CliError(`"${spec}" is neither owner/repo, host/owner/repo nor a clone URL.`);
  if (!config.accounts.some((a) => a.host === ref.host)) {
    throw new CliError(
      `No account on ${ref.host} in the list (ghom-gh add --hostname ${ref.host}).`,
    );
  }

  const resolution = await resolve(ref, config.accounts, {
    refresh: parsed.flags.refresh === true,
  });
  if (parsed.flags.json) {
    print(JSON.stringify(resolution, null, 2));
    return resolution.best ? 0 : 1;
  }

  printChecks(resolution);
  print();
  const { best } = resolution;
  if (!best) print(c.red("  None of the listed accounts can see this repository."));
  else if (rank(best.level) < rank("write")) {
    print(
      `  ${c.yellow("→")} ${c.bold(best.login)} would be used, but it cannot push (${best.level}).`,
    );
  } else print(`  ${c.green("→")} ghom-gh acts as ${c.bold(best.login)} (${best.level}).`);
  if (resolution.checkedAt) {
    print(c.dim(`  Checked ${ago(resolution.checkedAt)}; --refresh asks GitHub again.`));
  }
  return best ? 0 : 1;
}
