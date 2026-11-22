import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as vscode from "vscode";
import type { IconTheme, ServerCatalog } from "../catalog.js";
import type { ToolCallSummary } from "../mcp/result.js";
import { schemaFields } from "../schema/fields.js";
import { readDialogSize, TryHistoryStore } from "../try/history.js";
import { argumentPlan, collectFromAnswers, fixedArgumentNote } from "../try/parameters.js";
import type { CachedTool, ResolvedServer } from "../types.js";
import { renderDetailHtml, type DetailCall, type TryFormModel } from "./html.js";

/**
 * One replaceable editor tab, plus tabs that stay open.
 * A single click updates the replaceable tab. A double-click keeps that tab
 * and later clicks open a new one instead of changing it.
 */
export class ToolDetailPanel {
  private preview: DetailPage | undefined;
  private readonly pinned: DetailPage[] = [];
  private trying = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly catalog: ServerCatalog,
    private readonly theme: () => IconTheme,
    private readonly history: TryHistoryStore,
  ) {}

  async show(serverId: string, toolName: string, pin = false): Promise<void> {
    if (serverId.length === 0 || toolName.length === 0) {
      return;
    }
    if (pin) {
      const already = this.pinned.find((page) => page.matches(serverId, toolName));
      if (already) {
        already.reveal(false);
        return;
      }
      if (this.preview?.matches(serverId, toolName)) {
        const page = this.preview;
        this.preview = undefined;
        this.pinned.push(page);
        page.reveal(false);
        return;
      }
      const page = this.createPage(toolName, false);
      this.pinned.push(page);
      await page.show(serverId, toolName);
      return;
    }
    const page = this.ensurePreview(toolName);
    page.reveal(true);
    await page.show(serverId, toolName);
  }

  /**
   * Opens the parameter dialog in the tool tab, then calls the tool on Run.
   * VS Code has no multi-field modal, so the dialog is part of the tool page.
   */
  async tryTool(serverId: string, toolName: string): Promise<void> {
    if (serverId.length === 0 || toolName.length === 0) {
      return;
    }
    let page = this.find(serverId, toolName);
    if (!page) {
      page = this.ensurePreview(toolName);
      await page.show(serverId, toolName);
    }
    page.reveal(false);
    await this.tryPage(page);
  }

  private async tryPage(page: DetailPage): Promise<void> {
    if (this.trying) {
      void vscode.window.showInformationMessage("Finish or cancel the open try dialog first.");
      return;
    }
    this.trying = true;
    try {
      await page.runTry();
    } finally {
      this.trying = false;
    }
  }

  private ensurePreview(title: string): DetailPage {
    if (!this.preview) {
      this.preview = this.createPage(title, true);
    }
    return this.preview;
  }

  private find(serverId: string, toolName: string): DetailPage | undefined {
    const pages = [this.preview, ...this.pinned].filter(
      (page): page is DetailPage => page !== undefined && page.matches(serverId, toolName),
    );
    return pages.find((page) => page.active) ?? pages[0];
  }

  private createPage(title: string, preserveFocus: boolean): DetailPage {
    const panel = vscode.window.createWebviewPanel(
      "mcpToolXplorer.detail",
      title,
      { viewColumn: vscode.ViewColumn.Active, preserveFocus },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.context.globalStorageUri],
      },
    );
    const page = new DetailPage(panel, this.catalog, this.theme, this.history, () => {
      void this.tryPage(page);
    });
    panel.onDidDispose(() => {
      if (this.preview === page) {
        this.preview = undefined;
      }
      const index = this.pinned.indexOf(page);
      if (index >= 0) {
        this.pinned.splice(index, 1);
      }
    });
    return page;
  }
}

class DetailPage {
  private current: { serverId: string; toolName: string } | undefined;
  private callView: { serverId: string; toolName: string; view: DetailCall } | undefined;
  /** Bumped each time the page is pointed at a tool, so a slow render cannot overwrite a newer one. */
  private generation = 0;
  private disposed = false;
  private formWait: ((reply: FormReply) => void) | undefined;
  /** Set when the page changes before the dialog has started waiting. */
  private formCancelled = false;

  constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly catalog: ServerCatalog,
    private readonly theme: () => IconTheme,
    private readonly history: TryHistoryStore,
    onTry: () => void,
  ) {
    const messages = panel.webview.onDidReceiveMessage((message: unknown) => {
      const removed = removeTryId(message);
      if (removed && this.current) {
        void this.history.remove(this.current.serverId, this.current.toolName, removed);
        return;
      }
      if (isDialogResize(message)) {
        const size = readDialogSize(message);
        if (size) {
          void this.history.rememberDialogSize(size);
        }
        return;
      }
      const reply = formReply(message);
      if (reply) {
        this.takeForm(reply);
        return;
      }
      if (!isTryMessage(message) || !this.current) {
        return;
      }
      onTry();
    });
    panel.onDidDispose(() => {
      this.disposed = true;
      messages.dispose();
      this.cancelForm();
    });
  }

  get active(): boolean {
    return this.panel.active;
  }

  matches(serverId: string, toolName: string): boolean {
    return this.current?.serverId === serverId && this.current.toolName === toolName;
  }

  reveal(preserveFocus: boolean): void {
    this.panel.reveal(undefined, preserveFocus);
  }

  async show(serverId: string, toolName: string): Promise<void> {
    this.current = { serverId, toolName };
    this.generation += 1;
    this.panel.title = toolName;
    this.cancelForm();
    await this.render(serverId, toolName);
  }

  async runTry(): Promise<void> {
    const current = this.current;
    if (!current) {
      return;
    }
    const { serverId, toolName } = current;
    let sent: Record<string, unknown> | undefined;
    try {
      const prepared = await this.prepare(serverId, toolName);
      if (!this.matches(serverId, toolName)) {
        return;
      }
      if (!prepared.ok) {
        await this.render(serverId, toolName, { loadError: prepared.message });
        if (prepared.message) {
          void vscode.window.showErrorMessage(prepared.message);
        }
        return;
      }
      const collected = await this.promptForArguments(
        serverId,
        toolName,
        prepared.tool.title || prepared.tool.name,
        prepared.tool.inputSchema,
      );
      if (this.disposed || !this.matches(serverId, toolName)) {
        return;
      }
      if (collected.status === "cancelled") {
        await this.render(serverId, toolName);
        return;
      }
      if (collected.status !== "ready") {
        return;
      }
      sent = collected.values;
      const summary = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Calling ${prepared.tool.name} on ${prepared.server.name}`,
        },
        () => this.catalog.callTool(prepared.server.id, prepared.tool.name, collected.values),
      );
      if (!this.matches(serverId, toolName)) {
        return;
      }
      this.callView = { serverId, toolName, view: toDetailCall(collected.values, summary) };
      await this.render(serverId, toolName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.matches(serverId, toolName)) {
        this.callView = { serverId, toolName, view: toDetailCall(sent, undefined, message) };
        await this.render(serverId, toolName);
      }
      void vscode.window.showErrorMessage(message);
    }
  }

  private async promptForArguments(
    serverId: string,
    toolName: string,
    title: string,
    schema: unknown,
  ): Promise<Awaited<ReturnType<typeof collectFromAnswers>> | { status: "cancelled" }> {
    this.formCancelled = false;
    const plan = argumentPlan(schema);
    let answers: Record<string, string> | undefined;
    let errors: Record<string, string> | undefined;
    while (!this.disposed && this.matches(serverId, toolName)) {
      const form: TryFormModel = {
        title,
        prompts: plan.prompts,
        answers,
        errors,
        fixedNote: fixedArgumentNote(plan.fixed),
        history: plan.prompts.length > 0 ? this.history.list(serverId, toolName) : undefined,
        dialogSize: this.history.dialogSize(),
      };
      await this.render(serverId, toolName, { tryForm: form });
      if (this.disposed || !this.matches(serverId, toolName)) {
        return { status: "cancelled" };
      }
      const reply = await this.waitForForm();
      if (reply.command === "cancelTry" || this.disposed || !this.matches(serverId, toolName)) {
        return { status: "cancelled" };
      }
      const collected = collectFromAnswers(schema, reply.answers);
      if (collected.status === "ready" && plan.prompts.length > 0) {
        await this.history.remember(serverId, toolName, reply.answers, {
          id: randomBytes(8).toString("hex"),
          savedAt: new Date().toISOString(),
        });
      }
      if (collected.status !== "invalid") {
        return collected;
      }
      answers = reply.answers;
      errors = {};
      for (const field of collected.errors) {
        errors[field.name] = field.message;
      }
    }
    return { status: "cancelled" };
  }

  private waitForForm(): Promise<FormReply> {
    if (this.formCancelled) {
      this.formCancelled = false;
      return Promise.resolve({ command: "cancelTry" });
    }
    return new Promise((resolve) => {
      this.formWait = resolve;
    });
  }

  private takeForm(reply: FormReply): void {
    const pending = this.formWait;
    this.formWait = undefined;
    pending?.(reply);
  }

  private cancelForm(): void {
    const pending = this.formWait;
    this.formWait = undefined;
    if (pending) {
      pending({ command: "cancelTry" });
      return;
    }
    this.formCancelled = true;
  }

  private async prepare(serverId: string, toolName: string): Promise<
    | { ok: true; server: ResolvedServer; tool: CachedTool }
    | { ok: false; message?: string }
  > {
    const server = this.catalog.server(serverId);
    if (!server) {
      return { ok: false };
    }
    if (server.skipReason) {
      return { ok: false, message: server.skipReason };
    }
    try {
      const tool = await this.catalog.tool(serverId, toolName, this.theme());
      if (!tool) {
        return { ok: false };
      }
      return { ok: true, server, tool };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  private async render(
    serverId: string,
    toolName: string,
    options?: { loadError?: string; tryForm?: TryFormModel },
  ): Promise<void> {
    if (this.disposed) {
      return;
    }
    const ticket = this.generation;
    const server = this.catalog.server(serverId);
    let tool: CachedTool | undefined;
    let failure = options?.loadError;
    if (!failure && server && !server.skipReason) {
      try {
        tool = await this.catalog.tool(serverId, toolName, this.theme());
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
    }
    if (ticket !== this.generation || !this.matches(serverId, toolName)) {
      return;
    }
    const title = tool?.title || tool?.name || "MCP tool";
    this.panel.title = title;
    if (failure || !server || !tool) {
      this.panel.webview.html = failure ? messageHtml(failure) : unavailableHtml();
      if (options?.tryForm) {
        this.cancelForm();
      }
      return;
    }

    const icon = await detailIcon(this.panel, tool.iconPath);
    if (ticket !== this.generation || !this.matches(serverId, toolName)) {
      return;
    }
    const hidden = server.toolAllowlist !== undefined && !server.toolAllowlist.includes(tool.name);
    const saved = this.callView;
    const call = saved && saved.serverId === serverId && saved.toolName === toolName ? saved.view : undefined;
    this.panel.webview.html = renderDetailHtml({
      serverName: server.name,
      serverTransport: server.transport,
      serverFile: server.originFile,
      originLabel: server.originLabel,
      toolName: tool.name,
      title,
      description: tool.description,
      iconSrc: icon?.src,
      iconSvg: icon?.svg,
      notice: server.notice,
      allowlistNote: hidden
        ? "The configuration's tools list does not include this tool, so an agent that honors that list will not offer it. The server still advertises it."
        : undefined,
      parameters: schemaFields(tool.inputSchema),
      parameterSchema: tool.inputSchema,
      response: tool.outputSchema ? schemaFields(tool.outputSchema) : undefined,
      responseSchema: tool.outputSchema,
      call,
      tryForm: options?.tryForm,
    }, randomBytes(16).toString("hex"), this.panel.webview.cspSource);
  }
}

/** Raster icons load through the webview. SVG is inlined because that resource URL does not paint. */
async function detailIcon(
  panel: vscode.WebviewPanel,
  iconPath: string | undefined,
): Promise<{ src?: string; svg?: string } | undefined> {
  if (!iconPath) {
    return undefined;
  }
  if (iconPath.toLowerCase().endsWith(".svg")) {
    const svg = await readFile(iconPath, "utf8").catch(() => undefined);
    return svg ? { svg } : undefined;
  }
  return { src: panel.webview.asWebviewUri(vscode.Uri.file(iconPath)).toString() };
}

function toDetailCall(args: Record<string, unknown> | undefined, summary?: ToolCallSummary, error?: string): DetailCall {
  return {
    argumentsText: args ? JSON.stringify(args, null, 2) : "",
    isError: summary?.isError === true || error !== undefined,
    texts: summary?.texts ?? [],
    structuredText: summary?.structuredText,
    notes: summary?.notes ?? [],
    error,
  };
}

type FormReply =
  | { command: "submitTry"; answers: Record<string, string> }
  | { command: "cancelTry" };

function removeTryId(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  if ((message as { command?: unknown }).command !== "removeTry") {
    return undefined;
  }
  const id = (message as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function isTryMessage(message: unknown): boolean {
  return !!message && typeof message === "object" && (message as { command?: unknown }).command === "try";
}

function isDialogResize(message: unknown): boolean {
  return !!message && typeof message === "object" && (message as { command?: unknown }).command === "resizeTry";
}

function formReply(message: unknown): FormReply | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const command = (message as { command?: unknown }).command;
  if (command === "cancelTry") {
    return { command: "cancelTry" };
  }
  if (command !== "submitTry") {
    return undefined;
  }
  const raw = (message as { answers?: unknown }).answers;
  const answers: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string") {
        Object.defineProperty(answers, key, {
          value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    }
  }
  return { command: "submitTry", answers };
}

function unavailableHtml(): string {
  return messageHtml("This tool is no longer in the list. Refresh MCP Tool Xplorer and open it again.");
}

function messageHtml(message: string): string {
  const escaped = message
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<!DOCTYPE html>
<html lang="en">
<body style="color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); padding: 24px;">
  <p>${escaped}</p>
</body>
</html>`;
}
