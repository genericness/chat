// The platform port: one plain init function wires the host app (web or
// mobile) into the core. No DI framework — a module singleton, configured
// once at boot before anything else in this package is used.
import type { McpAuthRequiredError } from "./mcp"
import type { ToolDef } from "./openai"
import type { CoreStore } from "./store"

/** Platform-provided model tools (web: the E2B sandbox/computer-use suite). */
export interface ExtraTools {
  defs(opts: { vision?: boolean }): ToolDef[]
  names: Set<string>
  execute(
    name: string,
    args: Record<string, unknown>,
    ctx: { convId: string; msgId: string; pushImage(url: string): void }
  ): Promise<string | null>
}

export interface CorePorts {
  store: CoreStore
  /**
   * Raw prefs JSON string storage (localStorage-shaped). Parsing, caching,
   * and change notification live in profiles.ts; the platform only stores
   * the string (web: localStorage; mobile: SecureStore/AsyncStorage).
   */
  prefs: { get(): string | null; set(value: string): void }
  /**
   * Platform fetch. Every network call in this package routes through it.
   * Web omits it (browser fetch). Mobile injects a wrapper over expo/fetch
   * that prefixes the app origin + auth header onto relative "/api" URLs.
   */
  fetch?: typeof globalThis.fetch
  /** Surface a user-facing error outside React (web: sonner toast). */
  onError?: (message: string) => void
  /** An MCP server needs interactive authorization (requires a platform browser flow). */
  onMcpAuthRequired?: (err: McpAuthRequiredError) => void
  /** An artifact was created/edited — bring it on screen. */
  onArtifact?: (convId: string, artifactId: string) => void
  /** Generation for a conversation was stopped (web: tear down E2B sandboxes). */
  onConversationStop?: (convId: string) => void
  extraTools?: ExtraTools
}

let _ports: CorePorts | undefined

export function configureCore(p: CorePorts) {
  _ports = p
}

export function ports(): CorePorts {
  if (!_ports) throw new Error("configureCore() must run before the core is used")
  return _ports
}

export function store(): CoreStore {
  return ports().store
}

export const coreFetch: typeof globalThis.fetch = (...args) =>
  (_ports?.fetch ?? globalThis.fetch)(...args)
