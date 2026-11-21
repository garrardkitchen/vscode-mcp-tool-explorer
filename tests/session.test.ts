import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { materializeIcon } from "../src/mcp/icons.js";
import { callServerTool, listServerTools } from "../src/mcp/session.js";
import type { ResolvedServer } from "../src/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function server(overrides: Partial<ResolvedServer>): ResolvedServer {
  return {
    id: "test",
    name: "test",
    originLabel: "test",
    originFile: "/tmp/mcp.json",
    transport: "stdio",
    ...overrides,
  };
}

test("lists every page from a stdio server without calling tools", { timeout: 20_000 }, async () => {
  const tools = await listServerTools(server({
    command: process.execPath,
    args: [path.join(here, "fixture-server.mjs")],
    cwd: path.resolve(here, ".."),
  }));

  assert.deepEqual(tools.map((tool) => tool.name), ["echo", "quiet"]);
  assert.equal(tools[0]?.title, "Echo");
  assert.equal(tools[0]?.inputSchema.required?.[0], "text");
  assert.equal(tools[0]?.outputSchema?.properties && "text" in (tools[0].outputSchema.properties as object), true);
  assert.equal(tools[1]?.outputSchema, undefined);
  assert.equal(tools[0]?.icons?.[0]?.mimeType, "image/png");

  const directory = await mkdtemp(path.join(os.tmpdir(), "mcp-session-icon-"));
  try {
    const icon = tools[0]?.icons?.[0];
    assert.ok(icon);
    const saved = await materializeIcon(icon, directory);
    assert.ok(saved);
    const bytes = await readFile(saved);
    assert.equal(bytes[0], 0x89);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("calls a stdio tool with the entered arguments", { timeout: 20_000 }, async () => {
  const result = await callServerTool(server({
    command: process.execPath,
    args: [path.join(here, "fixture-server.mjs")],
    cwd: path.resolve(here, ".."),
  }), "echo", { text: "hi" });

  assert.equal(result.isError, false);
  assert.deepEqual(result.texts, ["hi"]);
  assert.equal(result.structuredText, '{\n  "text": "hi"\n}');
});

test("sends configured headers to an HTTP server", { timeout: 20_000 }, async () => {
  const child = spawn(process.execPath, [path.join(here, "http-fixture.mjs")], {
    cwd: path.resolve(here, ".."),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  try {
    const port = await new Promise<string>((resolve, reject) => {
      let output = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
        const line = output.split("\n")[0];
        if (line && line.trim().length > 0) {
          resolve(line.trim());
        }
      });
      child.once("exit", (code) => reject(new Error(`HTTP fixture exited ${code}: ${stderr}`)));
    });

    const tools = await listServerTools(server({
      transport: "http",
      url: `http://127.0.0.1:${port}/mcp`,
      headers: { "X-Test-Token": "secret" },
    }));
    assert.deepEqual(tools.map((tool) => tool.name), ["ping"]);
    assert.equal(tools[0]?.outputSchema?.required?.[0], "ok");
  } finally {
    child.kill();
  }
});

test("does not connect a client credentials server that has no secret", async () => {
  await assert.rejects(
    () => listServerTools(server({
      name: "entra-dev",
      transport: "http",
      url: "http://127.0.0.1:9/mcp",
      clientCredentials: { clientId: "app-id", scope: "api://resource/.default" },
    })),
    /Set Client Secret/,
  );
});

test("lists tools with a client credentials grant", { timeout: 20_000 }, async () => {
  const seen = await withClientCredentialsServer(async (endpoint) => {
    const tools = await listServerTools(server({
      transport: "http",
      url: endpoint.mcpUrl,
      clientCredentials: {
        clientId: endpoint.clientId,
        clientSecret: endpoint.clientSecret,
        scope: "tools.read",
      },
    }));
    assert.deepEqual(tools.map((tool) => tool.name), ["ping"]);
    return endpoint.tokenRequests;
  });

  assert.ok(seen.some((request) => request.grant === "client_credentials" && request.scope === "tools.read" && request.basic));
});

test("uses the configured issuer when the MCP host has no token endpoint", { timeout: 20_000 }, async () => {
  await withIssuerBackedServer(async (endpoint) => {
    const tools = await listServerTools(server({
      name: "entra-dev",
      transport: "http",
      url: endpoint.mcpUrl,
      clientCredentials: {
        clientId: endpoint.clientId,
        clientSecret: endpoint.clientSecret,
        scope: "tools.read",
        expectedIssuer: endpoint.issuer,
      },
    }));
    assert.deepEqual(tools.map((tool) => tool.name), ["ping"]);
  });
});

test("explains a missing token endpoint instead of reporting the host 404", async () => {
  await assert.rejects(
    () => withIssuerBackedServer((endpoint) => listServerTools(server({
      name: "entra-dev",
      transport: "http",
      url: endpoint.mcpUrl,
      clientCredentials: {
        clientId: endpoint.clientId,
        clientSecret: endpoint.clientSecret,
        scope: "tools.read",
      },
    })), { serveIssuer: false }),
    /oauthExpectedIssuer/,
  );
});

test("retries the token request when the resource parameter is rejected", { timeout: 20_000 }, async () => {
  const seen = await withClientCredentialsServer(async (endpoint) => {
    const tools = await listServerTools(server({
      transport: "http",
      url: endpoint.mcpUrl,
      clientCredentials: {
        clientId: endpoint.clientId,
        clientSecret: endpoint.clientSecret,
        scope: "tools.read",
      },
    }));
    assert.deepEqual(tools.map((tool) => tool.name), ["ping"]);
    return endpoint.tokenRequests;
  }, { rejectResource: true });

  assert.ok(seen.some((request) => request.resource !== null));
  assert.ok(seen.some((request) => request.grant === "client_credentials" && request.resource === null));
});

test("removes the client secret from a token error", { timeout: 20_000 }, async () => {
  const secret = "super-secret-value";
  await assert.rejects(
    () => withClientCredentialsServer((endpoint) => listServerTools(server({
      transport: "http",
      url: endpoint.mcpUrl,
      clientCredentials: {
        clientId: endpoint.clientId,
        clientSecret: secret,
        scope: "tools.read",
      },
    })), { echoSecret: secret }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /rejected/);
      assert.equal(message.includes(secret), false);
      return true;
    },
  );
});

interface TokenRequest {
  grant: string | null;
  scope: string | null;
  resource: string | null;
  basic: boolean;
}

function withClientCredentialsServer<T>(
  action: (endpoint: {
    mcpUrl: string;
    clientId: string;
    clientSecret: string;
    tokenRequests: TokenRequest[];
  }) => Promise<T>,
  options?: { rejectResource?: boolean; echoSecret?: string },
): Promise<T> {
  const clientId = "app-id";
  const clientSecret = options?.echoSecret ?? "test-secret-value";
  const accessToken = "fixture-access-token";
  const tokenRequests: TokenRequest[] = [];
  const mcp = new Server({ name: "oauth-fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: "ping", description: "oauth fixture", inputSchema: { type: "object", properties: {} } }],
  }));
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  });

  return mcp.connect(transport).then(() => new Promise<T>((resolve, reject) => {
    const httpServer = createServer(async (req, res) => {
      try {
        await routeOAuth(req, res, {
          clientId,
          clientSecret,
          accessToken,
          tokenRequests,
          rejectResource: options?.rejectResource === true,
          echoSecret: options?.echoSecret,
          mcpTransport: transport,
        });
      } catch (error) {
        if (!res.headersSent) {
          res.writeHead(500);
          res.end(error instanceof Error ? error.message : String(error));
        }
      }
    });
    httpServer.listen(0, "127.0.0.1", () => {
      const address = httpServer.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const origin = `http://127.0.0.1:${port}`;
      void action({
        mcpUrl: `${origin}/mcp`,
        clientId,
        clientSecret,
        tokenRequests,
      }).then(resolve, reject).finally(() => {
        httpServer.closeAllConnections();
        httpServer.close();
        void mcp.close().catch(() => undefined);
      });
    });
  }));
}

