import { describe, expect, test } from "bun:test";

import { type GhRemote, ghRepoFlag, pickGhBase } from "../src/gh-target.js";

const fork = "https://github.com/jane/website.git";
const parent = "https://github.com/acme/website.git";
const remote = (name: string, url: string, resolved: string | null = null): GhRemote => ({
  name,
  url,
  resolved,
});

describe("ghRepoFlag", () => {
  test.each([
    [["pr", "list", "-R", "acme/website"], "acme/website"],
    [["pr", "list", "--repo", "acme/website"], "acme/website"],
    [["pr", "list", "--repo=acme/website"], "acme/website"],
    [["pr", "list", "-Racme/website"], "acme/website"],
    [["pr", "create", "--fill"], null],
    [["api", "--", "-R", "x/y"], null],
  ])("%j", (args, expected) => {
    expect(ghRepoFlag(args)).toBe(expected);
  });
});

// The cases below were checked against gh 2.102 (`gh repo view` in a clone with these remotes).
describe("pickGhBase", () => {
  test("a fork with only origin acts on the fork", () => {
    expect(pickGhBase([remote("origin", fork)])).toMatchObject({ owner: "jane" });
  });

  test("upstream wins over origin, whatever the order", () => {
    expect(pickGhBase([remote("origin", fork), remote("upstream", parent)])).toMatchObject({
      owner: "acme",
    });
  });

  test("origin wins over a remote with another name", () => {
    expect(pickGhBase([remote("other", parent), remote("origin", fork)])).toMatchObject({
      owner: "jane",
    });
  });

  test("gh repo set-default wins over the names", () => {
    expect(pickGhBase([remote("origin", fork, "base"), remote("upstream", parent)])).toMatchObject({
      owner: "jane",
    });
  });

  test("an OWNER/REPO left by older gh versions", () => {
    expect(pickGhBase([remote("origin", fork, "acme/website")])).toMatchObject({
      owner: "acme",
      repo: "website",
    });
  });

  test("skips remotes that are not GitHub repositories", () => {
    expect(
      pickGhBase([remote("upstream", "/srv/git/x.git"), remote("origin", fork)]),
    ).toMatchObject({ owner: "jane" });
    expect(pickGhBase([])).toBeNull();
  });
});
