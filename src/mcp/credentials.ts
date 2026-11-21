const SECRET_KEY_PREFIX = "mcpToolExplorer.clientSecret";

/** VS Code secret-storage key for one server's client secret. */
export function clientSecretStorageKey(serverId: string, clientId: string): string {
  return `${SECRET_KEY_PREFIX}\0${serverId}\0${clientId}`;
}

export function missingClientSecretMessage(serverName: string): string {
  return `${serverName} uses a client credentials grant, and no client secret is stored. Run MCP Tool Explorer: Set Client Secret. The secret is kept in VS Code secret storage. You can also set oauthClientSecret, including \${env:NAME}.`;
}

/** Removes a client secret from an error message before it is shown. */
export function redactSecret(message: string, secret: string | undefined): string {
  if (!secret) {
    return message;
  }
  return message.split(secret).join("•••");
}

/** True when a token endpoint rejected the RFC 8707 resource parameter. */
export function resourceParameterRejected(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /resource/i.test(message) && /not supported|unsupported|invalid_request|AADSTS/i.test(message);
}
