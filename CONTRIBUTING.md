# Contributing

Issues and pull requests are welcome. Please read this before you open one. Agents working in this repo follow [AGENTS.md](AGENTS.md).

## Bugs and ideas

Use a [bug report](.github/ISSUE_TEMPLATE/bug_report.md) or a [feature request](.github/ISSUE_TEMPLATE/feature_request.md).

Leave secrets out. That includes client secrets, tokens, authorization headers, and private MCP config. A redacted shape of the server entry is enough.

For a vulnerability, follow [SECURITY.md](SECURITY.md). Do not file a public issue.

## Develop

You need Node.js 20 or newer and VS Code 1.95 or newer.

```bash
npm install
npm test
npm run compile
```

`npm test` runs `tests/*.test.ts`. `npm run compile` writes `dist/extension.js`. Press F5 to open an Extension Development Host. Build and install steps are in the [README](README.md).

## Pull requests

- Branch from `main`.
- Keep the change focused on one behavior.
- Use a [Conventional Commit](https://www.conventionalcommits.org/) subject, then a short body. Examples: `feat:`, `fix:`, `docs:`.
- Update the [README](README.md) in the same change when the user-facing behavior changes.
- Update [CHANGELOG.md](CHANGELOG.md) under `Unreleased` in the same commit. A user-facing change gets an Added, Changed, or Fixed note. Every other commit still gets one line.
- Add or adjust a test when the change is in the TypeScript that the tests cover.

Do not commit:

- `.vscode/mcp.json`
- client secrets, tokens, or real authorization headers
- `node_modules/`, `dist/`, or `*.vsix`

The package name is `mcp-tool-explorer`. The extension id is `Garrard.mcp-tool-explorer`. The publisher id is `Garrard`.
