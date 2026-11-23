import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as vscode from "vscode";
import type { IconTheme, ServerCatalog } from "../catalog.js";
import { ENVIRONMENT_CUSTOM_MAX, EnvironmentNameStore, environmentNameError, type EnvironmentOption } from "../floor/environmentNames.js";
import { EnvironmentStore } from "../floor/environmentStore.js";
import { FavouriteStore } from "../floor/favourites.js";
import { type CatalogServerDoc, type CatalogToolDoc, toolsMarkdown } from "../floor/catalogDoc.js";
import { buildFloorView, serverIdsToLoad, sortListedTools, toolMatchesQuery, visibleServers, type EnvFilter, type FloorServerInput, type FloorToolInput, type ToolOrder } from "../floor/listing.js";
import { ShelfWidthStore } from "../floor/shelfWidth.js";
import type { CachedTool, ResolvedServer } from "../types.js";

import { TryHistoryStore } from "../try/history.js";
import { renderFloorHtml } from "./floorHtml.js";

interface CachedServerTools {
  theme: IconTheme;
  tools: Array<{ tool: CachedTool; iconSvg?: string }>;
  error?: string;
}

/** The activity-bar Xplorer page: servers on the left, tools on the right. */
export class XplorerFloor implements vscode.WebviewViewProvider {
  private sidebar: vscode.Webview | undefined;
  private readonly shelfWidths: ShelfWidthStore;
  private query = "";
  private envFilter: EnvFilter = "ALL";
  private usedOnly = false;
  private toolOrder: ToolOrder = "asc";
  private selectedId: string | undefined;
  private focusSearch = false;
  private loadTicket = 0;
  private readonly cache = new Map<string, CachedServerTools>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly catalog: ServerCatalog,
    private readonly theme: () => IconTheme,
    private readonly favourites: FavouriteStore,
    private readonly environments: EnvironmentStore,
    private readonly environmentNames: EnvironmentNameStore,
    private readonly history: TryHistoryStore,
    private readonly onChrome: () => void,
  ) {
    this.shelfWidths = new ShelfWidthStore(context.globalState);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.globalStorageUri],
    };
    this.sidebar = webviewView.webview;
    const messages = this.bind(webviewView.webview);
    webviewView.onDidDispose(() => {
      messages.dispose();
      if (this.sidebar === webviewView.webview) {
        this.sidebar = undefined;
      }
    });
    this.paint();
    this.queueLoad();
  }

  /** Drops cached tool lists and reads configuration again. */
  refresh(): void {
    this.catalog.refresh();
    this.cache.clear();
    this.paint();
    this.queueLoad();
  }

  /** Icons follow the colour theme, so a theme change reads them again. */
  onThemeChange(): void {
    this.cache.clear();
    this.paint();
    this.queueLoad();
  }

  repaint(): void {
    this.focusSearch = false;
    this.paint();
  }

  private bind(webview: vscode.Webview): vscode.Disposable {
    return webview.onDidReceiveMessage((message: unknown) => {
      void this.onMessage(message);
    });
  }

  private paint(): void {
    if (this.envFilter !== "ALL" && !this.environmentNames.has(this.envFilter)) {
      this.envFilter = "ALL";
    }
    const loaded = this.catalog.current();
    const inputs = loaded.servers.map((server) => this.serverInput(server));
    const built = buildFloorView({
      servers: inputs,
      selectedId: this.selectedId,
      query: this.query,
      envFilter: this.envFilter,
      usedOnly: this.usedOnly,
      toolOrder: this.toolOrder,
    });
    this.selectedId = built.selectedId;
    const sidebar = this.sidebar;
    if (!sidebar) {
      return;
    }
    sidebar.html = renderFloorHtml(
      {
        ...built,
        query: this.query,
        refocus: this.focusSearch,
        envFilter: this.envFilter,
        problems: loaded.problems.map((problem) => problem.message),
        searched: loaded.servers.length === 0 ? loaded.searched : [],
        shelfWidth: this.shelfWidths.width(),
        usedOnly: this.usedOnly,
        toolOrder: this.toolOrder,
        environmentOptions: this.environmentNames.options(),
      },
      randomBytes(16).toString("hex"),
      sidebar.cspSource,
      (filePath) => sidebar.asWebviewUri(vscode.Uri.file(filePath)).toString(),
    );
  }

  private serverInput(server: ResolvedServer): FloorServerInput {
    const cached = this.cache.get(server.id);
    const fresh = cached !== undefined && cached.theme === this.theme();
    let tools: FloorToolInput[] | undefined;
    if (server.skipReason) {
      tools = [];
    } else if (fresh) {
      tools = cached.tools.map((entry) => ({
        name: entry.tool.name,
        title: entry.tool.title,
        description: entry.tool.description,
        iconPath: entry.tool.iconPath,
        iconSvg: entry.iconSvg,
        favourite: this.favourites.has(server.id, entry.tool.name),
        used: this.history.hasUse(server.id, entry.tool.name),
      }));
    }
    return {
      id: server.id,
      name: server.name,
      originLabel: server.originLabel,
      skipReason: server.skipReason,
      notice: server.notice,
      credentials: server.clientCredentials !== undefined,
      environment: this.environments.tag(server.id, server.name),
      tools,
      error: fresh ? cached.error : undefined,
    };
  }

  private queueLoad(): void {
    const ticket = ++this.loadTicket;
    void this.load(ticket);
  }

  private async load(ticket: number): Promise<void> {
    const loaded = this.catalog.current().servers.map((server) => ({
      id: server.id,
      environment: this.environments.tag(server.id, server.name),
      skipReason: server.skipReason,
    }));
    const ids = serverIdsToLoad(loaded, this.selectedId, this.query, this.envFilter);
    for (const id of ids) {
      if (ticket !== this.loadTicket) {
        return;
      }
      const server = this.catalog.server(id);
      if (!server || server.skipReason) {
        continue;
      }
      const cached = this.cache.get(id);
      if (cached && cached.theme === this.theme()) {
        continue;
      }
      await this.readServerTools(server, () => ticket === this.loadTicket);
      if (ticket !== this.loadTicket) {
        return;
      }
      this.paint();
    }
  }

  private async onMessage(message: unknown): Promise<void> {
    const command = commandOf(message);
    if (!command) {
      return;
    }
    if (command === "shelf") {
      const width = numberField(message, "width");
      if (width === undefined) {
        return;
      }
      await this.shelfWidths.remember(width);
      return;
    }
    if (command === "used") {
      const filter = field(message, "filter");
      if (filter !== "used" && filter !== "all") {
        return;
      }
      this.usedOnly = filter === "used";
      this.focusSearch = false;
      this.paint();
      return;
    }
    if (command === "sort") {
      const order = field(message, "order");
      if (order !== "asc" && order !== "desc") {
        return;
      }
      this.toolOrder = order;
      this.focusSearch = false;
      this.paint();
      return;
    }
    if (command === "catalog") {
      await this.openCatalog();
      return;
    }
    if (command === "search") {
      const query = field(message, "query");
      if (query === undefined) {
        return;
      }
      this.query = query;
      this.focusSearch = true;
      this.paint();
      this.queueLoad();
      return;
    }
    if (command === "env") {
      const filter = field(message, "filter");
      if (!this.acceptsFilter(filter)) {
        return;
      }
      this.envFilter = filter;
      this.focusSearch = false;
      this.paint();
      this.queueLoad();
      return;
    }
    if (command === "select") {
      const serverId = field(message, "serverId");
      if (!serverId) {
        return;
      }
      this.selectedId = serverId;
      this.focusSearch = false;
      this.paint();
      this.queueLoad();
      return;
    }
    const serverId = field(message, "serverId");
    const toolName = field(message, "toolName");
    if (command === "open" || command === "try") {
      if (!serverId || !toolName) {
        return;
      }
      this.selectedId = serverId;
      this.focusSearch = false;
      const name = command === "open" ? "mcpToolXplorer.openTool" : "mcpToolXplorer.tryTool";
      await vscode.commands.executeCommand(name, serverId, toolName);
      this.paint();
      return;
    }
    if (command === "favourite") {
      if (!serverId || !toolName) {
        return;
      }
      await this.favourites.toggle(serverId, toolName);
      this.onChrome();
      this.paint();
      return;
    }
    if (command === "secret") {
      if (!serverId) {
        return;
      }
      const server = this.catalog.server(serverId);
      if (!server) {
        return;
      }
      await vscode.commands.executeCommand("mcpToolXplorer.setClientSecret", { server });
      return;
    }
    if (command === "names") {
      await this.editEnvironments();
      return;
    }
    if (command === "tag") {
      if (!serverId) {
        return;
      }
      await this.pickTag(serverId);
    }
  }

  private async readServerTools(server: ResolvedServer, current: () => boolean = () => true): Promise<void> {
    if (server.skipReason || !current()) {
      return;
    }
    const cached = this.cache.get(server.id);
    if (cached && cached.theme === this.theme()) {
      return;
    }
    try {
      const tools = await this.catalog.toolsFor(server, this.theme());
      if (!current()) {
        return;
      }
      const decorated = await Promise.all(tools.map(async (tool) => ({
        tool,
        iconSvg: await readSvg(tool.iconPath),
      })));
      if (!current()) {
        return;
      }
      this.cache.set(server.id, { theme: this.theme(), tools: decorated });
    } catch (error) {
      if (!current()) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.cache.set(server.id, { theme: this.theme(), tools: [], error: message });
    }
  }

  private async openCatalog(): Promise<void> {
    const tagged = this.catalog.current().servers.map((server) => ({
      server,
      environment: this.environments.tag(server.id, server.name),
    }));
    const visible = visibleServers(tagged, this.envFilter);
    const selected = visible.find((item) => item.server.id === this.selectedId) ?? visible[0];
    const targets = this.query.trim().length > 0 ? visible : selected ? [selected] : [];
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Writing the tool catalog",
    }, async () => {
      for (const item of targets) {
        await this.readServerTools(item.server);
      }
      this.paint();
      const markdown = toolsMarkdown(targets.map((item) => this.catalogSection(item.server, item.environment)));
      const document = await vscode.workspace.openTextDocument({ language: "markdown", content: markdown });
      await vscode.window.showTextDocument(document, { preview: false });
    });
  }

  private catalogSection(server: ResolvedServer, environment: string | undefined): CatalogServerDoc {
    const cached = this.cache.get(server.id);
    const base = {
      name: server.name,
      originLabel: server.originLabel,
      environment: environment ? this.environmentNames.label(environment) : undefined,
    };
    if (server.skipReason) {
      return { ...base, note: server.skipReason, tools: [] };
    }
    if (!cached) {
      return { ...base, note: "Tools have not been read.", tools: [] };
    }
    if (cached.error) {
      return { ...base, note: cached.error, tools: [] };
    }
    const matched = cached.tools.filter((entry) => toolMatchesQuery(this.query, entry.tool, server.name, server.originLabel));
    const ordered = sortListedTools(matched.map((entry) => ({
      name: entry.tool.name,
      title: entry.tool.title && entry.tool.title.length > 0 ? entry.tool.title : entry.tool.name,
      description: entry.tool.description,
      favourite: this.favourites.has(server.id, entry.tool.name),
      inputSchema: entry.tool.inputSchema,
      outputSchema: entry.tool.outputSchema,
    })), this.toolOrder);
    const tools: CatalogToolDoc[] = ordered.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
    }));
    return { ...base, tools };
  }

  private async editEnvironments(): Promise<void> {
    const options = this.environmentNames.options();
    const picked = await vscode.window.showQuickPick<EnvironmentMenuItem>([
      { label: "Add an environment", description: "A new filter and tag", action: "add", id: "" },
      ...options.map((option) => ({
        label: option.label,
        description: option.builtin
          ? (option.label === option.id ? "Rename" : `Rename · ${option.id}`)
          : "Rename or remove",
        action: "edit" as const,
        id: option.id,
      })),
      {
        label: "Use DEV, TEST, and PROD",
        description: "Remove added environments and restore the three names",
        action: "reset",
        id: "",
      },
    ], {
      title: "Environments",
      placeHolder: "Add, rename, or remove an environment",
    });
    if (!picked) {
      return;
    }
    const changed = await this.applyEnvironmentChoice(picked);
    if (!changed) {
      return;
    }
    this.focusSearch = false;
    this.onChrome();
    this.paint();
    this.queueLoad();
  }

  private async applyEnvironmentChoice(picked: EnvironmentMenuItem): Promise<boolean> {
    if (picked.action === "add") {
      return this.addEnvironment();
    }
    if (picked.action === "reset") {
      return this.resetEnvironments();
    }
    const option = this.environmentNames.options().find((item) => item.id === picked.id);
    if (!option) {
      return false;
    }
    if (option.builtin) {
      return this.renameEnvironment(option);
    }
    const action = await vscode.window.showQuickPick<EnvironmentActionItem>([
      { label: "Rename", action: "rename" },
      { label: "Remove", action: "remove" },
    ], {
      title: option.label,
      placeHolder: "Rename or remove this environment",
    });
    if (!action) {
      return false;
    }
    if (action.action === "remove") {
      return this.removeEnvironment(option);
    }
    return this.renameEnvironment(option);
  }

  private async addEnvironment(): Promise<boolean> {
    const custom = this.environmentNames.options().filter((option) => !option.builtin).length;
    if (custom >= ENVIRONMENT_CUSTOM_MAX) {
      void vscode.window.showInformationMessage(`You can add up to ${ENVIRONMENT_CUSTOM_MAX} environments.`);
      return false;
    }
    const edited = await vscode.window.showInputBox({
      title: "New environment",
      prompt: "Shown on the server list and the filters. Up to 24 characters.",
      ignoreFocusOut: true,
      validateInput: (value) => environmentNameError(value, undefined, this.environmentNames.options()),
    });
    if (edited === undefined) {
      return false;
    }
    const id = await this.environmentNames.add(edited);
    return id !== undefined;
  }

  private async renameEnvironment(option: EnvironmentOption): Promise<boolean> {
    const edited = await vscode.window.showInputBox({
      title: `Name for ${option.label}`,
      value: option.label,
      prompt: "Shown on the server list and the filters. Up to 24 characters.",
      ignoreFocusOut: true,
      validateInput: (value) => environmentNameError(value, option.id, this.environmentNames.options()),
    });
    if (edited === undefined) {
      return false;
    }
    await this.environmentNames.rename(option.id, edited);
    return true;
  }

  private async removeEnvironment(option: EnvironmentOption): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(
      `Remove ${option.label}? Servers tagged ${option.label} use the server name again.`,
      { modal: true },
      "Remove",
    );
    if (choice !== "Remove") {
      return false;
    }
    const removed = await this.environmentNames.remove(option.id);
    if (!removed) {
      return false;
    }
    await this.environments.clearTag(option.id);
    if (this.envFilter === option.id) {
      this.envFilter = "ALL";
    }
    return true;
  }

  private async resetEnvironments(): Promise<boolean> {
    const options = this.environmentNames.options();
    const custom = options.filter((option) => !option.builtin);
    const renamed = options.some((option) => option.builtin && option.label !== option.id);
    if (custom.length === 0 && !renamed) {
      return false;
    }
    const choice = await vscode.window.showWarningMessage(
      "Restore DEV, TEST, and PROD and remove added environments?",
      { modal: true },
      "Restore",
    );
    if (choice !== "Restore") {
      return false;
    }
    const removed = await this.environmentNames.reset();
    for (const id of removed) {
      await this.environments.clearTag(id);
      if (this.envFilter === id) {
        this.envFilter = "ALL";
      }
    }
    return true;
  }

  private async pickTag(serverId: string): Promise<void> {
    const server = this.catalog.server(serverId);
    if (!server) {
      return;
    }
    const options = this.environmentNames.options();
    const picked = await vscode.window.showQuickPick([
      ...options.map((option) => ({
        label: option.label,
        description: option.builtin && option.label !== option.id ? option.id : undefined,
        tag: option.id,
      })),
      { label: "Use the server name", description: "Tag from the server name", tag: "name" },
    ], {
      title: `Environment for ${server.name}`,
      placeHolder: "Choose an environment",
    });
    if (!picked || (picked.tag !== "name" && !this.environmentNames.has(picked.tag))) {
      return;
    }
    await this.environments.set(server.id, picked.tag);
    this.onChrome();
    this.paint();
    this.queueLoad();
  }

  private acceptsFilter(value: string | undefined): value is EnvFilter {
    if (!value) {
      return false;
    }
    return value === "ALL" || this.environmentNames.has(value);
  }
}

interface EnvironmentMenuItem extends vscode.QuickPickItem {
  action: "add" | "edit" | "reset";
  id: string;
}

interface EnvironmentActionItem extends vscode.QuickPickItem {
  action: "rename" | "remove";
}

function commandOf(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const command = (message as { command?: unknown }).command;
  return typeof command === "string" ? command : undefined;
}

function field(message: unknown, name: string): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const value = (message as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

function numberField(message: unknown, name: string): number | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const value = (message as Record<string, unknown>)[name];
  return typeof value === "number" ? value : undefined;
}

async function readSvg(iconPath: string | undefined): Promise<string | undefined> {
  if (!iconPath || !iconPath.toLowerCase().endsWith(".svg")) {
    return undefined;
  }
  return readFile(iconPath, "utf8").catch(() => undefined);
}
