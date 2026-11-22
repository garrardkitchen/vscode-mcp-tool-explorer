# Publish to the marketplace

Kiro does not have its own marketplace. The Visual Studio Marketplace is what VS Code searches. Kiro searches Open VSX. Publish the same VSIX to both, with the publisher id `Garrard` so the extension id stays `Garrard.mcp-tool-xplorer`.

Package it once from this repo:

```bash
npm run package
```

That writes `mcp-tool-xplorer-0.1.17.vsix`. A version that is already published cannot be uploaded again. Bump `package.json` before the next release.

## Visual Studio Marketplace

1. Open [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) and create a publisher whose id is exactly `Garrard`. That must match the `publisher` field already in `package.json`.
2. Create an Azure DevOps personal access token with the **Marketplace (Manage)** scope. Create it for **All accessible organizations**. Azure DevOps retires these global tokens on **1 December 2026**. For a one-off publish from your machine, the token still works before that date. Do not commit it or paste it into the repo.
3. From this directory, sign in once:

```bash
npx @vscode/vsce login Garrard
```

4. Publish the VSIX you already built. `vsce publish` without `--packagePath` does not run this repo's package script, so publish the file `npm run package` wrote:

```bash
npx @vscode/vsce publish --packagePath mcp-tool-xplorer-0.1.17.vsix
```

The public page will be [marketplace.visualstudio.com/items?itemName=Garrard.mcp-tool-xplorer](https://marketplace.visualstudio.com/items?itemName=Garrard.mcp-tool-xplorer). In VS Code, search for **MCP Tool Xplorer**, or run:

```bash
code --install-extension Garrard.mcp-tool-xplorer
```

For later releases from GitHub Actions, add a Trusted Publishing policy on the Marketplace publisher and run `npx @vscode/vsce publish --oidc`. That path needs `id-token: write` and does not need a long-lived token.

## Kiro, through Open VSX

1. Sign in at [open-vsx.org](https://open-vsx.org) with the GitHub account that owns the repo, and sign the Eclipse Publisher Agreement.
2. Create an access token at [open-vsx.org/user-settings/tokens](https://open-vsx.org/user-settings/tokens). Keep it out of the repo. Set it in the shell as `OVSX_PAT`. Do not put the token after `-p` in a file you commit.
3. Create the namespace `Garrard`:

```bash
npx ovsx create-namespace Garrard -p "$OVSX_PAT"
```

If this extension is already on the Visual Studio Marketplace, Open VSX also requires you to be the **owner** of that namespace, not only a contributor. Claim it from the namespace page and link it to the Marketplace publisher `Garrard`.

4. Publish the same VSIX:

```bash
npx ovsx publish mcp-tool-xplorer-0.1.17.vsix -p "$OVSX_PAT"
```

The public page will be [open-vsx.org/extension/Garrard/mcp-tool-xplorer](https://open-vsx.org/extension/Garrard/mcp-tool-xplorer). In Kiro, open Extensions and search for **MCP Tool Xplorer**. Kiro reads Open VSX, so it will not see a package that exists only on the Visual Studio Marketplace.

The first Open VSX publish uses the access token. Later, after the namespace is verified, an active version exists, and a trusted-publishing policy is registered, GitHub Actions can run `npx ovsx publish --trusted-publishing`.
