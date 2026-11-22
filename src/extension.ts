import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import { iconCacheDirectory, ServerCatalog, type IconTheme } from "./catalog.js";
import { copilotConfigFile, profileDirectoryFromGlobalStorage } from "./config/origins.js";
import { clientSecretStorageKey } from "./mcp/credentials.js";
import type { ResolvedServer } from "./types.js";
import { TryHistoryStore } from "./try/history.js";
import { ToolDetailPanel } from "./view/detail.js";
import { classifyToolClick, type ToolClickState } from "./view/open.js";
import { invocationFromTreeItem, ToolTreeProvider } from "./view/tree.js";

export function activate(context: vscode.ExtensionContext): void {
  const profileDirectory = profileDirectoryFromGlobalStorage(context.globalStorageUri.fsPath);
  const secretPrompts = new Map<string, Promise<string | undefined>>();
  const catalog = new ServerCatalog({
    profileDirectory,
    iconCacheDir: iconCacheDirectory(context.globalStorageUri.fsPath),
    workspaceFolders: () => (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
      name: folder.name,
      path: folder.uri.fsPath,
    })),
    copilotHome: process.env.COPILOT_HOME,
    resolveClientSecret: (server) => resolveStoredClientSecret(context, server, secretPrompts),
  });
  const theme = (): IconTheme => {
    const kind = vscode.window.activeColorTheme.kind;
    return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight
      ? "light"
      : "dark";
  };
  const tree = new ToolTreeProvider(catalog, theme);
  const detail = new ToolDetailPanel(context, catalog, theme, new TryHistoryStore(context.globalState));
  let toolClicks: ToolClickState = {};
  const refreshSoon = debounce(() => tree.refresh(), 300);
  const workspaceWatchers: vscode.Disposable[] = [];

  const replaceWorkspaceWatchers = (): void => {
    while (workspaceWatchers.length > 0) {
      workspaceWatchers.pop()?.dispose();
    }
    workspaceWatchers.push(...watchWorkspaceConfigs(refreshSoon));
  };
  replaceWorkspaceWatchers();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("mcpToolExplorer.tools", tree),
    vscode.commands.registerCommand("mcpToolExplorer.refresh", () => tree.refresh()),
    vscode.commands.registerCommand("mcpToolExplorer.openTool", (serverId: unknown, toolName: unknown) => {
      if (typeof serverId !== "string" || typeof toolName !== "string") {
        return;
      }
      const decision = classifyToolClick(toolClicks, `${serverId}\0${toolName}`, Date.now());
      toolClicks = decision.state;
      if (decision.action === "ignore") {
        return;
      }
      return detail.show(serverId, toolName, decision.action === "pin");
    }),
    vscode.commands.registerCommand("mcpToolExplorer.setClientSecret", async (item?: unknown) => {
      const server = await chooseClientCredentialsServer(catalog, item);
      if (!server?.clientCredentials) {
        void vscode.window.showInformationMessage("None of the configured servers use a client credentials grant.");
        return;
      }
      const entered = await askForClientSecret(server, true);
      if (!entered) {
        return;
      }
      await context.secrets.store(clientSecretStorageKey(server.id, server.clientCredentials.clientId), entered);
      tree.refresh();
    }),
    vscode.commands.registerCommand("mcpToolExplorer.tryTool", (first?: unknown, second?: unknown) => {
      const fromTree = invocationFromTreeItem(first);
      if (fromTree) {
        return detail.tryTool(fromTree.serverId, fromTree.toolName);
      }
      if (typeof first === "string" && typeof second === "string") {
        return detail.tryTool(first, second);
      }
      return undefined;
    }),
    vscode.window.onDidChangeActiveColorTheme(() => tree.rerender()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      replaceWorkspaceWatchers();
      refreshSoon();
    }),
    new vscode.Disposable(() => {
      for (const watcher of workspaceWatchers) {
        watcher.dispose();
      }
    }),
    ...watchUserConfigFiles(profileDirectory, refreshSoon),
  );
}

export function deactivate(): void {
  // Each tools/list request closes its own connection.
}

async function resolveStoredClientSecret(
  context: vscode.ExtensionContext,
  server: ResolvedServer,
  pending: Map<string, Promise<string | undefined>>,
): Promise<string | undefined> {
  const clientId = server.clientCredentials?.clientId;
  if (!clientId) {
    return undefined;
  }
  const key = clientSecretStorageKey(server.id, clientId);
  const existing = await context.secrets.get(key);
  if (existing) {
    return existing;
  }
  const inflight = pending.get(key);
  if (inflight) {
    return inflight;
  }
  const prompt = Promise.resolve(askForClientSecret(server, false)).then(async (entered) => {
    if (!entered) {
      return undefined;
    }
    await context.secrets.store(key, entered);
    return entered;
  }).finally(() => {
    pending.delete(key);
  });
  pending.set(key, prompt);
  return prompt;
}

async function chooseClientCredentialsServer(
  catalog: ServerCatalog,
  item: unknown,
): Promise<ResolvedServer | undefined> {
  const fromTree = clientCredentialsFromItem(item);
  if (fromTree) {
    return fromTree;
  }
  const servers = catalog.current().servers.filter((server) => server.clientCredentials);
  if (servers.length === 0) {
    return undefined;
  }
  if (servers.length === 1) {
    return servers[0];
  }
  const picked = await vscode.window.showQuickPick(servers.map((server) => ({
    label: server.name,
    description: server.originLabel,
    server,
  })), {
    title: "Set client secret",
    placeHolder: "Machine-to-machine server",
  });
  return picked?.server;
}

function clientCredentialsFromItem(item: unknown): ResolvedServer | undefined {
  if (!item || typeof item !== "object" || !("server" in item)) {
    return undefined;
  }
  const server = (item as { server?: ResolvedServer }).server;
  if (server?.clientCredentials && typeof server.id === "string") {
    return server;
  }
  return undefined;
}

function askForClientSecret(server: ResolvedServer, replacing: boolean): Thenable<string | undefined> {
  return vscode.window.showInputBox({
    title: `Client secret for ${server.name}`,
    prompt: replacing
      ? "Replaces the stored machine-to-machine client secret. It is not written to a config file."
      : "Machine-to-machine client secret. It is stored in VS Code secret storage and is not written to a config file.",
    password: true,
    ignoreFocusOut: true,
  });
}

function watchWorkspaceConfigs(onChange: () => void): vscode.Disposable[] {
  const watchers: vscode.Disposable[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    for (const pattern of [".vscode/mcp.json", ".mcp.json"]) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, pattern));
      watcher.onDidChange(onChange);
      watcher.onDidCreate(onChange);
      watcher.onDidDelete(onChange);
      watchers.push(watcher);
    }
  }
  return watchers;
}

function watchUserConfigFiles(profileDirectory: string, onChange: () => void): vscode.Disposable[] {
  const files = [
    path.join(profileDirectory, "mcp.json"),
    copilotConfigFile(os.homedir(), process.env.COPILOT_HOME),
  ];
  return files
    .map((filePath) => watchFile(filePath, onChange))
    .filter((watcher): watcher is vscode.Disposable => watcher !== undefined);
}

function watchFile(filePath: string, onChange: () => void): vscode.Disposable | undefined {
  try {
    fs.watchFile(filePath, { interval: 1000 }, (current, previous) => {
      if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size) {
        onChange();
      }
    });
    return new vscode.Disposable(() => fs.unwatchFile(filePath));
  } catch {
    return undefined;
  }
}

function debounce(action: () => void, waitMs: number): () => void {
  let timer: NodeJS.Timeout | undefined;
  return () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(action, waitMs);
  };
}
