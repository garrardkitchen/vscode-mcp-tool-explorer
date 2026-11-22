import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfigs } from "../src/config/load.js";
import { candidateOrigins, profileDirectoryFromGlobalStorage } from "../src/config/origins.js";
import { parseConfigText } from "../src/config/parse.js";
import type { Origin } from "../src/config/origins.js";
import type { VariableContext } from "../src/config/variables.js";

const origin: Origin = {
  id: "workspace-vscode:/work",
  label: "Workspace · app · .vscode/mcp.json",
  file: "/work/.vscode/mcp.json",
  format: "vscode",
  workspaceFolder: "/work",
  workspaceName: "app",
};

const variables: VariableContext = {
  env: { API_TOKEN: "secret" },
  userHome: "/Users/me",
  pathSeparator: "/",
  workspaceFolder: "/work",
  workspaceFolderBasename: "app",
};

test("parses JSONC editor config and substitutes variables", () => {
  const result = parseConfigText({
    origin,
    variables,
    text: `{
      // local server
      "servers": {
        "memory": {
          "type": "stdio",
          "command": "node",
          "args": ["\${workspaceFolder}/server.js"],
          "env": { "TOKEN": "\${env:API_TOKEN}" },
        },
      },
    }`,
  });

  assert.equal(result.problems.length, 0);
  assert.equal(result.servers[0]?.command, "node");
  assert.deepEqual(result.servers[0]?.args, ["/work/server.js"]);
  assert.deepEqual(result.servers[0]?.env, { TOKEN: "secret" });
  assert.equal(result.servers[0]?.cwd, "/work");
  assert.equal(result.servers[0]?.skipReason, undefined);
});

test("skips input prompts and oauth, and notes unsandboxed servers", () => {
  const result = parseConfigText({
    origin,
    variables,
    text: JSON.stringify({
      servers: {
        prompted: { type: "stdio", command: "node", env: { KEY: "${input:api-key}" } },
        oauth: { type: "http", url: "https://example.com/mcp", oauth: { clientId: "app" } },
        token: {
          type: "http",
          url: "https://example.com/mcp",
          oauth: { clientId: "app" },
          headers: { Authorization: "Bearer ${env:API_TOKEN}" },
        },
        sandboxed: { type: "stdio", command: "node", sandboxEnabled: true },
      },
    }),
  });

  const byName = Object.fromEntries(result.servers.map((server) => [server.name, server]));
  assert.match(byName.prompted?.skipReason ?? "", /\$\{input:api-key\}/);
  assert.match(byName.oauth?.skipReason ?? "", /browser flow/);
  assert.equal(byName.oauth?.clientCredentials, undefined);
  assert.equal(byName.token?.skipReason, undefined);
  assert.equal(byName.token?.clientCredentials, undefined);
  assert.equal(byName.token?.headers?.Authorization, "Bearer secret");
  assert.match(byName.sandboxed?.notice ?? "", /sandboxEnabled is ignored/);
});

test("keeps a client credentials server and substitutes its secret", () => {
  const result = parseConfigText({
    origin,
    variables,
    text: JSON.stringify({
      servers: {
        machine: {
          type: "http",
          url: "https://example.com/mcp",
          oauthClientId: "app-id",
          oauthPublicClient: false,
          oauthGrantType: "client_credentials",
          oauthScopes: ["api://resource/.default"],
          oauthClientSecret: "${env:API_TOKEN}",
        },
        browser: {
          type: "http",
          url: "https://example.com/mcp",
          oauthGrantType: "authorization_code",
          oauthClientId: "public-app",
        },
        nested: {
          type: "http",
          url: "https://example.com/mcp",
          oauth: {
            clientId: "nested-app",
            grantType: "client_credentials",
            scopes: ["one", "two"],
            expectedIssuer: "https://login.example.com/tenant",
          },
        },
      },
    }),
  });

  const byName = Object.fromEntries(result.servers.map((server) => [server.name, server]));
  assert.equal(byName.machine?.skipReason, undefined);
  assert.equal(byName.machine?.clientCredentials?.clientId, "app-id");
  assert.equal(byName.machine?.clientCredentials?.clientSecret, "secret");
  assert.equal(byName.machine?.clientCredentials?.scope, "api://resource/.default");
  assert.match(byName.machine?.notice ?? "", /client credentials/);
  assert.match(byName.browser?.skipReason ?? "", /browser flow/);
  assert.equal(byName.nested?.skipReason, undefined);
  assert.equal(byName.nested?.clientCredentials?.clientId, "nested-app");
  assert.equal(byName.nested?.clientCredentials?.scope, "one two");
  assert.equal(byName.nested?.clientCredentials?.expectedIssuer, "https://login.example.com/tenant");
  assert.equal(byName.nested?.clientCredentials?.clientSecret, undefined);
});

