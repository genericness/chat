// Wires the web platform into @chat/core. Must be the first app import in
// main.tsx so configureCore runs before anything touches prefs or the store.
import { configureCore } from "@chat/core"

import { PREFS_KEY } from "@/lib/profiles"

configureCore({
  prefs: {
    get: () => localStorage.getItem(PREFS_KEY),
    set: (v) => localStorage.setItem(PREFS_KEY, v),
  },
})
