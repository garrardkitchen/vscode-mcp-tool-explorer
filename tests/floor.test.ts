import assert from "node:assert/strict";
import test from "node:test";
import { inferEnvironment, resolveEnvironment } from "../src/floor/environment.js";
import { EnvironmentStore } from "../src/floor/environmentStore.js";
import { FavouriteStore, readFavouriteKeys, toolKey } from "../src/floor/favourites.js";
import { buildFloorView, serverIdsToLoad, toolMatchesQuery } from "../src/floor/listing.js";
import { readShelfWidth, ShelfWidthStore } from "../src/floor/shelfWidth.js";
import { renderFloorHtml } from "../src/view/floorHtml.js";
import type { FloorServerInput } from "../src/floor/listing.js";

function memory() {
  const data = new Map<string, unknown>();
  return {
    data,
    store: {
      get: <T>(key: string): T | undefined => data.get(key) as T | undefined,
      update: async (key: string, value: unknown): Promise<void> => {
        data.set(key, value);
      },
    },
  };
}

test("reads a DEV, TEST, or PROD token and lets the last one win", () => {
  assert.equal(inferEnvironment("entra-dev"), "DEV");
  assert.equal(inferEnvironment("payments-TEST"), "TEST");
  assert.equal(inferEnvironment("billing_prod"), "PROD");
  assert.equal(inferEnvironment("entra-dev-test"), "TEST");
  assert.equal(inferEnvironment("development"), undefined);
  assert.equal(inferEnvironment("proddev"), undefined);
  assert.equal(inferEnvironment("mytest"), undefined);
  assert.equal(inferEnvironment("microsoft.docs.mcp"), undefined);
});

test("a stored tag replaces the name, and none hides it", () => {
  assert.equal(resolveEnvironment("entra-dev", "PROD"), "PROD");
  assert.equal(resolveEnvironment("entra-dev", "none"), undefined);
  assert.equal(resolveEnvironment("microsoft.docs.mcp", undefined), undefined);
  assert.equal(resolveEnvironment("entra-dev", "nope"), "DEV");
  assert.equal(resolveEnvironment("entra-dev", "c1"), "DEV");
  assert.equal(resolveEnvironment("docs", "c1", new Set(["c1"])), "c1");
  assert.equal(resolveEnvironment("docs", "c0", new Set(["c0"])), undefined);
});

test("stores an environment override and forgets it when the name should be used", async () => {
  const { store } = memory();
  const environments = new EnvironmentStore(store);
  assert.equal(environments.tag("entra-dev", "entra-dev"), "DEV");
  await environments.set("entra-dev", "PROD");
  assert.equal(environments.tag("entra-dev", "entra-dev"), "PROD");
  await environments.set("docs", "TEST");
  await environments.set("entra-dev", "name");
  assert.equal(environments.tag("entra-dev", "entra-dev"), "DEV");
  assert.equal(environments.tag("docs", "microsoft.docs.mcp"), "TEST");
  await environments.set("docs", "c1");
  assert.equal(environments.tag("docs", "microsoft.docs.mcp"), "TEST");
});

test("toggles a favourite without touching another tool", async () => {
  const { data, store } = memory();
  const favourites = new FavouriteStore(store);
  assert.equal(await favourites.toggle("entra-dev", "update_user"), true);
  assert.equal(favourites.has("entra-dev", "update_user"), true);
  assert.equal(favourites.has("entra-dev", "get_user"), false);
  assert.deepEqual(data.get("mcpToolXplorer.favourites"), [toolKey("entra-dev", "update_user")]);
  assert.equal(await favourites.toggle("entra-dev", "update_user"), false);
  assert.deepEqual(favourites.keys(), []);
  assert.deepEqual(readFavouriteKeys(["ok", "", 4, "kept"]), ["ok", "kept"]);
});

