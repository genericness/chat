// OAuth 2.1 for MCP servers (spec 2025-06-18 authorization flow), browser-side:
// protected-resource metadata → auth-server metadata → dynamic client
// registration → PKCE authorization-code flow in a popup → token refresh.
// Tokens live in localStorage with the rest of the user's keys.
import { API_BASE, IS_NATIVE } from "@/lib/api-base"
import { getPrefs, setPrefs } from "@/lib/profiles"
import type { McpServerConfig } from "@/lib/mcp"

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

interface AsMetadata {
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
}

export function updateMcpServer(id: string, patch: Partial<McpServerConfig>) {
  const servers = getPrefs().mcpServers ?? []
  setPrefs({ mcpServers: servers.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
}

function freshConfig(id: string): McpServerConfig | undefined {
  return getPrefs().mcpServers?.find((s) => s.id === id)
}

function b64url(bytes: Uint8Array): string {
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return { verifier, challenge: b64url(new Uint8Array(digest)) }
}

function callbackUrl(): string {
  // Native: the WebView origin isn't a valid redirect URI, so the flow lands
  // on the website's callback page, which deep-links back into the app.
  return `${API_BASE || location.origin}/oauth/callback`
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return (await res.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

/** RFC 9728 + RFC 8414 discovery with the well-known fallbacks the MCP spec requires. */
async function discover(
  cfg: McpServerConfig,
  wwwAuthenticate?: string | null
): Promise<{ as: AsMetadata; scope?: string; resource: string }> {
  const serverUrl = new URL(cfg.url)
  const path = serverUrl.pathname.replace(/\/$/, "")
  let scope = wwwAuthenticate
    ? /(?:^|[\s,])scope="([^"]+)"/.exec(wwwAuthenticate)?.[1]
    : undefined
  const fromHeader = wwwAuthenticate
    ? /resource_metadata="([^"]+)"/.exec(wwwAuthenticate)?.[1]
    : undefined

  const prmCandidates = fromHeader
    ? [fromHeader]
    : [
        ...(path ? [`${serverUrl.origin}/.well-known/oauth-protected-resource${path}`] : []),
        `${serverUrl.origin}/.well-known/oauth-protected-resource`,
      ]

  let issuer: string | undefined
  for (const url of prmCandidates) {
    const prm = await fetchJson(url)
    const servers = prm?.authorization_servers as string[] | undefined
    if (servers?.length) {
      issuer = servers[0]
      const supported = prm?.scopes_supported as string[] | undefined
      if (!scope && supported?.length) scope = supported.join(" ")
      break
    }
  }
  // Legacy (2025-03-26) servers are their own authorization server.
  issuer ??= serverUrl.origin

  const iss = new URL(issuer)
  const issPath = iss.pathname.replace(/\/$/, "")
  const candidates = issPath
    ? [
        `${iss.origin}/.well-known/oauth-authorization-server${issPath}`,
        `${iss.origin}/.well-known/openid-configuration${issPath}`,
        `${iss.origin}${issPath}/.well-known/openid-configuration`,
      ]
    : [
        `${iss.origin}/.well-known/oauth-authorization-server`,
        `${iss.origin}/.well-known/openid-configuration`,
      ]
  for (const url of candidates) {
    const meta = (await fetchJson(url)) as unknown as AsMetadata | null
    if (meta?.authorization_endpoint && meta?.token_endpoint) {
      return { as: meta, scope, resource: cfg.url.replace(/\/$/, "") }
    }
  }
  throw new Error(`Could not discover OAuth metadata for "${cfg.name}".`)
}

/** RFC 7591 dynamic registration as a public client (PKCE, no secret auth). */
async function ensureClient(
  cfg: McpServerConfig,
  as: AsMetadata
): Promise<{ clientId: string; clientSecret?: string }> {
  const existing = freshConfig(cfg.id)?.oauth
  if (existing?.clientId) return { clientId: existing.clientId, clientSecret: existing.clientSecret }
  if (!as.registration_endpoint) {
    throw new Error(`"${cfg.name}" requires OAuth but doesn't offer automatic client registration.`)
  }
  const res = await fetch(as.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "chat",
      redirect_uris: [callbackUrl()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  })
  if (!res.ok) throw new Error(`"${cfg.name}": client registration failed (${res.status})`)
  const json = (await res.json()) as { client_id: string; client_secret?: string }
  return { clientId: json.client_id, clientSecret: json.client_secret }
}

