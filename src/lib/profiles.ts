import { useSyncExternalStore } from "react"

import { API_BASE } from "@/lib/api-base"
import type { ChatGPTAuth } from "@/lib/chatgpt"
import type { McpServerConfig } from "@/lib/mcp"

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
  /** "Sign in with ChatGPT" tokens — this browser only, like every key here. */
  chatgptAuth?: ChatGPTAuth
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
  {
    name: "ChatGPT",
    baseUrl: `${API_BASE}/api/chatgpt/v1`,
    hint: "Uses your ChatGPT plan via sign-in — no API key. ChatGPT blocks direct browser calls, so requests route through this app's server; tokens and messages transit per request, never stored or logged. Append :low or :high to a model id to change reasoning effort.",
  },
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
    baseUrl: `${API_BASE}/api/opencode/go/v1`,
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

// Keys live in localStorage only: never sent to our worker, never synced, never logged.
const KEY = "chat:prefs"

function load(): Prefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "")
    if (parsed && Array.isArray(parsed.profiles)) return parsed
  } catch {
    // fall through
  }
  return { profiles: [] }
}

let cache: Prefs = load()
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

window.addEventListener("storage", (e) => {
  if (e.key === KEY) {
    cache = load()
    emit()
  }
})

export function getPrefs(): Prefs {
  return cache
}

export function setPrefs(patch: Partial<Prefs>) {
  cache = { ...cache, ...patch }
  localStorage.setItem(KEY, JSON.stringify(cache))
  emit()
}

export function usePrefs(): Prefs {
  return useSyncExternalStore((cb) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }, getPrefs)
}

export function activeProfile(prefs: Prefs = cache): Profile | undefined {
  return (
    prefs.profiles.find((p) => p.id === prefs.activeProfileId) ??
    prefs.profiles[0]
  )
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "")
}
