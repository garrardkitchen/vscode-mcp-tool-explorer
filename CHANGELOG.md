# Changelog

All notable changes to MCP Tool Xplorer are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.21] - 2026-11-23

### Added

- **Names** adds an environment and removes one you added. **DEV**, **TEST**, and **PROD** stay. Any of those names can be changed, and the server list updates.

## [0.1.20] - 2026-11-23

### Added

- Added a table at the top of the Markdown tab. The tool name links to that tool's section, and the description is the second column.

## [0.1.19] - 2026-11-23

### Added

- Added **Used only** at the top of the tool list.
- Added **A–Z** to reverse the tool order. Favourites stay above the other tools.
- Added **Markdown**, which opens an editor tab with the tools, their parameters, and their response schemas. The tab does not call the tools.

### Changed

- Made the **Used** mark amber so it stands out on the tool row.

## [0.1.18] - 2026-11-23

### Added

- Opened the activity bar on an Xplorer page of servers and tools.
- Made the server list resizable. The width is kept on this machine.
- Marked a tool **Used** after it has been run from Try. The mark stays if that saved try is removed.
- Added favourites. The hexagon keeps a tool above the others. Favourites are stored on this machine.
- Added search across tools, with **All**, **DEV**, **TEST**, and **PROD** filters. A match shows the tool, the server, and its environment.
- Tagged a server **DEV**, **TEST**, or **PROD** from its name, or from a choice stored on this machine.
- Asked for confirmation before Try on a server tagged **PROD**.
- Coloured a JSON response and added Find, with the current match and its path.
- Documented how to publish the same package to the Visual Studio Marketplace and to Open VSX.
- Documented local install and uninstall for both VS Code and Kiro.
- Added the changelog, security policy, contributing guide, code of conduct, and GitHub issue and pull request templates.
- Added AGENTS.md with the repository layout, commit rules, dependencies, and the tool-call flow.

### Changed

- The activity bar lists servers on the left of the Xplorer page and tools on the right. The client secret is still entered from the key, and previous tries stay in the try dialog.
- Renamed the extension to MCP Tool Xplorer. The package name is `mcp-tool-xplorer` and the extension id is `Garrard.mcp-tool-xplorer`.

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
[0.1.21]: https://github.com/garrardkitchen/vscode-mcp-tool-explorer/compare/5cdef75...HEAD
[0.1.20]: https://github.com/garrardkitchen/vscode-mcp-tool-explorer/compare/5cdef75...HEAD
[0.1.19]: https://github.com/garrardkitchen/vscode-mcp-tool-explorer/compare/5cdef75...HEAD
[0.1.18]: https://github.com/garrardkitchen/vscode-mcp-tool-explorer/compare/5cdef75...HEAD
[0.1.17]: https://github.com/garrardkitchen/vscode-mcp-tool-explorer/compare/b75a211...5cdef75
[0.1.14]: https://github.com/garrardkitchen/vscode-mcp-tool-explorer/commit/b75a211