test("reports a client credentials entry that cannot be started", () => {
  const result = parseConfigText({
    origin,
    variables,
    text: JSON.stringify({
      servers: {
        missingId: { type: "http", url: "https://example.com/mcp", oauthGrantType: "client_credentials" },
        badScopes: {
          type: "http",
          url: "https://example.com/mcp",
          oauthClientId: "app-id",
          oauthGrantType: "client_credentials",
          oauthScopes: [1],
        },
        otherGrant: {
          type: "http",
          url: "https://example.com/mcp",
          oauthClientId: "app-id",
          oauthGrantType: "password",
        },
      },
    }),
  });

  const byName = Object.fromEntries(result.servers.map((server) => [server.name, server]));
  assert.match(byName.missingId?.skipReason ?? "", /client id/);
  assert.match(byName.badScopes?.skipReason ?? "", /oauthScopes/);
  assert.match(byName.otherGrant?.skipReason ?? "", /not supported/);
});

test("loads envFile and lets env override it", () => {
  const result = parseConfigText({
    origin,
    variables,
    readEnvFile: (filePath) => filePath === "/work/.env" ? "FROM_FILE=file\nSHARED=file\n" : undefined,
    text: JSON.stringify({
      servers: {
        local: {
          type: "stdio",
          command: "node",
          envFile: "${workspaceFolder}/.env",
          env: { SHARED: "explicit" },
        },
      },
    }),
  });

  assert.deepEqual(result.servers[0]?.env, { FROM_FILE: "file", SHARED: "explicit" });
});

test("reports the wrong top-level key", () => {
  const result = parseConfigText({
    origin,
    variables,
    text: JSON.stringify({ mcpServers: { memory: { command: "node" } } }),
  });
  assert.match(result.problems[0]?.message ?? "", /mcpServers/);
});

test("finds profile, workspace, and copilot config paths", () => {
  const storage = "/Users/me/Library/Application Support/Code/User/profiles/abc/globalStorage/Garrard.mcp-tool-xplorer";
  assert.equal(profileDirectoryFromGlobalStorage(storage), "/Users/me/Library/Application Support/Code/User/profiles/abc");

  const origins = candidateOrigins({
    workspaceFolders: [{ name: "app", path: "/work/app" }],
    profileDirectory: "/profile",
    homeDirectory: "/Users/me",
    copilotHome: "/copilot",
  });
  assert.deepEqual(origins.map((item) => item.file), [
    path.join("/work/app", ".vscode", "mcp.json"),
    path.join("/work/app", ".mcp.json"),
    path.join("/profile", "mcp.json"),
    path.join("/copilot", "mcp-config.json"),
  ]);
});

test("loadConfigs reads each supported file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mcp-xplorer-"));
  try {
    const workspace = path.join(root, "app");
    const profile = path.join(root, "profile");
    const copilot = path.join(root, "copilot");
    await mkdir(path.join(workspace, ".vscode"), { recursive: true });
    await mkdir(profile, { recursive: true });
    await mkdir(copilot, { recursive: true });
    await writeFile(path.join(workspace, ".vscode", "mcp.json"), JSON.stringify({
      servers: { local: { type: "stdio", command: "node", args: ["server.js"] } },
    }));
    await writeFile(path.join(workspace, ".mcp.json"), JSON.stringify({
      mcpServers: { remote: { url: "https://example.com/mcp" } },
    }));
    await writeFile(path.join(profile, "mcp.json"), JSON.stringify({
      servers: { user: { command: "python", args: ["-m", "server"] } },
    }));
    await writeFile(path.join(copilot, "mcp-config.json"), JSON.stringify({
      mcpServers: { copilot: { command: "echo", env: { TOKEN: "${TOKEN:-none}" } } },
    }));

    const loaded = loadConfigs({
      workspaceFolders: [{ name: "app", path: workspace }],
      profileDirectory: profile,
      homeDirectory: root,
      copilotHome: copilot,
      env: { TOKEN: "abc" },
    });

    assert.equal(loaded.problems.length, 0);
    assert.deepEqual(loaded.servers.map((server) => server.name), ["local", "remote", "user", "copilot"]);
    assert.equal(loaded.servers[1]?.transport, "http");
    assert.equal(loaded.servers[3]?.env?.TOKEN, "abc");
    assert.equal(loaded.servers[0]?.cwd, workspace);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
