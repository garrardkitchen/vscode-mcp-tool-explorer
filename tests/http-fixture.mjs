import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const mcp = new Server(
  { name: "http-fixture", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "ping",
      description: "HTTP fixture tool",
      inputSchema: {
        type: "object",
        properties: {
          n: { type: "integer" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
        },
        required: ["ok"],
      },
    },
  ],
}));

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
  enableJsonResponse: true,
});
await mcp.connect(transport);

const httpServer = createServer(async (req, res) => {
  if (req.headers["x-test-token"] !== "secret") {
    res.writeHead(401);
    res.end("missing token");
    return;
  }
  try {
    await transport.handleRequest(req, res);
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
  process.stdout.write(`${port}\n`);
});
