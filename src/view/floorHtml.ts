import { defaultEnvironmentOptions, ENVIRONMENT_BADGE_CSS, environmentClass, environmentLabel, type EnvironmentOption } from "../floor/environmentNames.js";
import type { EnvFilter, FloorShelfServer, FloorToolView, FloorView, ToolOrder } from "../floor/listing.js";
import { readShelfWidth, SHELF_DEFAULT_PX, SHELF_MAX_PX, SHELF_MIN_PX, SHELF_TOOLS_MIN_PX } from "../floor/shelfWidth.js";
import { escapeHtml } from "./html.js";
import { inlineToolSvg } from "./svg.js";

export interface FloorHtmlModel extends FloorView {
  query: string;
  refocus: boolean;
  envFilter: EnvFilter;
  problems: string[];
  searched: string[];
  shelfWidth?: number;
  usedOnly: boolean;
  toolOrder: ToolOrder;
  environmentOptions?: EnvironmentOption[];
}

const HEX = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2 20.2 7v10L12 21.8 3.8 17V7Z"/></svg>`;
const KEY = `<svg class="key" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6.2 1.4a3.6 3.6 0 0 0-1.5 6.7L4.6 9.4 3.2 10.8l1.1 1.1 1.2-1.2.9.9 1.1-1.1-.9-.9 1.3-1.4A3.6 3.6 0 1 0 6.2 1.4zm.1 1.6a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/></svg>`;

const FLOOR_SCRIPT = `
    const vscode = acquireVsCodeApi();
    const search = document.getElementById("tool-search");
    if (search instanceof HTMLInputElement) {
      const state = vscode.getState() || {};
      if (search.dataset.refocus === "true" && typeof state.draft === "string" && state.draft !== search.value) {
        search.value = state.draft;
        vscode.postMessage({ command: "search", query: state.draft });
      } else if (search.dataset.refocus !== "true") {
        vscode.setState({ draft: search.value });
      }
      if (search.dataset.refocus === "true") {
        search.focus();
        const end = search.value.length;
        search.setSelectionRange(end, end);
      }
      let timer = 0;
      search.addEventListener("input", () => {
        vscode.setState({ draft: search.value });
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          vscode.postMessage({ command: "search", query: search.value });
        }, 150);
      });
    }
    document.body.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const node = target.closest("[data-action]");
      if (!(node instanceof HTMLElement)) return;
      const action = node.dataset.action || "";
      const serverId = node.dataset.serverId || "";
      const toolName = node.dataset.toolName || "";
      if (action === "search") return;
      vscode.postMessage({
        command: action,
        serverId: serverId,
        toolName: toolName,
        filter: node.dataset.env || "",
        order: node.dataset.order || "",
      });
    });
    document.body.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.getAttribute("role") !== "button") return;
      event.preventDefault();
      target.click();
    });
    const stage = document.querySelector(".stage");
    const shelf = document.querySelector(".shelf");
    const splitter = document.getElementById("shelf-splitter");
    const minShelf = ${SHELF_MIN_PX};
    const maxShelf = ${SHELF_MAX_PX};
    const toolsMin = ${SHELF_TOOLS_MIN_PX};
    function clampShelf(stageWidth, requested) {
      const room = Math.max(minShelf, Math.min(maxShelf, stageWidth - toolsMin));
      return Math.round(Math.min(room, Math.max(minShelf, requested)));
    }
    function applyShelf(next) {
      if (!(shelf instanceof HTMLElement) || !(splitter instanceof HTMLElement)) return;
      shelf.style.width = next + "px";
      splitter.setAttribute("aria-valuenow", String(next));
    }
    if (stage instanceof HTMLElement && shelf instanceof HTMLElement && splitter instanceof HTMLElement) {
      let drag = null;
      let saveTimer = 0;
      const postWidth = (width, wait) => {
        window.clearTimeout(saveTimer);
        const send = () => vscode.postMessage({ command: "shelf", width: width });
        if (wait) saveTimer = window.setTimeout(send, 200);
        else send();
      };
      splitter.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        drag = event.pointerId;
        splitter.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      splitter.addEventListener("pointermove", (event) => {
        if (drag !== event.pointerId) return;
        const bounds = stage.getBoundingClientRect();
        const next = clampShelf(bounds.width, event.clientX - bounds.left);
        applyShelf(next);
        postWidth(next, true);
      });
      const finish = (event) => {
        if (drag !== event.pointerId) return;
        drag = null;
        postWidth(Math.round(shelf.getBoundingClientRect().width), false);
      };
      splitter.addEventListener("pointerup", finish);
      splitter.addEventListener("pointercancel", finish);
      splitter.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const bounds = stage.getBoundingClientRect();
        const delta = event.key === "ArrowRight" ? 16 : -16;
        const next = clampShelf(bounds.width, shelf.getBoundingClientRect().width + delta);
        applyShelf(next);
        postWidth(next, false);
      });
    }
`;

