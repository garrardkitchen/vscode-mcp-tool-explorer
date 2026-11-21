import assert from "node:assert/strict";
import test from "node:test";
import { classifyToolClick, TOOL_OPEN_WINDOW_MS, type ToolClickState } from "../src/view/open.js";

test("a single click opens the replaceable tab and a different tool replaces it", () => {
  const first = classifyToolClick({}, "server\0alpha", 1_000);
  assert.equal(first.action, "preview");
  const second = classifyToolClick(first.state, "server\0beta", 1_000 + 50);
  assert.equal(second.action, "preview");
  assert.equal(second.state.key, "server\0beta");
});

test("a second click on the same tool inside the window keeps the tab", () => {
  const first = classifyToolClick({}, "server\0alpha", 1_000);
  const second = classifyToolClick(first.state, "server\0alpha", 1_000 + TOOL_OPEN_WINDOW_MS);
  assert.equal(second.action, "pin");
  const extra = classifyToolClick(second.state, "server\0alpha", 1_000 + TOOL_OPEN_WINDOW_MS + 10);
  assert.equal(extra.action, "ignore");
  const other = classifyToolClick(second.state, "server\0beta", 1_000 + TOOL_OPEN_WINDOW_MS + 10);
  assert.equal(other.action, "preview");
});

test("a later click on the same tool updates the replaceable tab again", () => {
  let state: ToolClickState = {};
  state = classifyToolClick(state, "server\0alpha", 1_000).state;
  const again = classifyToolClick(state, "server\0alpha", 1_000 + TOOL_OPEN_WINDOW_MS + 1);
  assert.equal(again.action, "preview");
});
