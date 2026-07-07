// Wires the mobile platform into @chat/core. Await initCore() before
// rendering anything that touches prefs or the store.
import { configureCore } from "@chat/core"
import * as Crypto from "expo-crypto"
import { Alert } from "react-native"

import { initDb } from "./db"
import { mobileFetch } from "./fetch"
import { hydratePrefs, prefsPort } from "./prefs"
import { mobileStore } from "./store"

let ready: Promise<void> | undefined

export function initCore(): Promise<void> {
  ready ??= (async () => {
    // generation.ts + db-helpers use crypto.randomUUID; Hermes doesn't ship it.
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto ?? {}
    if (!c.randomUUID) c.randomUUID = Crypto.randomUUID
    ;(globalThis as { crypto?: unknown }).crypto = c

    initDb()
    await hydratePrefs()
    configureCore({
      store: mobileStore,
      prefs: prefsPort,
      fetch: mobileFetch,
      onError: (m) => Alert.alert("Error", m),
      // onArtifact / onMcpAuthRequired / extraTools: later phases
    })
  })()
  return ready
}
