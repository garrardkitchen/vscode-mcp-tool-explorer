const STATE_KEY = "mcpToolXplorer.favourites";

interface StateStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

export function toolKey(serverId: string, toolName: string): string {
  return `${serverId}\0${toolName}`;
}

export function readFavouriteKeys(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

/** Favourites are tool keys in global state. They are not secrets. */
export class FavouriteStore {
  constructor(private readonly memento: StateStore) {}

  has(serverId: string, toolName: string): boolean {
    return this.keys().includes(toolKey(serverId, toolName));
  }

  keys(): string[] {
    return readFavouriteKeys(this.memento.get(STATE_KEY));
  }

  async toggle(serverId: string, toolName: string): Promise<boolean> {
    const key = toolKey(serverId, toolName);
    const current = this.keys();
    const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
    await this.memento.update(STATE_KEY, next);
    return next.includes(key);
  }
}
