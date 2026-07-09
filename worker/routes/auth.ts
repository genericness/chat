import { Hono } from "hono"
import type { AppEnv } from "../types"
import { randomToken, sha256Base64Url, timingSafeEqual } from "../lib/crypto"
import { exchangeCode, getUser, revokeToken } from "../lib/github"
import { upsertUser } from "../lib/db"
import {
  setSession,
  clearSession,
  setState,
  getState,
  clearState,
  createSessionToken,
} from "../lib/cookies"
import { checkRateLimit, clientIp } from "../lib/rate-limit"

const auth = new Hono<AppEnv>()
const BASE64URL = /^[A-Za-z0-9_-]+$/
const NATIVE_CODE_TTL_MS = 5 * 60_000

function validTokenPart(value: string | undefined, min: number, max: number): value is string {
  return !!value && value.length >= min && value.length <= max && BASE64URL.test(value)
}

auth.get("/login", (c) => {
  const mobile = !!c.req.query("mobile")
  const appState = c.req.query("app_state")
  const challenge = c.req.query("code_challenge")
  if (mobile && (!validTokenPart(appState, 32, 128) || !validTokenPart(challenge, 43, 128))) {
    return c.json({ error: "invalid_native_oauth_parameters" }, 400)
  }
  // The random prefix remains the GitHub OAuth state. Native-only values ride
  // inside the HttpOnly state cookie round-trip and are returned to the app.
  const state = mobile
    ? `${randomToken(16)}.m.${appState}.${challenge}`
    : randomToken(16)
  setState(c, state)
  const params = new URLSearchParams({
    client_id: c.env.GITHUB_CLIENT_ID,
    redirect_uri: `${c.env.APP_BASE_URL}/api/auth/callback`,
    scope: "read:user",
    state,
  })
  return c.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`)
})

auth.get("/callback", async (c) => {
  const code = c.req.query("code")
  const state = c.req.query("state")
  const expected = getState(c)
  clearState(c)
  if (!code || !state || !expected || state !== expected) {
    const expectedParts = expected?.split(".")
    if (
      expectedParts?.length === 4 &&
      expectedParts[1] === "m" &&
      validTokenPart(expectedParts[2], 32, 128)
    ) {
      const target = new URL("chat4x://auth")
      target.searchParams.set("state", expectedParts[2])
      target.searchParams.set("error", "1")
      return c.redirect(target.toString())
    }
    return c.redirect("/?auth=error")
  }
  const parts = state.split(".")
  const mobile = parts.length === 4 && parts[1] === "m"
  const appState = mobile ? parts[2] : undefined
  const challenge = mobile ? parts[3] : undefined
  const nativeFailure = new URL("chat4x://auth")
  if (appState) nativeFailure.searchParams.set("state", appState)
  nativeFailure.searchParams.set("error", "1")
  const fail = () => c.redirect(mobile ? nativeFailure.toString() : "/?auth=error")
  const token = await exchangeCode(
    c.env.GITHUB_CLIENT_ID,
    c.env.GITHUB_CLIENT_SECRET,
    code,
    `${c.env.APP_BASE_URL}/api/auth/callback`
  )
  if (!token) return fail()

  const gh = await getUser(token)
  await revokeToken(c.env.GITHUB_CLIENT_ID, c.env.GITHUB_CLIENT_SECRET, token)

  const user = await upsertUser(c.env.DB, gh)
  if (mobile) {
    if (!appState || !challenge) return fail()
    const nativeCode = randomToken(32)
    const now = Date.now()
    await c.env.DB.prepare(
      `INSERT INTO native_auth_codes
       (code_hash, user_id, code_challenge, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(await sha256Base64Url(nativeCode), user.id, challenge, now + NATIVE_CODE_TTL_MS, now)
      .run()
    c.executionCtx.waitUntil(
      c.env.DB.prepare("DELETE FROM native_auth_codes WHERE expires_at < ?")
        .bind(now)
        .run()
        .then(() => undefined)
        .catch(() => undefined)
    )
    const target = new URL("chat4x://auth")
    target.searchParams.set("code", nativeCode)
    target.searchParams.set("state", appState)
    return c.redirect(target.toString())
  }
  await setSession(c, user.id)
  return c.redirect("/")
})

auth.post("/logout", (c) => {
  clearSession(c)
  return c.body(null, 204)
})

auth.post("/mobile/exchange", async (c) => {
  if (!(await checkRateLimit(c, "native-auth", clientIp(c), 20, 5 * 60_000))) {
    return c.json({ error: "rate_limited" }, 429)
  }
  const contentLength = Number(c.req.header("content-length") ?? "0")
  if (contentLength > 4096) return c.json({ error: "request_too_large" }, 413)
  const body = (await c.req.json().catch(() => ({}))) as {
    code?: string
    code_verifier?: string
  }
  if (!validTokenPart(body.code, 32, 128) || !validTokenPart(body.code_verifier, 43, 128)) {
    return c.json({ error: "invalid_exchange" }, 400)
  }
  const codeHash = await sha256Base64Url(body.code)
  const row = await c.env.DB.prepare(
    "SELECT user_id, code_challenge, expires_at FROM native_auth_codes WHERE code_hash = ?"
  )
    .bind(codeHash)
    .first<{ user_id: number; code_challenge: string; expires_at: number }>()
  const challenge = await sha256Base64Url(body.code_verifier)
  if (!row || row.expires_at <= Date.now() || !timingSafeEqual(row.code_challenge, challenge)) {
    return c.json({ error: "invalid_exchange" }, 400)
  }
  // DELETE ... RETURNING makes the successful exchange single-use even if two
  // correct requests race each other.
  const consumed = await c.env.DB.prepare(
    "DELETE FROM native_auth_codes WHERE code_hash = ? RETURNING user_id"
  )
    .bind(codeHash)
    .first<{ user_id: number }>()
  if (!consumed || consumed.user_id !== row.user_id) {
    return c.json({ error: "invalid_exchange" }, 400)
  }
  const token = await createSessionToken(c.env.COOKIE_SECRET, row.user_id)
  c.header("cache-control", "no-store")
  return c.json({ token })
})

export default auth
