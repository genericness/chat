import { apiFetch } from "@/lib/api-base"
import { db, type Conversation, type Message } from "@/lib/db"
import { getPrefs, setPrefs } from "@/lib/profiles"

// Opt-in, conversation-granularity, last-write-wins by updatedAt.
// Profiles and API keys never leave localStorage.

let timer: number | undefined
let running = false
let applying = false // suppress re-scheduling while we write pulled data

export function scheduleSync(delayMs = 15_000) {
  if (!getPrefs().syncEnabled || applying) return
  window.clearTimeout(timer)
  timer = window.setTimeout(() => void runSync(), delayMs)
}

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024

async function pushAttachments(convId: string) {
  const atts = await db.attachments.where("convId").equals(convId).toArray()
  for (const a of atts) {
    if (a.syncedAt) continue
    if (a.blob.size > MAX_ATTACHMENT_BYTES) continue // over the 8MB cap: stays local-only
    const res = await apiFetch(`/api/sync/attachments/${a.id}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": a.mime, "x-attachment-name": a.name },
      body: a.blob,
    })
    if (res.ok) await db.attachments.update(a.id, { syncedAt: Date.now() })
  }
}

async function pullAttachments(convId: string, messages: Message[]) {
  const wanted = messages.flatMap((m) => m.attachmentIds ?? [])
  for (const id of wanted) {
    if (await db.attachments.get(id)) continue
    const res = await apiFetch(`/api/sync/attachments/${id}`, { credentials: "same-origin" })
    if (!res.ok) continue // not uploaded (e.g. over cap on the other device)
    await db.attachments.put({
      id,
      convId,
      name: res.headers.get("x-attachment-name") ?? "attachment",
      mime: res.headers.get("content-type") ?? "application/octet-stream",
      blob: await res.blob(),
      createdAt: Date.now(),
      syncedAt: Date.now(),
    })
  }
}

async function push(conv: Conversation) {
  // D1 caps rows at ~2MB; drop oversized messages (giant artifacts/pastes)
  // from sync rather than failing the whole conversation.
  const messages = (await db.messages.where("convId").equals(conv.id).sortBy("seq")).filter(
    (m) => JSON.stringify(m).length < 1_500_000
  )
  const res = await apiFetch(`/api/sync/chats/${conv.id}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversation: conv, messages }),
  })
  if (res.status === 409) {
    await pull(conv.id) // remote is newer — take it
    return
  }
  if (res.ok) await pushAttachments(conv.id)
}

async function pull(id: string) {
  const res = await apiFetch(`/api/sync/chats/${id}`, { credentials: "same-origin" })
  if (!res.ok) return
  const { conversation, messages } = (await res.json()) as {
    conversation: Conversation
    messages: Message[]
  }
  applying = true
  try {
    await db.transaction("rw", db.conversations, db.messages, async () => {
      // Never clobber a conversation that is generating right now.
      const busy = await db.messages
        .where("status")
        .equals("streaming")
        .filter((m) => m.convId === id)
        .count()
      if (busy > 0) return
      await db.conversations.put(conversation)
      await db.messages.where("convId").equals(id).delete()
      await db.messages.bulkPut(messages)
    })
    await pullAttachments(id, messages)
  } finally {
    applying = false
  }
}

export async function runSync(): Promise<void> {
  if (running || !getPrefs().syncEnabled) return
  running = true
  try {
    const res = await apiFetch("/api/sync/manifest", { credentials: "same-origin" })
    if (res.status === 401) {
      // Signed out: sync stays enabled in prefs but cannot run.
      return
    }
    if (!res.ok) return
    const { items } = (await res.json()) as {
      items: { id: string; updatedAt: number; deleted: boolean }[]
    }
    const remote = new Map(items.map((i) => [i.id, i]))
    const local = await db.conversations.toArray()
    const localById = new Map(local.map((c) => [c.id, c]))

    for (const conv of local) {
      const r = remote.get(conv.id)
      if (conv.deletedAt) {
        let confirmed = true
        if (r && !r.deleted) {
          const res = await apiFetch(`/api/sync/chats/${conv.id}`, {
            method: "DELETE",
            credentials: "same-origin",
          })
          confirmed = res.ok // keep the tombstone to retry if the server didn't take it
        }
        if (confirmed) await db.conversations.delete(conv.id)
        continue
      }
      if (!r || conv.updatedAt > r.updatedAt) await push(conv)
    }

    for (const [id, r] of remote) {
      const l = localById.get(id)
      if (r.deleted) {
        if (l && !l.deletedAt) {
          applying = true
          try {
            await db.transaction("rw", db.conversations, db.messages, db.attachments, async () => {
              await db.messages.where("convId").equals(id).delete()
              await db.attachments.where("convId").equals(id).delete()
              await db.conversations.delete(id)
            })
          } finally {
            applying = false
          }
        }
        continue
      }
      if (!l || r.updatedAt > l.updatedAt) await pull(id)
    }
    setPrefs({ lastSyncAt: Date.now() })
  } finally {
    running = false
  }
}

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
