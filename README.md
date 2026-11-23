# MCP Tool Xplorer

![MCP Tool Xplorer](media/logo.png)

MCP Tool Xplorer lists the tools exposed by the MCP servers already configured for VS Code. The activity bar opens a page of servers and tools. Each tool shows its icon beside its name. Click a tool to open its parameters, their datatypes, and the response schema in an editor tab. Another click replaces that tab. Double-click a tool to open a tab that stays open. Try a tool to fill in its parameters in a dialog and see a colour-coded response.

## What you can do

- See every server from your VS Code and Copilot MCP config files on the Xplorer page in the activity bar. Servers sit on the left. Tools for the selected server sit on the right. Drag the line between them to resize the server list. That width is kept on this machine.
- Select a server to connect and list its tools in alphabetical order. A tool with a title is ordered by that title, and letter case is ignored. **A–Z** at the top of the tool list reverses that order. Favourites stay above the other tools. The connection closes after the list is read. A server that cannot be started shows the reason and is not connected.
- Search tools across the servers you are looking at. A match shows the tool, the server, and its environment. Favourites that match are listed first. **All**, **DEV**, **TEST**, **PROD**, and any name you add narrow the server list. **Names** adds an environment, renames one, or removes an environment you added. **DEV**, **TEST**, and **PROD** stay on the list. Their names can be changed. Removing an added name tags those servers from the server name again.
- Favourite a tool with the hexagon beside its name, on the page or next to **Try** in the tool tab. Favourites stay above the other tools. Press the filled hexagon to remove one. Favourites are stored on this machine and are not secrets.
- See **Used** beside a tool that has been run from Try. The mark stays after a saved try is removed. A tool that has not been run has no mark. **Used only**, at the top of the tool list, hides the others.
- Tag a server **DEV**, **TEST**, **PROD**, or a name you added. **DEV**, **TEST**, and **PROD** are read from the server name when the name contains that word, such as `entra-dev`. `development` stays untagged. Press the tag, or **Tag**, and choose a name, or **Use the server name**. The choice is stored on this machine.
- Read the tool icon next to the tool name. A tool without a usable icon leaves that space empty.
- Click a tool once to open its icon, description, parameters, and response schema in an editor tab. Clicking a different tool replaces that tab. Double-click a tool to open a tab that stays open when you click other tools.
- Try a tool. A dialog lists every parameter. Run calls the tool and shows the response in the detail view. Cancel leaves the tool uncalled. A server tagged **PROD** asks you to confirm before the dialog opens. The question uses the name shown on that tag. Drag the lower-right corner to resize the dialog. That size is used the next time it opens. A run saves those parameter values for that tool. Choose a previous try to fill the dialog again, clear the fields to start over, or remove a saved try after confirming.
- Read a JSON response with colour, and search it. Keys, strings, numbers, booleans, and null use different colours. Find shows how many matches there are, highlights the current one, and lists the JSON path, such as `$.mail`. Text that is not JSON stays plain.
- Press **Markdown** at the top of the tool list. A new editor tab opens with the tools on that list, each parameter, and each response schema. The tab starts with a table: the tool name links to that tool, and the description is the second column. The tab does not call the tools. A search writes the tools that match. Otherwise it writes the selected server.
- Refresh the list after you change a config file. The view also reloads when those files change.
- Connect an HTTP server that uses a machine-to-machine client credentials grant. Press the key beside that server. VS Code asks for the client secret and stores it in secret storage. It is not written to a config file, and it is not shown again. A browser sign-in is not started.

A parameter row shows the name, datatype, whether it is required, and its description. Nested object fields use dotted names such as `address.city`. Array items use names such as `tags[].id`. Required means the field is listed in its parent object's `required` array.

When a tool declares `outputSchema`, the response section shows that schema. The schema describes the structured result. When a tool does not declare one, the response section says so. The parameter schema and the response schema are also available as JSON.

If a config file limits tools with a `tools` list, every tool the server advertises is still shown. A tool left out of that list is marked in its detail view.

## Where servers are read from

| Config file | Format | Top-level key |
| --- | --- | --- |
| `<workspace>/.vscode/mcp.json` | VS Code editor config | `servers` |
| `<workspace>/.mcp.json` | Portable Copilot config | `mcpServers` |
| Active profile `mcp.json` | VS Code editor config | `servers` |
| `$COPILOT_HOME/mcp-config.json`, or `~/.copilot/mcp-config.json` when `COPILOT_HOME` is unset | Portable Copilot config | `mcpServers` |

