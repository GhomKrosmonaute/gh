import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hookCommand } from "../src/git.js";
import { accountIdentity, IDENTITY_TTL_MS, noreplyEmail } from "../src/identity.js";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ghom-gh-test-"));
  process.env.GHOM_GH_CONFIG_DIR = dir;
});

afterAll(async () => {
  delete process.env.GHOM_GH_CONFIG_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("noreplyEmail", () => {
  test("uses GitHub's id+login form", () => {
    expect(noreplyEmail("github.com", 42, "jane")).toBe("42+jane@users.noreply.github.com");
    expect(noreplyEmail("git.corp.example", 7, "jo")).toBe("7+jo@users.noreply.git.corp.example");
  });
});

describe("accountIdentity", () => {
  test("serves a fresh cache entry without calling GitHub", async () => {
    const entry = { login: "Jane", name: "Jane Doe", email: "42+Jane@users.noreply.github.com" };
    await writeFile(
      join(dir, "identities.json"),
      JSON.stringify({ "github.com/jane": { ...entry, checkedAt: Date.now() } }),
    );
    expect(await accountIdentity("github.com", "JANE", "not-a-token")).toEqual(entry);
  });

  test("ignores an expired entry", async () => {
    const old = Date.now() - IDENTITY_TTL_MS - 1;
    await writeFile(
      join(dir, "identities.json"),
      JSON.stringify({
        "nowhere.invalid/jane": { login: "jane", name: "x", email: "y", checkedAt: old },
      }),
    );
    // The host does not resolve, so a cache miss surfaces as null.
    expect(await accountIdentity("nowhere.invalid", "jane", "not-a-token")).toBeNull();
  });
});

describe("hookCommand", () => {
  // git runs a config hook as `sh -c '<command> "$@"' <command> <hook args…>`.
  const runAsGit = (command: string, ...args: string[]) =>
    spawnSync("sh", ["-c", `${command} "$@"`, command, ...args], { encoding: "utf8" });

  test("passes the event and git's arguments through", () => {
    const result = runAsGit(
      hookCommand("post-checkout", "/bin/echo", "/bin/sh"),
      "0000",
      "ab",
      "1",
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("/bin/sh identity post-checkout 0000 ab 1\n");
  });

  test("does nothing when ghom-gh is gone", () => {
    const result = runAsGit(hookCommand("pre-commit", "/bin/echo", "/no/such/cli.js"), "x");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });
});
