# Changelog

All notable changes to MCP Tool Explorer are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Documented how to publish the same package to the Visual Studio Marketplace and to Open VSX.
- Documented local install and uninstall for both VS Code and Kiro.
- Added the changelog, security policy, contributing guide, code of conduct, and GitHub issue and pull request templates.
- Added AGENTS.md with the repository layout, commit rules, dependencies, and the tool-call flow.

## [0.1.17] - 2026-11-22

### Added

- Saved the parameter values from a run for that tool on this machine. A run that matches the newest saved try is not stored again. Up to 20 tries are kept, newest first.
- Added **Previous tries**, which fills the dialog from a saved run. **Clear fields** restores the unused dialog and leaves saved tries in place.
- Added **Remove** for a saved try. The dialog asks you to confirm before that entry is deleted. The fields you are editing stay as they are.
- Made the try dialog taller. Drag the lower-right corner to resize it. The next try dialog opens at that size, for every tool.

### Fixed

- Kept the note under **Previous tries** above the parameter fields.
- Kept the try dialog open while its corner is dragged.

## [0.1.14] - 2026-11-21

### Added

- First public release.
- Listed MCP servers from workspace `.vscode/mcp.json` and `.mcp.json`, the active profile `mcp.json`, and Copilot `mcp-config.json`.
- Listed each server's tools in alphabetical order, with the tool icon beside the name.
- Opened a tool in an editor tab on a single click. Another single click replaces that tab. A double-click keeps the tab open.
- Showed parameter names, datatypes, and the response schema. Listing tools does not call them.
- Added Try. A dialog collects every parameter, Run calls the tool, and Cancel leaves it uncalled.
- Connected an HTTP server with a machine-to-machine client credentials grant. Browser sign-in is not started.
- Added the activity bar mark and the icon used in the Extensions view.

[Unreleased]: https://github.com/garrardkitchen/vscode-mcp-tool-explorer/compare/5cdef75...HEAD
[0.1.17]: https://github.com/garrardkitchen/vscode-mcp-tool-explorer/compare/b75a211...5cdef75
[0.1.14]: https://github.com/garrardkitchen/vscode-mcp-tool-explorer/commit/b75a211
