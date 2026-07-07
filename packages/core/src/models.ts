import { coreFetch } from "./config"

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
  metaPromise ??= coreFetch("/api/openrouter/models")
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
