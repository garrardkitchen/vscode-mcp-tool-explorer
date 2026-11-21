import assert from "node:assert/strict";
import test from "node:test";
import { substitute } from "../src/config/variables.js";

const context = {
  env: { API_TOKEN: "secret", PATH: "/usr/bin" },
  userHome: "/Users/me",
  pathSeparator: "/",
  workspaceFolder: "/work/app",
  workspaceFolderBasename: "app",
};

test("resolves editor env, workspace, and home tokens", () => {
  const result = substitute("${workspaceFolder}/bin:${env:PATH}", context);
  assert.deepEqual(result, { value: "/work/app/bin:/usr/bin", unresolved: [] });
});

test("resolves portable variables and defaults", () => {
  const found = substitute("${API_TOKEN}", context);
  const fallback = substitute("${MISSING:-local}", context);
  assert.equal(found.value, "secret");
  assert.equal(fallback.value, "local");
  assert.deepEqual(fallback.unresolved, []);
});

test("reports input and command tokens", () => {
  const result = substitute("Bearer ${input:api-key} ${command:ext.getToken}", context);
  assert.deepEqual(result.unresolved, ["${input:api-key}", "${command:ext.getToken}"]);
});

test("reports a missing env token", () => {
  const result = substitute("${env:NOT_SET}", context);
  assert.equal(result.value, "${env:NOT_SET}");
  assert.deepEqual(result.unresolved, ["${env:NOT_SET}"]);
});
