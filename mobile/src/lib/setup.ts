// Wires the mobile platform into @chat/core. Await initCore() before
// rendering anything that touches prefs or the store.
import { configureCore, runSync, scheduleSync } from "@chat/core"
import * as Crypto from "expo-crypto"
import { router } from "expo-router"
import { addDatabaseChangeListener } from "expo-sqlite"
import { Alert, AppState } from "react-native"

import { hydrateAuth } from "./auth"
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
    await Promise.all([hydratePrefs(), hydrateAuth()])
    configureCore({
      store: mobileStore,
      prefs: prefsPort,
      fetch: mobileFetch,
      onError: (m) => Alert.alert("Error", m),
      // navigate dedupes, so streaming edit_artifact calls don't stack screens
      onArtifact: (convId, artifactId) =>
        router.navigate({
          pathname: "/artifact/[convId]/[artifactId]",
          params: { convId, artifactId },
        }),
      onMcpAuthRequired: (err) => {
        Alert.alert(
          "MCP authorization",
          `"${err.server.name}" needs authorization.`,
          [
            { text: "Not now", style: "cancel" },
            {
              text: "Connect",
              onPress: () => {
                void import("./mcp-oauth").then(({ authorizeMcpServer }) =>
                  authorizeMcpServer(err.server, err.wwwAuthenticate)
                    .then(() => Alert.alert("Connected", `Send again to use "${err.server.name}" tools.`))
                    .catch((e) => Alert.alert("Error", e instanceof Error ? e.message : String(e)))
                )
              },
            },
          ]
        )
      },
      // extraTools (E2B): web-only for now
    })

    // Sync triggers (mirrors web's Dexie hooks + focus/visibility listeners).
    // scheduleSync no-ops unless prefs.syncEnabled; the applying guard in core
    // suppresses re-scheduling storms while a pull writes.
    addDatabaseChangeListener(() => scheduleSync())
    AppState.addEventListener("change", (s) => {
      if (s === "active") scheduleSync(500)
    })
    setInterval(() => {
      if (AppState.currentState === "active") void runSync()
    }, 30_000)
    scheduleSync(2000)
  })()
  return ready
}
