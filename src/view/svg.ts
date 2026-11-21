/**
 * Turns a cached tool SVG into markup that can sit in the detail webview.
 * VS Code cancels many SVG image requests, and an <img> in the flex header
 * collapses under the webview's default max-height, so the icon is inlined.
 * The returned element is a single sanitized <svg class="icon">, or undefined
 * when the file is not a plain icon.
 */

const MAX_CHARS = 1024 * 1024;

const ALLOWED_TAGS = new Set([
  "svg", "g", "path", "circle", "rect", "ellipse", "line", "polyline", "polygon",
  "defs", "lineargradient", "radialgradient", "stop", "title", "desc",
  "clippath", "mask", "symbol", "use",
]);

const ALLOWED_ATTRS = new Set([
  "xmlns", "xmlns:xlink", "viewbox", "width", "height", "fill", "stroke",
  "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
  "stroke-dasharray", "stroke-dashoffset", "opacity", "fill-opacity", "stroke-opacity",
  "fill-rule", "clip-rule", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1",
  "x2", "y2", "points", "transform", "offset", "stop-color", "stop-opacity",
  "gradientunits", "gradienttransform", "spreadmethod", "fx", "fy", "id",
  "clip-path", "mask", "preserveaspectratio", "color", "display", "visibility",
  "overflow", "href", "xlink:href", "style", "xml:space", "enable-background", "version",
]);

const PAINT_ATTRS = new Set([
  "fill", "stroke", "color", "stop-color", "clip-path", "mask",
]);

const STYLE_PROPS = new Set([
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "opacity", "fill-opacity", "stroke-opacity", "fill-rule", "clip-rule",
  "stop-color", "stop-opacity", "color",
]);

interface Tag {
  name: string;
  attrs: Array<{ name: string; value: string }>;
  selfClosing: boolean;
  end: number;
}

export function inlineToolSvg(source: string): string | undefined {
  if (source.length === 0 || source.length > MAX_CHARS || source.includes("\0")) {
    return undefined;
  }
  const comments = stripComments(source.replace(/^\uFEFF/, "").trim());
  if (comments === undefined) {
    return undefined;
  }
  const text = comments.replace(/^<\?xml\b[^?]*\?>\s*/i, "");
  if (/<!|<\?/.test(text)) {
    return undefined;
  }

  const parts: string[] = [];
  const stack: string[] = [];
  let i = 0;
  let closedRoot = false;
  while (i < text.length) {
    if (closedRoot) {
      return text.slice(i).trim().length === 0 ? parts.join("") : undefined;
    }
    if (text[i] !== "<") {
      const next = text.indexOf("<", i);
      const chunk = text.slice(i, next < 0 ? text.length : next);
      if (chunk.trim().length > 0) {
        const parent = stack[stack.length - 1];
        if (parent !== "title" && parent !== "desc") {
          return undefined;
        }
        parts.push(escapeText(chunk));
      }
      if (next < 0) {
        break;
      }
      i = next;
      continue;
    }
    if (text.startsWith("</", i)) {
      const close = /^<\/\s*([a-zA-Z][\w:.-]*)\s*>/.exec(text.slice(i));
      if (!close) {
        return undefined;
      }
      const name = localName(close[1] ?? "");
      if (stack.pop() !== name) {
        return undefined;
      }
      parts.push(`</${name}>`);
      closedRoot = name === "svg" && stack.length === 0;
      i += close[0].length;
      continue;
    }

    const tag = readTag(text, i);
    if (!tag) {
      return undefined;
    }
    const name = localName(tag.name);
    if (!ALLOWED_TAGS.has(name)) {
      return undefined;
    }
    if (stack.length === 0 && (name !== "svg" || parts.length > 0)) {
      return undefined;
    }
    const attrs = sanitizeAttrs(name, tag.attrs);
    if (attrs === undefined) {
      return undefined;
    }
    parts.push(`<${name}${attrs}${tag.selfClosing ? " />" : ">"}`);
    if (tag.selfClosing) {
      closedRoot = name === "svg" && stack.length === 0;
    } else {
      stack.push(name);
    }
    i = tag.end;
  }
  return closedRoot && stack.length === 0 ? parts.join("") : undefined;
}

