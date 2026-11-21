import * as vscode from "vscode";
import type { ServerCatalog, IconTheme } from "../catalog.js";
import type { CachedTool, ResolvedServer } from "../types.js";

type ExplorerNode = ServerNode | ToolNode | MessageNode;

export class ToolTreeProvider implements vscode.TreeDataProvider<ExplorerNode> {
  private readonly change = new vscode.EventEmitter<ExplorerNode | undefined>();
  readonly onDidChangeTreeData = this.change.event;

  constructor(
    private readonly catalog: ServerCatalog,
    private readonly theme: () => IconTheme,
  ) {}

  refresh(): void {
    this.catalog.refresh();
    this.change.fire(undefined);
  }

  /** Reloads icons and labels without dropping the cached tool lists. */
  rerender(): void {
    this.change.fire(undefined);
  }

  getTreeItem(element: ExplorerNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ExplorerNode): Promise<ExplorerNode[]> {
    if (!element) {
      const loaded = this.catalog.current();
      const nodes: ExplorerNode[] = loaded.problems.map((problem) => new MessageNode(problem.message, "error"));
      if (loaded.servers.length === 0 && nodes.length === 0) {
        nodes.push(new MessageNode("No MCP servers found", "info", `Looked for:\n${loaded.searched.join("\n")}`));
      }
      nodes.push(...loaded.servers.map((server) => new ServerNode(server)));
      return nodes;
    }

    if (element instanceof ServerNode) {
      if (element.server.skipReason) {
        return [new MessageNode(element.server.skipReason, "warning")];
      }
      try {
        const tools = await this.catalog.toolsFor(element.server, this.theme());
        if (tools.length === 0) {
          return [new MessageNode("This server reported no tools.", "info")];
        }
        return tools.map((tool) => new ToolNode(element.server, tool));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [new MessageNode(message, "error")];
      }
    }

    return [];
  }
}

class ServerNode extends vscode.TreeItem {
  constructor(readonly server: ResolvedServer) {
    super(server.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = server.id;
    this.contextValue = server.clientCredentials ? "mcpServerCredentials" : "mcpServer";
    this.description = server.skipReason ? "Not connected" : `${server.transport} · ${server.originLabel}`;
    const tooltip = [server.originLabel, server.originFile, server.notice, server.skipReason].filter(Boolean);
    this.tooltip = tooltip.join("\n");
    this.iconPath = new vscode.ThemeIcon(server.skipReason ? "warning" : server.transport === "stdio" ? "terminal" : "globe");
  }
}

class ToolNode extends vscode.TreeItem {
  readonly serverId: string;
  readonly toolName: string;

  constructor(server: ResolvedServer, tool: CachedTool) {
    super(tool.title || tool.name, vscode.TreeItemCollapsibleState.None);
    this.serverId = server.id;
    this.toolName = tool.name;
    this.id = `${server.id}::${tool.name}`;
    this.contextValue = "mcpTool";
    if (tool.title && tool.title !== tool.name) {
      this.description = tool.name;
    }
    this.tooltip = tool.description ?? tool.name;
    this.iconPath = tool.iconPath ? vscode.Uri.file(tool.iconPath) : new vscode.ThemeIcon("tools");
    this.accessibilityInformation = { label: `${tool.title || tool.name}, MCP tool` };
    this.command = {
      command: "mcpToolExplorer.openTool",
      title: "Open Tool Details",
      arguments: [server.id, tool.name],
    };
  }
}

/** Reads the server and tool from a tree item passed to the Try command. */
export function invocationFromTreeItem(value: unknown): { serverId: string; toolName: string } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const serverId = (value as { serverId?: unknown }).serverId;
  const toolName = (value as { toolName?: unknown }).toolName;
  if (typeof serverId === "string" && serverId.length > 0 && typeof toolName === "string" && toolName.length > 0) {
    return { serverId, toolName };
  }
  return undefined;
}

class MessageNode extends vscode.TreeItem {
  constructor(message: string, icon: "error" | "warning" | "info", tooltip = message) {
    const [first = message] = message.split("\n");
    const label = first.length > 180 ? `${first.slice(0, 177)}...` : first;
    super(label, vscode.TreeItemCollapsibleState.None);
    this.tooltip = tooltip;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = "mcpMessage";
  }
}