In a multi-root workspace, each folder contributes its own `.vscode/mcp.json` and `.mcp.json`.

The profile file is the `mcp.json` next to the active profile's `globalStorage` directory. On a default local install that is often:

- macOS: `~/Library/Application Support/Code/User/mcp.json`
- Linux: `~/.config/Code/User/mcp.json`
- Windows: `%APPDATA%\Code\User\mcp.json`

Insiders, a named profile, and a remote window use that environment's own profile directory. The extension reads the profile for the window it is running in.

Comments and trailing commas in these files are accepted. A file that uses the other top-level key is reported in the view.

These are the server fields that are used:

| Field | Behavior |
| --- | --- |
| `type` | `stdio`, `http`, or `sse`. When `type` is omitted, a `url` means HTTP and a `command` means stdio. |
| `command`, `args` | Stdio executable and arguments. The command is spawned directly, not through a shell. |
| `cwd` | Stdio working directory. When omitted, this is the workspace folder, or your home directory when no folder is open. |
| `env` | Stdio environment variables. Values may be strings or numbers. `null` removes a variable loaded from `envFile`. |
| `envFile` | Stdio dotenv file. Values there are loaded first, then `env` overrides them. A relative path is resolved from the workspace folder, or from your home directory when no folder is open. |
| `url`, `headers` | HTTP or SSE endpoint and request headers. An `Authorization` header is sent as written. |
| `oauthGrantType` | `client_credentials` starts a machine-to-machine grant. `authorization_code`, or an OAuth client with no grant, is shown and is not started. |
| `oauthClientId` | Client id for that grant. The same value may be nested as `oauth.clientId`. |
| `oauthScopes` | Scopes for the token request, as a string or an array of strings. They are sent space-separated. For Microsoft Entra ID app-only access, use one scope that ends in `/.default`. Role names are application permissions, not the scope string. |
| `oauthClientSecret` | Client secret. A `${env:NAME}` reference is substituted. When this is omitted, the secret is taken from VS Code secret storage. |
| `oauthExpectedIssuer` | Authorization server issuer. Required when the MCP host does not publish OAuth metadata. For Microsoft Entra ID this is `https://login.microsoftonline.com/{tenant-id}/v2.0`. |
| `oauthTokenUrl` | Token endpoint. When set, metadata discovery is skipped. |
| `oauthPublicClient` | Read as documentation of a confidential client (`false`). The grant still runs when a client secret is available. |
| `tools` | Noted in the detail view. It does not hide tools. `["*"]` and an omitted list mean the agent may use every tool. |

Those OAuth fields may also be nested under `oauth` as `grantType`, `clientId`, `clientSecret`, `scopes`, `expectedIssuer`, and `tokenUrl`.

Variable substitution:

- `${workspaceFolder}`, `${workspaceFolderBasename}`, `${userHome}`, and `${pathSeparator}`
- `${env:NAME}`
- `${NAME}` and `${NAME:-default}`

In user and Copilot config, `${workspaceFolder}` is the first workspace folder. A server that still contains `${input:...}` or `${command:...}` is shown and is not started. A browser OAuth sign-in is not started. A client credentials grant is started for an HTTP server when `oauthGrantType` is `client_credentials`. An `Authorization` header, when present, is sent instead of starting a grant.

HTTP servers try Streamable HTTP first and then legacy SSE. An entry with `"type": "sse"` uses SSE only. Unix socket and named pipe URLs are reported and are not opened.

`sandboxEnabled` is not applied. The server runs as a normal process, and its tooltip and detail view say so. `dev` watch and debug settings are ignored.

## Requirements

- Node.js 20 or newer
- npm
- VS Code 1.95 or newer, or Kiro
- The `code` command on your PATH for VS Code, or the `kiro` command on your PATH for Kiro

In VS Code, run **Shell Command: Install 'code' command in PATH** if the shell cannot find `code`. Use `code-insiders` instead of `code` when you are installing into Insiders.

In Kiro, run **Shell Command: Install 'kiro' command in PATH** if the shell cannot find `kiro`.

