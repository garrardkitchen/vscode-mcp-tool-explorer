import path from "node:path";
import { loadConfigs, type LoadedConfig } from "./config/load.js";
import type { WorkspaceFolder } from "./config/origins.js";
import { missingClientSecretMessage } from "./mcp/credentials.js";
import { chooseIcon, materializeIcon } from "./mcp/icons.js";
import { callServerTool, listServerTools } from "./mcp/session.js";
import type { ToolCallSummary } from "./mcp/result.js";
import type { CachedTool, ResolvedServer, ToolDefinition } from "./types.js";

export type IconTheme = "light" | "dark";

/**
 * Reads MCP config files and caches each server's tool list.
 * A tools/list connection closes after the list is read.
 * Tools are called only when the user chooses Try.
 */
export class ServerCatalog {
  private generation = 0;
  private discovery: LoadedConfig | undefined;
  private tools = new Map<string, ToolDefinition[]>();
  private inflight = new Map<string, Promise<ToolDefinition[]>>();
  private iconFiles = new Map<string, Promise<string | undefined>>();

  constructor(
    private readonly options: {
      profileDirectory: string;
      iconCacheDir: string;
      workspaceFolders: () => readonly WorkspaceFolder[];
      homeDirectory?: string;
      copilotHome?: string;
      env?: NodeJS.ProcessEnv;
      /** Reads or asks for a client secret that was not in the config file. */
      resolveClientSecret?: (server: ResolvedServer) => Promise<string | undefined>;
    },
  ) {}

  refresh(): void {
    this.generation += 1;
    this.discovery = undefined;
    this.tools.clear();
    this.inflight.clear();
  }

  current(): LoadedConfig {
    if (!this.discovery) {
      this.discovery = loadConfigs({
        workspaceFolders: this.options.workspaceFolders(),
        profileDirectory: this.options.profileDirectory,
        homeDirectory: this.options.homeDirectory,
        copilotHome: this.options.copilotHome,
        env: this.options.env,
      });
    }
    return this.discovery;
  }

  server(serverId: string): ResolvedServer | undefined {
    return this.current().servers.find((server) => server.id === serverId);
  }

  async toolsFor(server: ResolvedServer, theme: IconTheme): Promise<CachedTool[]> {
    const definitions = await this.definitionsFor(server);
    const tools = await Promise.all(definitions.map((tool) => this.decorate(tool, theme)));
    tools.sort(compareTools);
    return tools;
  }

  /**
   * Calls one tool on a fresh connection.
   * A client credentials server gets its secret attached for that call only.
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallSummary> {
    const server = this.server(serverId);
    if (!server) {
      throw new Error("The server is no longer in the configuration.");
    }
    if (server.skipReason) {
      throw new Error(server.skipReason);
    }
    const connected = await this.withClientSecret(server);
    return callServerTool(connected, toolName, args);
  }

  async tool(serverId: string, toolName: string, theme: IconTheme): Promise<CachedTool | undefined> {
    const server = this.server(serverId);
    if (!server) {
      return undefined;
    }
    const tools = await this.toolsFor(server, theme);
    return tools.find((tool) => tool.name === toolName);
  }

  private async definitionsFor(server: ResolvedServer): Promise<ToolDefinition[]> {
    const cached = this.tools.get(server.id);
    if (cached) {
      return cached;
    }
    const pending = this.inflight.get(server.id);
    if (pending) {
      return pending;
    }

    const generation = this.generation;
    const load = this.withClientSecret(server).then((connected) => listServerTools(connected)).then((tools) => {
      if (generation === this.generation) {
        this.tools.set(server.id, tools);
      }
      return tools;
    }).finally(() => {
      if (this.inflight.get(server.id) === load) {
        this.inflight.delete(server.id);
      }
    });
    this.inflight.set(server.id, load);
    return load;
  }

  private async withClientSecret(server: ResolvedServer): Promise<ResolvedServer> {
    const configured = server.clientCredentials;
    if (!configured) {
      return server;
    }
    if (configured.clientSecret) {
      return server;
    }
    const secret = await this.options.resolveClientSecret?.(server);
    if (!secret) {
      throw new Error(missingClientSecretMessage(server.name));
    }
    return {
      ...server,
      clientCredentials: { ...configured, clientSecret: secret },
    };
  }

  private async decorate(tool: ToolDefinition, theme: IconTheme): Promise<CachedTool> {
    const icon = chooseIcon(tool.icons, theme);
    if (!icon) {
      return tool;
    }
    const iconPath = await this.iconFile(icon.src, () => materializeIcon(icon, this.options.iconCacheDir));
    return iconPath ? { ...tool, iconPath } : tool;
  }

  private iconFile(src: string, create: () => Promise<string | undefined>): Promise<string | undefined> {
    const existing = this.iconFiles.get(src);
    if (existing) {
      return existing;
    }
    const created = create()
      .catch(() => undefined)
      .then((filePath) => {
        if (filePath === undefined) {
          this.iconFiles.delete(src);
        }
        return filePath;
      });
    this.iconFiles.set(src, created);
    return created;
  }
}

export function iconCacheDirectory(globalStoragePath: string): string {
  return path.join(globalStoragePath, "tool-icons");
}

/** Orders tools by the label shown in the tree: title when set, otherwise name. */
export function compareTools(left: { name: string; title?: string }, right: { name: string; title?: string }): number {
  const byLabel = listedName(left).localeCompare(listedName(right), undefined, { sensitivity: "base" });
  if (byLabel !== 0) {
    return byLabel;
  }
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
    || left.name.localeCompare(right.name);
}

function listedName(tool: { name: string; title?: string }): string {
  return tool.title && tool.title.length > 0 ? tool.title : tool.name;
}
