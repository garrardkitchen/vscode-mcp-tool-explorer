import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ResolvedServer, ToolDefinition, ToolIcon } from "../types.js";
import { missingClientSecretMessage, redactSecret } from "./credentials.js";
import { summarizeToolResult, type ToolCallSummary } from "./result.js";
import { accessTokenFor } from "./token.js";

const CLIENT_INFO = { name: "mcp-tool-xplorer", version: "0.1.17" };
const MAX_PAGES = 64;

/**
 * Connects, reads every tools/list page, and closes the connection.
 * A stdio server is a child process and is stopped before this returns.
 */
export async function listServerTools(server: ResolvedServer, timeoutMs = 20_000): Promise<ToolDefinition[]> {
  return withClient(server, timeoutMs, (client) =>
    withTimeout(listAllTools(client), timeoutMs, `Timed out listing tools after ${timeoutMs}ms`),
  );
}

/**
 * Connects, calls one tool, and closes the connection.
 * A stdio server is a child process and is stopped before this returns.
 * Connecting times out after 20 seconds. The call times out after 60 seconds.
 */
export async function callServerTool(
  server: ResolvedServer,
  toolName: string,
  args: Record<string, unknown>,
  options?: { connectTimeoutMs?: number; callTimeoutMs?: number },
): Promise<ToolCallSummary> {
  const connectTimeoutMs = options?.connectTimeoutMs ?? 20_000;
  const callTimeoutMs = options?.callTimeoutMs ?? 60_000;
  return withClient(server, connectTimeoutMs, async (client) => {
    const result = await withTimeout(
      client.callTool({ name: toolName, arguments: args }, undefined, { timeout: callTimeoutMs }),
      callTimeoutMs,
      `Timed out calling ${toolName} after ${callTimeoutMs}ms`,
    );
    return summarizeToolResult(result);
  });
}

async function withClient<T>(
  server: ResolvedServer,
  connectTimeoutMs: number,
  action: (client: Client) => Promise<T>,
): Promise<T> {
  if (server.skipReason) {
    throw new Error(server.skipReason);
  }
  if (server.clientCredentials && !server.clientCredentials.clientSecret) {
    throw new Error(missingClientSecretMessage(server.name));
  }

  const opened: Client[] = [];
  let stderr = "";
  try {
    const client = await withTimeout(
      connect(server, opened, (text) => {
        stderr = text;
      }),
      connectTimeoutMs,
      `Timed out connecting after ${connectTimeoutMs}ms`,
    );
    return await action(client);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const log = stderr.trim().slice(-500);
    const text = log.length > 0 ? `${message}\n${log}` : message;
    throw new Error(redactSecret(text, server.clientCredentials?.clientSecret));
  } finally {
    await Promise.all(opened.map((client) => client.close().catch(() => undefined)));
  }
}

async function connect(
  server: ResolvedServer,
  opened: Client[],
  captureStderr: (text: string) => void,
): Promise<Client> {
  if (server.transport === "stdio") {
    const client = new Client(CLIENT_INFO);
    opened.push(client);
    let stderr = "";
    const transport = new StdioClientTransport({
      command: server.command ?? "",
      args: server.args,
      env: server.env,
      cwd: server.cwd,
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = (stderr + Buffer.from(chunk).toString("utf8")).slice(-2000);
      captureStderr(stderr);
    });
    await client.connect(transport);
    return client;
  }

  const url = new URL(server.url ?? "");
  const connecting = server.clientCredentials?.clientSecret
    ? await withAccessToken(server)
    : server;
  return connectHttp(connecting, url, opened);
}

async function withAccessToken(server: ResolvedServer): Promise<ResolvedServer> {
  const token = await accessTokenFor(server);
  return {
    ...server,
    headers: { ...server.headers, Authorization: `Bearer ${token}` },
    clientCredentials: undefined,
  };
}

function connectHttp(server: ResolvedServer, url: URL, opened: Client[]): Promise<Client> {
  const requestInit = server.headers ? { headers: server.headers } : undefined;
  if (server.transport === "sse") {
    return connectTransport(opened, new SSEClientTransport(url, { requestInit }));
  }

  return connectTransport(opened, new StreamableHTTPClientTransport(url, { requestInit }))
    .catch(async (error: unknown) => {
      try {
        return await connectTransport(opened, new SSEClientTransport(url, { requestInit }));
      } catch (sseError) {
        const first = error instanceof Error ? error.message : String(error);
        const second = sseError instanceof Error ? sseError.message : String(sseError);
        throw new Error(`${first}\nSSE fallback failed: ${second}`);
      }
    });
}

async function connectTransport(opened: Client[], transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport): Promise<Client> {
  const client = new Client(CLIENT_INFO);
  opened.push(client);
  await client.connect(transport);
  return client;
}

async function listAllTools(client: Client): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await client.listTools(cursor ? { cursor } : undefined);
    for (const tool of result.tools) {
      tools.push({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        icons: tool.icons?.map(normalizeIcon),
      });
    }
    if (!result.nextCursor || seenCursors.has(result.nextCursor)) {
      return tools;
    }
    seenCursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }

  throw new Error("The server returned too many tool pages.");
}

function normalizeIcon(icon: ToolIcon): ToolIcon {
  return {
    src: icon.src,
    mimeType: icon.mimeType,
    sizes: icon.sizes,
    theme: icon.theme,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}
