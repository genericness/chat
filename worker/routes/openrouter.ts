import { Hono } from "hono"
import type { AppEnv } from "../types"

interface OpenRouterModel {
  id: string
  name?: string
  context_length?: number
  pricing?: { prompt?: string; completion?: string }
  architecture?: { modality?: string; input_modalities?: string[] }
  supported_parameters?: string[]
}

// Public metadata proxy: the raw OpenRouter list is ~1MB, so slim it and cache
// the result at the edge for an hour.
const openrouter = new Hono<AppEnv>()

openrouter.get("/models", async (c) => {
  const cacheKey = new Request(new URL(c.req.url).toString())
  const cached = await caches.default.match(cacheKey)
  if (cached) return cached

  const upstream = await fetch("https://openrouter.ai/api/v1/models")
  if (!upstream.ok) return c.json({ error: "upstream_failed" }, 502)
  const json = (await upstream.json()) as { data?: OpenRouterModel[] }

  const slim = (json.data ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    contextLength: m.context_length,
    pricing: { prompt: m.pricing?.prompt, completion: m.pricing?.completion },
    modality: m.architecture?.modality,
    supportsTools: m.supported_parameters?.includes("tools") ?? undefined,
    supportsVision:
      m.architecture?.input_modalities?.includes("image") ??
      (m.architecture?.modality ? m.architecture.modality.split("->")[0].includes("image") : undefined),
  }))

  const res = new Response(JSON.stringify({ data: slim }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=3600",
    },
  })
  c.executionCtx.waitUntil(caches.default.put(cacheKey, res.clone()))
  return res
})

export default openrouter
