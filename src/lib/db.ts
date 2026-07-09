import Dexie, { type EntityTable } from "dexie"

export interface ConversationSettings {
  temperature?: number
  maxTokens?: number
  model?: string
  profileId?: string
}

export interface Conversation {
  id: string
  title: string
  systemPrompt?: string
  settings?: ConversationSettings
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export interface SearchResult {
  title: string
  url: string
  text: string
}

export type MessageStatus = "streaming" | "done" | "stopped" | "error"

export interface ToolCallRecord {
  id: string
  name: string
  args: string
  /** streaming = arguments still being generated; running = executing */
  status: "streaming" | "running" | "done" | "error"
}

export interface MessageStats {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  /** Wall-clock generation time in milliseconds. */
  durationMs: number
}

/** Full artifact state as of this message — latest snapshot in the thread wins. */
export interface ArtifactSnapshot {
  artifactId: string
  title: string
  /** Rendered preview document (for multi-file builds, the bundled output). */
  html: string
  /** Source tree for the code browser (present for built multi-file artifacts). */
  files?: { path: string; content: string }[]
}

export interface PendingQuestion {
  toolCallId: string
  question: string
  options?: string[]
  multiple?: boolean
}

export interface Message {
  id: string
  convId: string
  seq: number
  role: "user" | "assistant"
  content: string
  attachmentIds?: string[]
  searchResults?: SearchResult[]
  model?: string
  profileId?: string
  replyTo?: string
  reasoning?: string
  toolCalls?: ToolCallRecord[]
  artifacts?: ArtifactSnapshot[]
  pendingQuestion?: PendingQuestion
  stats?: MessageStats
  active: boolean
  status: MessageStatus
  error?: string
  createdAt: number
}

export interface Attachment {
  id: string
  convId: string
  name: string
  mime: string
  blob: Blob
  createdAt: number
  syncedAt?: number
}

/** Derived pointer to the newest snapshot of one artifact in a conversation. */
export interface ArtifactHead {
  key: string
  convId: string
  artifactId: string
  messageId: string
  seq: number
}

export const db = new Dexie("chat") as Dexie & {
  conversations: EntityTable<Conversation, "id">
  messages: EntityTable<Message, "id">
  attachments: EntityTable<Attachment, "id">
  artifactHeads: EntityTable<ArtifactHead, "key">
}

db.version(1).stores({
  conversations: "id, updatedAt",
  messages: "id, convId, [convId+seq], replyTo, status",
  attachments: "id, convId",
})

export function artifactHeadKey(convId: string, artifactId: string): string {
  return `${convId}\u0000${artifactId}`
}

export function artifactHeadsFromMessages(messages: Message[]): ArtifactHead[] {
  const heads = new Map<string, ArtifactHead>()
  for (const message of messages) {
    for (const snapshot of message.artifacts ?? []) {
      const key = artifactHeadKey(message.convId, snapshot.artifactId)
      const current = heads.get(key)
      if (!current || message.seq >= current.seq) {
        heads.set(key, {
          key,
          convId: message.convId,
          artifactId: snapshot.artifactId,
          messageId: message.id,
          seq: message.seq,
        })
      }
    }
  }
  return [...heads.values()]
}

db.version(2)
  .stores({
    conversations: "id, updatedAt",
    messages: "id, convId, [convId+seq], replyTo, status, [convId+status]",
    attachments: "id, convId",
    artifactHeads: "key, convId, [convId+artifactId], messageId, seq",
  })
  .upgrade(async (tx) => {
    const messages = await tx.table<Message>("messages").toArray()
    const heads = artifactHeadsFromMessages(messages)
    if (heads.length) await tx.table<ArtifactHead>("artifactHeads").bulkPut(heads)
  })

export async function rebuildArtifactHeads(convId: string, messages?: Message[]) {
  const rows =
    messages ??
    (await db.messages
      .where("[convId+seq]")
      .between([convId, Dexie.minKey], [convId, Dexie.maxKey])
      .toArray())
  const heads = artifactHeadsFromMessages(rows)
  await db.transaction("rw", db.artifactHeads, async () => {
    await db.artifactHeads.where("convId").equals(convId).delete()
    if (heads.length) await db.artifactHeads.bulkPut(heads)
  })
}

export function autoTitle(text: string): string {
  const line = text.trim().split("\n")[0]
  return line.length > 60 ? `${line.slice(0, 60)}…` : line || "New chat"
}

export async function createConversation(firstText: string): Promise<Conversation> {
  const now = Date.now()
  const conv: Conversation = {
    id: crypto.randomUUID(),
    title: autoTitle(firstText),
    createdAt: now,
    updatedAt: now,
  }
  await db.conversations.add(conv)
  return conv
}

export async function touchConversation(id: string) {
  await db.conversations.update(id, { updatedAt: Date.now() })
}

export async function renameConversation(id: string, title: string) {
  await db.conversations.update(id, { title, updatedAt: Date.now() })
}

export async function deleteConversation(id: string) {
  // With sync on, keep a tombstone row so the delete propagates; the sync
  // loop purges it after telling the server.
  const { getPrefs } = await import("@/lib/profiles")
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
      if (getPrefs().syncEnabled) {
        await db.conversations.update(id, { deletedAt: Date.now(), updatedAt: Date.now() })
      } else {
        await db.conversations.delete(id)
      }
    }
  )
}

/** Delete every conversation (tombstoning each when sync is on so it propagates). */
export async function deleteAllConversations() {
  const convs = await db.conversations.filter((c) => !c.deletedAt).toArray()
  for (const c of convs) await deleteConversation(c.id)
  return convs.length
}

export async function nextSeq(convId: string): Promise<number> {
  const last = await db.messages.where("[convId+seq]").between([convId, Dexie.minKey], [convId, Dexie.maxKey]).last()
  return (last?.seq ?? -1) + 1
}

/** Make one reply the active branch among all siblings answering the same user message. */
export async function promoteReply(msgId: string) {
  const msg = await db.messages.get(msgId)
  if (!msg?.replyTo) return
  await db.transaction("rw", db.messages, async () => {
    await db.messages.where("replyTo").equals(msg.replyTo!).modify({ active: false })
    await db.messages.update(msgId, { active: true })
  })
}

/** Recover messages stranded in "streaming" by a closed tab. Run once on boot. */
export async function runJanitor() {
  await db.messages.where("status").equals("streaming").modify({ status: "stopped" })
}
