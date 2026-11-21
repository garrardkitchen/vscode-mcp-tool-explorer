import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chooseIcon, materializeIcon } from "../src/mcp/icons.js";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("prefers the icon for the active theme", () => {
  const icons = [
    { src: "light.png", mimeType: "image/png", theme: "light" as const },
    { src: "dark.png", mimeType: "image/png", theme: "dark" as const },
  ];
  assert.equal(chooseIcon(icons, "dark")?.src, "dark.png");
  assert.equal(chooseIcon(icons, "light")?.src, "light.png");
  assert.equal(chooseIcon([{ src: "only.png", mimeType: "image/png", theme: "light" }], "dark")?.src, "only.png");
});

test("writes a data-uri png and rejects an svg that contains a script", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mcp-icons-"));
  try {
    const saved = await materializeIcon({ src: png, mimeType: "image/png" }, directory);
    assert.ok(saved);
    const bytes = await readFile(saved);
    assert.equal(bytes.subarray(0, 4).toString("hex"), "89504e47");

    const svg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')}`;
    assert.equal(await materializeIcon({ src: svg, mimeType: "image/svg+xml" }, directory), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
