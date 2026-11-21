import path from "node:path";

export interface WorkspaceFolder {
  name: string;
  path: string;
}

export interface Origin {
  id: string;
  label: string;
  file: string;
  format: "vscode" | "portable";
  workspaceFolder?: string;
  workspaceName?: string;
}

export interface OriginInput {
  workspaceFolders: readonly WorkspaceFolder[];
  /** Directory that contains the active profile's `mcp.json`. */
  profileDirectory: string;
  homeDirectory: string;
  /** `COPILOT_HOME` when it is set. Otherwise `~/.copilot` is used. */
  copilotHome?: string;
}

/** Directories VS Code uses for the active profile sit two levels above global storage. */
export function profileDirectoryFromGlobalStorage(globalStoragePath: string): string {
  return path.dirname(path.dirname(globalStoragePath));
}

export function copilotConfigFile(homeDirectory: string, copilotHome: string | undefined): string {
  const root = copilotHome && copilotHome.trim().length > 0
    ? copilotHome
    : path.join(homeDirectory, ".copilot");
  return path.join(root, "mcp-config.json");
}

/**
 * Every MCP config file this extension reads.
 * Editor files use a top-level `servers` object.
 * Portable Copilot files use a top-level `mcpServers` object.
 */
export function candidateOrigins(input: OriginInput): Origin[] {
  const origins: Origin[] = [];

  for (const folder of input.workspaceFolders) {
    origins.push({
      id: `workspace-vscode:${folder.path}`,
      label: `Workspace · ${folder.name} · .vscode/mcp.json`,
      file: path.join(folder.path, ".vscode", "mcp.json"),
      format: "vscode",
      workspaceFolder: folder.path,
      workspaceName: folder.name,
    });
    origins.push({
      id: `workspace-portable:${folder.path}`,
      label: `Workspace · ${folder.name} · .mcp.json`,
      file: path.join(folder.path, ".mcp.json"),
      format: "portable",
      workspaceFolder: folder.path,
      workspaceName: folder.name,
    });
  }

  origins.push({
    id: "user-profile",
    label: "User profile",
    file: path.join(input.profileDirectory, "mcp.json"),
    format: "vscode",
    workspaceFolder: input.workspaceFolders[0]?.path,
    workspaceName: input.workspaceFolders[0]?.name,
  });
  origins.push({
    id: "copilot-user",
    label: "Copilot user",
    file: copilotConfigFile(input.homeDirectory, input.copilotHome),
    format: "portable",
    workspaceFolder: input.workspaceFolders[0]?.path,
    workspaceName: input.workspaceFolders[0]?.name,
  });

  return origins;
}
