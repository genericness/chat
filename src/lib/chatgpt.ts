import { API_BASE, apiFetch } from "@/lib/api-base"
import { getPrefs, setPrefs } from "@/lib/profiles"

// "Sign in with ChatGPT": device-code OAuth against auth.openai.com (via our
// worker, which only relays — neither endpoint sends CORS headers), tokens in
// localStorage prefs like every other credential. Model calls then go through
// the worker's /api/chatgpt/v1 chat-completions facade over the ChatGPT-backed
// Codex API, billed to the user's own ChatGPT plan.

export interface ChatGPTAuth {
  accessToken: string
  refreshToken?: string
  /** ChatGPT account id claim — sent as a header on every model request. */
  accountId: string
  /** Epoch ms when accessToken expires, when known. */
  expiresAt?: number
  email?: string
  plan?: string
}

export const CHATGPT_BASE_URL = `${API_BASE}/api/chatgpt/v1`
/** Sensible starting model; the models endpoint lists what the plan offers. */
export const CHATGPT_DEFAULT_MODEL = "gpt-5.5"

export function isChatGPTBaseUrl(baseUrl: string): boolean {
  return /\/api\/chatgpt\/v1\/?$/.test(baseUrl)
}

export function getChatGPTAuth(): ChatGPTAuth | undefined {
  return getPrefs().chatgptAuth
}

export function signOutChatGPT() {
  setPrefs({ chatgptAuth: undefined })
}

/** JWT claim namespace carrying ChatGPT account/plan metadata. */
const AUTH_CLAIM = "https://api.openai.com/auth"

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  id_token?: string
  expires_in?: number
}

function decodeJwtPayload(token: string | undefined): Record<string, unknown> | undefined {
  const part = token?.split(".")[1]
  if (!part) return undefined
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/")
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
    const bytes = Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0))
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function authClaim(claims: Record<string, unknown> | undefined): Record<string, unknown> {
  const value = claims?.[AUTH_CLAIM]
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}

function toAuth(raw: TokenResponse, prev?: ChatGPTAuth): ChatGPTAuth {
  if (!raw.access_token) throw new Error("ChatGPT sign-in failed: no access token returned.")
  const id = decodeJwtPayload(raw.id_token)
  const access = decodeJwtPayload(raw.access_token)
  const accountId =
    asString(authClaim(id).chatgpt_account_id) ??
    asString(authClaim(access).chatgpt_account_id) ??
    prev?.accountId
  if (!accountId) throw new Error("ChatGPT sign-in failed: token carries no account id.")
  const exp = typeof access?.exp === "number" ? access.exp * 1000 : undefined
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? prev?.refreshToken,
    accountId,
    expiresAt:
      typeof raw.expires_in === "number" ? Date.now() + raw.expires_in * 1000 : exp,
    email: asString(id?.email) ?? prev?.email,
    plan: asString(authClaim(id).chatgpt_plan_type) ?? prev?.plan,
  }
}

async function postJson(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return apiFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })
}

export interface ChatGPTLogin {
  /** Short code the user enters at {@link verificationUrl}. */
  userCode: string
  verificationUrl: string
  /** Resolves once the user approves and tokens are stored in prefs. */
  done: Promise<ChatGPTAuth>
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException("aborted", "AbortError"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

export async function startChatGPTLogin(signal?: AbortSignal): Promise<ChatGPTLogin> {
  const res = await apiFetch("/api/chatgpt/auth/device", { method: "POST", signal })
  if (!res.ok) throw new Error(`Could not start ChatGPT sign-in (${res.status}).`)
  const raw = (await res.json()) as {
    device_auth_id?: string
    user_code?: string
    usercode?: string
    interval?: string | number
  }
  const userCode = raw.user_code ?? raw.usercode
  if (!raw.device_auth_id || !userCode) {
    throw new Error("ChatGPT sign-in did not return a device code.")
  }
  const intervalMs = 1000 * (Number(raw.interval) > 0 ? Number(raw.interval) : 5)
  return {
    userCode,
    verificationUrl: "https://auth.openai.com/codex/device",
    done: pollUntilAuthorized(raw.device_auth_id, userCode, intervalMs, signal),
  }
}

async function pollUntilAuthorized(
  deviceAuthId: string,
  userCode: string,
  intervalMs: number,
  signal?: AbortSignal
): Promise<ChatGPTAuth> {
  // Device codes expire server-side after ~15 minutes.
  const deadline = Date.now() + 15 * 60_000
  while (Date.now() < deadline) {
    await sleep(intervalMs, signal)
    const res = await postJson(
      "/api/chatgpt/auth/device/poll",
      { device_auth_id: deviceAuthId, user_code: userCode },
      signal
    )
    // 403/404 = the user hasn't finished; 429 = transient rate limit.
    if (res.status === 403 || res.status === 404 || res.status === 429) continue
    if (!res.ok) throw new Error(`ChatGPT sign-in failed (${res.status}).`)
    const raw = (await res.json()) as { authorization_code?: string; code_verifier?: string }
    // A 200 without a code means the approval is still binding.
    if (!raw.authorization_code || !raw.code_verifier) continue
    const tok = await postJson("/api/chatgpt/auth/exchange", raw, signal)
    if (!tok.ok) throw new Error(`ChatGPT sign-in failed at token exchange (${tok.status}).`)
    const auth = toAuth((await tok.json()) as TokenResponse)
    setPrefs({ chatgptAuth: auth })
    return auth
  }
  throw new Error("ChatGPT sign-in timed out — try again.")
}

const SIGNED_OUT_MSG = "Sign in with ChatGPT in Settings first."
const EXPIRED_MSG = "Your ChatGPT session expired — sign in again in Settings."

// Single-flight so concurrent requests (compare mode) refresh once.
let refreshing: Promise<ChatGPTAuth> | undefined

async function ensureFreshAuth(): Promise<ChatGPTAuth> {
  const auth = getPrefs().chatgptAuth
  if (!auth) throw new Error(SIGNED_OUT_MSG)
  if (auth.expiresAt === undefined || auth.expiresAt - Date.now() > 5 * 60_000) return auth
  if (!auth.refreshToken) {
    signOutChatGPT()
    throw new Error(EXPIRED_MSG)
  }
  refreshing ??= (async () => {
    try {
      const res = await postJson("/api/chatgpt/auth/refresh", {
        refresh_token: auth.refreshToken,
      })
      if (!res.ok) {
        // 400/401 = the refresh token itself is dead; anything else is transient.
        if (res.status === 400 || res.status === 401) {
          signOutChatGPT()
          throw new Error(EXPIRED_MSG)
        }
        throw new Error(`ChatGPT token refresh failed (${res.status}).`)
      }
      const next = toAuth((await res.json()) as TokenResponse, auth)
      setPrefs({ chatgptAuth: next })
      return next
    } finally {
      refreshing = undefined
    }
  })()
  return refreshing
}

/** Per-request auth headers for the /api/chatgpt/v1 facade, refreshing first if needed. */
export async function chatgptAuthHeaders(): Promise<Record<string, string>> {
  const auth = await ensureFreshAuth()
  return { authorization: `Bearer ${auth.accessToken}`, "chatgpt-account-id": auth.accountId }
}
