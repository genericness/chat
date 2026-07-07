import { runSync, scheduleSync } from "@chat/core"

import { db } from "@/lib/db"

// The sync algorithm lives in @chat/core; this shell owns the web triggers.
export { runSync, scheduleSync } from "@chat/core"

/** Call once on boot: mutation hooks + focus/poll triggers + initial run. */
export function initSync() {
  for (const table of [db.conversations, db.messages]) {
    table.hook("creating", () => scheduleSync())
    table.hook("updating", () => scheduleSync())
    table.hook("deleting", () => scheduleSync())
  }
  window.addEventListener("focus", () => scheduleSync(500))
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleSync(500)
  })
  // Poll while the tab is visible so remote changes (new chats, deletions from
  // other devices) arrive without needing a focus event or a local edit.
  window.setInterval(() => {
    if (document.visibilityState === "visible") void runSync()
  }, 30_000)
  scheduleSync(1000)
}
