import { rootProperties, typeLabel } from "../schema/fields.js";

export interface ParameterChoice {
  label: string;
  /** JSON text of the value that will be sent. */
  value: string;
  description?: string;
}

export type ParameterKind = "string" | "number" | "integer" | "boolean" | "enum" | "json";

export interface ParameterPrompt {
  name: string;
  required: boolean;
  kind: ParameterKind;
  typeLabel: string;
  description?: string;
  /** True when the schema allows JSON null. String parameters still send the typed text. */
  nullable: boolean;
  prefill?: string;
  choices?: ParameterChoice[];
  container: "array" | "object" | "any";
}

export interface ArgumentPlan {
  prompts: ParameterPrompt[];
  /** Values sent without a prompt, such as a `const` property. */
  fixed: Record<string, unknown>;
}

export type InterpretedAnswer =
  | { ok: true; omit: true }
  | { ok: true; omit: false; value: unknown }
  | { ok: false; message: string };

export interface FieldError {
  name: string;
  message: string;
}

export type ArgumentCollection =
  | { status: "cancelled" }
  | { status: "invalid"; message: string; errors: FieldError[] }
  | { status: "ready"; values: Record<string, unknown> };

const ENUM_PICK_LIMIT = 50;

export function argumentPlan(schema: unknown): ArgumentPlan {
  const prompts: ParameterPrompt[] = [];
  const fixed: Record<string, unknown> = {};
  for (const property of rootProperties(schema)) {
    const built = promptFor(property.name, property.required, property.schema);
    if (built.kind === "fixed") {
      assign(fixed, property.name, built.value);
    } else if (built.kind === "prompt") {
      prompts.push(built.prompt);
    }
  }
  return { prompts, fixed };
}

export function interpretAnswer(prompt: ParameterPrompt, text: string): InterpretedAnswer {
  const blank = prompt.kind === "string" ? text === "" : text.trim() === "";
  if (blank) {
    if (prompt.required) {
      return { ok: false, message: `${prompt.name} is required.` };
    }
    return { ok: true, omit: true };
  }
  if (prompt.nullable && prompt.kind !== "string" && prompt.kind !== "boolean" && prompt.kind !== "enum" && text.trim() === "null") {
    return { ok: true, omit: false, value: null };
  }

  switch (prompt.kind) {
    case "string":
      return { ok: true, omit: false, value: text };
    case "integer":
      return parseNumber(prompt.name, text, true);
    case "number":
      return parseNumber(prompt.name, text, false);
    case "boolean":
      if (text === "true") {
        return { ok: true, omit: false, value: true };
      }
      if (text === "false") {
        return { ok: true, omit: false, value: false };
      }
      return { ok: false, message: `${prompt.name} must be true or false.` };
    case "enum": {
      const match = prompt.choices?.find((choice) => choice.value === text);
      if (!match) {
        return { ok: false, message: `${prompt.name} must be one of the listed values.` };
      }
      return { ok: true, omit: false, value: JSON.parse(match.value) as unknown };
    }
    case "json":
      return parseJson(prompt, text);
    default:
      return { ok: false, message: `${prompt.name} could not be read.` };
  }
}

export async function collectArguments(
  schema: unknown,
  ask: (prompt: ParameterPrompt, step: number, total: number) => Promise<string | undefined>,
): Promise<ArgumentCollection> {
  const plan = argumentPlan(schema);
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(plan.fixed)) {
    assign(values, key, value);
  }
  const total = plan.prompts.length;
  for (let index = 0; index < total; index++) {
    const prompt = plan.prompts[index];
    if (!prompt) {
      continue;
    }
    const answer = await ask(prompt, index + 1, total);
    if (answer === undefined) {
      return { status: "cancelled" };
    }
    const interpreted = interpretAnswer(prompt, answer);
    if (!interpreted.ok) {
      return {
        status: "invalid",
        message: interpreted.message,
        errors: [{ name: prompt.name, message: interpreted.message }],
      };
    }
    if (!interpreted.omit) {
      assign(values, prompt.name, interpreted.value);
    }
  }
  return { status: "ready", values };
}

