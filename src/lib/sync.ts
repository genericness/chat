import { apiFetch } from "@/lib/api-base"
import {
  artifactHeadsFromMessages,
  db,
  type Conversation,
  type Message,
} from "@/lib/db"
import { getPrefs, setPrefs } from "@/lib/profiles"

// Opt-in, conversation-granularity, last-write-wins by updatedAt.
// Profiles and API keys never leave localStorage.

let timer: number | undefined
let running = false
let applying = 0 // suppress re-scheduling while concurrent pulls write local data

export function scheduleSync(delayMs = 15_000) {
  if (!getPrefs().syncEnabled || applying > 0) return
  window.clearTimeout(timer)
  timer = window.setTimeout(() => void runSync(), delayMs)
}

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
const ATTACHMENT_CONCURRENCY = 3
const CONVERSATION_CONCURRENCY = 3

async function forEachConcurrent<T>(
  values: readonly T[],
  limit: number,
  fn: (value: T) => Promise<void>
) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    for (;;) {
      const index = next++
      if (index >= values.length) return
      await fn(values[index])
    }
  })
  const results = await Promise.allSettled(workers)
  const failed = results.find((result) => result.status === "rejected")
  if (failed?.status === "rejected") throw failed.reason
}

async function pushAttachments(convId: string) {
  const atts = await db.attachments.where("convId").equals(convId).toArray()
  const pending = atts.filter((a) => !a.syncedAt && a.blob.size <= MAX_ATTACHMENT_BYTES)
  await forEachConcurrent(pending, ATTACHMENT_CONCURRENCY, async (a) => {
    const res = await apiFetch(`/api/sync/attachments/${a.id}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": a.mime, "x-attachment-name": a.name },
      body: a.blob,
    })
    if (res.ok) await db.attachments.update(a.id, { syncedAt: Date.now() })
  })
}

async function pullAttachments(convId: string, messages: Message[]) {
  const wanted = [...new Set(messages.flatMap((m) => m.attachmentIds ?? []))]
  const existing = await db.attachments.bulkGet(wanted)
  const missing = wanted.filter((_, i) => existing[i] === undefined)
  await forEachConcurrent(missing, ATTACHMENT_CONCURRENCY, async (id) => {
    const res = await apiFetch(`/api/sync/attachments/${id}`, { credentials: "same-origin" })
    if (!res.ok) return // not uploaded (e.g. over cap on the other device)
    await db.attachments.put({
      id,
      convId,
      name: res.headers.get("x-attachment-name") ?? "attachment",
      mime: res.headers.get("content-type") ?? "application/octet-stream",
      blob: await res.blob(),
      createdAt: Date.now(),
      syncedAt: Date.now(),
    })
  })
}

async function push(conv: Conversation) {
  // D1 caps rows at ~2MB. Serialize each message once, then assemble the JSON
  // envelope from those strings so giant artifacts are not traversed twice.
  const rows = await db.messages.where("convId").equals(conv.id).sortBy("seq")
  const messages: string[] = []
  for (const message of rows) {
    const json = JSON.stringify(message)
    if (json.length < 1_500_000) messages.push(json)
  }
  const body = `{"conversation":${JSON.stringify(conv)},"messages":[${messages.join(",")}]}`
  const res = await apiFetch(`/api/sync/chats/${conv.id}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body,
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
  applying++
  try {
    let applied = false
    await db.transaction(
      "rw",
      db.conversations,
      db.messages,
      db.artifactHeads,
      async () => {
        // Never clobber a conversation that is generating right now.
        const busy = await db.messages
          .where("[convId+status]")
          .equals([id, "streaming"])
          .count()
        if (busy > 0) return
        applied = true
        await db.conversations.put(conversation)
        await db.messages.where("convId").equals(id).delete()
        if (messages.length) await db.messages.bulkPut(messages)
        await db.artifactHeads.where("convId").equals(id).delete()
        const heads = artifactHeadsFromMessages(messages)
        if (heads.length) await db.artifactHeads.bulkPut(heads)
      }
    )
    if (applied) await pullAttachments(id, messages)
  } finally {
    applying--
  }
}

async function deleteRemoteConversation(id: string) {
  applying++
  try {
    await db.transaction(
      "rw",
      db.conversations,
      db.messages,
      db.attachments,
      db.artifactHeads,
      async () => {
        await db.messages.where("convId").equals(id).delete()
        await db.attachments.where("convId").equals(id).delete()
        await db.artifactHeads.where("convId").equals(id).delete()
        await db.conversations.delete(id)
      }
    )
  } finally {
    applying--
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

    await forEachConcurrent(local, CONVERSATION_CONCURRENCY, async (conv) => {
      const r = remote.get(conv.id)
      if (conv.deletedAt) {
        let confirmed = true
        if (r && !r.deleted) {
          const response = await apiFetch(`/api/sync/chats/${conv.id}`, {
            method: "DELETE",
            credentials: "same-origin",
          })
          confirmed = response.ok // keep the tombstone to retry if the server didn't take it
        }
        if (confirmed) await deleteRemoteConversation(conv.id)
        return
      }
      if (r?.deleted) return // remote tombstone wins; the second phase removes local data
      if (!r || conv.updatedAt > r.updatedAt) await push(conv)
    })

    await forEachConcurrent([...remote], CONVERSATION_CONCURRENCY, async ([id, r]) => {
      const localConversation = localById.get(id)
      if (r.deleted) {
        if (localConversation && !localConversation.deletedAt) {
          await deleteRemoteConversation(id)
        }
        return
      }
      if (!localConversation || r.updatedAt > localConversation.updatedAt) await pull(id)
    })
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
