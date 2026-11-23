/** How many saved tries are kept for one tool. Older tries past this are dropped. */
export const SAVED_TRY_LIMIT = 20;

/** Smallest dialog edge stored from a resize, in CSS pixels. */
export const TRY_DIALOG_MIN_PX = 280;
/** Largest dialog edge stored from a resize, in CSS pixels. */
export const TRY_DIALOG_MAX_PX = 4000;

const STATE_KEY = "mcpToolXplorer.savedTries";
const SIZE_KEY = "mcpToolXplorer.tryDialogSize";
const USED_KEY = "mcpToolXplorer.usedTools";

export interface TryDialogSize {
  width: number;
  height: number;
}

export interface SavedTry {
  id: string;
  savedAt: string;
  answers: Record<string, string>;
}

interface StateStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

/** Remembers parameter values for each tool in extension storage. */
export class TryHistoryStore {
  constructor(private readonly memento: StateStore) {}

  list(serverId: string, toolName: string): SavedTry[] {
    return readSavedTries(this.read()[storageKey(serverId, toolName)]);
  }

  /** True when this tool has been run, including a run whose saved try was later removed. */
  hasUse(serverId: string, toolName: string): boolean {
    const key = storageKey(serverId, toolName);
    return this.usedKeys().includes(key) || this.list(serverId, toolName).length > 0;
  }

  /** Records that Run was used for this tool. Returns true the first time. */
  async noteUse(serverId: string, toolName: string): Promise<boolean> {
    const key = storageKey(serverId, toolName);
    const keys = this.usedKeys();
    if (keys.includes(key)) {
      return false;
    }
    await this.memento.update(USED_KEY, [...keys, key]);
    return true;
  }

  async remember(serverId: string, toolName: string, answers: Record<string, string>, entry: { id: string; savedAt: string }): Promise<SavedTry[]> {
    const all = this.read();
    const key = storageKey(serverId, toolName);
    const current = readSavedTries(all[key]);
    const next = rememberTry(current, answers, entry);
    if (sameTries(current, next)) {
      return current;
    }
    all[key] = next;
    await this.memento.update(STATE_KEY, all);
    return next;
  }

  async remove(serverId: string, toolName: string, id: string): Promise<SavedTry[]> {
    const all = this.read();
    const key = storageKey(serverId, toolName);
    const next = removeSavedTry(readSavedTries(all[key]), id);
    all[key] = next;
    await this.memento.update(STATE_KEY, all);
    return next;
  }

  /** Last size the user gave the try dialog. Shared by every tool. */
  dialogSize(): TryDialogSize | undefined {
    return readDialogSize(this.memento.get(SIZE_KEY));
  }

  async rememberDialogSize(size: TryDialogSize): Promise<void> {
    const next = readDialogSize(size);
    if (!next) {
      return;
    }
    const current = this.dialogSize();
    if (current && current.width === next.width && current.height === next.height) {
      return;
    }
    await this.memento.update(SIZE_KEY, next);
  }

  private read(): Record<string, unknown> {
    const stored = this.memento.get<unknown>(STATE_KEY);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      return {};
    }
    return { ...(stored as Record<string, unknown>) };
  }

  private usedKeys(): string[] {
    const stored = this.memento.get<unknown>(USED_KEY);
    if (!Array.isArray(stored)) {
      return [];
    }
    return stored.filter((item): item is string => typeof item === "string" && item.length > 0);
  }
}

export function storageKey(serverId: string, toolName: string): string {
  return `${serverId}\0${toolName}`;
}

/** Adds a try when its answers differ from the newest saved try. */
export function rememberTry(existing: readonly SavedTry[], answers: Record<string, string>, entry: { id: string; savedAt: string }): SavedTry[] {
  const normalized = normalizeAnswers(answers);
  const latest = existing[0];
  if (latest && answersMatch(latest.answers, normalized)) {
    return [...existing];
  }
  return [{ id: entry.id, savedAt: entry.savedAt, answers: normalized }, ...existing].slice(0, SAVED_TRY_LIMIT);
}

export function removeSavedTry(existing: readonly SavedTry[], id: string): SavedTry[] {
  return existing.filter((item) => item.id !== id);
}

export function answersMatch(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => left[key] === right[key]);
}

/** Accepts a stored or posted dialog size. Anything else is dropped. */
export function readDialogSize(value: unknown): TryDialogSize | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const width = dialogEdge((value as { width?: unknown }).width);
  const height = dialogEdge((value as { height?: unknown }).height);
  if (width === undefined || height === undefined) {
    return undefined;
  }
  return { width, height };
}

function dialogEdge(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const rounded = Math.round(value);
  if (rounded < TRY_DIALOG_MIN_PX || rounded > TRY_DIALOG_MAX_PX) {
    return undefined;
  }
  return rounded;
}

export function readSavedTries(value: unknown): SavedTry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const tries: SavedTry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const id = (item as { id?: unknown }).id;
    const savedAt = (item as { savedAt?: unknown }).savedAt;
    const answers = (item as { answers?: unknown }).answers;
    if (typeof id !== "string" || id.length === 0 || typeof savedAt !== "string" || !isStringRecord(answers)) {
      continue;
    }
    tries.push({ id, savedAt, answers: normalizeAnswers(answers) });
  }
  return tries;
}

function sameTries(left: readonly SavedTry[], right: readonly SavedTry[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => item.id === right[index]?.id && item.savedAt === right[index]?.savedAt && answersMatch(item.answers, right[index]?.answers ?? {}));
}

function normalizeAnswers(answers: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const key of Object.keys(answers).sort()) {
    const value = answers[key];
    if (typeof value === "string") {
      normalized[key] = value;
    }
  }
  return normalized;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
