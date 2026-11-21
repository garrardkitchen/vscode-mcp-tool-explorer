import path from "node:path";
import { parse as parseJsonc, printParseErrorCode, type ParseError } from "jsonc-parser";
import type { ClientCredentials, ConfigProblem, ResolvedServer } from "../types.js";
import type { Origin } from "./origins.js";
import { parseEnvFile } from "./envFile.js";
import { substitute, type VariableContext } from "./variables.js";

export interface ParseInput {
  origin: Origin;
  text: string;
  variables: VariableContext;
  /** Reads an envFile. Return undefined when the file does not exist. */
  readEnvFile?: (filePath: string) => string | undefined;
}

export interface ParseResult {
  servers: ResolvedServer[];
  problems: ConfigProblem[];
}

export function parseConfigText(input: ParseInput): ParseResult {
  const errors: ParseError[] = [];
  const value = parseJsonc(input.text.replace(/^\uFEFF/, ""), errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const error = errors[0];
    const code = error ? printParseErrorCode(error.error) : "ParseError";
    const offset = error?.offset ?? 0;
    return {
      servers: [],
      problems: [{
        file: input.origin.file,
        message: `Could not parse ${input.origin.label}: ${code} at offset ${offset}.`,
      }],
    };
  }

  const root = asRecord(value);
  if (!root) {
    return {
      servers: [],
      problems: [{
        file: input.origin.file,
        message: `${input.origin.label} must be a JSON object.`,
      }],
    };
  }

  const key = input.origin.format === "vscode" ? "servers" : "mcpServers";
  const otherKey = key === "servers" ? "mcpServers" : "servers";
  if (!(key in root)) {
    const hint = otherKey in root
      ? ` This file has "${otherKey}" instead of "${key}".`
      : "";
    return {
      servers: [],
      problems: [{
        file: input.origin.file,
        message: `${input.origin.label} has no "${key}" object.${hint}`,
      }],
    };
  }

  const servers = asRecord(root[key]);
  if (!servers) {
    return {
      servers: [],
      problems: [{
        file: input.origin.file,
        message: `${input.origin.label} "${key}" must be an object.`,
      }],
    };
  }

  const problems: ConfigProblem[] = [];
  const resolved: ResolvedServer[] = [];
  for (const [name, raw] of Object.entries(servers)) {
    const entry = asRecord(raw);
    if (!entry) {
      problems.push({
        file: input.origin.file,
        message: `Server "${name}" in ${input.origin.label} is not an object.`,
      });
      continue;
    }
    resolved.push(resolveServer(name, entry, input));
  }

  return { servers: resolved, problems };
}

