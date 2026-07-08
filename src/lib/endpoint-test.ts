// Shared "test this endpoint" probe for the onboarding wizard and settings:
// one GET /models validates the URL, key, and CORS in a single shot and
// doubles as the model list for picking a default.

import { chatgptAuthHeaders, isChatGPTBaseUrl } from "@/lib/chatgpt"

export type EndpointTestResult =
  | { ok: true; models: string[] }
  | { ok: false; reason: "auth" | "unreachable" | "no-models"; detail: string }

export async function testEndpoint(baseUrl: string, apiKey: string): Promise<EndpointTestResult> {
  const headers: Record<string, string> = {}
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  if (/^https:\/\/api\.anthropic\.com/.test(baseUrl)) {
    headers["anthropic-dangerous-direct-browser-access"] = "true"
    headers["x-api-key"] = apiKey
  }
  if (isChatGPTBaseUrl(baseUrl)) {
    try {
      Object.assign(headers, await chatgptAuthHeaders())
    } catch (err) {
      return {
        ok: false,
        reason: "auth",
        detail: err instanceof Error ? err.message : String(err),
      }
    }
  }

  let res: Response
  try {
    res = await fetch(`${baseUrl}/models`, { headers })
  } catch {
    return {
      ok: false,
      reason: "unreachable",
      detail:
        "Could not reach the endpoint — check the URL, the server's CORS settings, and that http:// hosts are only used from localhost.",
    }
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: "auth", detail: "The endpoint rejected the API key." }
  }
  if (!res.ok) {
    return {
      ok: false,
      reason: "no-models",
      detail: `Endpoint reachable, but the model list failed (${res.status}). It may still work for chat.`,
    }
  }
  try {
    const json = (await res.json()) as { data?: { id?: string }[] }
    const models = (json.data ?? []).map((m) => m.id).filter((id): id is string => !!id)
    if (!models.length) {
      return {
        ok: false,
        reason: "no-models",
        detail: "Endpoint reachable, but it returned no models. You can still set one manually.",
      }
    }
    return { ok: true, models }
  } catch {
    return {
      ok: false,
      reason: "no-models",
      detail: "Endpoint reachable, but the model list response wasn't valid JSON.",
    }
  }
}
