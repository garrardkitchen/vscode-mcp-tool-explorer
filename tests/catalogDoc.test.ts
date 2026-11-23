import assert from "node:assert/strict";
import test from "node:test";
import { toolsMarkdown } from "../src/floor/catalogDoc.js";

test("writes parameters and a response schema without calling the tool", () => {
  const markdown = toolsMarkdown([{
    name: "entra-dev",
    originLabel: "Copilot",
    environment: "DEV",
    tools: [{
      name: "get_user",
      title: "Get | user",
      description: "Read one\nuser",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", description: "User | id" } },
        required: ["id"],
      },
      outputSchema: {
        type: "object",
        properties: { mail: { type: "string" } },
      },
    }],
  }]);

  assert.match(markdown, /^# Tools\n/);
  assert.ok(markdown.indexOf("| Tool | Description |") < markdown.indexOf("## entra-dev"));
  assert.match(markdown, /\| \[Get \\| user\]\(#get--user\) \| Read one user \|/);
  assert.match(markdown, /## entra-dev/);
  assert.match(markdown, /DEV · Copilot/);
  assert.match(markdown, /### Get \| user/);
  assert.match(markdown, /`get_user`/);
  assert.match(markdown, /Read one user/);
  assert.match(markdown, /\| id \| string \| yes \| User \\| id \|/);
  assert.match(markdown, /\| mail \| string \| no \| {2}\|/);
  assert.match(markdown, /```json\n\{/);
  assert.doesNotMatch(markdown, /tools\/call/);
});

test("says when a tool declares no parameters or response schema", () => {
  const markdown = toolsMarkdown([{
    name: "docs",
    originLabel: "Workspace",
    note: "This server still contains ${input:token}.",
    tools: [],
  }, {
    name: "plain",
    originLabel: "Workspace",
    tools: [{
      name: "ping",
      title: "Ping",
      inputSchema: { type: "object", properties: {} },
    }, {
      name: "ping-again",
      title: "Ping",
      inputSchema: { type: "object", properties: {} },
    }],
  }]);

  assert.match(markdown, /\| \[Ping\]\(#ping\) \| {2}\|/);
  assert.match(markdown, /\| \[Ping\]\(#ping-1\) \| {2}\|/);
  assert.match(markdown, /This server still contains \$\{input:token\}\./);
  assert.match(markdown, /This tool declares no parameters\./);
  assert.match(markdown, /This tool does not declare a response schema\./);
  assert.doesNotMatch(markdown, /### Ping[\s\S]*#### Response schema/);
});
