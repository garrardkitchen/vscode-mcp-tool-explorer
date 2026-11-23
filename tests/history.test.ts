import assert from "node:assert/strict";
import test from "node:test";
import { readDialogSize, rememberTry, removeSavedTry, TryHistoryStore, type SavedTry } from "../src/try/history.js";

const first = { id: "a", savedAt: "2026-11-22T10:00:00.000Z" };
const second = { id: "b", savedAt: "2026-11-22T11:00:00.000Z" };

test("stores a try and skips one that matches the newest", () => {
  const once = rememberTry([], { city: "Paris", limit: "10" }, first);
  assert.equal(once.length, 1);
  assert.deepEqual(once[0]?.answers, { city: "Paris", limit: "10" });

  const again = rememberTry(once, { limit: "10", city: "Paris" }, second);
  assert.equal(again.length, 1);
  assert.equal(again[0]?.id, "a");

  const changed = rememberTry(again, { city: "Lyon", limit: "10" }, second);
  assert.deepEqual(changed.map((item) => item.id), ["b", "a"]);
  assert.equal(changed[0]?.answers.city, "Lyon");
});

test("drops tries past the limit and removes one by id", () => {
  let tries: SavedTry[] = [];
  for (let index = 0; index < 22; index += 1) {
    tries = rememberTry(tries, { n: String(index) }, { id: `id-${index}`, savedAt: `2026-11-22T00:${String(index).padStart(2, "0")}:00.000Z` });
  }
  assert.equal(tries.length, 20);
  assert.equal(tries[0]?.answers.n, "21");
  assert.equal(tries.at(-1)?.answers.n, "2");

  const removed = removeSavedTry(tries, "id-21");
  assert.equal(removed.some((item) => item.id === "id-21"), false);
  assert.equal(removed.length, 19);
});

test("persists tries per tool and ignores a repeated last try", async () => {
  const data = new Map<string, unknown>();
  const store = new TryHistoryStore({
    get: (key) => data.get(key) as undefined,
    update: async (key, value) => {
      data.set(key, value);
    },
  });

  await store.remember("server", "echo", { text: "hi" }, first);
  await store.remember("server", "echo", { text: "hi" }, second);
  await store.remember("server", "other", { text: "hi" }, second);
  assert.deepEqual(store.list("server", "echo").map((item) => item.id), ["a"]);
  assert.deepEqual(store.list("server", "other").map((item) => item.id), ["b"]);

  await store.remove("server", "echo", "a");
  assert.deepEqual(store.list("server", "echo"), []);
  assert.equal(store.list("server", "other").length, 1);
});

test("remembers one dialog size and ignores a size that cannot be used", async () => {
  const data = new Map<string, unknown>();
  let writes = 0;
  const store = new TryHistoryStore({
    get: (key) => data.get(key) as undefined,
    update: async (key, value) => {
      writes += 1;
      data.set(key, value);
    },
  });

  assert.equal(store.dialogSize(), undefined);
  assert.equal(readDialogSize({ width: Number.NaN, height: 800 }), undefined);
  await store.rememberDialogSize({ width: 640.4, height: 880.2 });
  assert.deepEqual(store.dialogSize(), { width: 640, height: 880 });
  await store.rememberDialogSize({ width: 640, height: 880 });
  assert.equal(writes, 1);

  await store.rememberDialogSize({ width: 10, height: 880 });
  assert.deepEqual(store.dialogSize(), { width: 640, height: 880 });
  assert.equal(writes, 1);

  data.set("mcpToolXplorer.tryDialogSize", { width: "640", height: 800 });
  assert.equal(store.dialogSize(), undefined);
});

test("marks a tool as used once, and a saved try counts before that mark", async () => {
  const data = new Map<string, unknown>();
  const store = new TryHistoryStore({
    get: (key) => data.get(key) as undefined,
    update: async (key, value) => {
      data.set(key, value);
    },
  });

  assert.equal(store.hasUse("server", "echo"), false);
  await store.remember("server", "echo", { text: "hi" }, first);
  assert.equal(store.hasUse("server", "echo"), true);

  assert.equal(await store.noteUse("server", "plain"), true);
  assert.equal(await store.noteUse("server", "plain"), false);
  assert.equal(store.hasUse("server", "plain"), true);
  await store.remove("server", "echo", "a");
  assert.equal(store.hasUse("server", "echo"), false);
});
