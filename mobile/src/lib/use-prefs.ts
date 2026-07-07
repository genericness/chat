import { getPrefs, subscribePrefs, type Prefs } from "@chat/core"
import { useSyncExternalStore } from "react"

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribePrefs, getPrefs)
}
