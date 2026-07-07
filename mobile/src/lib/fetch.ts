// expo/fetch is WinterCG-compliant with streaming response bodies — the SSE
// loop in @chat/core works unchanged. Relative "/api/*" URLs (worker routes:
// exa proxy, openrouter metadata, sync) are prefixed with the app origin.
import { fetch as expoFetch } from "expo/fetch"

export const APP_ORIGIN = "https://chat.4x.rip"

export const mobileFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  let url =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
  if (url.startsWith("/")) url = APP_ORIGIN + url
  return expoFetch(url, init as never)
}) as unknown as typeof globalThis.fetch
