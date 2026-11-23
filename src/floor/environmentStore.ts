import { isCustomEnvironmentId, isEnvironmentTag, resolveEnvironment } from "./environment.js";

const STATE_KEY = "mcpToolXplorer.environments";

interface StateStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

function readMap(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

/** Per-server environment tag. A missing entry uses the server name. */
export class EnvironmentStore {
  constructor(
    private readonly memento: StateStore,
    private readonly knownIds: () => ReadonlySet<string> = () => new Set(),
  ) {}

  tag(serverId: string, serverName: string): string | undefined {
    return resolveEnvironment(serverName, this.read()[serverId], this.knownIds());
  }

  async set(serverId: string, tag: string): Promise<void> {
    const all = { ...this.read() };
    if (tag === "name") {
      delete all[serverId];
    } else if (this.accepts(tag)) {
      all[serverId] = tag;
    } else {
      return;
    }
    await this.memento.update(STATE_KEY, all);
  }

  /** Drops a removed environment from every server. Built-in tags stay. */
  async clearTag(tagId: string): Promise<void> {
    if (!isCustomEnvironmentId(tagId)) {
      return;
    }
    const all = { ...this.read() };
    let changed = false;
    for (const [serverId, value] of Object.entries(all)) {
      if (value === tagId) {
        delete all[serverId];
        changed = true;
      }
    }
    if (!changed) {
      return;
    }
    await this.memento.update(STATE_KEY, all);
  }

  private accepts(tag: string): boolean {
    if (isEnvironmentTag(tag)) {
      return true;
    }
    return isCustomEnvironmentId(tag) && this.knownIds().has(tag);
  }

  private read(): Record<string, unknown> {
    return readMap(this.memento.get(STATE_KEY));
  }
}