/** Reads every field at once. An empty answer omits an optional parameter. */
export function collectFromAnswers(schema: unknown, answers: Record<string, string>): ArgumentCollection {
  const plan = argumentPlan(schema);
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(plan.fixed)) {
    assign(values, key, value);
  }
  const errors: FieldError[] = [];
  for (const prompt of plan.prompts) {
    const interpreted = interpretAnswer(prompt, ownString(answers, prompt.name) ?? "");
    if (!interpreted.ok) {
      errors.push({ name: prompt.name, message: interpreted.message });
      continue;
    }
    if (!interpreted.omit) {
      assign(values, prompt.name, interpreted.value);
    }
  }
  const first = errors[0];
  if (first) {
    return { status: "invalid", message: first.message, errors };
  }
  return { status: "ready", values };
}

/** Short note for values the dialog does not ask for, such as `const`. */
export function fixedArgumentNote(fixed: Record<string, unknown>): string | undefined {
  const names = Object.keys(fixed);
  if (names.length === 0) {
    return undefined;
  }
  const parts = names.map((name) => `${name} is ${encodedFixed(fixed[name])}`);
  return `Sent automatically: ${parts.join(", ")}.`;
}

type BuiltPrompt =
  | { kind: "skip" }
  | { kind: "fixed"; value: unknown }
  | { kind: "prompt"; prompt: ParameterPrompt };

function promptFor(name: string, required: boolean, schema: unknown): BuiltPrompt {
  if (schema === true) {
    return { kind: "prompt", prompt: jsonPrompt(name, required, "any", true, "any", undefined, undefined) };
  }
  if (!isRecord(schema)) {
    return { kind: "skip" };
  }
  const effective = unwrapSingleUnion(schema);
  if ("const" in effective) {
    return { kind: "fixed", value: effective.const };
  }

  const enumerated = enumValues(effective);
  if (enumerated && enumerated.length > 0 && enumerated.length <= ENUM_PICK_LIMIT) {
    return { kind: "prompt", prompt: enumPrompt(name, required, effective, enumerated) };
  }

  const types = typeNames(effective).filter((typeName) => typeName !== "null");
  const nullable = isNullable(effective);
  const description = typeof effective.description === "string" && effective.description.length > 0
    ? effective.description
    : undefined;
  if (types.length > 1 || (enumerated && enumerated.length > ENUM_PICK_LIMIT)) {
    return { kind: "prompt", prompt: jsonPrompt(name, required, typeLabel(effective), nullable, "any", description, effective.default) };
  }

  const typeName = types[0];
  if (typeName === "string") {
    return {
      kind: "prompt",
      prompt: {
        name,
        required,
        kind: "string",
        typeLabel: typeLabel(effective),
        description,
        nullable,
        prefill: typeof effective.default === "string" ? effective.default : undefined,
        container: "any",
      },
    };
  }
  if (typeName === "integer" || typeName === "number") {
    return {
      kind: "prompt",
      prompt: {
        name,
        required,
        kind: typeName,
        typeLabel: typeLabel(effective),
        description,
        nullable,
        prefill: typeof effective.default === "number" ? String(effective.default) : undefined,
        container: "any",
      },
    };
  }
  if (typeName === "boolean") {
    const encodedDefault = typeof effective.default === "boolean" ? JSON.stringify(effective.default) : undefined;
    return {
      kind: "prompt",
      prompt: {
        name,
        required,
        kind: "boolean",
        typeLabel: "boolean",
        description,
        nullable,
        container: "any",
        choices: [
          { label: "true", value: "true", description: encodedDefault === "true" ? "Default" : undefined },
          { label: "false", value: "false", description: encodedDefault === "false" ? "Default" : undefined },
        ],
      },
    };
  }
  if (typeName === "array" || effective.items !== undefined) {
    return { kind: "prompt", prompt: jsonPrompt(name, required, typeLabel(effective), nullable, "array", description, effective.default) };
  }
  if (typeName === "object" || isRecord(effective.properties)) {
    return { kind: "prompt", prompt: jsonPrompt(name, required, typeLabel(effective), nullable, "object", description, effective.default) };
  }
  return { kind: "prompt", prompt: jsonPrompt(name, required, typeLabel(effective), nullable, "any", description, effective.default) };
}

