import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type { ClientCredentials, ResolvedServer } from "../types.js";
import { redactSecret, resourceParameterRejected } from "./credentials.js";

/**
 * Asks the authorization server for an access token.
 * The MCP host is not used as a token endpoint when it publishes no metadata.
 */
export async function accessTokenFor(server: ResolvedServer): Promise<string> {
  const credentials = server.clientCredentials;
  const clientSecret = credentials?.clientSecret;
  if (!credentials || !clientSecret) {
    throw new Error("A client secret is required.");
  }
  const tokenUrl = await resolveTokenUrl(server);
  return requestToken(tokenUrl, { ...credentials, clientSecret }, server.url);
}

async function resolveTokenUrl(server: ResolvedServer): Promise<string> {
  const configured = server.clientCredentials?.tokenUrl;
  if (configured) {
    return configured;
  }
  const discovered = server.url ? await tokenUrlFromResource(server.url) : undefined;
  if (discovered) {
    return discovered;
  }
  const issuer = server.clientCredentials?.expectedIssuer;
  if (issuer) {
    const fromIssuer = await tokenUrlFromIssuer(issuer);
    if (fromIssuer) {
      return fromIssuer;
    }
    throw new Error(`No token endpoint was published for ${issuer}.`);
  }
  throw new Error(
    `${server.name} did not publish an OAuth token endpoint, so the client credentials grant has nowhere to send the secret. Set oauthExpectedIssuer to the authorization server. For Microsoft Entra ID use https://login.microsoftonline.com/{tenant-id}/v2.0. You can set oauthTokenUrl to the token endpoint instead.`,
  );
}

async function tokenUrlFromResource(serverUrl: string): Promise<string | undefined> {
  try {
    const metadata = await discoverOAuthProtectedResourceMetadata(serverUrl);
    const authorizationServer = metadata.authorization_servers?.[0];
    if (!authorizationServer) {
      return undefined;
    }
    const authorization = await discoverAuthorizationServerMetadata(authorizationServer);
    return authorization?.token_endpoint;
  } catch {
    return undefined;
  }
}

async function tokenUrlFromIssuer(issuer: string): Promise<string | undefined> {
  try {
    const metadata = await discoverAuthorizationServerMetadata(issuer);
    return metadata?.token_endpoint;
  } catch {
    return undefined;
  }
}

async function requestToken(
  tokenUrl: string,
  credentials: ClientCredentials & { clientSecret: string },
  resourceUrl: string | undefined,
  omitResource = false,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });
  if (credentials.scope) {
    body.set("scope", credentials.scope);
  }
  if (!omitResource && resourceUrl) {
    const resource = new URL(resourceUrl);
    resource.hash = "";
    body.set("resource", resource.href);
  }
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    const message = redactSecret(tokenErrorMessage(response.status, text), credentials.clientSecret);
    if (!omitResource && credentials.scope && resourceParameterRejected(new Error(message))) {
      return requestToken(tokenUrl, credentials, resourceUrl, true);
    }
    throw new Error(message);
  }
  let accessToken: string | undefined;
  try {
    const parsed = JSON.parse(text) as { access_token?: unknown };
    accessToken = typeof parsed.access_token === "string" ? parsed.access_token : undefined;
  } catch {
    accessToken = undefined;
  }
  if (!accessToken) {
    throw new Error("The token endpoint did not return an access token.");
  }
  return accessToken;
}

function tokenErrorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown; error_description?: unknown; message?: unknown };
    const detail = [parsed.error_description, parsed.message, parsed.error].find((item) => typeof item === "string");
    if (typeof detail === "string" && detail.length > 0) {
      return `Token request failed: ${detail}`;
    }
  } catch {
    // The body is not JSON.
  }
  const trimmed = body.trim().slice(0, 300);
  return trimmed.length > 0 ? `Token request failed: HTTP ${status}: ${trimmed}` : `Token request failed: HTTP ${status}`;
}
