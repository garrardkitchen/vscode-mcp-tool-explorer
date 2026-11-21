const PREDEFINED = new Set([
  "workspaceFolder",
  "workspaceFolderBasename",
  "userHome",
  "pathSeparator",
]);

export interface VariableContext {
  env: NodeJS.ProcessEnv;
  userHome: string;
  pathSeparator: string;
  workspaceFolder?: string;
  workspaceFolderBasename?: string;
}

export interface Substitution {
  value: string;
  /** Tokens such as `${input:api-key}` that this extension does not resolve. */
  unresolved: string[];
}

/**
 * Resolves VS Code `${env:NAME}` / `${workspaceFolder}` tokens and portable
 * `${NAME}` / `${NAME:-default}` tokens. `${input:...}` and `${command:...}`
 * stay in place and are reported.
 */
export function substitute(input: string, context: VariableContext): Substitution {
  let current = input;
  const unresolved = new Set<string>();

  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    current = current.replace(/\$\{([^}]+)\}/g, (full, inner: string) => {
      const resolved = resolveToken(inner, context);
      if (resolved.status === "unresolved") {
        unresolved.add(full);
        return full;
      }
      if (resolved.value !== full) {
        changed = true;
      }
      return resolved.value;
    });
    if (!changed) {
      break;
    }
  }

  return { value: current, unresolved: [...unresolved] };
}

export function substituteAll(values: string[], context: VariableContext): Substitution {
  const unresolved = new Set<string>();
  const parts = values.map((value) => {
    const result = substitute(value, context);
    for (const token of result.unresolved) {
      unresolved.add(token);
    }
    return result.value;
  });
  return { value: parts.join("\n"), unresolved: [...unresolved] };
}

function resolveToken(
  inner: string,
  context: VariableContext,
): { status: "resolved"; value: string } | { status: "unresolved" } {
  if (inner.startsWith("input:") || inner.startsWith("command:")) {
    return { status: "unresolved" };
  }

  if (inner.startsWith("env:")) {
    const name = inner.slice("env:".length);
    const value = lookupEnv(context.env, name);
    return value === undefined ? { status: "unresolved" } : { status: "resolved", value };
  }

  if (inner === "workspaceFolder") {
    return context.workspaceFolder === undefined
      ? { status: "unresolved" }
      : { status: "resolved", value: context.workspaceFolder };
  }
  if (inner === "workspaceFolderBasename") {
    return context.workspaceFolderBasename === undefined
      ? { status: "unresolved" }
      : { status: "resolved", value: context.workspaceFolderBasename };
  }
  if (inner === "userHome") {
    return { status: "resolved", value: context.userHome };
  }
  if (inner === "pathSeparator") {
    return { status: "resolved", value: context.pathSeparator };
  }

  const portable = /^([A-Za-z_][A-Za-z0-9_]*)(:-([\s\S]*))?$/.exec(inner);
  if (!portable || PREDEFINED.has(portable[1] ?? "")) {
    return { status: "unresolved" };
  }

  const name = portable[1] ?? "";
  const hasDefault = portable[2] !== undefined;
  const fallback = portable[3] ?? "";
  const value = lookupEnv(context.env, name);
  if (value !== undefined) {
    return { status: "resolved", value };
  }
  if (hasDefault) {
    return { status: "resolved", value: fallback };
  }
  return { status: "unresolved" };
}

function lookupEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  if (name.length === 0) {
    return undefined;
  }
  const direct = env[name];
  if (direct !== undefined) {
    return direct;
  }
  if (process.platform !== "win32") {
    return undefined;
  }
  const match = Object.keys(env).find((key) => key.toLowerCase() === name.toLowerCase());
  return match ? env[match] : undefined;
}