const servers: FloorServerInput[] = [
  {
    id: "docs",
    name: "microsoft.docs.mcp",
    originLabel: "Workspace",
    credentials: false,
    tools: [
      { name: "search", title: "Search docs", description: "Find a page", favourite: false },
    ],
  },
  {
    id: "dev",
    name: "entra-dev",
    originLabel: "Copilot",
    credentials: true,
    environment: "DEV",
    tools: [
      { name: "update_user", title: "Change a user's profile", description: "Write a profile", favourite: true },
      { name: "get_user", title: "Get user", description: "Read one user", favourite: false },
      { name: "list_groups", title: "List groups", favourite: false },
    ],
  },
  {
    id: "prod",
    name: "entra-prod",
    originLabel: "Profile",
    credentials: true,
    environment: "PROD",
    tools: [
      { name: "get_user", title: "Get user", description: "Read one user", favourite: true },
    ],
  },
  {
    id: "held",
    name: "input-dev",
    originLabel: "Workspace",
    credentials: false,
    environment: "DEV",
    skipReason: "This server still contains ${input:token}.",
  },
];

test("puts favourites above the other tools for the selected server", () => {
  const view = buildFloorView({ servers, selectedId: "dev", query: "", envFilter: "ALL" });
  assert.deepEqual(view.favourites.map((tool) => tool.name), ["update_user"]);
  assert.deepEqual(view.tools.map((tool) => tool.name), ["get_user", "list_groups"]);
  assert.equal(view.favourites[0]?.showServer, false);
  assert.equal(view.servers.find((server) => server.id === "dev")?.selected, true);
  assert.equal(view.servers.find((server) => server.id === "dev")?.matchCount, undefined);
});

test("a search lists matching favourites first and counts them on the shelf", () => {
  const view = buildFloorView({ servers, selectedId: "dev", query: "user", envFilter: "ALL" });
  assert.deepEqual(view.favourites.map((tool) => `${tool.serverId}:${tool.name}`), ["dev:update_user", "prod:get_user"]);
  assert.deepEqual(view.tools.map((tool) => `${tool.serverId}:${tool.name}`), ["dev:get_user"]);
  assert.equal(view.favourites[0]?.showServer, true);
  assert.equal(view.favourites[0]?.environment, "DEV");
  assert.equal(view.servers.find((server) => server.id === "dev")?.matchCount, 2);
  assert.equal(view.servers.find((server) => server.id === "prod")?.matchCount, 1);
  assert.equal(view.servers.find((server) => server.id === "docs")?.matchCount, 0);
  assert.equal(view.servers.find((server) => server.id === "held")?.matchCount, undefined);
  assert.match(view.servers.find((server) => server.id === "held")?.status ?? "", /\$\{input:token\}/);
});

test("used only hides tools that have not been run, and reverse flips each group", () => {
  const listed = buildFloorView({
    servers: [{
      id: "dev",
      name: "entra-dev",
      originLabel: "Copilot",
      credentials: true,
      environment: "DEV",
      tools: [
        { name: "update_user", title: "Change a user's profile", favourite: true, used: false },
        { name: "get_user", title: "Get user", favourite: false, used: true },
        { name: "list_groups", title: "List groups", favourite: false },
        { name: "zeta", title: "Zeta", favourite: true, used: true },
      ],
    }],
    selectedId: "dev",
    query: "",
    envFilter: "ALL",
    usedOnly: true,
  });
  assert.deepEqual(listed.favourites.map((tool) => tool.name), ["zeta"]);
  assert.deepEqual(listed.tools.map((tool) => tool.name), ["get_user"]);

  const reversed = buildFloorView({
    servers: [{
      id: "dev",
      name: "entra-dev",
      originLabel: "Copilot",
      credentials: true,
      environment: "DEV",
      tools: [
        { name: "update_user", title: "Change a user's profile", favourite: true },
        { name: "get_user", title: "Get user", favourite: false },
        { name: "list_groups", title: "List groups", favourite: false },
        { name: "zeta", title: "Zeta", favourite: true },
      ],
    }],
    selectedId: "dev",
    query: "",
    envFilter: "ALL",
    toolOrder: "desc",
  });
  assert.deepEqual(reversed.favourites.map((tool) => tool.name), ["zeta", "update_user"]);
  assert.deepEqual(reversed.tools.map((tool) => tool.name), ["list_groups", "get_user"]);

  const empty = buildFloorView({
    servers: [{
      id: "dev",
      name: "entra-dev",
      originLabel: "Copilot",
      credentials: false,
      tools: [{ name: "get_user", title: "Get user", favourite: false }],
    }],
    selectedId: "dev",
    query: "",
    envFilter: "ALL",
    usedOnly: true,
  });
  assert.equal(empty.message, "No used tools.");
});

