function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses a JSON object or array. Other text stays plain. */
export function parseJsonDocument(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(trimmed);
    if (isRecord(value) || Array.isArray(value)) {
      return value;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function pathFor(parent: string, key: string | number): string {
  if (typeof key === "number") {
    return `${parent}[${key}]`;
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return `${parent}.${key}`;
  }
  return `${parent}[${JSON.stringify(key)}]`;
}

function line(html: string, current = false): string {
  return `<div class="json-line${current ? " now" : ""}"><span class="json-gutter"></span><span class="json-code">${html}</span></div>`;
}

function pad(depth: number): string {
  return "  ".repeat(depth);
}

function primitive(value: unknown, path: string): string {
  if (value === null) {
    return `<span class="z json-hit" data-path="${escapeHtml(path)}">null</span>`;
  }
  if (typeof value === "string") {
    return `<span class="p">"</span><span class="s json-hit" data-path="${escapeHtml(path)}">${escapeHtml(value)}</span><span class="p">"</span>`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    const kind = typeof value === "number" ? "n" : "b";
    return `<span class="${kind} json-hit" data-path="${escapeHtml(path)}">${escapeHtml(String(value))}</span>`;
  }
  return `<span class="z json-hit" data-path="${escapeHtml(path)}">${escapeHtml(String(value))}</span>`;
}

function write(value: unknown, path: string, depth: number, lines: string[]): void {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(line(`${pad(depth)}<span class="p">[]</span>`));
      return;
    }
    lines.push(line(`${pad(depth)}<span class="p">[</span>`));
    value.forEach((item, index) => {
      const child = pathFor(path, index);
      if (isRecord(item) || Array.isArray(item)) {
        write(item, child, depth + 1, lines);
      } else {
        const comma = index < value.length - 1 ? `<span class="p">,</span>` : "";
        lines.push(line(`${pad(depth + 1)}${primitive(item, child)}${comma}`));
      }
      if ((isRecord(item) || Array.isArray(item)) && index < value.length - 1) {
        const last = lines[lines.length - 1];
        if (last) {
          lines[lines.length - 1] = last.replace("</span></div>", `<span class="p">,</span></span></div>`);
        }
      }
    });
    lines.push(line(`${pad(depth)}<span class="p">]</span>`));
    return;
  }
  if (!isRecord(value)) {
    lines.push(line(`${pad(depth)}${primitive(value, path)}`));
    return;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    lines.push(line(`${pad(depth)}<span class="p">{}</span>`));
    return;
  }
  lines.push(line(`${pad(depth)}<span class="p">{</span>`));
  keys.forEach((key, index) => {
    const child = pathFor(path, key);
    const comma = index < keys.length - 1 ? `<span class="p">,</span>` : "";
    const keyHtml = `<span class="p">"</span><span class="k json-hit" data-path="${escapeHtml(child)}">${escapeHtml(key)}</span><span class="p">"</span><span class="p">: </span>`;
    const item = value[key];
    if (isRecord(item) || Array.isArray(item)) {
      lines.push(line(`${pad(depth + 1)}${keyHtml}`));
      write(item, child, depth + 1, lines);
      if (comma) {
        const last = lines[lines.length - 1];
        if (last) {
          lines[lines.length - 1] = last.replace("</span></div>", `${comma}</span></div>`);
        }
      }
      return;
    }
    lines.push(line(`${pad(depth + 1)}${keyHtml}${primitive(item, child)}${comma}`));
  });
  lines.push(line(`${pad(depth)}<span class="p">}</span>`));
}

/** Colour-coded JSON. Searchable values carry `data-path`. `<` is escaped. */
export function renderColouredJson(value: unknown): string {
  const lines: string[] = [];
  write(value, "$", 0, lines);
  return `<div class="json-doc">${lines.join("")}</div>`;
}
