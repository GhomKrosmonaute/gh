import { describe, expect, test } from "bun:test";

import { parseArgs } from "../src/args.js";
import { parseCredentialRequest } from "../src/commands/credential.js";
import { pushRepository, shellQuote, withGitConfig } from "../src/git.js";

describe("parseArgs", () => {
  const pushSpec = { as: { type: "string" }, refresh: { type: "boolean" } } as const;

  test("push keeps every git argument in order", () => {
    const parsed = parseArgs(
      ["-u", "--as", "bob", "origin", "--force-with-lease", "main"],
      pushSpec,
    );
    expect(parsed.flags).toEqual({ as: "bob" });
    expect(parsed.rest).toEqual(["-u", "origin", "--force-with-lease", "main"]);
    expect(parsed.tail).toBeNull();
  });

  test("--flag=value and --", () => {
    const parsed = parseArgs(["--as=bob", "--refresh", "origin", "--", "x"], pushSpec);
    expect(parsed.flags).toEqual({ as: "bob", refresh: true });
    expect(parsed.rest).toEqual(["origin"]);
    expect(parsed.tail).toEqual(["x"]);
  });

  test("strict mode rejects unknown options", () => {
    expect(() => parseArgs(["--nope"], {}, { strict: true })).toThrow("Unknown option --nope");
  });

  test("missing values are errors", () => {
    expect(() => parseArgs(["--as"], pushSpec)).toThrow("--as expects a value");
  });

  test("run stops at the command", () => {
    const parsed = parseArgs(["--as", "bob", "gh", "pr", "create", "--as", "x"], pushSpec, {
      strict: true,
      stopAtPositional: true,
    });
    expect(parsed.flags).toEqual({ as: "bob" });
    expect(parsed.rest).toEqual(["gh", "pr", "create", "--as", "x"]);
  });
});

describe("pushRepository", () => {
  test.each([
    [[], null],
    [["-u", "origin", "main"], "origin"],
    [["--force", "upstream"], "upstream"],
    [["-o", "ci.skip", "fork", "HEAD"], "fork"],
    [["--push-option", "x", "--receive-pack", "rp"], null],
    [["--repo", "fork"], "fork"],
    [["--repo=fork", "origin"], "origin"],
    [["--tags", "--", "fork", "main"], "fork"],
    [["git@github.com:o/r.git", "HEAD:main"], "git@github.com:o/r.git"],
  ])("%j → %s", (args, expected) => {
    expect(pushRepository(args)).toBe(expected);
  });
});

test("withGitConfig appends to GIT_CONFIG_COUNT", () => {
  const env = withGitConfig(
    { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "a.b", GIT_CONFIG_VALUE_0: "1" },
    [
      ["c.d", ""],
      ["e.f", "2"],
    ],
  );
  expect(env).toMatchObject({
    GIT_CONFIG_COUNT: "3",
    GIT_CONFIG_KEY_0: "a.b",
    GIT_CONFIG_KEY_1: "c.d",
    GIT_CONFIG_VALUE_1: "",
    GIT_CONFIG_KEY_2: "e.f",
    GIT_CONFIG_VALUE_2: "2",
  });
});

test("shellQuote", () => {
  expect(shellQuote("/usr/local/bin/node")).toBe("/usr/local/bin/node");
  expect(shellQuote("/Users/a b/it's.js")).toBe(`'/Users/a b/it'\\''s.js'`);
});

test("parseCredentialRequest stops at the blank line", () => {
  const request = "protocol=https\nhost=github.com\npath=o/r.git\nusername=bob\n\nignored=1\n";
  expect(parseCredentialRequest(request)).toEqual({
    protocol: "https",
    host: "github.com",
    path: "o/r.git",
    username: "bob",
  });
});
