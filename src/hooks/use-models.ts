import { fetchOpenRouterMeta } from "@chat/core"
import { useQuery } from "@tanstack/react-query"

import type { Profile } from "@/lib/profiles"

// Shared model-metadata logic lives in @chat/core; re-export for existing importers.
export { fetchOpenRouterMeta, lookupMeta } from "@chat/core"
export type { ModelMeta } from "@chat/core"

/** Model ids offered by the user's own endpoint (`GET {baseUrl}/models`). */
export function useEndpointModels(profile?: Profile) {
  return useQuery({
    queryKey: ["endpoint-models", profile?.id, profile?.baseUrl],
    enabled: !!profile,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const headers: Record<string, string> = {}
      if (profile!.apiKey) headers.authorization = `Bearer ${profile!.apiKey}`
      if (/^https:\/\/api\.anthropic\.com/.test(profile!.baseUrl)) {
        headers["anthropic-dangerous-direct-browser-access"] = "true"
        headers["x-api-key"] = profile!.apiKey
      }
      const res = await fetch(`${profile!.baseUrl}/models`, { headers })
      if (!res.ok) throw new Error(`models list failed (${res.status})`)
      const json = (await res.json()) as { data?: { id: string }[] }
      return (json.data ?? []).map((m) => m.id)
    },
  })
}

/** OpenRouter public metadata, slimmed + cached by our worker. */
export function useOpenRouterMeta() {
  return useQuery({
    queryKey: ["openrouter-meta"],
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
