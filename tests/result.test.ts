import assert from "node:assert/strict";
import test from "node:test";
import { summarizeToolResult } from "../src/mcp/result.js";

test("summarizes text, structured content, and non-text blocks", () => {
  const summary = summarizeToolResult({
    isError: true,
    content: [
      { type: "text", text: "failed" },
      { type: "image", data: "abcd", mimeType: "image/png" },
      { type: "resource", resource: { uri: "file:///tmp/a.txt", text: "body" } },
      { type: "resource_link", uri: "file:///tmp/b.txt" },
    ],
    structuredContent: { ok: false },
  });

  assert.equal(summary.isError, true);
  assert.deepEqual(summary.texts, ["failed", "file:///tmp/a.txt\nbody"]);
  assert.equal(summary.structuredText, '{\n  "ok": false\n}');
  assert.match(summary.notes[0] ?? "", /Image \(image\/png, 4 base64 characters\)/);
  assert.match(summary.notes[1] ?? "", /Resource link file:\/\/\/tmp\/b.txt/);
});

test("notes a long response without keeping the tail", () => {
  const summary = summarizeToolResult({
    content: [{ type: "text", text: "x".repeat(200_010) }],
  });
  assert.equal(summary.texts[0]?.length, 200_000);
  assert.match(summary.notes[0] ?? "", /Omitted 10 characters/);
});
