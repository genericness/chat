// The non-interactive half of MCP OAuth: token storage in prefs, silent
// refresh, disconnect. The interactive authorization flow is platform-owned
// (web: popup; mobile: openAuthSessionAsync) and calls into these helpers.
import { coreFetch } from "./config"
import type { McpServerConfig } from "./mcp"
import { getPrefs, setPrefs } from "./profiles"

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
}

export interface McpOAuth {
  clientId?: string
  clientSecret?: string
  tokenEndpoint?: string
  resource?: string
  tokens?: OAuthTokens
}

export function updateMcpServer(id: string, patch: Partial<McpServerConfig>) {
  const servers = getPrefs().mcpServers ?? []
  setPrefs({ mcpServers: servers.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
}

export function freshMcpConfig(id: string): McpServerConfig | undefined {
  return getPrefs().mcpServers?.find((s) => s.id === id)
}

export async function tokenRequest(
  tokenEndpoint: string,
  params: Record<string, string>,
  clientSecret?: string
): Promise<OAuthTokens> {
  const body = new URLSearchParams(params)
  if (clientSecret) body.set("client_secret", clientSecret)
  const res = await coreFetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  })
  if (!res.ok) throw new Error(`token request failed (${res.status})`)
  const json = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!json.access_token) throw new Error("token response missing access_token")
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? Date.now() + (json.expires_in - 60) * 1000 : undefined,
  }
}

/** Current access token, silently refreshed if expired. Null → interactive auth needed. */
export async function getValidToken(serverId: string): Promise<string | null> {
  const cfg = freshMcpConfig(serverId)
  const oauth = cfg?.oauth
  if (!cfg || !oauth?.tokens) return null
  const { tokens } = oauth
  if (!tokens.expiresAt || tokens.expiresAt > Date.now()) return tokens.accessToken
  if (!tokens.refreshToken || !oauth.tokenEndpoint || !oauth.clientId) return null
  try {
    const next = await tokenRequest(
      oauth.tokenEndpoint,
      {
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
        client_id: oauth.clientId,
        ...(oauth.resource && { resource: oauth.resource }),
      },
      oauth.clientSecret
    )
    updateMcpServer(cfg.id, {
      oauth: { ...oauth, tokens: { refreshToken: tokens.refreshToken, ...next } },
    })
    return next.accessToken
  } catch {
    return null
  }
}

export function disconnectMcpServer(serverId: string) {
  const cfg = freshMcpConfig(serverId)
  if (!cfg) return
  updateMcpServer(serverId, { oauth: { ...cfg.oauth, tokens: undefined } })
}
