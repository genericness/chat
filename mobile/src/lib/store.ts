// SQLite implementation of @chat/core's CoreStore port.
// Contract notes (see core/store.ts): patch keys explicitly set to undefined
// CLEAR the stored field (mapped to NULL here), and writes apply in call
// order (single expo-sqlite connection — do not add write pooling).
import type { AttachmentMeta, Conversation, CoreStore, Message } from "@chat/core"
import { asc, eq, inArray, max } from "drizzle-orm"

import { attachments, conversations, db, messages } from "./db"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Db = typeof db | Tx

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = ""
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

type ConvRow = typeof conversations.$inferSelect
type MsgRow = typeof messages.$inferSelect
type AttRow = typeof attachments.$inferSelect

function rowToConversation(r: ConvRow): Conversation {
  return {
    id: r.id,
    title: r.title,
    systemPrompt: r.systemPrompt ?? undefined,
    settings: (r.settings as Conversation["settings"]) ?? undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt ?? undefined,
  }
}

function conversationToRow(c: Conversation): ConvRow {
  return {
    id: c.id,
    title: c.title,
    systemPrompt: c.systemPrompt ?? null,
    settings: c.settings ?? null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    deletedAt: c.deletedAt ?? null,
  }
}

export function rowToMessage(r: MsgRow): Message {
  return {
    id: r.id,
    convId: r.convId,
    seq: r.seq,
    role: r.role as Message["role"],
    content: r.content,
    attachmentIds: (r.attachmentIds as string[] | null) ?? undefined,
    searchResults: (r.searchResults as Message["searchResults"] | null) ?? undefined,
    model: r.model ?? undefined,
    profileId: r.profileId ?? undefined,
    replyTo: r.replyTo ?? undefined,
    reasoning: r.reasoning ?? undefined,
    toolCalls: (r.toolCalls as Message["toolCalls"] | null) ?? undefined,
    artifacts: (r.artifacts as Message["artifacts"] | null) ?? undefined,
    pendingQuestion: (r.pendingQuestion as Message["pendingQuestion"] | null) ?? undefined,
    stats: (r.stats as Message["stats"] | null) ?? undefined,
    active: r.active,
    status: r.status as Message["status"],
    error: r.error ?? undefined,
    createdAt: r.createdAt,
  }
}

function messageToRow(m: Message): MsgRow {
  return {
    id: m.id,
    convId: m.convId,
    seq: m.seq,
    role: m.role,
    content: m.content,
    attachmentIds: m.attachmentIds ?? null,
    searchResults: m.searchResults ?? null,
    model: m.model ?? null,
    profileId: m.profileId ?? null,
    replyTo: m.replyTo ?? null,
    reasoning: m.reasoning ?? null,
    toolCalls: m.toolCalls ?? null,
    artifacts: m.artifacts ?? null,
    pendingQuestion: m.pendingQuestion ?? null,
    stats: m.stats ?? null,
    active: m.active,
    status: m.status,
    error: m.error ?? null,
    createdAt: m.createdAt,
  }
}

// Model keys map 1:1 onto drizzle column property names (both camelCase).
const MSG_KEYS = new Set([
  "id", "convId", "seq", "role", "content", "attachmentIds", "searchResults",
  "model", "profileId", "replyTo", "reasoning", "toolCalls", "artifacts",
  "pendingQuestion", "stats", "active", "status", "error", "createdAt",
])
const CONV_KEYS = new Set([
  "id", "title", "systemPrompt", "settings", "createdAt", "updatedAt", "deletedAt",
])

/** undefined patch values become NULL — Dexie-style "clear the field". */
function patchToSet<Row>(patch: Record<string, unknown>, keys: Set<string>) {
  const set: Record<string, unknown> = {}
  for (const k of Object.keys(patch)) {
    if (keys.has(k)) set[k] = patch[k] ?? null
  }
  return set as Partial<Row>
}

function toMeta(r: Omit<AttRow, "data">): AttachmentMeta {
  return {
    id: r.id,
    convId: r.convId,
    name: r.name,
    mime: r.mime,
    size: r.size,
    createdAt: r.createdAt,
    syncedAt: r.syncedAt ?? undefined,
  }
}

async function attData(d: Db, id: string): Promise<AttRow> {
  const [row] = await d.select().from(attachments).where(eq(attachments.id, id))
  if (!row) throw new Error(`attachment ${id} is missing`)
  return row
}

