import { Hono } from "hono"
import type { AppEnv } from "../types"
import {
  chatToResponses,
  extractModelSlugs,
  responsesToChatChunks,
  type ChatCompletionsBody,
} from "../lib/codex"

// "Sign in with ChatGPT": the user's own ChatGPT plan powers the models, via
// the same public OAuth client the Codex CLI uses. Neither auth.openai.com nor
// chatgpt.com sends CORS headers, so both legs proxy through the worker
// same-origin. Tokens and messages transit per request — never stored or
// logged (the OpenCode Zen precedent).
//
// Auth is the device-code flow (the loopback redirect the CLI uses can't work
// from a web app): the client fetches a short user code here, the user enters
// it at auth.openai.com/codex/device, and the client polls until authorized.

/** Public OAuth client id used by the Codex CLI. */
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const ISSUER = "https://auth.openai.com"
const CODEX_BASE = "https://chatgpt.com/backend-api/codex"
const SCOPE = "openid profile email offline_access"
/** Identifies the client to OpenAI; the backend gates access on it. */
const ORIGINATOR = "codex_cli_rs"
// The backend gates the available model set on this query param — a stale
// value makes every model report as unsupported. Bump toward the current
// Codex CLI release if models disappear.
const CLIENT_VERSION = "0.142.5"

const chatgpt = new Hono<AppEnv>()

// Overridable so tests (and endpoint moves) can repoint the upstreams.
const issuer = (env: AppEnv["Bindings"]) => env.CHATGPT_ISSUER || ISSUER
const codexBase = (env: AppEnv["Bindings"]) => env.CODEX_BASE_URL || CODEX_BASE

const passthrough = async (upstream: Response) =>
  new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  })

/** The codex backend reports errors as {detail} or {error:{message}}. */
function upstreamError(text: string, fallback: string): string {
  try {
    const parsed = JSON.parse(text) as {
      detail?: unknown
      error?: { message?: unknown } | string
    }
    if (typeof parsed.detail === "string") return parsed.detail
    if (typeof parsed.error === "string") return parsed.error
    const msg = typeof parsed.error === "object" ? parsed.error?.message : undefined
    if (typeof msg === "string") return msg
  } catch {
    // Not JSON. chatgpt.com's WAF blocks Cloudflare Worker egress (subrequests
    // carry an unremovable cf-worker header) with an HTML bot challenge — the
    // codex leg must route through a non-Worker egress instead.
    if (/<(!doctype|html)/i.test(text)) {
      return (
        "ChatGPT's edge blocked this server's request (bot challenge). " +
        "Route the codex leg through scripts/codex-forwarder.mjs and set CODEX_BASE_URL."
      )
    }
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 160)
    if (snippet) return `${fallback}: ${snippet}`
  }
  return fallback
}

chatgpt.post("/auth/device", async (c) => {
  const upstream = await fetch(`${issuer(c.env)}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  })
  return passthrough(upstream)
})

chatgpt.post("/auth/device/poll", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    device_auth_id?: string
    user_code?: string
  }
  if (!body.device_auth_id || !body.user_code) {
    return c.json({ error: "device_auth_id and user_code required" }, 400)
  }
  const upstream = await fetch(`${issuer(c.env)}/api/accounts/deviceauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ device_auth_id: body.device_auth_id, user_code: body.user_code }),
  })
  return passthrough(upstream)
})

chatgpt.post("/auth/exchange", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    authorization_code?: string
    code_verifier?: string
  }
  if (!body.authorization_code || !body.code_verifier) {
    return c.json({ error: "authorization_code and code_verifier required" }, 400)
  }
  const upstream = await fetch(`${issuer(c.env)}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code: body.authorization_code,
      code_verifier: body.code_verifier,
      redirect_uri: `${issuer(c.env)}/deviceauth/callback`,
    }),
  })
  return passthrough(upstream)
})

chatgpt.post("/auth/refresh", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { refresh_token?: string }
  if (!body.refresh_token) return c.json({ error: "refresh_token required" }, 400)
  const upstream = await fetch(`${issuer(c.env)}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: body.refresh_token,
      client_id: CLIENT_ID,
      scope: SCOPE,
    }),
  })
  return passthrough(upstream)
})

/** Auth headers the codex backend expects, from the client's per-request auth. */
function codexHeaders(c: {
  req: { header: (name: string) => string | undefined }
  env: AppEnv["Bindings"]
}): Record<string, string> | undefined {
  const auth = c.req.header("authorization")
  const account = c.req.header("chatgpt-account-id")
  if (!auth || !account) return undefined
  return {
    authorization: auth,
    "chatgpt-account-id": account,
    originator: ORIGINATOR,
    "openai-beta": "responses=experimental",
    // Authenticates us to a self-hosted codex forwarder (see CODEX_BASE_URL).
    ...(c.env.CODEX_PROXY_SECRET && { "x-forwarder-secret": c.env.CODEX_PROXY_SECRET }),
  }
}

chatgpt.get("/v1/models", async (c) => {
  const headers = codexHeaders(c)
  if (!headers) return c.json({ error: { message: "Sign in with ChatGPT first." } }, 401)
  const upstream = await fetch(
    `${codexBase(c.env)}/models?client_version=${CLIENT_VERSION}`,
    { headers: { ...headers, accept: "application/json" } }
  )
  if (!upstream.ok) {
    const text = await upstream.text()
    return new Response(
      JSON.stringify({
        error: { message: upstreamError(text, `ChatGPT model list failed (${upstream.status})`) },
      }),
      { status: upstream.status, headers: { "content-type": "application/json" } }
    )
  }
  const slugs = extractModelSlugs(await upstream.json())
  return c.json({ object: "list", data: slugs.map((id) => ({ id, object: "model" })) })
})

chatgpt.post("/v1/chat/completions", async (c) => {
  const headers = codexHeaders(c)
  if (!headers) return c.json({ error: { message: "Sign in with ChatGPT first." } }, 401)
  const body = (await c.req.json().catch(() => undefined)) as ChatCompletionsBody | undefined
  if (!body?.model || !Array.isArray(body.messages)) {
    return c.json({ error: { message: "model and messages required" } }, 400)
  }

  const upstream = await fetch(
    `${codexBase(c.env)}/responses?client_version=${CLIENT_VERSION}`,
    {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(chatToResponses(body)),
    }
  )
  if (!upstream.ok || !upstream.body) {
    const text = upstream.body ? await upstream.text() : ""
    return new Response(
      JSON.stringify({
        error: { message: upstreamError(text, `ChatGPT backend error (${upstream.status})`) },
      }),
      { status: upstream.status, headers: { "content-type": "application/json" } }
    )
  }
  return new Response(responsesToChatChunks(upstream.body, body.model), {
    headers: { "content-type": "text/event-stream", "cache-control": "private, no-store" },
  })
})

export default chatgpt
