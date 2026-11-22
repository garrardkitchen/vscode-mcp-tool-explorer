import assert from "node:assert/strict";
import test from "node:test";
import { argumentPlan } from "../src/try/parameters.js";
import { renderDetailHtml } from "../src/view/html.js";

test("escapes tool text and shows parameters and a missing response schema", () => {
  const html = renderDetailHtml({
    serverName: "memory",
    serverTransport: "stdio",
    serverFile: "/work/.vscode/mcp.json",
    originLabel: "Workspace · app · .vscode/mcp.json",
    toolName: "create<script>",
    title: "Create",
    description: "<img src=x onerror=alert(1)>",
    parameters: [
      { name: "text", type: "string", required: true, description: "Text to store", depth: 0 },
    ],
    parameterSchema: { type: "object" },
  }, "nonce", "vscode-webview:");

  assert.match(html, /create&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /<td class="type">string<\/td>/);
  assert.match(html, /This tool does not declare a response schema/);
  assert.match(html, /id="try-tool"/);
  assert.match(html, /Try opens a dialog with every parameter/);
  assert.match(html, /<script nonce="nonce">/);
  assert.doesNotMatch(html, /id="try-dialog"/);
  assert.doesNotMatch(html, /<script>/);
});

test("escapes a tool call result and keeps the try script static", () => {
  const html = renderDetailHtml({
    serverName: "memory",
    serverTransport: "stdio",
    serverFile: "/work/.vscode/mcp.json",
    originLabel: "Workspace",
    toolName: "echo",
    title: "Echo",
    parameters: [],
    parameterSchema: { type: "object" },
    call: {
      argumentsText: '{"text":"<script>"}',
      isError: true,
      texts: ["<img src=x onerror=alert(1)>"],
      structuredText: '{"ok":true}',
      notes: ["Image (image/png, 4 base64 characters). The bytes are not shown."],
    },
  }, "nonce", "vscode-webview:");

  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /The tool reported an error/);
  assert.match(html, /Structured result/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>/);
});

const formSchema = {
  type: "object",
  required: ["text", "count"],
  properties: {
    text: { type: "string", description: "Text to echo" },
    flag: { type: "boolean", default: true },
    count: { type: "integer" },
    mode: { const: "fast" },
    units: { type: "string", enum: ["c", "f"], default: "c" },
    address: { type: "object", properties: { city: { type: "string" } } },
    shade: { type: "string", enum: ["a", "b", "c", "d", "e", "f"] },
    limit: { type: "integer", default: 10 },
    score: { type: ["number", "null"] },
  },
};

test("opens a try dialog with every field, run, and cancel", () => {
  const plan = argumentPlan(formSchema);
  const html = renderDetailHtml({
    serverName: "memory",
    serverTransport: "stdio",
    serverFile: "/work/.vscode/mcp.json",
    originLabel: "Workspace",
    toolName: "echo",
    title: "Echo",
    parameters: [],
    parameterSchema: formSchema,
    tryForm: {
      title: "Echo",
      prompts: plan.prompts,
      fixedNote: 'Sent automatically: mode is "fast".',
    },
  }, "nonce", "vscode-webview:");

  assert.match(html, /id="try-dialog"/);
  assert.match(html, /id="try-title">Run Echo</);
  assert.match(html, /Fill in the parameters/);
  assert.match(html, /Sent automatically: mode is &quot;fast&quot;\./);
  assert.match(html, /id="try-cancel"[^>]*>Cancel</);
  assert.match(html, /id="try-run">Run</);
  assert.match(html, /name="text"/);
  assert.match(html, /class="field-status required">Required/);
  assert.match(html, /Text to echo/);
  assert.match(html, /id="try-field-0"[^>]*autofocus/);
  assert.match(html, /name="flag" value="" checked/);
  assert.doesNotMatch(html, /name="flag" value="true" checked/);
  assert.match(html, /Default is true/);
  assert.match(html, /name="count"[^>]*inputmode="numeric"/);
  assert.match(html, /name="units" value="" checked/);
  assert.match(html, /value="&quot;c&quot;"/);
  assert.doesNotMatch(html, /value="&quot;c&quot;" checked/);
  assert.match(html, /Default is c\./);
  assert.match(html, /name="address"[^>]*placeholder="\{\}"/);
  assert.match(html, /Enter a JSON object/);
  assert.match(html, /name="shade"/);
  assert.match(html, /<select[^>]*name="shade"/);
  assert.match(html, /Leave unset/);
  assert.match(html, /name="limit"[^>]*value="10"/);
  assert.match(html, /Enter null for JSON null/);
  assert.match(html, /showModal/);
  assert.match(html, /submitTry/);
  assert.match(html, /cancelTry/);
  assert.match(html, /id="try-history"/);
  assert.match(html, /class="try-history"[\s\S]*id="try-history-help"[\s\S]*class="try-fields"/);
  assert.match(html, /resize: both/);
  assert.match(html, /height: min\(88vh, 900px\)/);
  assert.match(html, /resizeTry/);
  assert.match(html, /suppressDismiss/);
  assert.match(html, /event\.clientX < rect\.left/);
  assert.match(html, /\.try-head, \.try-footer, \.try-history \{ flex: 0 0 auto; \}/);
  assert.match(html, /id="try-clear"[^>]*>Clear fields</);
  assert.match(html, /id="try-remove"[^>]*disabled>Remove</);
  assert.match(html, /id="try-delete-confirm"[^>]*hidden/);
  assert.match(html, /Remove this saved try\?/);
  assert.match(html, /id="try-delete-keep"/);
  assert.match(html, /removeTry/);
  assert.doesNotMatch(html, /Skip/);
  assert.doesNotMatch(html, /<script>/);
});

