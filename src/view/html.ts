import type { ParameterPrompt } from "../try/parameters.js";
import type { SchemaField } from "../types.js";
import { inlineToolSvg } from "./svg.js";

export interface DetailModel {
  serverName: string;
  serverTransport: string;
  serverFile: string;
  originLabel: string;
  toolName: string;
  title: string;
  description?: string;
  /** Webview URI for a raster icon. SVG files use `iconSvg` instead. */
  iconSrc?: string;
  /** Cached SVG file text. Rendered inline when it is a plain icon. */
  iconSvg?: string;
  allowlistNote?: string;
  notice?: string;
  parameters: SchemaField[];
  parameterSchema: unknown;
  /** Undefined when the server did not declare an output schema. */
  response?: SchemaField[];
  responseSchema?: unknown;
  /** Present after the user has tried the tool. */
  call?: DetailCall;
  /** When set, the page opens with the parameter dialog. */
  tryForm?: TryFormModel;
}

export interface TryFormModel {
  title: string;
  prompts: ParameterPrompt[];
  /** Previous answers when a field failed validation. */
  answers?: Record<string, string>;
  errors?: Record<string, string>;
  fixedNote?: string;
}

export interface DetailCall {
  argumentsText: string;
  isError: boolean;
  texts: string[];
  structuredText?: string;
  notes: string[];
  error?: string;
}

