import { ENVIRONMENT_TAGS, isCustomEnvironmentId, isEnvironmentTag, type EnvironmentTag } from "./environment.js";

/** Longest environment name shown on a chip or a server. */
export const ENVIRONMENT_NAME_MAX = 24;

/** How many environments can be added beside DEV, TEST, and PROD. */
export const ENVIRONMENT_CUSTOM_MAX = 12;

const STATE_KEY = "mcpToolXplorer.environmentNames";

const CUSTOM_CLASSES = ["env-c0", "env-c1", "env-c2", "env-c3", "env-c4"] as const;

/** Badge colours. DEV, TEST, and PROD keep their colours. Added environments cycle the rest. */
export const ENVIRONMENT_BADGE_CSS = [
  ".env-dev { background: #E39A3C; color: #14181c; }",
  ".env-test { background: #7ec8c4; color: #14181c; }",
  ".env-prod { background: #d9786c; color: #14181c; }",
  ".env-c0 { background: #c4a6ff; color: #14181c; }",
  ".env-c1 { background: #6dce97; color: #14181c; }",
  ".env-c2 { background: #7eb6e0; color: #14181c; }",
  ".env-c3 { background: #e7a0b4; color: #14181c; }",
  ".env-c4 { background: #d7c4a3; color: #14181c; }",
].join("\n    ");

export interface EnvironmentOption {
  id: string;
  label: string;
  /** DEV, TEST, and PROD. These stay on the list. */
  builtin: boolean;
}

interface StateStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

interface StoredEnvironmentCatalog {
  labels: Partial<Record<EnvironmentTag, string>>;
  custom: Array<{ id: string; label: string }>;
  next: number;
}

export function defaultEnvironmentOptions(): EnvironmentOption[] {
  return ENVIRONMENT_TAGS.map((id) => ({ id, label: id, builtin: true }));
}

/** A display name. Empty, too long, or containing a control character is dropped. */
export function normalizeEnvironmentName(value: string): string | undefined {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0 || trimmed.length > ENVIRONMENT_NAME_MAX) {
    return undefined;
  }
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

/** Why a typed name cannot be saved. Undefined means it can. */
export function environmentNameError(
  value: string,
  exceptId: string | undefined,
  options: readonly EnvironmentOption[],
): string | undefined {
  const next = normalizeEnvironmentName(value);
  if (!next) {
    return `Enter a name up to ${ENVIRONMENT_NAME_MAX} characters.`;
  }
  if (next.toLocaleLowerCase() === "all") {
    return "All is the filter for every server.";
  }
  const clash = options.find((option) => option.id !== exceptId && option.label.toLocaleLowerCase() === next.toLocaleLowerCase());
  if (clash) {
    return `${clash.label} already uses that name.`;
  }
  return undefined;
}

export function environmentLabel(id: string, options: readonly EnvironmentOption[]): string {
  return options.find((option) => option.id === id)?.label ?? id;
}

/** Colour class for a tag. The result is one of the badge classes. */
export function environmentClass(id: string): string {
  if (id === "DEV") {
    return "env-dev";
  }
  if (id === "TEST") {
    return "env-test";
  }
  if (id === "PROD") {
    return "env-prod";
  }
  const match = /^c([1-9][0-9]{0,5})$/.exec(id);
  if (!match) {
    return "env-c0";
  }
  return CUSTOM_CLASSES[Number(match[1]) % CUSTOM_CLASSES.length] ?? "env-c0";
}

export function isEnvironmentClass(value: string): boolean {
  return value === "env-dev" || value === "env-test" || value === "env-prod" || CUSTOM_CLASSES.some((name) => name === value);
}

export function readEnvironmentOptions(value: unknown): EnvironmentOption[] {
  const stored = readStored(value);
  const builtins = ENVIRONMENT_TAGS.map((id) => ({
    id,
    label: stored.labels[id] ?? id,
    builtin: true,
  }));
  const custom = stored.custom.map((entry) => ({ id: entry.id, label: entry.label, builtin: false }));
  return [...builtins, ...custom];
}

/**
 * Environment names for the filters and server tags.
 * DEV, TEST, and PROD always remain. Added names can be removed.
 */
export class EnvironmentNameStore {
  constructor(private readonly memento: StateStore) {}

  options(): EnvironmentOption[] {
    return readEnvironmentOptions(this.memento.get(STATE_KEY));
  }

  ids(): ReadonlySet<string> {
    return new Set(this.options().map((option) => option.id));
  }

  has(id: string): boolean {
    return this.options().some((option) => option.id === id);
  }

  label(id: string): string {
    return environmentLabel(id, this.options());
  }

