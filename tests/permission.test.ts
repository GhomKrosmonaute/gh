import { describe, expect, test } from "bun:test";

import {
  type AccountCheck,
  type Level,
  levelFromPermissions,
  pickBest,
} from "../src/permission.js";

describe("levelFromPermissions", () => {
  test("takes the highest flag GitHub sets", () => {
    const all = { admin: true, maintain: true, push: true, triage: true, pull: true };
    expect(levelFromPermissions(all)).toBe("admin");
    expect(levelFromPermissions({ ...all, admin: false })).toBe("maintain");
    expect(levelFromPermissions({ ...all, admin: false, maintain: false })).toBe("write");
    expect(levelFromPermissions({ pull: true, triage: true })).toBe("triage");
    expect(levelFromPermissions({ pull: true })).toBe("read");
    expect(levelFromPermissions({})).toBe("none");
  });

  test("a repository visible without permissions is readable", () => {
    expect(levelFromPermissions(undefined)).toBe("read");
  });
});

describe("pickBest", () => {
  const check = (login: string, level: Level): AccountCheck => ({
    host: "github.com",
    login,
    level,
  });

  test("highest permission wins", () => {
    const best = pickBest([check("a", "read"), check("b", "admin"), check("c", "write")]);
    expect(best?.login).toBe("b");
  });

  test("ties go to the account listed first", () => {
    expect(pickBest([check("a", "write"), check("b", "write")])?.login).toBe("a");
    expect(pickBest([check("b", "write"), check("a", "write")])?.login).toBe("b");
  });

  test("respects the minimum", () => {
    expect(pickBest([check("a", "read"), check("b", "triage")], "write")).toBeNull();
    expect(pickBest([check("a", "none")])).toBeNull();
    expect(pickBest([])).toBeNull();
  });
});
