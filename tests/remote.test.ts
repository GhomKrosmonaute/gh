import { describe, expect, test } from "bun:test";

import { normalizeHost, parseRepoSpec, parseRepoUrl, repoKey } from "../src/remote.js";

const ref = (host: string, owner: string, repo: string) => ({ host, owner, repo });

describe("parseRepoUrl", () => {
  test.each([
    ["https://github.com/acme/website.git", ref("github.com", "acme", "website")],
    ["https://github.com/acme/website", ref("github.com", "acme", "website")],
    ["https://github.com/acme/website/", ref("github.com", "acme", "website")],
    ["https://someone@github.com/Owner/Repo.git", ref("github.com", "Owner", "Repo")],
    ["https://user:secret@GitHub.com/o/r", ref("github.com", "o", "r")],
    ["git@github.com:o/r.git", ref("github.com", "o", "r")],
    ["github.com:o/r", ref("github.com", "o", "r")],
    ["ssh://git@github.com/o/r.git", ref("github.com", "o", "r")],
    ["ssh://git@ssh.github.com:443/o/r.git", ref("github.com", "o", "r")],
    ["https://git.corp.example:8443/team/tool.git", ref("git.corp.example", "team", "tool")],
    ["git@acme.ghe.com:team/tool", ref("acme.ghe.com", "team", "tool")],
  ])("%s", (url, expected) => {
    expect(parseRepoUrl(url)).toEqual(expected);
  });

  test.each([
    "../other-clone",
    "/srv/git/repo.git",
    "file:///srv/git/o/r.git",
    "C:/work/o/r",
    "https://github.com/only-owner",
    "https://github.com/o/r/tree/main",
    "owner/repo",
  ])("rejects %s", (url) => {
    expect(parseRepoUrl(url)).toBeNull();
  });
});

describe("parseRepoSpec", () => {
  test("owner/repo defaults to github.com", () => {
    expect(parseRepoSpec("o/r")).toEqual(ref("github.com", "o", "r"));
  });
  test("host/owner/repo", () => {
    expect(parseRepoSpec("GHE.corp.example/o/r.git")).toEqual(ref("ghe.corp.example", "o", "r"));
  });
  test("credential helper path on another host", () => {
    expect(parseRepoSpec("o/r.git", "ghe.corp.example")).toEqual(ref("ghe.corp.example", "o", "r"));
  });
  test("URLs too", () => {
    expect(parseRepoSpec("git@github.com:o/r.git")).toEqual(ref("github.com", "o", "r"));
  });
  test.each(["o", "a/b/c/d", "/r", "o/"])("rejects %s", (spec) => {
    expect(parseRepoSpec(spec)).toBeNull();
  });
});

test("normalizeHost", () => {
  expect(normalizeHost("SSH.GitHub.com:443")).toBe("github.com");
  expect(normalizeHost("www.github.com")).toBe("github.com");
  expect(normalizeHost("ghe.corp.example")).toBe("ghe.corp.example");
});

test("repoKey ignores case", () => {
  expect(repoKey(ref("github.com", "Acme", "Website"))).toBe(
    repoKey(ref("github.com", "acme", "website")),
  );
});
