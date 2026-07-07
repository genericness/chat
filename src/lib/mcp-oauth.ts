// OAuth 2.1 for MCP servers (spec 2025-06-18 authorization flow) — the
// interactive, browser-only half: protected-resource metadata → auth-server
// metadata → dynamic client registration → PKCE authorization-code flow in a
// popup. Token storage/refresh live in @chat/core (mcp-auth.ts).
import {
  freshMcpConfig,
  tokenRequest,
  updateMcpServer,
  type McpServerConfig,
} from "@chat/core"

export { disconnectMcpServer, updateMcpServer } from "@chat/core"

interface AsMetadata {
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
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
  return `${location.origin}/oauth/callback`
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
  const existing = freshMcpConfig(cfg.id)?.oauth
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
  const popup = window.open("about:blank", "mcp-oauth", "width=600,height=750,popup")
  if (!popup) throw new Error("Popup blocked — allow popups for this site to connect.")
  try {
    const cfg = freshMcpConfig(cfgIn.id) ?? cfgIn
    const { as, scope, resource } = await discover(cfg, wwwAuthenticate)
    const client = await ensureClient(cfg, as)
    const { verifier, challenge } = await pkce()
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)))

    const url = new URL(as.authorization_endpoint)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("client_id", client.clientId)
    url.searchParams.set("redirect_uri", callbackUrl())
    url.searchParams.set("code_challenge", challenge)
    url.searchParams.set("code_challenge_method", "S256")
    url.searchParams.set("state", state)
    url.searchParams.set("resource", resource)
    if (scope) url.searchParams.set("scope", scope)
    popup.location.href = url.toString()

    const code = await waitForCallback(state, popup)
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
    if (!popup.closed) popup.close()
  }
}