function sanitizeAttrs(tag: string, attrs: Tag["attrs"]): string | undefined {
  const rendered: string[] = [];
  for (const attr of attrs) {
    const key = attr.name.toLowerCase();
    if (key.startsWith("on")) {
      return undefined;
    }
    if (tag === "svg" && (key === "class" || key === "aria-hidden")) {
      continue;
    }
    if (!ALLOWED_ATTRS.has(key)) {
      continue;
    }
    if (/javascript\s*:/i.test(attr.value) || attr.value.includes("<") || attr.value.includes(">")) {
      return undefined;
    }
    if (key === "href" || key === "xlink:href") {
      if (!/^#[A-Za-z][\w:.-]*$/.test(attr.value)) {
        return undefined;
      }
    } else if (key === "id" && !/^[A-Za-z][\w:.-]*$/.test(attr.value)) {
      continue;
    } else if (key === "style") {
      const style = sanitizeStyle(attr.value);
      if (style === undefined) {
        return undefined;
      }
      if (style.length > 0) {
        rendered.push(` style="${escapeText(style)}"`);
      }
      continue;
    } else if (PAINT_ATTRS.has(key) && !paintValueOk(attr.value)) {
      return undefined;
    }
    rendered.push(` ${key}="${escapeText(attr.value)}"`);
  }
  if (tag === "svg") {
    rendered.push(` class="icon" aria-hidden="true"`);
  }
  return rendered.join("");
}

function sanitizeStyle(value: string): string | undefined {
  if (/[{}<>]|@|expression\s*\(|javascript\s*:/i.test(value)) {
    return undefined;
  }
  const kept: string[] = [];
  for (const part of value.split(";")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const split = trimmed.indexOf(":");
    if (split < 0) {
      return undefined;
    }
    const prop = trimmed.slice(0, split).trim().toLowerCase();
    const paint = trimmed.slice(split + 1).trim();
    if (!STYLE_PROPS.has(prop)) {
      continue;
    }
    if (!paintValueOk(paint)) {
      return undefined;
    }
    kept.push(`${prop}:${paint}`);
  }
  return kept.join(";");
}

function paintValueOk(value: string): boolean {
  const compact = value.toLowerCase().replace(/\s+/g, "");
  if (
    compact.includes("<")
    || compact.includes(">")
    || compact.includes("javascript:")
    || compact.includes("expression(")
    || /\b(?:https?:|file:|data:)/.test(compact)
  ) {
    return false;
  }
  const urls = compact.match(/url\([^)]*\)/g) ?? [];
  if (!urls.every((url) => /^url\(#[a-z0-9_.:-]+\)$/.test(url))) {
    return false;
  }
  const withoutUrls = compact.replace(/url\(#[a-z0-9_.:-]+\)/g, "");
  const funcs = withoutUrls.match(/[a-z]+\([^)]*\)/g) ?? [];
  return funcs.every((fn) => /^(?:rgb|rgba|hsl|hsla)\([0-9.,%+-]+\)$/.test(fn));
}

function readTag(text: string, start: number): Tag | undefined {
  let i = start + 1;
  const name = /^[a-zA-Z][\w:.-]*/.exec(text.slice(i));
  if (!name) {
    return undefined;
  }
  i += name[0].length;
  const attrs: Tag["attrs"] = [];
  while (i < text.length) {
    const skipped = skipSpace(text, i);
    i = skipped;
    if (text[i] === ">") {
      return { name: name[0], attrs, selfClosing: false, end: i + 1 };
    }
    if (text[i] === "/" && text[i + 1] === ">") {
      return { name: name[0], attrs, selfClosing: true, end: i + 2 };
    }
    const attrName = /^[a-zA-Z_:][\w:.-]*/.exec(text.slice(i));
    if (!attrName) {
      return undefined;
    }
    i += attrName[0].length;
    i = skipSpace(text, i);
    if (text[i] !== "=") {
      return undefined;
    }
    i = skipSpace(text, i + 1);
    const quote = text[i];
    if (quote !== `"` && quote !== `'`) {
      return undefined;
    }
    const end = text.indexOf(quote, i + 1);
    if (end < 0) {
      return undefined;
    }
    attrs.push({ name: attrName[0], value: text.slice(i + 1, end) });
    i = end + 1;
  }
  return undefined;
}

function skipSpace(text: string, index: number): number {
  let i = index;
  while (text[i] === " " || text[i] === "\n" || text[i] === "\r" || text[i] === "\t") {
    i += 1;
  }
  return i;
}

function localName(name: string): string {
  const colon = name.lastIndexOf(":");
  return (colon >= 0 ? name.slice(colon + 1) : name).toLowerCase();
}

function stripComments(source: string): string | undefined {
  const parts: string[] = [];
  let i = 0;
  while (i < source.length) {
    const start = source.indexOf("<!--", i);
    if (start < 0) {
      parts.push(source.slice(i));
      break;
    }
    parts.push(source.slice(i, start));
    const end = source.indexOf("-->", start + 4);
    if (end < 0) {
      return undefined;
    }
    i = end + 3;
  }
  return parts.join("");
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