## Build

From this directory:

```bash
npm install
npm run compile
```

`npm run compile` bundles the extension to `dist/extension.js`. Run the tests with:

```bash
npm test
```

## Install locally

Package a VSIX, then install that file into VS Code, into Kiro, or into both. Each editor keeps its own copy of the extension.

```bash
npm run package
```

Install into VS Code:

```bash
code --install-extension mcp-tool-xplorer-0.1.21.vsix --force
```

Install into Kiro:

```bash
kiro --install-extension mcp-tool-xplorer-0.1.21.vsix --force
```

Reload the window in the editor you installed into. The **MCP Tool Xplorer** icon is on the activity bar. If you do not see it, right-click the activity bar and enable **MCP Tool Xplorer**.

You can also install the VSIX from the Extensions view in either editor. Open the view menu and choose **Install from VSIX...**.

The installed extension id is `Garrard.mcp-tool-xplorer`. The package name is `mcp-tool-xplorer`. The publisher id is `Garrard`.

## Uninstall

Uninstall from VS Code:

```bash
code --uninstall-extension Garrard.mcp-tool-xplorer
```

Uninstall from Kiro:

```bash
kiro --uninstall-extension Garrard.mcp-tool-xplorer
```

Reload the window in the editor you uninstalled from. Uninstalling from one editor leaves the extension in the other. Neither command deletes the VSIX in this directory.

For Insiders, use `code-insiders` in the VS Code install and uninstall commands.

## Use the view

1. Configure servers in one of the files above, or use **MCP: Add Server** in VS Code.
2. Open **MCP Tool Xplorer** on the activity bar. Servers are on the left. Tools for the selected server are on the right. Drag the line between them to resize the server list. Arrow keys move it while that line is focused. The width is kept on this machine.
3. Select a server. The extension starts that server, requests `tools/list`, and then closes the connection. Use the search box to look across servers. **All**, **DEV**, **TEST**, **PROD**, or a name you added narrows the list. **Names** adds, renames, or removes an environment.
4. Press the hexagon to favourite a tool. Favourites stay above a line, above the other tools. A tool you have run shows **Used** in amber. **Used only** shows just those tools. **A–Z** reverses the order. **Markdown** opens a tab with the tools, their parameters, and their response schemas. The tab starts with a table of links to those tools.
5. Press the key on a server that uses a client credentials grant. Enter the client secret when asked. Press the environment tag to choose a name, or **Use the server name**.
6. Click a tool once. A tab opens in the editor and shows that tool. Click a different tool and the same tab shows the new tool.
7. Double-click a tool to open a tab that stays open when you click other tools.
8. Choose **Try** on the tool row, or the **Try** button in the tool tab. A server tagged **PROD** asks you to confirm first. A dialog then opens with the parameters. Drag the lower-right corner to resize it. Choose **Run** to call the tool, or **Cancel** to close it. **Previous tries** fills the fields from an earlier run. **Clear fields** empties the dialog without deleting saved tries. **Remove** asks you to confirm before a saved try is deleted.
9. When the response is JSON, use **Find** to move through matches. The count shows which match is current, and the path names the field.

Use the refresh action on the view title, or run **MCP Tool Xplorer: Refresh Servers** from the Command Palette. A server that fails to connect shows the error under its name, including a short stderr tail for a stdio process. Connecting and listing each time out after 20 seconds.

## Try a tool

Try is the **Try** button on each tool row, and it is also a button in the tool's detail view. It opens the tool's tab and a dialog with every parameter. When the server is tagged **PROD**, VS Code asks you to confirm before that dialog opens. Run opens a fresh connection, sends `tools/call`, shows the response in that tab, and closes the connection. Listing tools does not call them. A JSON response can be searched. Find matches keys, strings, numbers, booleans, and null, and shows the path of the current match. Text that is not JSON is shown as plain text.

The dialog follows the tool's input schema:

