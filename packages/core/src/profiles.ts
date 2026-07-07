import { ports } from "./config"
import type { McpServerConfig } from "./mcp"

export interface Profile {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  defaultModel?: string
}

export interface Prefs {
  profiles: Profile[]
  activeProfileId?: string
  selectedModels?: string[]
  globalSystemPrompt?: string
  exaKey?: string
  e2bKey?: string
  mcpServers?: McpServerConfig[]
  syncEnabled?: boolean
  lastSyncAt?: number
  onboardedAt?: number
}

export interface Preset {
  name: string
  baseUrl: string
  hint?: string
}

export const PRESETS: Preset[] = [
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { name: "Anthropic", baseUrl: "https://api.anthropic.com/v1" },
  {
    name: "Google AI Studio",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    hint: "Model ids are prefixed with models/, e.g. models/gemini-2.5-pro.",
  },
  { name: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
  { name: "Together", baseUrl: "https://api.together.xyz/v1" },
  { name: "Mistral", baseUrl: "https://api.mistral.ai/v1" },
  { name: "NavyAI", baseUrl: "https://api.navy/v1" },
  {
    name: "OpenCode Zen",
    baseUrl: "/api/opencode/go/v1",
    hint: "OpenCode blocks direct browser calls, so this routes through this app's server. Your key and messages transit the proxy per request — never stored or logged.",
  },
  {
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    hint: "Start Ollama with OLLAMA_ORIGINS set to this site's origin so the browser can reach it.",
  },
  {
    name: "LM Studio",
    baseUrl: "http://localhost:1234/v1",
    hint: "Enable CORS in LM Studio's server settings so the browser can reach it.",
  },
]

// Keys live in the platform's local store only (localStorage / SecureStore):
// never sent to our worker, never synced, never logged. The port reads/writes
// the raw JSON string; parsing and caching happen here.

let cache: Prefs | undefined
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function parse(raw: string | null): Prefs {
  try {
    const parsed = JSON.parse(raw ?? "")
    if (parsed && Array.isArray(parsed.profiles)) return parsed
  } catch {
    // fall through
  }
  return { profiles: [] }
}

export function getPrefs(): Prefs {
  cache ??= parse(ports().prefs.get())
  return cache
}

export function setPrefs(patch: Partial<Prefs>) {
  cache = { ...getPrefs(), ...patch }
  ports().prefs.set(JSON.stringify(cache))
  emit()
}

/** Drop the in-memory copy and re-read from the platform store (e.g. after a
 * cross-tab storage event). */
export function reloadPrefs() {
  cache = undefined
  emit()
}

export function subscribePrefs(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function activeProfile(prefs: Prefs = getPrefs()): Profile | undefined {
  return (
    prefs.profiles.find((p) => p.id === prefs.activeProfileId) ??
    prefs.profiles[0]
  )
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "")
}