async function routeOAuth(
  req: IncomingMessage,
  res: ServerResponse,
  options: {
    clientId: string;
    clientSecret: string;
    accessToken: string;
    tokenRequests: TokenRequest[];
    rejectResource: boolean;
    echoSecret?: string;
    mcpTransport: StreamableHTTPServerTransport;
  },
): Promise<void> {
  const host = req.headers.host ?? "127.0.0.1";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const origin = `http://${host}`;
  if (url.pathname === "/.well-known/oauth-protected-resource") {
    json(res, {
      resource: `${origin}/mcp`,
      authorization_servers: [`${origin}/`],
      scopes_supported: ["tools.read"],
    });
    return;
  }
  if (url.pathname === "/.well-known/oauth-authorization-server") {
    json(res, {
      issuer: `${origin}/`,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["client_credentials"],
      token_endpoint_auth_methods_supported: ["client_secret_basic"],
    });
    return;
  }
  if (url.pathname === "/token") {
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const expectedBasic = `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`;
    const postedSecret = params.get("client_id") === options.clientId && params.get("client_secret") === options.clientSecret;
    options.tokenRequests.push({
      grant: params.get("grant_type"),
      scope: params.get("scope"),
      resource: params.get("resource"),
      basic: req.headers.authorization === expectedBasic || postedSecret,
    });
    if (options.echoSecret) {
      json(res, {
        error: "invalid_client",
        error_description: `rejected ${options.echoSecret}`,
      }, 400);
      return;
    }
    if (req.headers.authorization !== expectedBasic && !postedSecret) {
      json(res, { error: "invalid_client", error_description: "client authentication failed" }, 401);
      return;
    }
    if (options.rejectResource && params.get("resource")) {
      json(res, {
        error: "invalid_request",
        error_description: "AADSTS9010023: The resource parameter is not supported.",
      }, 400);
      return;
    }
    json(res, { access_token: options.accessToken, token_type: "Bearer", expires_in: 3600 });
    return;
  }

  if (req.headers.authorization !== `Bearer ${options.accessToken}`) {
    await readBody(req);
    res.writeHead(401, {
      "WWW-Authenticate": `Bearer realm="mcp", resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    });
    res.end("unauthorized");
    return;
  }
  await options.mcpTransport.handleRequest(req, res);
}

function json(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function withIssuerBackedServer<T>(
  action: (endpoint: { mcpUrl: string; issuer: string; clientId: string; clientSecret: string }) => Promise<T>,
  options?: { serveIssuer?: boolean },
): Promise<T> {
  const clientId = "app-id";
  const clientSecret = "test-secret-value";
  const accessToken = "issuer-access-token";
  const serveIssuer = options?.serveIssuer !== false;
  const mcp = new Server({ name: "issuer-fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: "ping", description: "issuer fixture", inputSchema: { type: "object", properties: {} } }],
  }));
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  });
  return mcp.connect(transport).then(() => new Promise<T>((resolve, reject) => {
    const httpServer = createServer(async (req, res) => {
      const host = req.headers.host ?? "127.0.0.1";
      const url = new URL(req.url ?? "/", `http://${host}`);
      const origin = `http://${host}`;
      if (serveIssuer && (
        url.pathname === "/.well-known/oauth-authorization-server/tenant/v2.0"
        || url.pathname === "/tenant/v2.0/.well-known/openid-configuration"
      )) {
        json(res, {
          issuer: `${origin}/tenant/v2.0`,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          jwks_uri: `${origin}/keys`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          grant_types_supported: ["client_credentials"],
          token_endpoint_auth_methods_supported: ["client_secret_post"],
        });
        return;
      }
      if (url.pathname === "/token" && serveIssuer) {
        const body = await readBody(req);
        const params = new URLSearchParams(body);
        if (params.get("client_id") !== clientId || params.get("client_secret") !== clientSecret) {
          json(res, { error: "invalid_client", error_description: "client authentication failed" }, 401);
          return;
        }
        json(res, { access_token: accessToken, token_type: "Bearer", expires_in: 3600 });
        return;
      }
      if (url.pathname === "/mcp" && req.headers.authorization === `Bearer ${accessToken}`) {
        await transport.handleRequest(req, res);
        return;
      }
      if (url.pathname === "/mcp") {
        await readBody(req);
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ statusCode: 401, message: "Invalid bearer token." }));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ statusCode: 404, message: "Resource not found" }));
    });
    httpServer.listen(0, "127.0.0.1", () => {
      const address = httpServer.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const origin = `http://127.0.0.1:${port}`;
      void action({
        mcpUrl: `${origin}/mcp`,
        issuer: `${origin}/tenant/v2.0`,
        clientId,
        clientSecret,
      }).then(resolve, reject).finally(() => {
        httpServer.closeAllConnections();
        httpServer.close();
        void mcp.close().catch(() => undefined);
      });
    });
  }));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
