// Export / import chats as portable files. Everything is local (Dexie); this
// is a serializer + a download/upload, so users can back up or move history
// without our sync. Two formats: JSON (round-trips everything) and Markdown
// (a readable transcript, export-only).
import { db, type Conversation, type Message } from "@/lib/db"

const FORMAT = "chat-export/v1"

interface ExportedAttachment {
  id: string
  name: string
  mime: string
  /** base64 of the blob */
  data: string
}

interface ExportBundle {
  format: typeof FORMAT
  conversation: Conversation
  messages: Message[]
  attachments: ExportedAttachment[]
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let bin = ""
  for (const b of buf) bin += String.fromCharCode(b)
  return btoa(bin)
}

function base64ToBlob(data: string, mime: string): Blob {
  const bin = atob(data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

async function loadBundle(convId: string): Promise<ExportBundle> {
  const conversation = await db.conversations.get(convId)
  if (!conversation) throw new Error("conversation not found")
  const messages = await db.messages.where("convId").equals(convId).sortBy("seq")
  const atts = await db.attachments.where("convId").equals(convId).toArray()
  const attachments = await Promise.all(
    atts.map(async (a) => ({
      id: a.id,
      name: a.name,
      mime: a.mime,
      data: await blobToBase64(a.blob),
    }))
  )
  return { format: FORMAT, conversation, messages, attachments }
}

function toMarkdown(conv: Conversation, messages: Message[]): string {
  const lines = [`# ${conv.title}`, ""]
  for (const m of messages) {
    if (!m.active || !m.content) continue
    lines.push(m.role === "user" ? "## You" : `## Assistant${m.model ? ` (${m.model})` : ""}`)
    lines.push("", m.content, "")
  }
  return lines.join("\n")
}

function safeName(title: string): string {
  return (title.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "chat").replace(/\s+/g, "-")
}

async function save(name: string, text: string, mime: string) {
  // Native gets the OS share sheet; the import.meta.env literal keeps
  // Capacitor out of web bundles (see api-base.ts / native.ts).
  if (import.meta.env.VITE_API_BASE) {
    const { shareFile } = await import("@/lib/native")
    await shareFile(name, text)
    return
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export async function exportChatJson(convId: string) {
  const bundle = await loadBundle(convId)
  await save(`${safeName(bundle.conversation.title)}.json`, JSON.stringify(bundle), "application/json")
}

export async function exportChatMarkdown(convId: string) {
  const bundle = await loadBundle(convId)
  await save(
    `${safeName(bundle.conversation.title)}.md`,
    toMarkdown(bundle.conversation, bundle.messages),
    "text/markdown"
  )
}

/** Import a v1 bundle under a fresh conversation id (never clobbers an existing chat). */
export async function importChatJson(text: string): Promise<string> {
  const bundle = JSON.parse(text) as ExportBundle
  if (bundle.format !== FORMAT || !bundle.conversation || !Array.isArray(bundle.messages)) {
    throw new Error("Not a chat export file")
  }
  const now = Date.now()
  const newConvId = crypto.randomUUID()
  // Attachments get fresh ids too, remapped into the messages that reference them.
  const attIdMap = new Map<string, string>()
  for (const a of bundle.attachments ?? []) attIdMap.set(a.id, crypto.randomUUID())

  await db.transaction("rw", db.conversations, db.messages, db.attachments, async () => {
    await db.conversations.add({
      ...bundle.conversation,
      id: newConvId,
      title: bundle.conversation.title || "Imported chat",
      createdAt: now,
      updatedAt: now,
      deletedAt: undefined,
    })
    await db.messages.bulkAdd(
      bundle.messages.map((m) => ({
        ...m,
        id: crypto.randomUUID(),
        convId: newConvId,
        attachmentIds: m.attachmentIds?.map((id) => attIdMap.get(id) ?? id),
      }))
    )
    await db.attachments.bulkAdd(
      (bundle.attachments ?? []).map((a) => ({
        id: attIdMap.get(a.id)!,
        convId: newConvId,
        name: a.name,
        mime: a.mime,
        blob: base64ToBlob(a.data, a.mime),
        createdAt: now,
      }))
    )
  })
  return newConvId
}

/** Opens a file picker and imports the chosen JSON export. Resolves to the new id. */
export function pickAndImportChat(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "application/json,.json"
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      try {
        resolve(await importChatJson(await file.text()))
      } catch (e) {
        reject(e)
      }
    }
    input.click()
  })
}
