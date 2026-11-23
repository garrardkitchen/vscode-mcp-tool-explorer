import assert from "node:assert/strict";
import test from "node:test";
import { environmentClass, environmentNameError, EnvironmentNameStore, readEnvironmentOptions } from "../src/floor/environmentNames.js";
import { EnvironmentStore } from "../src/floor/environmentStore.js";
import { buildFloorView } from "../src/floor/listing.js";
import { renderFloorHtml } from "../src/view/floorHtml.js";

function memory() {
  const data = new Map<string, unknown>();
  return {
    data,
    store: {
      get: <T>(key: string): T | undefined => data.get(key) as T | undefined,
      update: async (key: string, value: unknown): Promise<void> => {
        if (value === undefined) {
          data.delete(key);
          return;
        }
        data.set(key, value);
      },
    },
  };
}

test("keeps DEV, TEST, and PROD and drops a name that cannot be shown", () => {
  assert.deepEqual(readEnvironmentOptions(undefined).map((option) => option.label), ["DEV", "TEST", "PROD"]);
  const options = readEnvironmentOptions({
    DEV: "  Development  ",
    TEST: "all",
    PROD: "TEST",
    custom: [
      { id: "DEV", label: "Nope" },
      { id: "c1", label: "All" },
      { id: "c1", label: "Staging" },
      { id: "c2", label: "staging" },
      { id: "c3", label: "UAT" },
    ],
  });
  assert.deepEqual(options.map((option) => `${option.id}:${option.label}`), [
    "DEV:Development",
    "TEST:TEST",
    "PROD:PROD",
    "c1:Staging",
    "c3:UAT",
  ]);
  assert.equal(environmentNameError("uat", undefined, options), "UAT already uses that name.");
  assert.equal(environmentNameError("All", undefined, options), "All is the filter for every server.");
  assert.equal(environmentNameError("ok", "c1", options), undefined);
  assert.equal(environmentNameError("a".repeat(25), undefined, options)?.length, "Enter a name up to 24 characters.".length);
});

test("adds an environment, renames it, and does not reuse its id", async () => {
  const { data, store } = memory();
  const names = new EnvironmentNameStore(store);
  assert.equal(await names.add("  "), undefined);
  assert.equal(await names.add("Staging"), "c1");
  assert.equal(await names.rename("c1", "Staging"), undefined);
  await names.rename("c1", "Preprod");
  assert.equal(names.label("c1"), "Preprod");
  assert.equal(await names.remove("DEV"), false);
  assert.equal(await names.remove("c1"), true);
  assert.equal(names.has("c1"), false);
  assert.equal(await names.add("Staging"), "c2");
  assert.equal(data.get("mcpToolXplorer.environmentNames") !== undefined, true);

  await names.rename("DEV", "Development");
  assert.equal(names.label("DEV"), "Development");
  await names.rename("DEV", "DEV");
  assert.equal(names.label("DEV"), "DEV");
  const removed = await names.reset();
  assert.deepEqual(removed, ["c2"]);
  assert.deepEqual(names.options().map((option) => option.id), ["DEV", "TEST", "PROD"]);
  assert.equal(await names.add("Lab"), "c3");
});

test("a removed environment leaves the server name in charge", async () => {
  const { store } = memory();
  const names = new EnvironmentNameStore(store);
  const id = await names.add("Staging");
  assert.equal(id, "c1");
  const environments = new EnvironmentStore(store, () => names.ids());
  await environments.set("payments", "c1");
  assert.equal(environments.tag("payments", "payments"), "c1");
  assert.equal(await names.remove("c1"), true);
  await environments.clearTag("c1");
  assert.equal(environments.tag("payments", "payments"), undefined);
  await environments.set("payments", "nope");
  assert.equal(environments.tag("payments", "payments"), undefined);
});

test("an added environment is a filter chip and keeps its own colour", () => {
  assert.equal(environmentClass("DEV"), "env-dev");
  assert.equal(environmentClass("c1"), "env-c1");
  assert.equal(environmentClass("c5"), "env-c0");
  const options = readEnvironmentOptions({ custom: [{ id: "c1", label: "A<B" }] });
  const view = buildFloorView({
    servers: [{
      id: "payments",
      name: "payments",
      originLabel: "Workspace",
      credentials: false,
      environment: "c1",
      tools: [],
    }],
    query: "",
    envFilter: "c1",
  });
  assert.equal(view.servers.length, 1);
  const html = renderFloorHtml({
    ...view,
    query: "",
    refocus: false,
    envFilter: "c1",
    problems: [],
    searched: [],
    usedOnly: false,
    toolOrder: "asc",
    environmentOptions: options,
  }, "nonce", "vscode-webview:", () => "");
  assert.match(html, /data-env="c1">A&lt;B/);
  assert.match(html, /class="chip on"/);
  assert.match(html, /class="env env-c1"/);
  assert.doesNotMatch(html, /class="env env-prod">A&lt;B/);
  assert.match(html, /data-action="names">Names/);
  assert.doesNotMatch(html, /style="/);
});