export function renderFloorHtml(
  model: FloorHtmlModel,
  nonce: string,
  cspSource: string,
  iconUri: (filePath: string) => string,
): string {
  const options = environmentOptionsOf(model);
  const chips = [{ id: "ALL", label: "All" }, ...options.map((option) => ({ id: option.id, label: option.label }))].map((filter) => {
    const on = model.envFilter === filter.id ? " on" : "";
    return `<button type="button" class="chip${on}" data-action="env" data-env="${escapeHtml(filter.id)}">${escapeHtml(filter.label)}</button>`;
  }).join("");
  const namesButton = `<button type="button" class="chip" data-action="names">Names</button>`;
  const refocus = model.refocus ? ` data-refocus="true"` : "";
  const shelfWidth = readShelfWidth(model.shelfWidth) ?? SHELF_DEFAULT_PX;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <title>Xplorer</title>
  <style nonce="${nonce}">
    body {
      margin: 0;
      height: 100vh;
      overflow: hidden;
      color: var(--vscode-foreground, #F4F1EA);
      background: var(--vscode-editor-background, #171c21);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .floor { display: flex; flex-direction: column; height: 100vh; min-width: 0; min-height: 0; }
    .top {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      padding: 10px 12px;
      border-bottom: 1px solid var(--vscode-widget-border, rgba(244, 241, 234, 0.12));
      background: var(--vscode-editor-background, #171c21);
    }
    .mark {
      width: 16px;
      height: 16px;
      flex: none;
      color: #E39A3C;
    }
    h1 { font-size: 0.95em; font-weight: 650; margin: 0; letter-spacing: 0.04em; }
    #tool-search {
      flex: 1 1 160px;
      min-width: 0;
      box-sizing: border-box;
      background: var(--vscode-input-background, #12161a);
      color: var(--vscode-input-foreground, #F4F1EA);
      border: 1px solid var(--vscode-input-border, rgba(244, 241, 234, 0.18));
      border-radius: 4px;
      padding: 5px 8px;
      font: inherit;
    }
    #tool-search:focus { outline: 1px solid var(--vscode-focusBorder, #E39A3C); outline-offset: 1px; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    button {
      font: inherit;
      cursor: pointer;
      border-radius: 4px;
    }
    button:focus { outline: 1px solid var(--vscode-focusBorder, #E39A3C); outline-offset: 1px; }
    .chip, .try {
      background: transparent;
      color: var(--vscode-foreground, #F4F1EA);
      border: 1px solid var(--vscode-widget-border, rgba(244, 241, 234, 0.2));
      padding: 3px 8px;
    }
    .chip.on {
      background: var(--vscode-button-background, #E39A3C);
      color: var(--vscode-button-foreground, #14181c);
      border-color: transparent;
    }
    .stage {
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: row;
    }
    .shelf {
      flex: 0 0 auto;
      width: ${SHELF_DEFAULT_PX}px;
      min-width: ${SHELF_MIN_PX}px;
      max-width: calc(100% - ${SHELF_TOOLS_MIN_PX + 8}px);
      min-height: 0;
      overflow: auto;
      background: var(--vscode-sideBar-background, #12161a);
    }
    .splitter {
      flex: 0 0 8px;
      position: relative;
      cursor: col-resize;
      touch-action: none;
      background: transparent;
    }
    .splitter::before {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      left: 3px;
      width: 1px;
      background: var(--vscode-widget-border, rgba(244, 241, 234, 0.28));
    }
    .splitter:hover::before, .splitter:focus-visible::before {
      left: 2px;
      width: 3px;
      background: var(--vscode-focusBorder, #E39A3C);
    }
    .splitter:focus { outline: none; }
    .work { flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; }
    ${shelfWidthRule(model.shelfWidth)}
    .problem, .empty, .pending, .searched { color: var(--vscode-descriptionForeground, #8d877c); margin: 8px 12px; }
    .problem { color: var(--vscode-errorForeground, #d9786c); }
    .server, .tool {
      display: grid;
      gap: 6px 8px;
      align-items: center;
      padding: 8px 12px;
      cursor: pointer;
    }
    .server { grid-template-columns: minmax(0, 1fr) auto auto auto; }
    .server.on { background: var(--vscode-list-activeSelectionBackground, rgba(227, 154, 60, 0.18)); }
    .server:hover, .tool:hover { background: var(--vscode-list-hoverBackground, rgba(244, 241, 234, 0.06)); }
    .server-name, .tool-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .server-name { font-weight: 600; }
    .origin, .status, .tool-desc, .tool-meta { color: var(--vscode-descriptionForeground, #8d877c); }
    .origin, .status { grid-column: 1 / -1; }
    .status { color: var(--vscode-editorWarning-foreground, #E39A3C); }
    .count {
      min-width: 1.4em;
      text-align: center;
      color: var(--vscode-badge-foreground, #14181c);
      background: var(--vscode-badge-background, #E39A3C);
      border-radius: 999px;
      font-size: 0.75em;
      padding: 0 6px;
    }
    .env, .tag {
      font-size: 0.68em;
      font-weight: 700;
      letter-spacing: 0.05em;
      border: none;
      border-radius: 999px;
      padding: 2px 6px;
      line-height: 1.4;
    }
    ${ENVIRONMENT_BADGE_CSS}
    .tag { background: transparent; color: var(--vscode-descriptionForeground, #8d877c); border: 1px solid var(--vscode-widget-border, rgba(244, 241, 234, 0.28)); }
    button.icon-button, button.hex-fav {
      background: transparent;
      color: var(--vscode-descriptionForeground, #8d877c);
      border: none;
      padding: 2px;
      line-height: 0;
    }
    button.hex-fav.on { color: #E39A3C; }
    .key, .hex-fav svg, .mark { width: 14px; height: 14px; display: block; }
    .hex-fav path, .mark path { fill: none; stroke: currentColor; stroke-width: 1.7; }
    .hex-fav.on path { fill: currentColor; stroke: currentColor; }
    .tool { grid-template-columns: 16px minmax(0, 1fr) auto auto; }
    .tool-icon, .tool .icon, .tool img {
      width: 16px;
      height: 16px;
      max-width: 16px;
      max-height: 16px;
      min-width: 16px;
      min-height: 16px;
      object-fit: contain;
      display: block;
    }
    .tool-copy { min-width: 0; display: flex; flex-direction: column; }
    .tool-title-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .used {
      flex: none;
      font-size: 0.68em;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #14181c;
      background: #E39A3C;
      border: none;
      border-radius: 999px;
      padding: 1px 6px;
    }
    .tool-bar {
      position: sticky;
      top: 0;
      z-index: 1;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
      padding: 8px 12px;
      background: var(--vscode-editor-background, #171c21);
      border-bottom: 1px solid var(--vscode-widget-border, rgba(244, 241, 234, 0.12));
    }
    .tool-desc {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .group {
      margin: 12px 12px 4px;
      color: #E39A3C;
      font-size: 0.75em;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .rule { border: none; border-top: 1px solid var(--vscode-widget-border, rgba(244, 241, 234, 0.16)); margin: 8px 12px; }
    .try { padding: 3px 8px; }
  </style>
</head>
<body class="layout-columns">
  <div class="floor">
    <div class="top">
      <svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2 20.2 7v10L12 21.8 3.8 17V7Z"/></svg>
      <h1>Xplorer</h1>
      <input id="tool-search" type="search" placeholder="Search tools" spellcheck="false" autocomplete="off" value="${escapeHtml(model.query)}"${refocus} />
      <div class="chips" role="group" aria-label="Environment">${chips}${namesButton}</div>
    </div>
    <div class="stage">
      <div class="shelf">
        ${model.problems.map((problem) => `<p class="problem">${escapeHtml(problem)}</p>`).join("")}
        ${shelf(model, options)}
      </div>
      <div id="shelf-splitter" class="splitter" role="separator" aria-orientation="vertical" aria-label="Resize server list" aria-valuemin="${SHELF_MIN_PX}" aria-valuemax="${SHELF_MAX_PX}" aria-valuenow="${shelfWidth}" tabindex="0"></div>
      <div class="work">
        ${work(model, iconUri, options)}
      </div>
    </div>
  </div>
  <script nonce="${nonce}">${FLOOR_SCRIPT}</script>
</body>
</html>`;
}

function shelfWidthRule(width: number | undefined): string {
  const parsed = readShelfWidth(width);
  if (parsed === undefined) {
    return "";
  }
  return `.shelf { width: ${parsed}px; }`;
}

function environmentOptionsOf(model: FloorHtmlModel): EnvironmentOption[] {
  return model.environmentOptions ?? defaultEnvironmentOptions();
}

function shelf(model: FloorHtmlModel, options: readonly EnvironmentOption[]): string {
  if (model.servers.length === 0) {
    const looked = model.searched.length > 0
      ? `<p class="searched">Looked for ${escapeHtml(model.searched.join(", "))}</p>`
      : "";
    return `${looked}`;
  }
  return model.servers.map((server) => serverRow(server, options)).join("");
}

function serverRow(server: FloorShelfServer, options: readonly EnvironmentOption[]): string {
  const env = server.environment
    ? `<button type="button" class="env ${environmentClass(server.environment)}" data-action="tag" data-server-id="${escapeHtml(server.id)}" aria-label="Change environment tag">${escapeHtml(environmentLabel(server.environment, options))}</button>`
    : `<button type="button" class="tag" data-action="tag" data-server-id="${escapeHtml(server.id)}">Tag</button>`;
  const key = server.credentials
    ? `<button type="button" class="icon-button" data-action="secret" data-server-id="${escapeHtml(server.id)}" aria-label="Set client secret" title="Set client secret">${KEY}</button>`
    : `<span></span>`;
  const count = typeof server.matchCount === "number" ? `<span class="count">${server.matchCount}</span>` : `<span></span>`;
  const status = server.status ? `<span class="status">${escapeHtml(server.status)}</span>` : "";
  const notice = server.notice ? `<span class="origin">${escapeHtml(server.notice)}</span>` : "";
  const selected = server.selected ? " on" : "";
  return `<div class="server${selected}" role="button" tabindex="0" data-action="select" data-server-id="${escapeHtml(server.id)}" aria-selected="${server.selected ? "true" : "false"}">
    <span class="server-name">${escapeHtml(server.name)}</span>
    ${env}
    ${key}
    ${count}
    <span class="origin">${escapeHtml(server.originLabel)}</span>
    ${notice}
    ${status}
  </div>`;
}

function work(model: FloorHtmlModel, iconUri: (filePath: string) => string, options: readonly EnvironmentOption[]): string {
  const groups = `${toolGroup(model.favourites, "Favourites", iconUri, options)}${model.favourites.length > 0 && model.tools.length > 0 ? `<hr class="rule" />` : ""}${toolGroup(model.tools, "", iconUri, options)}`;
  const message = model.message ? `<p class="empty">${escapeHtml(model.message)}</p>` : "";
  const pending = model.pendingNote ? `<p class="pending">${escapeHtml(model.pendingNote)}</p>` : "";
  return `${toolBar(model)}${groups}${message}${pending}`;
}

function toolBar(model: FloorHtmlModel): string {
  const usedOn = model.usedOnly ? " on" : "";
  const usedNext = model.usedOnly ? "all" : "used";
  const orderNext = model.toolOrder === "desc" ? "asc" : "desc";
  const orderLabel = model.toolOrder === "desc" ? "Z–A" : "A–Z";
  return `<div class="tool-bar">
    <button type="button" class="chip${usedOn}" data-action="used" data-env="${usedNext}" aria-pressed="${model.usedOnly ? "true" : "false"}">Used only</button>
    <button type="button" class="chip" data-action="sort" data-order="${orderNext}" aria-label="Reverse the tool order">${orderLabel}</button>
    <button type="button" class="chip" data-action="catalog">Markdown</button>
  </div>`;
}

function toolGroup(tools: FloorToolView[], label: string, iconUri: (filePath: string) => string, options: readonly EnvironmentOption[]): string {
  if (tools.length === 0) {
    return "";
  }
  const heading = label ? `<div class="group">${escapeHtml(label)}</div>` : "";
  return `${heading}${tools.map((tool) => toolRow(tool, iconUri, options)).join("")}`;
}

function toolRow(tool: FloorToolView, iconUri: (filePath: string) => string, options: readonly EnvironmentOption[]): string {
  const meta = tool.showServer
    ? `<span class="tool-meta">${escapeHtml(tool.serverName)}${tool.environment ? ` · ${escapeHtml(environmentLabel(tool.environment, options))}` : ""} · ${escapeHtml(tool.originLabel)}</span>`
    : "";
  const description = tool.description ? `<span class="tool-desc">${escapeHtml(tool.description)}</span>` : "";
  const pressed = tool.favourite ? "true" : "false";
  const on = tool.favourite ? " on" : "";
  const label = tool.favourite ? "Remove from favourites" : "Favourite this tool";
  return `<div class="tool" role="button" tabindex="0" data-action="open" data-server-id="${escapeHtml(tool.serverId)}" data-tool-name="${escapeHtml(tool.name)}">
    ${iconMarkup(tool, iconUri)}
    <span class="tool-copy">
      <span class="tool-title-line"><span class="tool-title">${escapeHtml(tool.title)}</span>${tool.used ? `<span class="used">Used</span>` : ""}</span>
      ${meta}
      ${description}
    </span>
    <button type="button" class="hex-fav${on}" data-action="favourite" data-server-id="${escapeHtml(tool.serverId)}" data-tool-name="${escapeHtml(tool.name)}" aria-pressed="${pressed}" aria-label="${label}" title="${label}">${HEX}</button>
    <button type="button" class="try" data-action="try" data-server-id="${escapeHtml(tool.serverId)}" data-tool-name="${escapeHtml(tool.name)}" aria-label="Try ${escapeHtml(tool.title)}">Try</button>
  </div>`;
}

function iconMarkup(tool: FloorToolView, iconUri: (filePath: string) => string): string {
  if (tool.iconSvg) {
    const svg = inlineToolSvg(tool.iconSvg);
    if (svg) {
      return svg;
    }
  }
  if (tool.iconPath && !tool.iconPath.toLowerCase().endsWith(".svg")) {
    return `<img class="tool-icon" alt="" src="${escapeHtml(iconUri(tool.iconPath))}" />`;
  }
  return `<span class="tool-icon" aria-hidden="true"></span>`;
}


