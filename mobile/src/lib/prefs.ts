// Mobile prefs storage behind @chat/core's string-shaped prefs port.
// Secrets (API keys) live in SecureStore (Keychain/Keystore, ≤2KB per entry,
// one entry per key); the rest of the prefs JSON lives in AsyncStorage.
// The core only ever sees the recomposed JSON string, held in memory for
// synchronous reads; writes are decomposed and persisted fire-and-forget.
import AsyncStorage from "@react-native-async-storage/async-storage"
import * as SecureStore from "expo-secure-store"

const PREFS_KEY = "chat:prefs"
const sec = (name: string) => `chat.key.${name}`

let current: string | null = null

interface PrefsShape {
  profiles?: { id: string; apiKey?: string }[]
  exaKey?: string
  e2bKey?: string
  [k: string]: unknown
}

/** Load AsyncStorage prefs + SecureStore keys into memory. Call once at boot. */
export async function hydratePrefs(): Promise<void> {
  const raw = await AsyncStorage.getItem(PREFS_KEY)
  if (!raw) {
    current = null
    return
  }
  try {
    const prefs = JSON.parse(raw) as PrefsShape
    for (const p of prefs.profiles ?? []) {
      p.apiKey = (await SecureStore.getItemAsync(sec(`profile-${p.id}`))) ?? ""
    }
    const exa = await SecureStore.getItemAsync(sec("exa"))
    if (exa) prefs.exaKey = exa
    const e2b = await SecureStore.getItemAsync(sec("e2b"))
    if (e2b) prefs.e2bKey = e2b
    current = JSON.stringify(prefs)
  } catch {
    current = raw
  }
}

function persist(value: string) {
  try {
    const prefs = JSON.parse(value) as PrefsShape
    for (const p of prefs.profiles ?? []) {
      void SecureStore.setItemAsync(sec(`profile-${p.id}`), p.apiKey ?? "")
    }
    void SecureStore.setItemAsync(sec("exa"), prefs.exaKey ?? "")
    void SecureStore.setItemAsync(sec("e2b"), prefs.e2bKey ?? "")
    const redacted: PrefsShape = {
      ...prefs,
      profiles: (prefs.profiles ?? []).map((p) => ({ ...p, apiKey: "" })),
    }
    delete redacted.exaKey
    delete redacted.e2bKey
    void AsyncStorage.setItem(PREFS_KEY, JSON.stringify(redacted))
  } catch {
    void AsyncStorage.setItem(PREFS_KEY, value)
  }
}

export const prefsPort = {
  get: () => current,
  set: (v: string) => {
    current = v
    persist(v)
  },
}