function enumPrompt(name: string, required: boolean, schema: Record<string, unknown>, values: unknown[]): ParameterPrompt {
  const encodedDefault = "default" in schema ? JSON.stringify(schema.default) : undefined;
  return {
    name,
    required,
    kind: "enum",
    typeLabel: typeLabel(schema),
    description: typeof schema.description === "string" && schema.description.length > 0 ? schema.description : undefined,
    nullable: isNullable(schema),
    container: "any",
    choices: values.flatMap((value) => {
      const encoded = JSON.stringify(value);
      if (encoded === undefined) {
        return [];
      }
      return [{
        label: displayValue(value),
        value: encoded,
        description: encodedDefault === encoded ? "Default" : undefined,
      }];
    }),
  };
}

function jsonPrompt(
  name: string,
  required: boolean,
  label: string,
  nullable: boolean,
  container: "array" | "object" | "any",
  description: string | undefined,
  fallback: unknown,
): ParameterPrompt {
  return {
    name,
    required,
    kind: "json",
    typeLabel: label,
    description,
    nullable,
    container,
    prefill: fallback === undefined ? undefined : JSON.stringify(fallback),
  };
}

function parseNumber(name: string, text: string, integer: boolean): InterpretedAnswer {
  const trimmed = text.trim();
  const pattern = integer ? /^-?\d+$/ : /^-?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/;
  if (!pattern.test(trimmed)) {
    return { ok: false, message: integer ? `${name} must be an integer.` : `${name} must be a number.` };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, message: `${name} must be a finite number.` };
  }
  return { ok: true, omit: false, value };
}

function parseJson(prompt: ParameterPrompt, text: string): InterpretedAnswer {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, message: `${prompt.name} must be JSON.` };
  }
  if (prompt.container === "array" && !Array.isArray(value)) {
    return { ok: false, message: `${prompt.name} must be a JSON array.` };
  }
  if (prompt.container === "object" && (!isRecord(value))) {
    return { ok: false, message: `${prompt.name} must be a JSON object.` };
  }
  return { ok: true, omit: false, value };
}

function enumValues(schema: Record<string, unknown>): unknown[] | undefined {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum;
  }
  const unions = unionParts(schema);
  if (!unions || unions.length === 0 || !unions.every((part) => "const" in part)) {
    return undefined;
  }
  return unions.map((part) => part.const);
}

function unwrapSingleUnion(schema: Record<string, unknown>): Record<string, unknown> {
  let current = schema;
  for (let depth = 0; depth < 5; depth++) {
    const unions = unionParts(current);
    const only = unions?.length === 1 ? unions[0] : undefined;
    if (!only) {
      return current;
    }
    current = only;
  }
  return current;
}

function unionParts(schema: Record<string, unknown>): Record<string, unknown>[] | undefined {
  const unions = schema.anyOf ?? schema.oneOf;
  if (!Array.isArray(unions) || unions.length === 0) {
    return undefined;
  }
  const parts: Record<string, unknown>[] = [];
  for (const part of unions) {
    if (!isRecord(part)) {
      return undefined;
    }
    parts.push(part);
  }
  return parts;
}

function isNullable(schema: Record<string, unknown>): boolean {
  if (typeNames(schema).includes("null")) {
    return true;
  }
  const unions = unionParts(schema);
  return unions?.some((part) => part.type === "null" || part.const === null) ?? false;
}

function typeNames(schema: Record<string, unknown>): string[] {
  if (Array.isArray(schema.type)) {
    return schema.type.filter((name): name is string => typeof name === "string");
  }
  return typeof schema.type === "string" ? [schema.type] : [];
}

function displayValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "" : encoded;
}

function ownString(record: Record<string, string>, key: string): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return typeof descriptor?.value === "string" ? descriptor.value : undefined;
}

function encodedFixed(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    if (text === undefined) {
      return "undefined";
    }
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  } catch {
    return "unprintable";
  }
}

function assign(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
