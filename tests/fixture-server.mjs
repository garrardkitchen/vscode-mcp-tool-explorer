import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const icon = {
  src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  mimeType: "image/png",
  sizes: ["24x24"],
};

const echo = {
  name: "echo",
  title: "Echo",
  description: "Echo text back",
  icons: [icon],
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Text to echo" },
    },
    required: ["text"],
  },
  outputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
    },
    required: ["text"],
  },
};

const quiet = {
  name: "quiet",
  description: "No declared result",
  inputSchema: { type: "object", properties: {} },
};

const server = new Server(
  { name: "fixture", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  if (request.params?.cursor === "page-2") {
    return { tools: [quiet] };
  }
  return { tools: [echo], nextCursor: "page-2" };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "echo") {
    const text = request.params.arguments?.text;
    const value = typeof text === "string" ? text : "";
    return {
      content: [{ type: "text", text: value }],
      structuredContent: { text: value },
    };
  }
  return { content: [{ type: "text", text: "ok" }] };
});

await server.connect(new StdioServerTransport());