- Run sends the values in the dialog. Cancel, Escape, or a click outside the dialog leaves the tool uncalled.
- A required parameter must have a value. Leave an optional field empty to skip it. For an optional boolean or a short list, choose Leave unset.
- Strings are sent as you type them. Numbers and integers are parsed. Booleans are true or false. A list of up to five values uses a row of choices, and a longer list of up to 50 uses a dropdown. An enum with more than 50 values is entered as JSON.
- Objects and arrays are entered as JSON.
- A default for a string, number, integer, or JSON value is filled in. Clear an optional default to leave that parameter unset. A default for a boolean or a list is labeled and is not selected, so the parameter stays unset until you choose it.
- A parameter with a single fixed `const` value is not shown. It is sent automatically.
- For a nullable number, integer, object, or array, enter `null` to send JSON null.
- A field that cannot be read is marked in the dialog. The tool is not called until every field is valid.
- A successful run saves the parameter values for that tool on this machine. A run whose values match the newest saved try is not stored again. The dialog keeps up to 20 tries, newest first.
- **Previous tries** lists those saved runs. Choosing one fills the fields. The note under the list sits above the parameter fields. **Clear fields** restores the dialog to its unused state and leaves the saved tries in place.
- Drag the lower-right corner of the dialog to change its size. The dialog stays open while you resize it. The next try dialog opens at that size. The size is stored on this machine, with the saved tries, and it is the same for every tool.
- **Remove** asks "Remove this saved try?" Choose **Remove** to delete that entry, or **Keep** to leave it. The fields you are editing stay as they are.

The detail view then shows the arguments that were sent, text content, structured content, and any error. Image, audio, and binary resource bytes are described and are not inlined. A long response is cut after 200,000 characters. Connecting times out after 20 seconds. The call times out after 60 seconds. A server that the list cannot start, such as one waiting on `${input:...}` or a browser sign-in, cannot be tried.

## Run from source

1. Open this folder in VS Code.
2. Run `npm install`.
3. Press F5, or start the **Run Extension** launch configuration.

F5 compiles the extension and opens an Extension Development Host. The **MCP Tool Xplorer** view in that window is this extension.

## Machine-to-machine authentication

An HTTP or SSE server with `oauthGrantType` set to `client_credentials` connects without a browser. The extension requests a token with the client id, secret, and scopes, then sends that token as a bearer token. It discovers the token endpoint from the MCP server when that server publishes OAuth metadata. When the host does not, set `oauthExpectedIssuer` or `oauthTokenUrl`. A 404 from the API host's own `/token` path is not used. For Entra ID, set one scope such as `api://your-api-id/.default` and set the issuer to `https://login.microsoftonline.com/{tenant-id}/v2.0`.

```json
{
  "mcpServers": {
    "headless-api": {
      "type": "http",
      "url": "https://example.com/mcp",
      "oauthClientId": "YOUR-CLIENT-ID",
      "oauthPublicClient": false,
      "oauthGrantType": "client_credentials",
      "oauthScopes": ["api://YOUR-API-ID/.default"]
    }
  }
}
```

The client secret is not read from the Copilot keychain. Set it in one of these ways:

- Run **MCP Tool Xplorer: Set Client Secret**, or use the key icon on that server. The value is stored in VS Code secret storage. Expanding the server asks for it once when nothing is stored yet.
- Set `oauthClientSecret` in the MCP config. `${env:NAME}` is substituted. The value stays in memory for the connection and is not shown in the tool view.

A browser OAuth client, including one with only `oauth.clientId` or `oauthGrantType` of `authorization_code`, is shown and is not started. If the server's token endpoint rejects the resource parameter, the request is sent again with the configured scope and without that parameter.

## Limits

- Tools are called only when you choose Try.
- `${input:...}` and `${command:...}` are not prompted or executed. Those placeholders are for starting a server, not for tool parameters.
- Browser OAuth sign-in is not started. A client credentials grant is. A header you already configured is sent as written.
- Editor sandbox rules and development-mode watch or debug settings are not applied.
- Unix socket and named pipe endpoints are not opened.
- Icons are taken from the tool's `icons` list. PNG, JPEG, GIF, WebP, and SVG are accepted. An SVG that contains a script, an embedded document, or an external image is skipped, as is a file larger than 1 MB. The detail view shows the same icon beside the tool title.
- Claude Desktop, Cursor, and other editors' MCP configs are not read unless they are also one of the files in the table above.

## Project

- [AGENTS.md](AGENTS.md) for the layout, commit rules, and how a tool call is made
- [Publish to the marketplace](PUBLISH-TO-MARKETPLACE.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [License](LICENSE)
