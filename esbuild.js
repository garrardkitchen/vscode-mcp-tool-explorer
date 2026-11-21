const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");

/** Bundle the extension to CommonJS so the ESM MCP SDK loads inside VS Code. */
const buildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/extension.js",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
  // Prefer the ESM build. jsonc-parser's `main` is UMD and calls
  // require("./impl/...") at runtime, which breaks once the file is bundled.
  mainFields: ["module", "main"],
};

if (watch) {
  esbuild.context(buildOptions).then((context) => context.watch());
} else {
  esbuild.build(buildOptions);
}
