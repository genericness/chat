// expo/fetch is WinterCG-compliant with streaming response bodies — the SSE
// loop in @chat/core works unchanged. Relative "/api/*" URLs (worker routes:
// exa proxy, openrouter metadata, sync) are prefixed with the app origin and
// get the session bearer token, unless the caller already set authorization
// (the OpenCode proxy forwards the provider key that way).
import { fetch as expoFetch } from "expo/fetch"

import { getToken } from "./auth"

export const APP_ORIGIN = "https://chat.4x.rip"

export const mobileFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  let url =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
  const sameOrigin = url.startsWith("/")
  if (sameOrigin) url = APP_ORIGIN + url
  const token = sameOrigin ? getToken() : null
  if (token) {
    const headers = { ...((init?.headers as Record<string, string>) ?? {}) }
    if (!Object.keys(headers).some((h) => h.toLowerCase() === "authorization")) {
      headers.authorization = `Bearer ${token}`
    }
    init = { ...init, headers }
  }
  return expoFetch(url, init as never)
}) as unknown as typeof globalThis.fetch