function resolveServer(
  name: string,
  entry: Record<string, unknown>,
  input: ParseInput,
): ResolvedServer {
  const base: ResolvedServer = {
    id: `${input.origin.id}::${name}`,
    name,
    originLabel: input.origin.label,
    originFile: input.origin.file,
    transport: "stdio",
  };

  const unresolved = new Set<string>();
  const take = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
      return undefined;
    }
    const result = substitute(value, input.variables);
    for (const token of result.unresolved) {
      unresolved.add(token);
    }
    return result.value;
  };

  const command = take(entry.command);
  const args = readArgs(entry.args, take);
  const url = take(entry.url);
  const headers = readHeaders(entry.headers, take);
  const cwd = take(entry.cwd);
  const allowlist = readAllowlist(entry.tools);
  const credentials = readClientCredentials(entry, take);
  if (entry.sandboxEnabled === true) {
    base.notice = "sandboxEnabled is ignored. The server runs as a normal process.";
  }

  const transport = inferTransport(entry.type, command, url);
  base.transport = transport ?? "stdio";
  base.command = command;
  base.url = url;
  base.toolAllowlist = allowlist;

  if (unresolved.size > 0) {
    base.skipReason = `Unresolved ${[...unresolved].join(", ")}. This extension does not prompt for inputs or run command variables.`;
    return base;
  }

  if (args.problem || headers.problem) {
    base.skipReason = args.problem ?? headers.problem;
    return base;
  }
  base.args = args.args;
  base.headers = headers.headers;

  if (transport === undefined) {
    base.skipReason = command && url
      ? "Set type to stdio, http, or sse. This entry has both a command and a url."
      : "Set type to stdio, http, or sse, and provide a command or a url.";
    return base;
  }

  if (credentials.problem) {
    base.skipReason = credentials.problem;
    return base;
  }
  if (credentials.config && !hasAuthorizationHeader(headers.headers)) {
    if (transport === "stdio") {
      base.skipReason = "A client credentials grant applies to an HTTP server.";
      return base;
    }
    base.clientCredentials = credentials.config;
    const grantNote = "Connects with a client credentials grant.";
    base.notice = base.notice ? `${base.notice} ${grantNote}` : grantNote;
  } else if (hasOAuth(entry) && !hasAuthorizationHeader(headers.headers)) {
    base.skipReason = "This server is configured for OAuth sign-in. This extension does not start that browser flow. Set oauthGrantType to client_credentials for a machine-to-machine client.";
    return base;
  }

  if (transport === "stdio") {
    if (!command) {
      base.skipReason = "This stdio server has no command.";
      return base;
    }
    const envResult = resolveEnv(entry, input, unresolved);
    if (unresolved.size > 0) {
      base.skipReason = `Unresolved ${[...unresolved].join(", ")}. This extension does not prompt for inputs or run command variables.`;
      return base;
    }
    if (envResult.skipReason) {
      base.skipReason = envResult.skipReason;
      return base;
    }
    base.command = command;
    base.env = envResult.env;
    base.cwd = resolveCwd(cwd, input);
    return base;
  }

  if (!url) {
    base.skipReason = "This HTTP server has no url.";
    return base;
  }
  if (url.startsWith("unix://") || url.startsWith("pipe://")) {
    base.skipReason = "Unix socket and named pipe MCP endpoints are not supported.";
    return base;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      base.skipReason = "The server URL must use http or https.";
      return base;
    }
  } catch {
    base.skipReason = "The server URL is not valid.";
    return base;
  }

  base.url = url;
  return base;
}

function inferTransport(
  rawType: unknown,
  command: string | undefined,
  url: string | undefined,
): ResolvedServer["transport"] | undefined {
  if (rawType === "stdio" || rawType === "http" || rawType === "sse") {
    return rawType;
  }
  if (rawType !== undefined) {
    return undefined;
  }
  if (url && !command) {
    return "http";
  }
  if (command && !url) {
    return "stdio";
  }
  return undefined;
}

function resolveEnv(
  entry: Record<string, unknown>,
  input: ParseInput,
  unresolved: Set<string>,
): { env?: Record<string, string>; skipReason?: string } {
  const env: Record<string, string> = {};
  const envFile = typeof entry.envFile === "string"
    ? substitute(entry.envFile, input.variables)
    : undefined;
  if (envFile) {
    for (const token of envFile.unresolved) {
      unresolved.add(token);
    }
    if (envFile.unresolved.length > 0) {
      return {};
    }
    const filePath = path.isAbsolute(envFile.value)
      ? envFile.value
      : path.resolve(envFileBase(input), envFile.value);
    const text = input.readEnvFile?.(filePath);
    if (text === undefined) {
      return { skipReason: `Environment file not found: ${filePath}` };
    }
    for (const [key, value] of Object.entries(parseEnvFile(text))) {
      const substituted = substitute(value, input.variables);
      for (const token of substituted.unresolved) {
        unresolved.add(token);
      }
      env[key] = substituted.value;
    }
  }

  const configured = asRecord(entry.env);
  if (entry.env !== undefined && !configured) {
    return { skipReason: "The env field must be an object." };
  }
  if (configured) {
    for (const [key, value] of Object.entries(configured)) {
      if (value === null) {
        delete env[key];
        continue;
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        env[key] = String(value);
        continue;
      }
      if (typeof value !== "string") {
        return { skipReason: `Environment variable "${key}" must be a string, number, or null.` };
      }
      const substituted = substitute(value, input.variables);
      for (const token of substituted.unresolved) {
        unresolved.add(token);
      }
      env[key] = substituted.value;
    }
  }

  return { env: Object.keys(env).length > 0 ? env : undefined };
}

function envFileBase(input: ParseInput): string {
  return input.origin.workspaceFolder ?? input.variables.userHome;
}

function resolveCwd(cwd: string | undefined, input: ParseInput): string {
  const base = input.origin.workspaceFolder ?? input.variables.userHome;
  if (cwd && path.isAbsolute(cwd)) {
    return cwd;
  }
  if (cwd) {
    return path.resolve(base, cwd);
  }
  return base;
}

