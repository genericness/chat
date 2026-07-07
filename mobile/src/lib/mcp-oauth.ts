// Interactive MCP OAuth for mobile: same discovery + DCR + PKCE flow as the
// web popup version (src/lib/mcp-oauth.ts), but the authorization hop runs in
// a system browser via openAuthSessionAsync and redirects back to the app's
// custom scheme. Token storage/refresh live in @chat/core (mcp-auth.ts).
import {
  freshMcpConfig,
  tokenRequest,
  updateMcpServer,
  type McpServerConfig,
} from "@chat/core"
import * as Crypto from "expo-crypto"
import * as WebBrowser from "expo-web-browser"

const REDIRECT_URI = "chat4x://mcp-oauth"

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
  const verifier = b64url(Crypto.getRandomBytes(32))
  const digestB64 = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  )
  const challenge = digestB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  return { verifier, challenge }
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
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  })
  if (!res.ok) throw new Error(`"${cfg.name}": client registration failed (${res.status})`)
  const json = (await res.json()) as { client_id: string; client_secret?: string }
  return { clientId: json.client_id, clientSecret: json.client_secret }
}

/** Full interactive flow in a system browser session. */
export async function authorizeMcpServer(
  cfgIn: McpServerConfig,
  wwwAuthenticate?: string | null
): Promise<void> {
  const cfg = freshMcpConfig(cfgIn.id) ?? cfgIn
  const { as, scope, resource } = await discover(cfg, wwwAuthenticate)
  const client = await ensureClient(cfg, as)
  const { verifier, challenge } = await pkce()
  const state = b64url(Crypto.getRandomBytes(16))

  const url = new URL(as.authorization_endpoint)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", client.clientId)
  url.searchParams.set("redirect_uri", REDIRECT_URI)
  url.searchParams.set("code_challenge", challenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("state", state)
  url.searchParams.set("resource", resource)
  if (scope) url.searchParams.set("scope", scope)

  const result = await WebBrowser.openAuthSessionAsync(url.toString(), REDIRECT_URI)
  if (result.type !== "success") throw new Error("Authorization was cancelled.")
  const returnedState = /[?&]state=([^&#]+)/.exec(result.url)?.[1]
  const code = /[?&]code=([^&#]+)/.exec(result.url)?.[1]
  if (decodeURIComponent(returnedState ?? "") !== state) throw new Error("State mismatch.")
  if (!code) {
    const err = /[?&]error=([^&#]+)/.exec(result.url)?.[1]
    throw new Error(err ? decodeURIComponent(err) : "Authorization failed.")
  }

  const tokens = await tokenRequest(
    as.token_endpoint,
    {
      grant_type: "authorization_code",
      code: decodeURIComponent(code),
      redirect_uri: REDIRECT_URI,
      client_id: client.clientId,
      code_verifier: verifier,
      resource,
    },
    client.clientSecret
  )
  updateMcpServer(cfg.id, {
    oauth: { ...client, tokenEndpoint: as.token_endpoint, resource, tokens },
  })
}
