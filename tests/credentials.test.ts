import assert from "node:assert/strict";
import test from "node:test";
import { clientSecretStorageKey, redactSecret, resourceParameterRejected } from "../src/mcp/credentials.js";

test("client secret storage keys differ by server and client", () => {
  const first = clientSecretStorageKey("origin::entra", "app-1");
  const second = clientSecretStorageKey("origin::entra", "app-2");
  assert.notEqual(first, second);
  assert.match(first, /^mcpToolXplorer\.clientSecret\0origin::entra\0app-1$/);
  assert.match(second, /^mcpToolXplorer\.clientSecret\0origin::entra\0app-2$/);
});

test("redacts a client secret and recognizes a rejected resource parameter", () => {
  const secret = "super-secret-value";
  assert.equal(redactSecret(`rejected ${secret} now`, secret), "rejected ••• now");
  assert.equal(redactSecret("no secret here", undefined), "no secret here");
  assert.equal(resourceParameterRejected(new Error("AADSTS9010023: The resource parameter is not supported.")), true);
  assert.equal(resourceParameterRejected(new Error("invalid_client")), false);
  assert.equal(resourceParameterRejected(new Error("Protected resource https://mcp.example does not match expected https://other.example/")), false);
});