test("an environment filter hides other servers and does not start a skipped server", () => {
  const view = buildFloorView({ servers, selectedId: "prod", query: "", envFilter: "DEV" });
  assert.deepEqual(view.servers.map((server) => server.id), ["dev", "held"]);
  assert.equal(view.selectedId, "dev");
  assert.deepEqual(serverIdsToLoad(servers, "prod", "", "DEV"), ["dev"]);
  assert.deepEqual(serverIdsToLoad(servers, "dev", "user", "ALL"), ["dev", "docs", "prod"]);
  assert.equal(toolMatchesQuery("copilot", { name: "search", title: "Search docs" }, "microsoft.docs.mcp", "Copilot"), true);
});

test("the page escapes names, puts servers beside the tools, and keeps the script static", () => {
  const view = buildFloorView({
    servers: [{
      id: "dev",
      name: "entra<script>",
      originLabel: "Copilot",
      credentials: true,
      environment: "DEV",
      tools: [{ name: "get_user", title: "Get <user>", favourite: true, used: true }],
    }],
    selectedId: "dev",
    query: "get",
    envFilter: "DEV",
  });
  const html = renderFloorHtml({
    query: "get",
    refocus: true,
    envFilter: "DEV",
    ...view,
    problems: ["bad <file>"],
    searched: [],
    shelfWidth: 240,
  }, "nonce", "vscode-webview:", () => "vscode-webview://icon.png");

  assert.match(html, /layout-columns/);
  assert.match(html, /id="shelf-splitter"/);
  assert.match(html, /role="separator"/);
  assert.match(html, /\.shelf \{ width: 240px; \}/);
  assert.match(html, /data-refocus="true"/);
  assert.match(html, /entra&lt;script&gt;/);
  assert.match(html, /Get &lt;user&gt;/);
  assert.match(html, /bad &lt;file&gt;/);
  assert.match(html, /data-action="secret"/);
  assert.match(html, /data-action="favourite"/);
  assert.match(html, /class="hex-fav on"/);
  assert.match(html, /class="chip on"/);
  assert.match(html, /Favourites/);
  assert.match(html, /class="used">Used/);
  assert.match(html, /\.used \{[^}]*background: #E39A3C;/);
  assert.match(html, /Used only/);
  assert.match(html, /data-action="sort"/);
  assert.match(html, />A–Z</);
  assert.match(html, /data-action="catalog">Markdown/);
  assert.match(html, /data-action="names">Names/);
  assert.doesNotMatch(html, /Open in editor/);
  assert.match(html, /<div class="tool" role="button"/);
  assert.match(html, /<script nonce="nonce">/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /style="/);
});

test("remembers a server list width and drops one that cannot be used", async () => {
  const kept = memory();
  const store = new ShelfWidthStore(kept.store);
  assert.equal(store.width(), undefined);
  assert.equal(readShelfWidth(219.6), 220);
  assert.equal(readShelfWidth(139), undefined);
  assert.equal(readShelfWidth("240"), undefined);

  await store.remember(240.2);
  assert.equal(store.width(), 240);
  await store.remember(240);
  assert.equal(kept.data.get("mcpToolXplorer.serverListWidth"), 240);
  await store.remember(12);
  assert.equal(store.width(), 240);

  const html = renderFloorHtml({
    query: "",
    refocus: false,
    envFilter: "ALL",
    servers: [],
    favourites: [],
    tools: [],
    problems: [],
    searched: [],
    shelfWidth: 12,
  }, "nonce", "vscode-webview:", () => "");
  assert.match(html, /width: 220px/);
  assert.doesNotMatch(html, /width: 12px/);
  assert.doesNotMatch(html, /style="/);
});
