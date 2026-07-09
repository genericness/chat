import { useQuery } from "@tanstack/react-query"

import { apiFetch } from "@/lib/api-base"
import { chatgptAuthHeaders, isChatGPTBaseUrl } from "@/lib/chatgpt"
import type { Profile } from "@/lib/profiles"

export interface ModelMeta {
  id: string
  name?: string
  contextLength?: number
  pricing?: { prompt?: string; completion?: string }
  modality?: string
  supportsTools?: boolean
  supportsVision?: boolean
}

// Module-level cache so non-React code (generation.ts) can consult metadata too.
let metaPromise: Promise<Map<string, ModelMeta>> | undefined
export function fetchOpenRouterMeta(): Promise<Map<string, ModelMeta>> {
  metaPromise ??= apiFetch("/api/openrouter/models")
    .then(async (res) => {
      if (!res.ok) throw new Error("metadata fetch failed")
      const json = (await res.json()) as { data: ModelMeta[] }
      return new Map(json.data.map((m) => [m.id, m]))
    })
    .catch((err) => {
      metaPromise = undefined // retry next time
      throw err
    })
  return metaPromise
}

/** Exact id match first, then vendor-suffix match ("gpt-4o" → "openai/gpt-4o").
 * Google AI Studio prefixes ids with "models/" ("models/gemini-2.5-pro"). */
export function lookupMeta(
  meta: Map<string, ModelMeta> | undefined,
  id: string
): ModelMeta | undefined {
  if (!meta) return undefined
  const bare = id.replace(/^models\//, "")
  const exact = meta.get(id) ?? meta.get(bare)
  if (exact) return exact
  for (const m of meta.values()) {
    if (m.id.split("/")[1] === bare) return m
  }
  return undefined
}

/** Model ids offered by the user's own endpoint (`GET {baseUrl}/models`). */
export function useEndpointModels(profile?: Profile, enabled = true) {
  return useQuery({
    queryKey: ["endpoint-models", profile?.id, profile?.baseUrl],
    enabled: enabled && !!profile,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const headers: Record<string, string> = {}
      if (profile!.apiKey) headers.authorization = `Bearer ${profile!.apiKey}`
      if (/^https:\/\/api\.anthropic\.com/.test(profile!.baseUrl)) {
        headers["anthropic-dangerous-direct-browser-access"] = "true"
        headers["x-api-key"] = profile!.apiKey
      }
      if (isChatGPTBaseUrl(profile!.baseUrl)) {
        Object.assign(headers, await chatgptAuthHeaders())
      }
      const res = await fetch(`${profile!.baseUrl}/models`, { headers })
      if (!res.ok) throw new Error(`models list failed (${res.status})`)
      const json = (await res.json()) as { data?: { id: string }[] }
      return (json.data ?? []).map((m) => m.id)
    },
  })
}

/** OpenRouter public metadata, slimmed + cached by our worker. */
export function useOpenRouterMeta(enabled = true) {
  return useQuery({
    queryKey: ["openrouter-meta"],
    enabled,
    staleTime: 24 * 3600_000,
    gcTime: 24 * 3600_000,
    queryFn: fetchOpenRouterMeta,
  })
}

export function fmtPricePerM(perToken?: string): string | undefined {
  const n = parseFloat(perToken ?? "")
  if (!Number.isFinite(n) || n === 0) return undefined
  const perM = n * 1e6
  return `$${perM < 10 ? perM.toFixed(2) : perM.toFixed(0)}/M`
}

export function fmtContext(len?: number): string | undefined {
  if (!len) return undefined
  return len >= 1000 ? `${Math.round(len / 1000)}K ctx` : `${len} ctx`
}
