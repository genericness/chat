import { coreFetch, store } from "./config"
import type { Conversation, Message } from "./db-types"
import { getPrefs, setPrefs } from "./profiles"

// Opt-in, conversation-granularity, last-write-wins by updatedAt.
// Profiles and API keys never leave the device.
// The platform owns the triggers (web: Dexie hooks + focus/visibility;
// mobile: AppState + store write notifications) and calls scheduleSync/runSync;
// the algorithm and the applying/running guards live here.

let timer: ReturnType<typeof setTimeout> | undefined
let running = false
let applying = false // suppress re-scheduling while we write pulled data

export function scheduleSync(delayMs = 15_000) {
  if (!getPrefs().syncEnabled || applying) return
  clearTimeout(timer)
  timer = setTimeout(() => void runSync(), delayMs)
}

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024

async function pushAttachments(convId: string) {
  for (const a of await store().attachments.metaByConv(convId)) {
    if (a.syncedAt) continue
    if (a.size > MAX_ATTACHMENT_BYTES) continue // over the 8MB cap: stays local-only
    const res = await coreFetch(`/api/sync/attachments/${a.id}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": a.mime, "x-attachment-name": a.name },
      body: await store().attachments.body(a.id),
    })
    if (res.ok) await store().attachments.markSynced(a.id)
  }
}

async function pullAttachments(convId: string, messages: Message[]) {
  const wanted = messages.flatMap((m) => m.attachmentIds ?? [])
  for (const id of wanted) {
    if (await store().attachments.meta(id)) continue
    const res = await coreFetch(`/api/sync/attachments/${id}`, { credentials: "same-origin" })
    if (!res.ok) continue // not uploaded (e.g. over cap on the other device)
    await store().attachments.putFromDownload(
      {
        id,
        convId,
        name: res.headers.get("x-attachment-name") ?? "attachment",
        mime: res.headers.get("content-type") ?? "application/octet-stream",
        createdAt: Date.now(),
        syncedAt: Date.now(),
      },
      res
    )
  }
}

async function push(conv: Conversation) {
  // D1 caps rows at ~2MB; drop oversized messages (giant artifacts/pastes)
  // from sync rather than failing the whole conversation.
  const messages = (await store().messages.byConv(conv.id)).filter(
    (m) => JSON.stringify(m).length < 1_500_000
  )
  const res = await coreFetch(`/api/sync/chats/${conv.id}`, {
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
  const res = await coreFetch(`/api/sync/chats/${id}`, { credentials: "same-origin" })
  if (!res.ok) return
  const { conversation, messages } = (await res.json()) as {
    conversation: Conversation
    messages: Message[]
  }
  applying = true
  try {
    await store().transaction(async (s) => {
      // Never clobber a conversation that is generating right now.
      const busy = (await s.messages.streaming()).filter((m) => m.convId === id).length
      if (busy > 0) return
      await s.conversations.put(conversation)
      await s.messages.deleteByConv(id)
      await s.messages.bulkPut(messages)
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
    const res = await coreFetch("/api/sync/manifest", { credentials: "same-origin" })
    if (res.status === 401) {
      // Signed out: sync stays enabled in prefs but cannot run.
      return
    }
    if (!res.ok) return
    const { items } = (await res.json()) as {
      items: { id: string; updatedAt: number; deleted: boolean }[]
    }
    const remote = new Map(items.map((i) => [i.id, i]))
    const local = await store().conversations.all()
    const localById = new Map(local.map((c) => [c.id, c]))

    for (const conv of local) {
      const r = remote.get(conv.id)
      if (conv.deletedAt) {
        let confirmed = true
        if (r && !r.deleted) {
          const res = await coreFetch(`/api/sync/chats/${conv.id}`, {
            method: "DELETE",
            credentials: "same-origin",
          })
          confirmed = res.ok // keep the tombstone to retry if the server didn't take it
        }
        if (confirmed) await store().conversations.delete(conv.id)
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
            await store().transaction(async (s) => {
              await s.messages.deleteByConv(id)
              await s.attachments.deleteByConv(id)
              await s.conversations.delete(id)
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
