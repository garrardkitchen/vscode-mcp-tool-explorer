import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolIcon } from "../types.js";

const MAX_BYTES = 1024 * 1024;

export function chooseIcon(icons: ToolIcon[] | undefined, theme: "light" | "dark"): ToolIcon | undefined {
  if (!icons || icons.length === 0) {
    return undefined;
  }
  const usable = icons.filter((icon) => {
    const mime = canonicalMime(icon.mimeType) ?? mimeFromSrc(icon.src);
    return mime === undefined || isSupportedMime(mime);
  });
  const preferred = usable.filter((icon) => icon.theme === undefined || icon.theme === theme);
  const candidates = preferred.length > 0 ? preferred : usable;
  return candidates.slice().sort((left, right) => score(left, theme) - score(right, theme))[0];
}

/** Saves a supported image and returns its local path. Remote and data icons are copied into `cacheDir`. */
export async function materializeIcon(icon: ToolIcon, cacheDir: string): Promise<string | undefined> {
  const bytes = await readIconBytes(icon.src);
  if (!bytes || bytes.length === 0 || bytes.length > MAX_BYTES) {
    return undefined;
  }
  const sniffed = sniff(bytes);
  if (!sniffed) {
    return undefined;
  }
  const declared = canonicalMime(icon.mimeType) ?? mimeFromSrc(icon.src);
  if (declared && declared !== sniffed.mime) {
    return undefined;
  }
  await mkdir(cacheDir, { recursive: true });
  const filePath = path.join(cacheDir, `${hash(icon.src)}.${sniffed.ext}`);
  await writeFile(filePath, bytes);
  return filePath;
}

function score(icon: ToolIcon, theme: "light" | "dark"): number {
  const themeScore = icon.theme === theme ? 0 : icon.theme ? 20 : 5;
  const mime = canonicalMime(icon.mimeType) ?? mimeFromSrc(icon.src) ?? "";
  const mimeScore = mime === "image/png" || mime === "image/jpeg" ? 0
    : mime === "image/webp" || mime === "image/gif" ? 2
      : mime === "image/svg+xml" ? 4
        : 3;
  const size = iconSize(icon);
  const sizeScore = size === undefined ? 1 : Math.abs(size - 32) / 32;
  return themeScore + mimeScore + sizeScore;
}

function iconSize(icon: ToolIcon): number | undefined {
  const sizes = icon.sizes ?? [];
  const parsed = sizes
    .map((size) => /^(\d+)/.exec(size)?.[1])
    .map((value) => (value === undefined ? undefined : Number(value)))
    .filter((value): value is number => value !== undefined && value > 0);
  if (parsed.length === 0) {
    return undefined;
  }
  return Math.max(...parsed);
}

async function readIconBytes(src: string): Promise<Buffer | undefined> {
  if (src.startsWith("data:")) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(src);
    if (!match) {
      return undefined;
    }
    const payload = match[3] ?? "";
    return match[2] ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
  }

  if (src.startsWith("file:")) {
    const filePath = fileURLToPath(src);
    const info = await stat(filePath).catch(() => undefined);
    if (!info || !info.isFile() || info.size > MAX_BYTES) {
      return undefined;
    }
    return readFile(filePath);
  }

  if (src.startsWith("https://") || src.startsWith("http://")) {
    const response = await fetch(src, { redirect: "follow", signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
    if (!response?.ok) {
      return undefined;
    }
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
      return undefined;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length > MAX_BYTES ? undefined : bytes;
  }

  return undefined;
}

function sniff(bytes: Buffer): { mime: string; ext: string } | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mime: "image/png", ext: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (bytes.length >= 6 && bytes.subarray(0, 6).toString("ascii").startsWith("GIF8")) {
    return { mime: "image/gif", ext: "gif" };
  }
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  const text = bytes.toString("utf8").trim();
  if (/<script|javascript:|on[a-z]+\s*=/i.test(text)) {
    return undefined;
  }
  if (/^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)) {
    return { mime: "image/svg+xml", ext: "svg" };
  }
  return undefined;
}

function mimeFromSrc(src: string): string | undefined {
  const data = /^data:([^;,]+)/.exec(src);
  if (data?.[1]) {
    return canonicalMime(data[1]);
  }
  const clean = src.split("?")[0]?.split("#")[0]?.toLowerCase() ?? "";
  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg";
  if (clean.endsWith(".gif")) return "image/gif";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".svg")) return "image/svg+xml";
  return undefined;
}

function canonicalMime(mime: string | undefined): string | undefined {
  if (!mime) {
    return undefined;
  }
  const normalized = mime.toLowerCase().split(";")[0]?.trim();
  if (normalized === "image/jpg") {
    return "image/jpeg";
  }
  return normalized;
}

function isSupportedMime(mime: string): boolean {
  return mime === "image/png"
    || mime === "image/jpeg"
    || mime === "image/gif"
    || mime === "image/webp"
    || mime === "image/svg+xml";
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}
