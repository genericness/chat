// GitHub sign-in via the worker: openAuthSessionAsync drives the OAuth flow
// in a system browser; the worker's callback redirects to chat4x://auth with
// a bearer token (same encrypted payload as the web session cookie).
import * as SecureStore from "expo-secure-store"
import * as WebBrowser from "expo-web-browser"

import { APP_ORIGIN } from "./fetch"

const TOKEN_KEY = "chat.session"
let token: string | null = null

export async function hydrateAuth(): Promise<void> {
  token = await SecureStore.getItemAsync(TOKEN_KEY)
}

export const getToken = () => token

export async function signIn(): Promise<boolean> {
  const result = await WebBrowser.openAuthSessionAsync(
    `${APP_ORIGIN}/api/auth/login?mobile=1`,
    "chat4x://auth"
  )
  if (result.type !== "success") return false
  // RN's URL polyfill lacks searchParams; parse by hand.
  const t = /[?&]token=([^&#]+)/.exec(result.url)?.[1]
  if (!t) return false
  token = decodeURIComponent(t)
  await SecureStore.setItemAsync(TOKEN_KEY, token)
  return true
}

export async function signOut(): Promise<void> {
  token = null
  await SecureStore.deleteItemAsync(TOKEN_KEY)
}
