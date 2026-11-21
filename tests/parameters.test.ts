import assert from "node:assert/strict";
import test from "node:test";
import { argumentPlan, collectArguments, collectFromAnswers, fixedArgumentNote, interpretAnswer } from "../src/try/parameters.js";

const sample = {
  type: "object",
  required: ["text", "count"],
  properties: {
    text: { type: "string", description: "Text to echo" },
    note: { type: "string" },
    flag: { type: "boolean", default: true },
    count: { type: "integer" },
    mode: { const: "fast" },
    units: { type: "string", enum: ["c", "f"], default: "c" },
    address: {
      type: "object",
      required: ["city"],
      properties: { city: { type: "string" } },
    },
    tags: { type: "array", items: { type: "string" } },
    limit: { type: "integer", default: 10 },
    score: { type: ["number", "null"] },
  },
};

test("plans one prompt per parameter and sends const values without asking", () => {
  const plan = argumentPlan(sample);
  assert.deepEqual(plan.prompts.map((prompt) => [prompt.name, prompt.kind, prompt.required]), [
    ["text", "string", true],
    ["note", "string", false],
    ["flag", "boolean", false],
    ["count", "integer", true],
    ["units", "enum", false],
    ["address", "json", false],
    ["tags", "json", false],
    ["limit", "integer", false],
    ["score", "number", false],
  ]);
  assert.deepEqual(plan.fixed, { mode: "fast" });
  assert.equal(plan.prompts.find((prompt) => prompt.name === "limit")?.prefill, "10");
  assert.equal(plan.prompts.find((prompt) => prompt.name === "flag")?.choices?.[0]?.description, "Default");
  assert.equal(plan.prompts.find((prompt) => prompt.name === "units")?.choices?.[0]?.description, "Default");
  assert.equal(plan.prompts.find((prompt) => prompt.name === "address")?.container, "object");
  assert.equal(plan.prompts.find((prompt) => prompt.name === "tags")?.container, "array");
  assert.equal(plan.prompts.find((prompt) => prompt.name === "score")?.nullable, true);
});

test("resolves a local ref and merges allOf before prompting", () => {
  const plan = argumentPlan({
    type: "object",
    required: ["id"],
    properties: { id: { $ref: "#/$defs/id" } },
    allOf: [{ properties: { extra: { type: "boolean" } } }],
    $defs: { id: { type: "string", format: "uuid" } },
  });
  assert.deepEqual(plan.prompts.map((prompt) => [prompt.name, prompt.kind, prompt.typeLabel, prompt.required]), [
    ["id", "string", "string (uuid)", true],
    ["extra", "boolean", "boolean", false],
  ]);
});

test("coerces answers and omits optional blanks", async () => {
  const answers: Record<string, string> = {
    text: "hello",
    note: "",
    flag: "true",
    count: "2",
    units: JSON.stringify("f"),
    address: '{"city":"Paris"}',
    tags: '["a"]',
    limit: "",
    score: "null",
  };
  const result = await collectArguments(sample, async (prompt) => answers[prompt.name]);
  assert.deepEqual(result, {
    status: "ready",
    values: {
      mode: "fast",
      text: "hello",
      flag: true,
      count: 2,
      units: "f",
      address: { city: "Paris" },
      tags: ["a"],
      score: null,
    },
  });
});

test("stops prompting when the user cancels", async () => {
  let calls = 0;
  const result = await collectArguments(sample, async () => {
    calls += 1;
    return undefined;
  });
  assert.equal(result.status, "cancelled");
  assert.equal(calls, 1);
});

test("does not prompt when the tool declares no parameters", async () => {
  let calls = 0;
  const result = await collectArguments({ type: "object", properties: {} }, async () => {
    calls += 1;
    return "";
  });
  assert.equal(calls, 0);
  assert.deepEqual(result, { status: "ready", values: {} });
});

test("collects every field from one form and keeps fixed values", () => {
  const result = collectFromAnswers(sample, {
    text: "hello",
    note: "",
    flag: "true",
    count: "2",
    units: JSON.stringify("f"),
    address: '{"city":"Paris"}',
    tags: '["a"]',
    limit: "",
    score: "null",
  });
  assert.deepEqual(result, {
    status: "ready",
    values: {
      mode: "fast",
      text: "hello",
      flag: true,
      count: 2,
      units: "f",
      address: { city: "Paris" },
      tags: ["a"],
      score: null,
    },
  });
  assert.equal(fixedArgumentNote(argumentPlan(sample).fixed), 'Sent automatically: mode is "fast".');
  assert.equal(fixedArgumentNote({}), undefined);
});

test("reports every invalid field and does not return a partial call", () => {
  const result = collectFromAnswers(sample, { text: "", count: "1.5", address: "[]" });
  assert.equal(result.status, "invalid");
  if (result.status !== "invalid") {
    return;
  }
  assert.deepEqual(result.errors.map((error) => error.name), ["text", "count", "address"]);
  assert.equal("values" in result, false);
});

test("rejects malformed numbers, JSON, and empty required values", () => {
  const plan = argumentPlan(sample);
  const count = plan.prompts.find((prompt) => prompt.name === "count");
  const address = plan.prompts.find((prompt) => prompt.name === "address");
  const text = plan.prompts.find((prompt) => prompt.name === "text");
  assert.ok(count && address && text);
  assert.equal(interpretAnswer(count, "1.5").ok, false);
  assert.equal(interpretAnswer(count, "").ok, false);
  assert.equal(interpretAnswer(address, "[]").ok, false);
  assert.equal(interpretAnswer(address, "not json").ok, false);
  assert.equal(interpretAnswer(text, "").ok, false);
  const note = plan.prompts.find((prompt) => prompt.name === "note");
  assert.ok(note);
  assert.deepEqual(interpretAnswer(note, ""), { ok: true, omit: true });
  assert.deepEqual(interpretAnswer(note, "  "), { ok: true, omit: false, value: "  " });
});
