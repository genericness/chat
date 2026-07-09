import type { Context } from "hono"
import { getCookie, setCookie, deleteCookie } from "hono/cookie"
import type { AppEnv } from "../types"
import { encryptToken, decryptToken } from "./crypto"

const SESSION_COOKIE = "chat_session"
const STATE_COOKIE = "chat_oauth_state"
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

function isSecure(c: Context<AppEnv>): boolean {
  return new URL(c.req.url).protocol === "https:"
}

export async function setSession(c: Context<AppEnv>, userId: number): Promise<void> {
  const value = await encryptToken(
    c.env.COOKIE_SECRET,
    JSON.stringify({ uid: userId, exp: Date.now() + SESSION_TTL_MS })
  )
  setCookie(c, SESSION_COOKIE, value, {
    httpOnly: true,
    secure: isSecure(c),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  })
}

export async function getSessionUserId(c: Context<AppEnv>): Promise<number | null> {
  // Native apps send the same encrypted payload as a bearer token instead of a cookie.
  const header = c.req.header("authorization")
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined
  const value = getCookie(c, SESSION_COOKIE) ?? bearer
  if (!value) return null
  const plain = await decryptToken(c.env.COOKIE_SECRET, value)
  if (!plain) return null
  try {
    const parsed = JSON.parse(plain) as { uid?: number; exp?: number }
    // exp is mandatory so a leaked token can't outlive its TTL. Tokens minted
    // before this check get invalidated — one forced re-login.
    if (!parsed.exp || parsed.exp < Date.now()) return null
    return typeof parsed.uid === "number" ? parsed.uid : null
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