test("keeps entered values, marks invalid fields, and escapes the dialog", () => {
  const name = "note<script>";
  const html = renderDetailHtml({
    serverName: "memory",
    serverTransport: "stdio",
    serverFile: "/work/.vscode/mcp.json",
    originLabel: "Workspace",
    toolName: "echo",
    title: "Echo",
    parameters: [],
    parameterSchema: { type: "object" },
    tryForm: {
      title: `Echo<img src=x onerror=alert(1)>`,
      prompts: [
        {
          name,
          required: true,
          kind: "string",
          typeLabel: "string",
          description: `<img src=x onerror=alert(1)>`,
          nullable: false,
          container: "any",
        },
        {
          name: "address",
          required: false,
          kind: "json",
          typeLabel: "object",
          nullable: false,
          container: "object",
        },
      ],
      answers: {
        [name]: `"><script>alert(1)</script>`,
        address: `</textarea><script>alert(1)</script>`,
      },
      errors: { [name]: `${name} is required.` },
    },
  }, "nonce", "vscode-webview:");

  assert.match(html, /Run Echo&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /note&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /value="&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
  assert.match(html, /&lt;\/textarea&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /note&lt;script&gt; is required/);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /id="try-field-0"[^>]*autofocus/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<\/textarea><script>/);
  assert.doesNotMatch(html, /<script>/);
});

test("confirms a tool that has no parameters", () => {
  const html = renderDetailHtml({
    serverName: "memory",
    serverTransport: "stdio",
    serverFile: "/work/.vscode/mcp.json",
    originLabel: "Workspace",
    toolName: "ping",
    title: "Ping",
    parameters: [],
    parameterSchema: { type: "object" },
    tryForm: { title: "Ping", prompts: [] },
  }, "nonce", "vscode-webview:");

  assert.match(html, /This tool takes no parameters/);
  assert.match(html, /id="try-run" autofocus>Run</);
  assert.match(html, /id="try-cancel"/);
  assert.match(html, /resize: both/);
  assert.doesNotMatch(html, /class="try-fields"/);
  assert.doesNotMatch(html, /id="try-history"/);
  assert.doesNotMatch(html, /class="try-history"/);
});

test("embeds saved tries without letting their text run", () => {
  const html = renderDetailHtml({
    serverName: "memory",
    serverTransport: "stdio",
    serverFile: "/work/.vscode/mcp.json",
    originLabel: "Workspace",
    toolName: "echo",
    title: "Echo",
    parameters: [],
    parameterSchema: { type: "object" },
    tryForm: {
      title: "Echo",
      prompts: [{
        name: "text",
        required: true,
        kind: "string",
        typeLabel: "string",
        nullable: false,
        container: "any",
      }],
      history: [{
        id: "try-1",
        savedAt: "2026-11-22T12:00:00.000Z",
        answers: { text: `</script><img src=x onerror=alert(1)>` },
      }],
    },
  }, "nonce", "vscode-webview:");

  assert.match(html, /\\u003c\/script&gt;|\\u003c\/script>/);
  assert.match(html, /try-1/);
  assert.doesNotMatch(html, /<\/script><img/);
  assert.doesNotMatch(html, /<script>/);
});

test("applies a saved dialog size and drops a size that is not a length", () => {
  const prompt = {
    name: "text",
    required: true,
    kind: "string" as const,
    typeLabel: "string",
    nullable: false,
    container: "any" as const,
  };
  const base = {
    serverName: "memory",
    serverTransport: "stdio",
    serverFile: "/work/.vscode/mcp.json",
    originLabel: "Workspace",
    toolName: "echo",
    title: "Echo",
    parameters: [],
    parameterSchema: { type: "object" },
  };
  const saved = renderDetailHtml({
    ...base,
    tryForm: {
      title: "Echo",
      prompts: [prompt],
      dialogSize: { width: 640, height: 820 },
    },
  }, "nonce", "vscode-webview:");
  assert.match(saved, /dialog#try-dialog\.try-dialog \{\s*width: min\(640px, calc\(100vw - 16px\)\);\s*height: min\(820px, calc\(100vh - 16px\)\);/);
  assert.doesNotMatch(saved, /style="/);

  const rejected = renderDetailHtml({
    ...base,
    tryForm: {
      title: "Echo",
      prompts: [prompt],
      dialogSize: { width: "640px;background:url(https://evil)" as unknown as number, height: 820 },
    },
  }, "nonce", "vscode-webview:");
  assert.doesNotMatch(rejected, /evil/);
  assert.doesNotMatch(rejected, /640px/);
});
