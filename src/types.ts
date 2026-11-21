/**
 * Machine-to-machine OAuth client.
 * `clientSecret` is a credential. Do not render, log, or copy it into a webview.
 */
export interface ClientCredentials {
  clientId: string;
  clientSecret?: string;
  /** Space-separated scope string sent to the token endpoint. */
  scope?: string;
  /** Authorization server issuer. Used when the MCP host does not publish OAuth metadata. */
  expectedIssuer?: string;
  /** Token endpoint. When set, discovery is skipped. */
  tokenUrl?: string;
}

/** A configured MCP server after variable substitution. */
export interface ResolvedServer {
  id: string;
  name: string;
  originLabel: string;
  originFile: string;
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  /**
   * Tool names the config exposes to an agent.
   * Missing, or a list that contains `*`, means every tool the server advertises.
   */
  toolAllowlist?: string[];
  /** When set, the server is shown and is not connected. */
  skipReason?: string;
  /** Shown with the server. The server is still connected. */
  notice?: string;
  /** Set for an HTTP client credentials grant. Absent when a browser sign-in would be required. */
  clientCredentials?: ClientCredentials;
}

export interface ConfigProblem {
  file: string;
  message: string;
}

export interface ToolIcon {
  src: string;
  mimeType?: string;
  sizes?: string[];
  theme?: "light" | "dark";
}

export interface ToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  icons?: ToolIcon[];
}

export interface CachedTool extends ToolDefinition {
  /** Local image file chosen for the active color theme. */
  iconPath?: string;
}

export interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  depth: number;
}
