/** Narrowest server list, in CSS pixels. The webview uses this same bound. */
export const SHELF_MIN_PX = 140;
/** Widest server list stored from a drag, in CSS pixels. */
export const SHELF_MAX_PX = 720;
/** Server list width before the user resizes it. */
export const SHELF_DEFAULT_PX = 220;
/** Room left for the tool list while the divider is dragged. */
export const SHELF_TOOLS_MIN_PX = 160;

const STATE_KEY = "mcpToolXplorer.serverListWidth";

interface StateStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

/** Accepts a stored or posted server-list width. Anything else is dropped. */
export function readShelfWidth(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const rounded = Math.round(value);
  if (rounded < SHELF_MIN_PX || rounded > SHELF_MAX_PX) {
    return undefined;
  }
  return rounded;
}

/** Remembers the server-list width in global state. It is not a secret. */
export class ShelfWidthStore {
  constructor(private readonly memento: StateStore) {}

  width(): number | undefined {
    return readShelfWidth(this.memento.get(STATE_KEY));
  }

  async remember(width: number): Promise<void> {
    const next = readShelfWidth(width);
    if (next === undefined || next === this.width()) {
      return;
    }
    await this.memento.update(STATE_KEY, next);
  }
}