function readArgs(
  value: unknown,
  take: (value: unknown) => string | undefined,
): { args?: string[]; problem?: string } {
  if (value === undefined) {
    return {};
  }
  if (!Array.isArray(value)) {
    return { problem: "args must be an array." };
  }
  const args: string[] = [];
  for (const item of value) {
    if (typeof item === "number" && Number.isFinite(item)) {
      args.push(String(item));
      continue;
    }
    if (typeof item !== "string") {
      return { problem: "Each arg must be a string or a number." };
    }
    args.push(take(item) ?? item);
  }
  return { args };
}

function readHeaders(
  value: unknown,
  take: (value: unknown) => string | undefined,
): { headers?: Record<string, string>; problem?: string } {
  if (value === undefined) {
    return {};
  }
  const record = asRecord(value);
  if (!record) {
    return { problem: "headers must be an object." };
  }
  const headers: Record<string, string> = {};
  for (const [key, header] of Object.entries(record)) {
    if (typeof header === "number" && Number.isFinite(header)) {
      headers[key] = String(header);
      continue;
    }
    if (typeof header !== "string") {
      return { problem: `Header "${key}" must be a string or a number.` };
    }
    headers[key] = take(header) ?? header;
  }
  return { headers };
}

function readAllowlist(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return undefined;
  }
  const names = value as string[];
  if (names.length === 0 || names.includes("*")) {
    return undefined;
  }
  return names;
}

function readClientCredentials(
  entry: Record<string, unknown>,
  take: (value: unknown) => string | undefined,
): { config?: ClientCredentials; problem?: string } {
  const nested = asRecord(entry.oauth);
  const grantRaw = firstString(take(entry.oauthGrantType), nested ? take(nested.grantType) : undefined);
  const grant = grantRaw?.trim().toLowerCase();
  if (grant !== "client_credentials") {
    if (grant && grant !== "authorization_code") {
      return { problem: `OAuth grant "${grantRaw}" is not supported. This extension runs the client credentials grant.` };
    }
    return {};
  }

  const clientId = firstString(take(entry.oauthClientId), nested ? take(nested.clientId) : undefined)?.trim();
  if (!clientId) {
    return { problem: "The client credentials grant has no client id." };
  }
  const scopes = readScopes(entry.oauthScopes ?? nested?.scopes, take);
  if (scopes.problem) {
    return { problem: scopes.problem };
  }
  const clientSecret = nonempty(firstString(
    take(entry.oauthClientSecret),
    nested ? take(nested.clientSecret) : undefined,
  ));
  const expectedIssuer = present(firstString(
    take(entry.oauthExpectedIssuer),
    nested ? take(nested.expectedIssuer) : undefined,
  ));
  const tokenUrl = present(firstString(
    take(entry.oauthTokenUrl),
    nested ? take(nested.tokenUrl) : undefined,
  ));
  return {
    config: {
      clientId,
      ...(clientSecret ? { clientSecret } : {}),
      ...(scopes.scope ? { scope: scopes.scope } : {}),
      ...(expectedIssuer ? { expectedIssuer } : {}),
      ...(tokenUrl ? { tokenUrl } : {}),
    },
  };
}

function readScopes(
  value: unknown,
  take: (value: unknown) => string | undefined,
): { scope?: string; problem?: string } {
  if (value === undefined) {
    return {};
  }
  if (typeof value === "string") {
    const scope = take(value)?.trim();
    return scope ? { scope } : {};
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return { problem: "oauthScopes must be an array of strings." };
  }
  const scopes = value
    .map((item) => take(item)?.trim() ?? "")
    .filter((item) => item.length > 0);
  return scopes.length > 0 ? { scope: scopes.join(" ") } : {};
}

function firstString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined);
}

/** Keeps a non-blank value and trims it. Do not use this for a client secret. */
function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed;
}

/** Keeps a client secret, including surrounding whitespace. */
function nonempty(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  return value;
}

function hasOAuth(entry: Record<string, unknown>): boolean {
  return asRecord(entry.oauth) !== undefined || typeof entry.oauthClientId === "string";
}

function hasAuthorizationHeader(headers: Record<string, string> | undefined): boolean {
  if (!headers) {
    return false;
  }
  return Object.keys(headers).some((key) => key.toLowerCase() === "authorization");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}