function makeStore(d: Db): CoreStore {
  const store: CoreStore = {
    conversations: {
      get: async (id) => {
        const [row] = await d.select().from(conversations).where(eq(conversations.id, id))
        return row && rowToConversation(row)
      },
      put: async (c) => {
        const row = conversationToRow(c)
        await d.insert(conversations).values(row).onConflictDoUpdate({
          target: conversations.id,
          set: row,
        })
      },
      update: async (id, patch) => {
        await d
          .update(conversations)
          .set(patchToSet<ConvRow>(patch as Record<string, unknown>, CONV_KEYS))
          .where(eq(conversations.id, id))
      },
      delete: async (id) => {
        await d.delete(conversations).where(eq(conversations.id, id))
      },
      all: async () => (await d.select().from(conversations)).map(rowToConversation),
    },
    messages: {
      get: async (id) => {
        const [row] = await d.select().from(messages).where(eq(messages.id, id))
        return row && rowToMessage(row)
      },
      add: async (m) => {
        await d.insert(messages).values(messageToRow(m))
      },
      update: async (id, patch) => {
        await d
          .update(messages)
          .set(patchToSet<MsgRow>(patch as Record<string, unknown>, MSG_KEYS))
          .where(eq(messages.id, id))
      },
      bulkPut: async (ms) => {
        for (const m of ms) {
          const row = messageToRow(m)
          await d.insert(messages).values(row).onConflictDoUpdate({
            target: messages.id,
            set: row,
          })
        }
      },
      bulkDelete: async (ids) => {
        if (ids.length) await d.delete(messages).where(inArray(messages.id, ids))
      },
      byConv: async (convId) =>
        (
          await d.select().from(messages).where(eq(messages.convId, convId)).orderBy(asc(messages.seq))
        ).map(rowToMessage),
      byReplyTo: async (replyTo) =>
        (await d.select().from(messages).where(eq(messages.replyTo, replyTo))).map(rowToMessage),
      streaming: async () =>
        (await d.select().from(messages).where(eq(messages.status, "streaming"))).map(rowToMessage),
      deleteByConv: async (convId) => {
        await d.delete(messages).where(eq(messages.convId, convId))
      },
      lastSeq: async (convId) => {
        const [row] = await d
          .select({ last: max(messages.seq) })
          .from(messages)
          .where(eq(messages.convId, convId))
        return row?.last ?? undefined
      },
    },
    attachments: {
      add: async (meta, data) => {
        const b64 = String(data)
        await d.insert(attachments).values({
          id: meta.id,
          convId: meta.convId,
          name: meta.name,
          mime: meta.mime,
          size: b64ToBytes(b64).length,
          data: b64,
          createdAt: meta.createdAt,
          syncedAt: meta.syncedAt ?? null,
        })
      },
      meta: async (id) => {
        const [row] = await d
          .select({
            id: attachments.id,
            convId: attachments.convId,
            name: attachments.name,
            mime: attachments.mime,
            size: attachments.size,
            createdAt: attachments.createdAt,
            syncedAt: attachments.syncedAt,
          })
          .from(attachments)
          .where(eq(attachments.id, id))
        return row && toMeta(row)
      },
      metaByConv: async (convId) =>
        (
          await d
            .select({
              id: attachments.id,
              convId: attachments.convId,
              name: attachments.name,
              mime: attachments.mime,
              size: attachments.size,
              createdAt: attachments.createdAt,
              syncedAt: attachments.syncedAt,
            })
            .from(attachments)
            .where(eq(attachments.convId, convId))
        ).map(toMeta),
      asDataUrl: async (id) => {
        const row = await attData(d, id)
        return `data:${row.mime};base64,${row.data}`
      },
      asText: async (id) => {
        const row = await attData(d, id)
        return new TextDecoder().decode(b64ToBytes(row.data))
      },
      // RN's BodyInit type omits BufferSource, but expo/fetch accepts Uint8Array.
      body: async (id) => b64ToBytes((await attData(d, id)).data) as unknown as BodyInit,
      putFromDownload: async (meta, res) => {
        const bytes = new Uint8Array(await res.arrayBuffer())
        const row = {
          id: meta.id,
          convId: meta.convId,
          name: meta.name,
          mime: meta.mime,
          size: bytes.length,
          data: bytesToB64(bytes),
          createdAt: meta.createdAt,
          syncedAt: meta.syncedAt ?? null,
        }
        await d.insert(attachments).values(row).onConflictDoUpdate({
          target: attachments.id,
          set: row,
        })
      },
      markSynced: async (id) => {
        await d.update(attachments).set({ syncedAt: Date.now() }).where(eq(attachments.id, id))
      },
      bulkDelete: async (ids) => {
        if (ids.length) await d.delete(attachments).where(inArray(attachments.id, ids))
      },
      deleteByConv: async (convId) => {
        await d.delete(attachments).where(eq(attachments.convId, convId))
      },
    },
    transaction: async (fn) => {
      if (d !== db) return fn(store) // already inside a transaction — reuse it
      await db.transaction(async (tx) => fn(makeStore(tx)))
    },
  }
  return store
}

export const mobileStore = makeStore(db)
