import type { Context } from "hono"
import { getCookie, setCookie, deleteCookie } from "hono/cookie"
import type { AppEnv } from "../types"
import { encryptToken, decryptToken } from "./crypto"

const SESSION_COOKIE = "chat_session"
const STATE_COOKIE = "chat_oauth_state"

function isSecure(c: Context<AppEnv>): boolean {
  return new URL(c.req.url).protocol === "https:"
}

export async function setSession(c: Context<AppEnv>, userId: number): Promise<void> {
  const value = await encryptToken(c.env.COOKIE_SECRET, JSON.stringify({ uid: userId }))
  setCookie(c, SESSION_COOKIE, value, {
    httpOnly: true,
    secure: isSecure(c),
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  })
}

/** Mobile session: same encrypted payload as the cookie, carried as a Bearer
 * token (native apps can't see the auth browser's cookies). Tokens carry an
 * exp since no cookie maxAge governs them. */
export async function mintSessionToken(c: Context<AppEnv>, userId: number): Promise<string> {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 30
  return encryptToken(c.env.COOKIE_SECRET, JSON.stringify({ uid: userId, exp }))
}

export async function getSessionUserId(c: Context<AppEnv>): Promise<number | null> {
  const bearer = c.req.header("authorization")?.match(/^Bearer (.+)$/i)?.[1]
  const value = bearer ?? getCookie(c, SESSION_COOKIE)
  if (!value) return null
  const plain = await decryptToken(c.env.COOKIE_SECRET, value)
  if (!plain) return null
  try {
    const parsed = JSON.parse(plain) as { uid?: number; exp?: number }
    if (parsed.exp !== undefined && parsed.exp < Date.now()) return null
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
