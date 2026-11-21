import type { SchemaField } from "../types.js";

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema | JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  const?: unknown;
  format?: string;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;
  title?: string;
}

/**
 * Flattens a JSON Schema into rows of name, datatype, and required.
 * Required means the property is listed in its parent object's `required` array.
 */
export function schemaFields(schema: unknown): SchemaField[] {
  if (!isSchema(schema)) {
    return [];
  }
  const fields: SchemaField[] = [];
  const root = resolve(schema, schema, new Set());
  walk(schema, root, "", false, 0, fields, new Set());
  return fields;
}

export function typeLabel(schema: unknown): string {
  if (!isSchema(schema)) {
    return "any";
  }
  return describe(resolve(schema, schema, new Set()), schema);
}

export interface RootProperty {
  name: string;
  required: boolean;
  /** Resolved property schema. Boolean schemas stay booleans. */
  schema: unknown;
}

/** Top-level properties of an object schema, after local `$ref` and `allOf` are resolved. */
export function rootProperties(schema: unknown): RootProperty[] {
  if (!isSchema(schema)) {
    return [];
  }
  const resolved = mergeAllOf(resolve(schema, schema, new Set()), schema);
  if (!resolved.properties) {
    return [];
  }
  const requiredNames = new Set(resolved.required ?? []);
  return Object.entries(resolved.properties).map(([name, property]) => ({
    name,
    required: requiredNames.has(name),
    schema: propertySchema(schema, property),
  }));
}

function propertySchema(root: JsonSchema, property: unknown): unknown {
  if (!isSchema(property)) {
    return property;
  }
  return mergeAllOf(resolve(root, property, new Set()), root);
}

function walk(
  root: JsonSchema,
  schema: unknown,
  name: string,
  required: boolean,
  depth: number,
  fields: SchemaField[],
  stack: Set<JsonSchema>,
): void {
  if (!isSchema(schema)) {
    fields.push({
      name: name.length === 0 ? "(response)" : name,
      type: schema === true ? "any" : "never",
      required,
      depth,
    });
    return;
  }
  const resolved = mergeAllOf(resolve(root, schema, new Set()), root);
  const properties = resolved.properties;
  const isObject = properties !== undefined || typeNames(resolved).includes("object");
  const isRoot = name.length === 0;

  if (isObject && properties && (isRoot || Object.keys(properties).length > 0)) {
    if (!isRoot) {
      fields.push(field(name, describe(resolved, root), required, resolved, depth));
    }
    if (stack.has(resolved)) {
      return;
    }
    const nextStack = new Set(stack);
    nextStack.add(resolved);
    const requiredNames = new Set(resolved.required ?? []);
    const childDepth = isRoot ? 0 : depth + 1;
    for (const [key, child] of Object.entries(properties)) {
      const childName = name.length === 0 ? key : `${name}.${key}`;
      walk(root, child, childName, requiredNames.has(key), childDepth, fields, nextStack);
    }
    if (isSchema(resolved.additionalProperties)) {
      const extraName = name.length === 0 ? "(additional properties)" : `${name}.(additional properties)`;
      walk(root, resolved.additionalProperties, extraName, false, childDepth, fields, nextStack);
    }
    return;
  }

  const label = name.length === 0 ? "(response)" : name;
  fields.push(field(label, describe(resolved, root), required, resolved, depth));

  if (stack.has(resolved)) {
    return;
  }
  const item = arrayItem(resolved);
  if (item && isSchema(item) && (item.properties || typeNames(resolve(root, item, new Set())).includes("object"))) {
    const nextStack = new Set(stack);
    nextStack.add(resolved);
    const itemResolved = resolve(root, item, new Set());
    if (itemResolved.properties) {
      const requiredNames = new Set(itemResolved.required ?? []);
      for (const [key, child] of Object.entries(itemResolved.properties)) {
        walk(root, child, `${label}[].${key}`, requiredNames.has(key), depth + 1, fields, nextStack);
      }
    }
  }
}

function field(
  name: string,
  type: string,
  required: boolean,
  schema: JsonSchema,
  depth: number,
): SchemaField {
  return {
    name,
    type,
    required,
    description: fieldDescription(schema),
    depth,
  };
}

function fieldDescription(schema: JsonSchema): string | undefined {
  const parts: string[] = [];
  if (typeof schema.description === "string" && schema.description.length > 0) {
    parts.push(schema.description);
  }
  if (schema.default !== undefined) {
    parts.push(`Default: ${formatDefault(schema.default)}`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function describe(schema: JsonSchema, root: JsonSchema): string {
  if (schema.const !== undefined) {
    return `const ${formatDefault(schema.const)}`;
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    if (schema.enum.length > 8) {
      return `enum (${schema.enum.length} values)`;
    }
    return schema.enum.map((value) => formatDefault(value)).join(" | ");
  }

  const unions = schema.anyOf ?? schema.oneOf;
  if (unions && unions.length > 0) {
    return unions.map((part) => describe(resolve(root, part, new Set()), root)).join(" | ");
  }

  const names = typeNames(schema);
  if (names.includes("array") || schema.items !== undefined) {
    const item = arrayItem(schema);
    const itemLabel = item ? describe(resolve(root, item, new Set()), root) : "any";
    return `array of ${itemLabel}`;
  }
  if (names.length === 0) {
    return schema.properties ? "object" : "any";
  }

  const formatted = names.map((name) => {
    if (name === "string" && typeof schema.format === "string" && schema.format.length > 0) {
      return `string (${schema.format})`;
    }
    return name;
  });
  return formatted.join(" | ");
}

function typeNames(schema: JsonSchema): string[] {
  if (Array.isArray(schema.type)) {
    return schema.type.filter((name) => typeof name === "string");
  }
  return typeof schema.type === "string" ? [schema.type] : [];
}

function arrayItem(schema: JsonSchema): JsonSchema | undefined {
  if (Array.isArray(schema.items)) {
    return schema.items[0];
  }
  return schema.items;
}

function mergeAllOf(schema: JsonSchema, root: JsonSchema): JsonSchema {
  if (!schema.allOf || schema.allOf.length === 0) {
    return schema;
  }
  const merged: JsonSchema = { ...schema, properties: { ...schema.properties }, required: [...(schema.required ?? [])] };
  delete merged.allOf;
  for (const part of schema.allOf) {
    const flat = mergeAllOf(resolve(root, part, new Set()), root);
    merged.properties = { ...merged.properties, ...flat.properties };
    merged.required = [...(merged.required ?? []), ...(flat.required ?? [])];
    merged.type ??= flat.type;
    merged.description ??= flat.description;
    merged.format ??= flat.format;
  }
  return merged;
}

function resolve(root: JsonSchema, schema: JsonSchema, seen: Set<string>): JsonSchema {
  if (typeof schema.$ref !== "string" || !schema.$ref.startsWith("#/")) {
    return schema;
  }
  if (seen.has(schema.$ref)) {
    return schema;
  }
  const target = pointer(root, schema.$ref);
  if (!target) {
    return schema;
  }
  const next = new Set(seen);
  next.add(schema.$ref);
  return resolve(root, target, next);
}

function pointer(root: JsonSchema, ref: string): JsonSchema | undefined {
  const parts = ref.slice(2).split("/").map(decodePointer);
  let current: unknown = root;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return isSchema(current) ? current : undefined;
}

function decodePointer(part: string): string {
  return decodeURIComponent(part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function formatDefault(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  return JSON.stringify(value);
}

function isSchema(value: unknown): value is JsonSchema {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