export function renderDetailHtml(model: DetailModel, nonce: string, cspSource: string): string {
  const icon = iconMarkup(model);
  const description = model.description
    ? `<p class="description">${escapeHtml(model.description)}</p>`
    : "";
  const allowlist = model.allowlistNote ? `<p class="note">${escapeHtml(model.allowlistNote)}</p>` : "";
  const notice = model.notice ? `<p class="note">${escapeHtml(model.notice)}</p>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <title>${escapeHtml(model.title)}</title>
  <style nonce="${nonce}">
    body {
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 1.5;
      margin: 0;
      padding: 28px 32px 64px;
    }
    main { max-width: 880px; }
    header { display: flex; gap: 16px; align-items: flex-start; }
    /* The webview shell sets img { max-height: 100% }. In this flex header that
       percentage resolves to 0, so the size has to be a length, not a percentage. */
    .icon {
      width: 40px;
      height: 40px;
      max-width: 40px;
      max-height: 40px;
      min-width: 40px;
      min-height: 40px;
      object-fit: contain;
      flex: 0 0 auto;
      display: block;
    }
    .icon.fallback {
      background: var(--vscode-badge-background);
      border-radius: 6px;
      box-sizing: border-box;
    }
    h1 { font-size: 1.45em; font-weight: 600; margin: 0 0 4px; }
    h2 { font-size: 1.05em; font-weight: 600; margin: 28px 0 8px; }
    .meta, .description, .note { color: var(--vscode-descriptionForeground); margin: 4px 0; }
    .note { color: var(--vscode-editorWarning-foreground, var(--vscode-descriptionForeground)); }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td {
      text-align: left;
      vertical-align: top;
      padding: 7px 10px;
      border-bottom: 1px solid var(--vscode-widget-border, rgba(127, 127, 127, 0.35));
    }
    th { color: var(--vscode-descriptionForeground); font-weight: 600; }
    .type, pre, code { font-family: var(--vscode-editor-font-family); }
    .type { white-space: nowrap; }
    .depth-1 { padding-left: 22px; }
    .depth-2 { padding-left: 38px; }
    .depth-3 { padding-left: 54px; }
    .depth-4 { padding-left: 70px; }
    pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 12px;
      overflow: auto;
      border-radius: 4px;
    }
    details { margin-top: 10px; }
    summary { cursor: pointer; color: var(--vscode-textLink-foreground); }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 2px;
      padding: 6px 14px;
      font: inherit;
      cursor: pointer;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }
    .call-error { color: var(--vscode-errorForeground); }
    .try-dialog {
      padding: 0;
      border: 1px solid var(--vscode-contrastBorder, var(--vscode-widget-border, transparent));
      border-top: 3px solid var(--vscode-button-background);
      border-radius: 8px;
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
      width: min(34rem, calc(100vw - 32px));
      max-height: min(80vh, 760px);
      box-shadow: 0 16px 48px var(--vscode-widget-shadow);
    }
    .try-dialog::backdrop {
      background: #0006;
    }
    .try-dialog form {
      display: flex;
      flex-direction: column;
      max-height: min(80vh, 760px);
      margin: 0;
    }
    .try-head, .try-footer { flex: none; }
    .try-head { padding: 18px 22px 8px; }
    .try-head h2 {
      margin: 0;
      font-size: 1.2em;
      font-weight: 600;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }
    .lede {
      margin: 6px 0 0;
      max-width: 62ch;
      color: var(--vscode-descriptionForeground);
    }
    .fixed-note { margin: 8px 0 0; color: var(--vscode-descriptionForeground); overflow-wrap: anywhere; }
    .try-fields {
      flex: 1 1 auto;
      min-height: 0;
      overflow: auto;
      padding: 8px 22px 18px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 0;
      padding: 0 0 16px;
      border: none;
      border-bottom: 1px solid var(--vscode-widget-border, rgba(127, 127, 127, 0.28));
      min-inline-size: 0;
    }
    .try-fields .field:last-child { border-bottom: none; padding-bottom: 0; }
    .field-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
      padding: 0;
      width: 100%;
    }
    .field-name { font-weight: 600; overflow-wrap: anywhere; }
    .field-status { color: var(--vscode-descriptionForeground); font-size: 0.85em; flex: none; }
    .field-status.required { color: var(--vscode-foreground); }
    .field-type, .field-help, .field-hint, .field-error { margin: 0; overflow-wrap: anywhere; }
    .field-type {
      font-family: var(--vscode-editor-font-family);
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
    }
    .field-help, .field-hint { color: var(--vscode-descriptionForeground); }
    .field-help { white-space: pre-wrap; }
    .field-error { color: var(--vscode-errorForeground); }
    .control { margin-top: 4px; }
    .try-dialog input[type="text"],
    .try-dialog textarea,
    .try-dialog select {
      width: 100%;
      box-sizing: border-box;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
      padding: 7px 10px;
      font: inherit;
    }
    .try-dialog textarea,
    .try-dialog input.mono { font-family: var(--vscode-editor-font-family); }
    .try-dialog textarea { min-height: 6.5em; resize: vertical; }
    .try-dialog input::placeholder,
    .try-dialog textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
    .try-dialog input:focus,
    .try-dialog textarea:focus,
    .try-dialog select:focus,
    .try-dialog input[type="radio"]:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }
    .try-dialog input[aria-invalid="true"],
    .try-dialog textarea[aria-invalid="true"],
    .try-dialog select[aria-invalid="true"] {
      border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
      background: var(--vscode-inputValidation-errorBackground, var(--vscode-input-background));
    }
    .try-dialog .field[aria-invalid="true"] input[type="radio"] {
      outline: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
    }
    .choices { display: flex; flex-wrap: wrap; gap: 8px 18px; }
    .choice { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .try-dialog input[type="radio"] { accent-color: var(--vscode-button-background); }
    .try-footer {
      display: flex;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 8px;
      padding: 12px 22px 16px;
      border-top: 1px solid var(--vscode-widget-border, rgba(127, 127, 127, 0.35));
    }
    .try-dialog button { min-width: 5.5rem; border: 1px solid var(--vscode-button-border, transparent); }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  </style>
</head>
<body>
  <main>
    <header>
      ${icon}
      <div>
        <h1>${escapeHtml(model.title)}</h1>
        <p class="meta">${escapeHtml(model.toolName)} · ${escapeHtml(model.serverName)} · ${escapeHtml(model.serverTransport)}</p>
        <p class="meta">${escapeHtml(model.originLabel)}</p>
        <p class="meta">${escapeHtml(model.serverFile)}</p>
      </div>
    </header>
    ${description}
    ${allowlist}
    ${notice}
    ${trySection(model)}
    ${model.tryForm ? tryDialog(model.tryForm) : ""}
    <h2>Parameters</h2>
    ${model.parameters.length === 0 ? `<p class="meta">This tool declares no parameters.</p>` : fieldTable(model.parameters)}
    ${schemaBlock("Parameter schema", model.parameterSchema)}
    <h2>Response</h2>
    ${responseSection(model)}
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById("try-tool")?.addEventListener("click", () => {
      vscode.postMessage({ command: "try" });
    });
    const dialog = document.getElementById("try-dialog");
    const form = document.getElementById("try-form");
    if (dialog instanceof HTMLDialogElement && form instanceof HTMLFormElement) {
      dialog.showModal();
      let sent = false;
      const finish = (command) => {
        if (sent) return;
        sent = true;
        const answers = {};
        for (const [key, value] of new FormData(form).entries()) {
          if (typeof value === "string") {
            Object.defineProperty(answers, key, { value: value, enumerable: true, writable: true, configurable: true });
          }
        }
        vscode.postMessage({ command, answers });
      };
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        finish("submitTry");
      });
      document.getElementById("try-cancel")?.addEventListener("click", () => finish("cancelTry"));
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        finish("cancelTry");
      });
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) finish("cancelTry");
      });
    }
  </script>
</body>
</html>`;
}

