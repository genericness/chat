import { getPrefs, reloadPrefs, subscribePrefs, type Prefs } from "@chat/core"
import { useSyncExternalStore } from "react"

// Prefs logic lives in @chat/core behind the prefs port (see core-setup.ts);
// this shell adds the web-only bits and re-exports for existing importers.
export { activeProfile, getPrefs, normalizeBaseUrl, PRESETS, setPrefs } from "@chat/core"
export type { Prefs, Preset, Profile } from "@chat/core"

// Keys live in localStorage only: never sent to our worker, never synced, never logged.
export const PREFS_KEY = "chat:prefs"

// Cross-tab sync: another tab wrote prefs — re-read on the storage event.
window.addEventListener("storage", (e) => {
  if (e.key === PREFS_KEY) reloadPrefs()
})

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribePrefs, getPrefs)
}
