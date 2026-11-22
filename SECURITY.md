# Security policy

MCP Tool Explorer is a local VS Code extension. It reads MCP config files you already have, lists tools, and calls a tool only when you choose Try.

## Supported versions

Security fixes go into the latest release on `main`.

| Version | Supported |
| --- | --- |
| 0.1.17 | Yes |
| Older builds | No |

## Reporting a vulnerability

Email [garrardkitchen@gmail.com](mailto:garrardkitchen@gmail.com).

Do not open a public GitHub issue for a vulnerability. Do not include a client secret, access token, authorization header, private key, or the contents of an MCP config file.

Include:

- The extension version and the VS Code version.
- What you expected and what happened.
- Whether the issue needs a crafted config, a crafted tool schema, or a crafted tool result.
- The impact you can demonstrate.

A report is acknowledged as soon as it is read. There is no bug bounty.

If GitHub private vulnerability reporting is enabled on this repository, you can use that instead of email.

## How sensitive data is handled

- A client secret typed with **Set Client Secret**, or with the key icon, is stored in VS Code secret storage for this extension. A secret written in an MCP config file is used from that file and is not copied into the tool view.
- Token errors are shown with the client secret removed.
- Saved try values and the try dialog size are stored in VS Code extension state on this machine. That storage is not secret storage. A saved try can contain whatever you typed into the dialog.
- Run sends the dialog values to the MCP server you configured. The extension does not send them anywhere else.
- `${input:...}` and `${command:...}` are not executed. Browser OAuth sign-in is not started.
- An SVG tool icon that contains a script, an embedded document, or an external image is not shown.

Problems in an MCP server, in VS Code, or in the MCP SDK should be reported to those projects.
