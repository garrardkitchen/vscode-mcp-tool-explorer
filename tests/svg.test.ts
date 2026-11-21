import assert from "node:assert/strict";
import test from "node:test";
import { renderDetailHtml } from "../src/view/html.js";
import { inlineToolSvg } from "../src/view/svg.js";

const icon = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M27.8 30H4.2" fill="#26C9FC"/>
<path d="M11 23H8" fill="white"/>
<path d="M8 15H7" style="fill:#321B41;position:fixed;width:999px" />
</svg>
`;

test("inlines a plain svg icon and drops layout styles", () => {
  const svg = inlineToolSvg(icon);
  assert.ok(svg);
  assert.match(svg, /^<svg\b/);
  assert.match(svg, /class="icon"/);
  assert.match(svg, /viewbox="0 0 32 32"/);
  assert.match(svg, /fill="#26C9FC"/);
  assert.match(svg, /fill="white"/);
  assert.match(svg, /style="fill:#321B41"/);
  assert.doesNotMatch(svg, /position|999px|<img/);
});

test("rejects svg icons that can run or load outside the image", () => {
  const hostile = [
    `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml">x</body></foreignObject></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.test/a.png"></image></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil.test/a.svg#x"></use></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><style>body{display:none}</style></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><path fill="url(https://evil.test/a)" d="M0 0"/></svg>`,
  ];
  for (const source of hostile) {
    assert.equal(inlineToolSvg(source), undefined, source);
  }
});

test("detail html inlines a safe svg and keeps a raster icon as an image", () => {
  const base = {
    serverName: "memory",
    serverTransport: "stdio",
    serverFile: "/work/.vscode/mcp.json",
    originLabel: "Workspace",
    toolName: "echo",
    title: "Echo",
    parameters: [],
    parameterSchema: { type: "object" },
  };
  const svgHtml = renderDetailHtml({ ...base, iconSvg: icon }, "nonce", "https://*.vscode-cdn.net");
  assert.match(svgHtml, /<svg[^>]*class="icon"/);
  assert.match(svgHtml, /fill="#26C9FC"/);
  assert.match(svgHtml, /max-height:\s*40px/);
  assert.doesNotMatch(svgHtml, /<img/);
  assert.doesNotMatch(svgHtml, /<script>/);

  const blocked = renderDetailHtml({
    ...base,
    iconSvg: `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`,
  }, "nonce", "https://*.vscode-cdn.net");
  assert.match(blocked, /class="icon fallback"/);
  assert.doesNotMatch(blocked, /alert\(1\)|<script>/);

  const pngHtml = renderDetailHtml({
    ...base,
    iconSrc: "https://file+.vscode-resource.vscode-cdn.net/icon.png",
  }, "nonce", "https://*.vscode-cdn.net");
  assert.match(pngHtml, /<img class="icon"/);
  assert.match(pngHtml, /icon\.png/);
});
