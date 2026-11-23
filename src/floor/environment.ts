export const ENVIRONMENT_TAGS = ["DEV", "TEST", "PROD"] as const;

export type EnvironmentTag = (typeof ENVIRONMENT_TAGS)[number];

const TOKEN = /(^|[^a-z0-9])(dev|test|prod)(?=[^a-z0-9]|$)/gi;

/** Reads a DEV, TEST, or PROD token from a server name. The last token wins. */
export function inferEnvironment(name: string): EnvironmentTag | undefined {
  let found: EnvironmentTag | undefined;
  for (const match of name.matchAll(TOKEN)) {
    const word = match[2]?.toUpperCase();
    if (word === "DEV" || word === "TEST" || word === "PROD") {
      found = word;
    }
  }
  return found;
}

export function isEnvironmentTag(value: unknown): value is EnvironmentTag {
  return value === "DEV" || value === "TEST" || value === "PROD";
}

/** A built-in tag, or an id such as `c1` for an environment the user added. */
export type EnvironmentId = string;

/** Ids for environments the user added. Built-in tags use a different shape. */
export function isCustomEnvironmentId(value: string): boolean {
  return /^c[1-9][0-9]{0,5}$/.test(value);
}

/**
 * A stored `none` hides a tag inferred from the name.
 * A stored built-in tag replaces the inferred one.
 * A stored custom id replaces it only when that environment still exists.
 */
export function resolveEnvironment(
  name: string,
  stored: unknown,
  knownIds?: ReadonlySet<string>,
): EnvironmentId | undefined {
  if (stored === "none") {
    return undefined;
  }
  if (typeof stored === "string" && acceptsStoredTag(stored, knownIds)) {
    return stored;
  }
  return inferEnvironment(name);
}

function acceptsStoredTag(value: string, knownIds?: ReadonlySet<string>): boolean {
  if (isEnvironmentTag(value)) {
    return true;
  }
  return isCustomEnvironmentId(value) && knownIds?.has(value) === true;
}
