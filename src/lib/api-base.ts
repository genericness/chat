// Native (Capacitor) builds set VITE_API_BASE=https://chat.4x.rip so the app,
// served from a WebView origin, still reaches our worker. Web builds leave it
// unset: paths stay relative and cookie auth applies. Session bearer token for
// native lives in localStorage (first-party JS only).
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? ""
export const IS_NATIVE = API_BASE !== ""

const TOKEN_KEY = "chat_token"

export function getAuthToken(): string | null {
  return IS_NATIVE ? localStorage.getItem(TOKEN_KEY) : null
}

export function setAuthToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

/** fetch() for our worker's /api/* — prepends the base and attaches the bearer token on native. */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getAuthToken()
  const headers = token
    ? { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` }
    : init.headers
  return fetch(API_BASE + path, { ...init, headers })
}