function iconMarkup(model: DetailModel): string {
  if (model.iconSvg) {
    const svg = inlineToolSvg(model.iconSvg);
    if (svg) {
      return svg;
    }
  }
  if (model.iconSrc) {
    return `<img class="icon" alt="" src="${escapeHtml(model.iconSrc)}" />`;
  }
  return `<span class="icon fallback" aria-hidden="true"></span>`;
}

function trySection(model: DetailModel): string {
  const intro = `<h2>Try</h2>
    <p class="meta">Try opens a dialog with every parameter. Run calls the tool and shows the response here. Cancel leaves the tool uncalled.</p>
    <p><button type="button" id="try-tool">Try</button></p>`;
  return model.call ? `${intro}${callSection(model.call)}` : intro;
}

function callSection(call: DetailCall): string {
  const error = call.error ? `<p class="call-error">${escapeHtml(call.error)}</p>` : "";
  const reported = call.isError && !call.error ? `<p class="call-error">The tool reported an error.</p>` : "";
  const argumentsBlock = call.argumentsText.length > 0
    ? `<h2>Arguments sent</h2><pre>${escapeHtml(call.argumentsText)}</pre>`
    : "";
  const texts = call.texts.length > 0
    ? `<h2>Result</h2><pre>${escapeHtml(call.texts.join("\n\n"))}</pre>`
    : "";
  const structured = call.structuredText !== undefined
    ? `<h2>Structured result</h2><pre>${escapeHtml(call.structuredText)}</pre>`
    : "";
  const notes = call.notes.map((note) => `<p class="meta">${escapeHtml(note)}</p>`).join("");
  const empty = !call.error && call.texts.length === 0 && call.structuredText === undefined && call.notes.length === 0
    ? `<p class="meta">The tool returned no content.</p>`
    : "";
  return `<h2>Last result</h2>${reported}${error}${argumentsBlock}${texts}${structured}${notes}${empty}`;
}

function responseSection(model: DetailModel): string {
  if (!model.response) {
    return `<p class="meta">This tool does not declare a response schema.</p>`;
  }
  const intro = `<p class="meta">The server declares this schema for the tool's structured result.</p>`;
  const table = model.response.length === 0
    ? `<p class="meta">The response schema has no fields.</p>`
    : fieldTable(model.response);
  return `${intro}${table}${schemaBlock("Response schema", model.responseSchema)}`;
}

