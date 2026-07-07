// The platform port: one plain init function wires the host app (web or
// mobile) into the core. No DI framework — a module singleton, configured
// once at boot before anything else in this package is used.

export interface CorePorts {
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
}

let _ports: CorePorts | undefined

export function configureCore(p: CorePorts) {
  _ports = p
}

export function ports(): CorePorts {
  if (!_ports) throw new Error("configureCore() must run before the core is used")
  return _ports
}

export const coreFetch: typeof globalThis.fetch = (...args) =>
  (_ports?.fetch ?? globalThis.fetch)(...args)
