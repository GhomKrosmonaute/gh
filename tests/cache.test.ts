import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CACHE_TTL_MS, forget, readCached, writeCached } from "../src/cache.js";

const ref = { host: "github.com", owner: "o", repo: "r" };
const alice = { host: "github.com", login: "alice" };
const bob = { host: "github.com", login: "Bob" };
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ghom-gh-test-"));
  process.env.GHOM_GH_CONFIG_DIR = dir;
});

afterAll(async () => {
  delete process.env.GHOM_GH_CONFIG_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("permission cache", () => {
  test("returns the checks in today's priority order", async () => {
    await writeCached(ref, [
      { login: "alice", level: "read" },
      { login: "bob", level: "admin", note: "x" },
    ]);
    const cached = await readCached({ ...ref, owner: "O" }, [bob, alice]);
    expect(cached?.checks.map((c) => c.login)).toEqual(["bob", "alice"]);
  });

  test("is stale when the account list changed", async () => {
    await writeCached(ref, [{ login: "alice", level: "read" }]);
    expect(await readCached(ref, [alice, bob])).toBeNull();
    expect(await readCached(ref, [bob])).toBeNull();
  });

  test("expires", async () => {
    const now = Date.now();
    await writeCached(ref, [{ login: "alice", level: "read" }], now);
    expect(await readCached(ref, [alice], now + CACHE_TTL_MS - 1)).not.toBeNull();
    expect(await readCached(ref, [alice], now + CACHE_TTL_MS + 1)).toBeNull();
  });

  test("forget", async () => {
    await writeCached(ref, [{ login: "alice", level: "read" }]);
    await forget(ref);
    expect(await readCached(ref, [alice])).toBeNull();
  });
});