async function tokenRequest(
  tokenEndpoint: string,
  params: Record<string, string>,
  clientSecret?: string
): Promise<OAuthTokens> {
  const body = new URLSearchParams(params)
  if (clientSecret) body.set("client_secret", clientSecret)
  const res = await fetch(tokenEndpoint, {
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

function waitForCallback(state: string, popup: Window): Promise<string> {
  return new Promise((resolve, reject) => {
    const bc = new BroadcastChannel("mcp-oauth")
    const closedPoll = setInterval(() => {
      if (popup.closed) {
        cleanup()
        reject(new Error("Authorization window was closed."))
      }
    }, 500)
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error("Authorization timed out."))
    }, 300_000)
    const cleanup = () => {
      bc.close()
      clearInterval(closedPoll)
      clearTimeout(timeout)
    }
    bc.onmessage = (e) => {
      const data = e.data as { state?: string; code?: string; error?: string }
      if (data?.state !== state) return
      cleanup()
      if (data.code) resolve(data.code)
      else reject(new Error(data.error ?? "Authorization failed."))
    }
  })
}

/** Full interactive flow. Must be called from a user gesture (opens a popup). */
export async function authorizeMcpServer(
  cfgIn: McpServerConfig,
  wwwAuthenticate?: string | null
): Promise<void> {
  // Open synchronously so popup blockers see the user gesture; navigate later.
  // Native has no popups: the flow runs in an in-app browser tab instead.
  const popup = IS_NATIVE
    ? null
    : window.open("about:blank", "mcp-oauth", "width=600,height=750,popup")
  if (!IS_NATIVE && !popup) {
    throw new Error("Popup blocked — allow popups for this site to connect.")
  }
  // The callback uses BroadcastChannel, so the authorization server never
  // needs an opener reference (which would let it navigate the chat tab).
  if (popup) popup.opener = null
  try {
    const cfg = freshConfig(cfgIn.id) ?? cfgIn
    const { as, scope, resource } = await discover(cfg, wwwAuthenticate)
    const client = await ensureClient(cfg, as)
    const { verifier, challenge } = await pkce()
    // ".n" marks native so the callback page relays via deep link ("." is not
    // in the base64url alphabet).
    const state = b64url(crypto.getRandomValues(new Uint8Array(16))) + (IS_NATIVE ? ".n" : "")

    const url = new URL(as.authorization_endpoint)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("client_id", client.clientId)
    url.searchParams.set("redirect_uri", callbackUrl())
    url.searchParams.set("code_challenge", challenge)
    url.searchParams.set("code_challenge_method", "S256")
    url.searchParams.set("state", state)
    url.searchParams.set("resource", resource)
    if (scope) url.searchParams.set("scope", scope)

    let code: string
    if (popup) {
      popup.location.href = url.toString()
      code = await waitForCallback(state, popup)
    } else {
      if (!import.meta.env.VITE_API_BASE) {
        throw new Error("Native OAuth callback handling is unavailable in this build.")
      }
      const [{ waitForMcpCallback }, { Browser }] = await Promise.all([
        import("@/lib/native"),
        import("@capacitor/browser"),
      ])
      await Browser.open({ url: url.toString() })
      const params = await waitForMcpCallback()
      if (params.get("state") !== state) throw new Error("Authorization failed (state mismatch).")
      const returned = params.get("code")
      if (!returned) {
        throw new Error(
          params.get("error_description") ?? params.get("error") ?? "Authorization failed."
        )
      }
      code = returned
    }
    const tokens = await tokenRequest(
      as.token_endpoint,
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: callbackUrl(),
        client_id: client.clientId,
        code_verifier: verifier,
        resource,
      },
      client.clientSecret
    )
    updateMcpServer(cfg.id, {
      oauth: { ...client, tokenEndpoint: as.token_endpoint, resource, tokens },
    })
  } finally {
    if (popup && !popup.closed) popup.close()
  }
}

/** Current access token, silently refreshed if expired. Null → interactive auth needed. */
export async function getValidToken(serverId: string): Promise<string | null> {
  const cfg = freshConfig(serverId)
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
  const cfg = freshConfig(serverId)
  if (!cfg) return
  updateMcpServer(serverId, { oauth: { ...cfg.oauth, tokens: undefined } })
}
