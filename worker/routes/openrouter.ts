import { Hono } from "hono"
import type { AppEnv } from "../types"
import { sha256Base64Url } from "../lib/crypto"

interface OpenRouterModel {
  id: string
  name?: string
  context_length?: number
  pricing?: { prompt?: string; completion?: string }
  architecture?: { modality?: string; input_modalities?: string[] }
  supported_parameters?: string[]
}

interface CachedModels {
  body: string
  etag: string
  storedAt: number
}

const openrouter = new Hono<AppEnv>()

// The Cache API is per data center. Keep a longer-lived recovery copy at the
// edge, refresh it hourly, and let browsers reuse the slim response for an
// hour too. The hard TTL lets us serve the last known catalog if OpenRouter is
// briefly unavailable without storing any user-specific data.
const REFRESH_AFTER_MS = 60 * 60_000
const EDGE_TTL_SECONDS = 24 * 60 * 60
const BROWSER_TTL_SECONDS = 60 * 60
const STORED_AT_HEADER = "x-chat-cache-stored-at"
const CACHE_VERSION = "openrouter-models-v2"

const refreshes = new Map<string, Promise<CachedModels | null>>()

/** Ignore query-string cache busters for this parameter-free public route. */
function cacheKey(requestUrl: string): Request {
  const url = new URL(requestUrl)
  url.pathname = `/__cache/${CACHE_VERSION}`
  url.search = ""
  url.hash = ""
  return new Request(url.toString(), { method: "GET" })
}

function storedResponse(record: CachedModels): Response {
  return new Response(record.body, {
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${EDGE_TTL_SECONDS}`,
      etag: record.etag,
      [STORED_AT_HEADER]: String(record.storedAt),
    },
  })
}

function etagMatches(value: string | undefined, etag: string | null): boolean {
  if (!value || !etag) return false
  return value
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === "*" || candidate === etag)
}

function clientResponse(
  response: Response,
  cacheStatus: "HIT" | "MISS" | "REVALIDATED" | "STALE",
  ifNoneMatch?: string
): Response {
  const headers = new Headers(response.headers)
  headers.delete(STORED_AT_HEADER)
  headers.set("cache-control", `public, max-age=${BROWSER_TTL_SECONDS}`)
  headers.set("x-chat-cache", cacheStatus)
  if (etagMatches(ifNoneMatch, headers.get("etag"))) {
    headers.delete("content-length")
    return new Response(null, { status: 304, headers })
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function fetchModels(): Promise<CachedModels | null> {
  const upstream = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { accept: "application/json" },
  })
  if (!upstream.ok) return null
  const json = (await upstream.json()) as { data?: OpenRouterModel[] }

  const slim = (json.data ?? []).map((model) => ({
    id: model.id,
    name: model.name,
    contextLength: model.context_length,
    pricing: { prompt: model.pricing?.prompt, completion: model.pricing?.completion },
    modality: model.architecture?.modality,
    supportsTools: model.supported_parameters?.includes("tools") ?? undefined,
    supportsVision:
      model.architecture?.input_modalities?.includes("image") ??
      (model.architecture?.modality
        ? model.architecture.modality.split("->")[0].includes("image")
        : undefined),
  }))
  const body = JSON.stringify({ data: slim })
  return {
    body,
    etag: `"${await sha256Base64Url(body)}"`,
    storedAt: Date.now(),
  }
}

/** Coalesce simultaneous misses within an isolate and populate the local colo. */
async function refresh(cache: Cache, key: Request): Promise<CachedModels | null> {
  const cacheId = key.url
  const inFlight = refreshes.get(cacheId)
  if (inFlight) return inFlight
  const task = (async () => {
    const record = await fetchModels()
    if (!record) return null
    try {
      await cache.put(key, storedResponse(record))
    } catch {
      // Cache writes are an optimization; a fresh upstream response is still usable.
    }
    return record
  })()
  refreshes.set(cacheId, task)
  try {
    return await task
  } finally {
    if (refreshes.get(cacheId) === task) refreshes.delete(cacheId)
  }
}

// Public metadata proxy: the raw OpenRouter list is roughly 1 MB, so slim it
// once per colo and cache only the deterministic, credential-free result.
openrouter.get("/models", async (c) => {
  const cache = caches.default
  const key = cacheKey(c.req.url)
  const ifNoneMatch = c.req.header("if-none-match")
  let cached: Response | undefined
  try {
    cached = await cache.match(key)
  } catch {
    // Continue to the upstream if the local cache is unavailable.
  }

  if (cached) {
    const storedAt = Number(cached.headers.get(STORED_AT_HEADER) ?? "0")
    if (Number.isFinite(storedAt) && Date.now() - storedAt < REFRESH_AFTER_MS) {
      return clientResponse(cached, "HIT", ifNoneMatch)
    }
    const fresh = await refresh(cache, key)
    if (fresh) return clientResponse(storedResponse(fresh), "REVALIDATED", ifNoneMatch)
    return clientResponse(cached, "STALE", ifNoneMatch)
  }

  const fresh = await refresh(cache, key)
  if (!fresh) return c.json({ error: "upstream_failed" }, 502)
  return clientResponse(storedResponse(fresh), "MISS", ifNoneMatch)
})

export default openrouter