  async rename(id: string, value: string): Promise<void> {
    const options = this.options();
    const current = options.find((option) => option.id === id);
    if (!current || environmentNameError(value, id, options)) {
      return;
    }
    const next = normalizeEnvironmentName(value);
    if (!next || next === current.label) {
      return;
    }
    const stored = readStored(this.memento.get(STATE_KEY));
    if (isEnvironmentTag(id)) {
      if (next === id) {
        delete stored.labels[id];
      } else {
        stored.labels[id] = next;
      }
    } else {
      const entry = stored.custom.find((item) => item.id === id);
      if (!entry) {
        return;
      }
      entry.label = next;
    }
    await this.write(stored);
  }

  /** Adds an environment and returns its id. Undefined when the name cannot be saved. */
  async add(value: string): Promise<string | undefined> {
    const options = this.options();
    if (options.filter((option) => !option.builtin).length >= ENVIRONMENT_CUSTOM_MAX) {
      return undefined;
    }
    if (environmentNameError(value, undefined, options)) {
      return undefined;
    }
    const label = normalizeEnvironmentName(value);
    if (!label) {
      return undefined;
    }
    const stored = readStored(this.memento.get(STATE_KEY));
    const id = `c${stored.next}`;
    stored.custom.push({ id, label });
    stored.next += 1;
    await this.write(stored);
    return id;
  }

  /** Removes an environment the user added. DEV, TEST, and PROD stay. */
  async remove(id: string): Promise<boolean> {
    if (!isCustomEnvironmentId(id)) {
      return false;
    }
    const stored = readStored(this.memento.get(STATE_KEY));
    const index = stored.custom.findIndex((item) => item.id === id);
    if (index < 0) {
      return false;
    }
    stored.custom.splice(index, 1);
    await this.write(stored);
    return true;
  }

  /** Restores DEV, TEST, and PROD and drops added environments. Returns the removed ids. */
  async reset(): Promise<string[]> {
    const stored = readStored(this.memento.get(STATE_KEY));
    const removed = stored.custom.map((item) => item.id);
    const renamed = ENVIRONMENT_TAGS.some((tag) => stored.labels[tag] !== undefined);
    if (removed.length === 0 && !renamed) {
      return [];
    }
    await this.write({ labels: {}, custom: [], next: stored.next });
    return removed;
  }

  private async write(stored: StoredEnvironmentCatalog): Promise<void> {
    const payload: Record<string, unknown> = {};
    for (const tag of ENVIRONMENT_TAGS) {
      const label = stored.labels[tag];
      if (label) {
        payload[tag] = label;
      }
    }
    if (stored.custom.length > 0) {
      payload.custom = stored.custom;
    }
    if (stored.next > 1) {
      payload.next = stored.next;
    }
    await this.memento.update(STATE_KEY, Object.keys(payload).length === 0 ? undefined : payload);
  }
}

function readStored(value: unknown): StoredEnvironmentCatalog {
  const labels: Partial<Record<EnvironmentTag, string>> = {};
  const custom: Array<{ id: string; label: string }> = [];
  let next = 1;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { labels, custom, next };
  }
  const record = value as Record<string, unknown>;
  const display = new Map<EnvironmentTag, string>(ENVIRONMENT_TAGS.map((tag) => [tag, tag]));
  const usedLabels = new Set(ENVIRONMENT_TAGS.map((tag) => tag.toLocaleLowerCase()));
  for (const tag of ENVIRONMENT_TAGS) {
    const raw = record[tag];
    if (typeof raw !== "string") {
      continue;
    }
    const label = normalizeEnvironmentName(raw);
    if (!label || label.toLocaleLowerCase() === "all") {
      continue;
    }
    usedLabels.delete((display.get(tag) ?? tag).toLocaleLowerCase());
    if (usedLabels.has(label.toLocaleLowerCase())) {
      usedLabels.add((display.get(tag) ?? tag).toLocaleLowerCase());
      continue;
    }
    display.set(tag, label);
    usedLabels.add(label.toLocaleLowerCase());
    if (label !== tag) {
      labels[tag] = label;
    }
  }
  if (Array.isArray(record.custom)) {
    for (const entry of record.custom) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const id = (entry as { id?: unknown }).id;
      if (typeof id !== "string" || !isCustomEnvironmentId(id)) {
        continue;
      }
      const number = Number(id.slice(1));
      if (number >= next) {
        next = number + 1;
      }
      if (custom.length >= ENVIRONMENT_CUSTOM_MAX || custom.some((item) => item.id === id)) {
        continue;
      }
      const rawLabel = (entry as { label?: unknown }).label;
      if (typeof rawLabel !== "string") {
        continue;
      }
      const label = normalizeEnvironmentName(rawLabel);
      if (!label || label.toLocaleLowerCase() === "all" || usedLabels.has(label.toLocaleLowerCase())) {
        continue;
      }
      usedLabels.add(label.toLocaleLowerCase());
      custom.push({ id, label });
    }
  }
  if (typeof record.next === "number" && Number.isInteger(record.next) && record.next > next) {
    next = record.next;
  }
  return { labels, custom, next };
}
