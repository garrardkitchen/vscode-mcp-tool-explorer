import assert from "node:assert/strict";
import test from "node:test";
import { schemaFields } from "../src/schema/fields.js";

test("flattens parameters, nested objects, arrays, enums, and defaults", () => {
  const fields = schemaFields({
    type: "object",
    required: ["location"],
    properties: {
      location: { type: "string", description: "City name" },
      units: { type: "string", enum: ["c", "f"] },
      limit: { type: "integer", default: 10 },
      address: {
        type: "object",
        required: ["city"],
        properties: { city: { type: "string" } },
      },
      tags: {
        type: "array",
        items: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
  });

  assert.deepEqual(fields.map((field) => [field.name, field.type, field.required, field.description]), [
    ["location", "string", true, "City name"],
    ["units", '"c" | "f"', false, undefined],
    ["limit", "integer", false, "Default: 10"],
    ["address", "object", false, undefined],
    ["address.city", "string", true, undefined],
    ["tags", "array of object", false, undefined],
    ["tags[].id", "string", true, undefined],
  ]);
});

test("resolves local refs and array response schemas", () => {
  const parameters = schemaFields({
    type: "object",
    properties: {
      id: { $ref: "#/$defs/Id" },
    },
    $defs: {
      Id: { type: "string", format: "uuid" },
    },
  });
  assert.deepEqual(parameters.map((field) => [field.name, field.type]), [["id", "string (uuid)"]]);

  const response = schemaFields({
    type: "array",
    items: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    },
  });
  assert.deepEqual(response.map((field) => [field.name, field.type, field.required]), [
    ["(response)", "array of object", false],
    ["(response)[].name", "string", true],
  ]);
});