function fieldTable(fields: SchemaField[]): string {
  const rows = fields.map((field) => {
    const depth = Math.min(field.depth, 4);
    return `<tr>
      <td class="depth-${depth}">${escapeHtml(field.name)}</td>
      <td class="type">${escapeHtml(field.type)}</td>
      <td>${field.required ? "yes" : "no"}</td>
      <td>${escapeHtml(field.description ?? "")}</td>
    </tr>`;
  }).join("");
  return `<table>
    <thead><tr><th>Name</th><th>Datatype</th><th>Required</th><th>Description</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function schemaBlock(title: string, schema: unknown): string {
  return `<details>
    <summary>${escapeHtml(title)}</summary>
    <pre>${escapeHtml(JSON.stringify(schema, null, 2))}</pre>
  </details>`;
}

const CHOICE_RADIOS = 5;

function tryDialog(form: TryFormModel): string {
  const prompts = form.prompts;
  const focusIndex = focusField(prompts, form.errors);
  const fields = prompts.map((prompt, index) => fieldBlock(prompt, index, form, index === focusIndex)).join("");
  const fixed = form.fixedNote ? `<p class="fixed-note">${escapeHtml(form.fixedNote)}</p>` : "";
  const body = fields.length > 0 ? `<div class="try-fields">${fields}</div>` : "";
  const runFocus = focusIndex < 0 ? " autofocus" : "";
  return `<dialog id="try-dialog" class="try-dialog" aria-labelledby="try-title" aria-describedby="try-lede">
    <form id="try-form" autocomplete="off">
      <div class="try-head">
        <h2 id="try-title">Run ${escapeHtml(form.title)}</h2>
        <p id="try-lede" class="lede">${escapeHtml(formLede(prompts))}</p>
        ${fixed}
      </div>
      ${body}
      <div class="try-footer">
        <button type="button" id="try-cancel" class="secondary">Cancel</button>
        <button type="submit" id="try-run"${runFocus}>Run</button>
      </div>
    </form>
  </dialog>`;
}

function formLede(prompts: ParameterPrompt[]): string {
  if (prompts.length === 0) {
    return "This tool takes no parameters.";
  }
  const hasChoices = prompts.some((prompt) => (prompt.choices?.length ?? 0) > 0);
  return hasChoices
    ? "Fill in the parameters. Leave an optional field empty, or choose Leave unset, to skip it."
    : "Fill in the parameters. Leave an optional field empty to skip it.";
}

function focusField(prompts: ParameterPrompt[], errors: Record<string, string> | undefined): number {
  if (prompts.length === 0) {
    return -1;
  }
  const invalid = prompts.findIndex((prompt) => errors?.[prompt.name]);
  return invalid >= 0 ? invalid : 0;
}

function fieldBlock(prompt: ParameterPrompt, index: number, form: TryFormModel, focus: boolean): string {
  const error = form.errors?.[prompt.name];
  const hint = fieldHint(prompt);
  const hintId = hint ? `try-hint-${index}` : undefined;
  const errorId = error ? `try-error-${index}` : undefined;
  const describedBy = [hintId, errorId].filter((id): id is string => id !== undefined);
  const described = describedBy.length > 0 ? describedBy.join(" ") : undefined;
  const status = prompt.required
    ? `<span class="field-status required">Required</span>`
    : `<span class="field-status">Optional</span>`;
  const help = prompt.description ? `<p class="field-help">${escapeHtml(prompt.description)}</p>` : "";
  const hintHtml = hint ? `<p class="field-hint" id="${hintId}">${escapeHtml(hint)}</p>` : "";
  const errorHtml = error ? `<p class="field-error" id="${errorId}">${escapeHtml(error)}</p>` : "";
  const choices = prompt.choices ?? [];
  const useChoices = (prompt.kind === "boolean" || prompt.kind === "enum") && choices.length > 0;
  if (useChoices && choices.length <= CHOICE_RADIOS) {
    return `<fieldset class="field"${invalidAttrs(Boolean(error), described)}>
      <legend class="field-head"><span class="field-name">${escapeHtml(prompt.name)}</span>${status}</legend>
      <p class="field-type">${escapeHtml(prompt.typeLabel)}</p>
      ${help}
      ${hintHtml}
      ${choiceRadios(prompt, form.answers, focus)}
      ${errorHtml}
    </fieldset>`;
  }
  const controlId = `try-field-${index}`;
  return `<div class="field">
    <div class="field-head"><label class="field-name" for="${controlId}">${escapeHtml(prompt.name)}</label>${status}</div>
    <p class="field-type">${escapeHtml(prompt.typeLabel)}</p>
    ${help}
    ${hintHtml}
    ${useChoices ? choiceSelect(prompt, index, form.answers, focus, described, Boolean(error)) : textControl(prompt, index, form.answers, focus, described, Boolean(error))}
    ${errorHtml}
  </div>`;
}

function invalidAttrs(invalid: boolean, described: string | undefined): string {
  const describedAttr = described ? ` aria-describedby="${described}"` : "";
  return invalid ? ` aria-invalid="true"${describedAttr}` : describedAttr;
}

function choiceRadios(prompt: ParameterPrompt, answers: Record<string, string> | undefined, focus: boolean): string {
  const selected = selectedChoice(prompt, answers);
  const options = prompt.required ? [] : [{ label: "Leave unset", value: "" }];
  for (const choice of prompt.choices ?? []) {
    options.push({ label: choice.label, value: choice.value });
  }
  const radios = options.map((option, optionIndex) => {
    const checked = selected !== undefined && option.value === selected ? " checked" : "";
    const auto = focus && (selected === undefined ? optionIndex === 0 : option.value === selected) ? " autofocus" : "";
    return `<label class="choice"><input type="radio" name="${escapeHtml(prompt.name)}" value="${escapeHtml(option.value)}"${checked}${auto} /> ${escapeHtml(option.label)}</label>`;
  }).join("");
  return `<div class="choices control">${radios}</div>`;
}

function choiceSelect(
  prompt: ParameterPrompt,
  index: number,
  answers: Record<string, string> | undefined,
  focus: boolean,
  described: string | undefined,
  invalid: boolean,
): string {
  const selected = selectedChoice(prompt, answers) ?? "";
  const options = choiceOptions(prompt).map((option) => {
    const selectedAttr = option.value === selected ? " selected" : "";
    return `<option value="${escapeHtml(option.value)}"${selectedAttr}>${escapeHtml(option.label)}</option>`;
  }).join("");
  const auto = focus ? " autofocus" : "";
  return `<select id="try-field-${index}" class="control" name="${escapeHtml(prompt.name)}"${auto}${invalidAttrs(invalid, described)}>${options}</select>`;
}

function choiceOptions(prompt: ParameterPrompt): { label: string; value: string }[] {
  const options = prompt.required ? [{ label: "Choose a value", value: "" }] : [{ label: "Leave unset", value: "" }];
  for (const choice of prompt.choices ?? []) {
    options.push({ label: choice.label, value: choice.value });
  }
  return options;
}

function textControl(
  prompt: ParameterPrompt,
  index: number,
  answers: Record<string, string> | undefined,
  focus: boolean,
  described: string | undefined,
  invalid: boolean,
): string {
  const value = textValue(prompt, answers);
  const auto = focus ? " autofocus" : "";
  const attrs = `${auto}${invalidAttrs(invalid, described)}`;
  if (prompt.kind === "json") {
    return `<textarea id="try-field-${index}" class="control" name="${escapeHtml(prompt.name)}" rows="5" spellcheck="false" autocomplete="off" placeholder="${escapeHtml(jsonPlaceholder(prompt))}"${attrs}>${escapeHtml(value)}</textarea>`;
  }
  const mono = prompt.kind === "number" || prompt.kind === "integer" ? ` class="control mono"` : ` class="control"`;
  const mode = prompt.kind === "integer" ? ` inputmode="numeric"` : prompt.kind === "number" ? ` inputmode="decimal"` : "";
  const placeholder = prompt.required ? "" : ` placeholder="Leave empty to skip"`;
  return `<input id="try-field-${index}"${mono} type="text" name="${escapeHtml(prompt.name)}" spellcheck="false" autocomplete="off" value="${escapeHtml(value)}"${mode}${placeholder}${attrs} />`;
}

function jsonPlaceholder(prompt: ParameterPrompt): string {
  if (prompt.container === "array") {
    return "[]";
  }
  if (prompt.container === "object") {
    return "{}";
  }
  return "JSON";
}

function textValue(prompt: ParameterPrompt, answers: Record<string, string> | undefined): string {
  if (answers) {
    return recorded(answers, prompt.name) ?? "";
  }
  return prompt.prefill ?? "";
}

function selectedChoice(prompt: ParameterPrompt, answers: Record<string, string> | undefined): string | undefined {
  if (answers) {
    return recorded(answers, prompt.name) ?? "";
  }
  return prompt.required ? undefined : "";
}

function recorded(answers: Record<string, string>, name: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(answers, name)) {
    return undefined;
  }
  const value = answers[name];
  return typeof value === "string" ? value : undefined;
}

function fieldHint(prompt: ParameterPrompt): string | undefined {
  const parts: string[] = [];
  if (prompt.kind === "json") {
    parts.push(prompt.container === "array"
      ? "Enter a JSON array."
      : prompt.container === "object"
        ? "Enter a JSON object."
        : "Enter JSON.");
  }
  if (prompt.nullable && prompt.kind !== "string" && prompt.kind !== "boolean" && prompt.kind !== "enum") {
    parts.push("Enter null for JSON null.");
  }
  const fallback = prompt.choices?.find((choice) => choice.description === "Default");
  if (fallback && (prompt.kind === "boolean" || prompt.kind === "enum")) {
    parts.push(`Default is ${fallback.label}.`);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
