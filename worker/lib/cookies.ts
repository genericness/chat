import type { Context } from "hono"
import { getCookie, setCookie, deleteCookie } from "hono/cookie"
import type { AppEnv } from "../types"
import { encryptToken, decryptToken } from "./crypto"

const SESSION_COOKIE = "chat_session"
const STATE_COOKIE = "chat_oauth_state"
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

function isSecure(c: Context<AppEnv>): boolean {
  return new URL(c.req.url).protocol === "https:"
}

export async function setSession(c: Context<AppEnv>, userId: number): Promise<void> {
  const value = await createSessionToken(c.env.COOKIE_SECRET, userId)
  setCookie(c, SESSION_COOKIE, value, {
    httpOnly: true,
    secure: isSecure(c),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
}

export function createSessionToken(secret: string, userId: number): Promise<string> {
  const iat = Date.now()
  const exp = iat + SESSION_MAX_AGE_SECONDS * 1000
  return encryptToken(secret, JSON.stringify({ uid: userId, iat, exp }))
}

export async function getSessionUserId(c: Context<AppEnv>): Promise<number | null> {
  // Native apps send the same encrypted payload as a bearer token instead of a cookie.
  const header = c.req.header("authorization")
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined
  const cookie = getCookie(c, SESSION_COOKIE)
  const value = cookie ?? bearer
  const usingBearer = !cookie && !!bearer
  if (!value) return null
  const plain = await decryptToken(c.env.COOKIE_SECRET, value)
  if (!plain) return null
  try {
    const parsed = JSON.parse(plain) as { uid?: number; iat?: number; exp?: number }
    const now = Date.now()
    if (
      typeof parsed.uid !== "number" ||
      typeof parsed.exp !== "number" ||
      parsed.exp <= now
    ) {
      return null
    }
    // Native releases issued expiring bearer tokens without iat before the
    // PKCE exchange shipped. Honor only those already-expiring tokens during
    // their remaining lifetime; web cookies must always carry iat and exp.
    if (typeof parsed.iat !== "number") {
      return usingBearer && parsed.exp - now <= SESSION_MAX_AGE_SECONDS * 1000 ? parsed.uid : null
    }
    if (
      parsed.iat > now + 60_000 ||
      parsed.exp - parsed.iat > SESSION_MAX_AGE_SECONDS * 1000
    ) {
      return null
    }
    return parsed.uid
  } catch {
    return null
  }
}

export function clearSession(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" })
}

export function setState(c: Context<AppEnv>, state: string): void {
  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    secure: isSecure(c),
    sameSite: "Lax",
    path: "/",
    maxAge: 600,
  })
}

export function getState(c: Context<AppEnv>): string | undefined {
  return getCookie(c, STATE_COOKIE)
}

export function clearState(c: Context<AppEnv>): void {
  deleteCookie(c, STATE_COOKIE, { path: "/" })
}
