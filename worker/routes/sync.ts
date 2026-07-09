import { Hono, type Context } from "hono"
import type { AppEnv } from "../types"
import { requireAuth } from "../middleware/require-auth"
import { checkRateLimit, clientIp } from "../lib/rate-limit"

interface SyncConversation {
  id: string
  title: string
  updatedAt: number
  [key: string]: unknown
}

interface SyncMessage {
  id: string
  seq: number
  [key: string]: unknown
}

// Conversation-granularity sync, last-write-wins by updatedAt. Messages are
// stored one row each (a whole chat in one row would hit D1's 2MB row cap).
const sync = new Hono<AppEnv>()
sync.use("*", requireAuth)
sync.use("*", async (c, next) => {
  const write = !["GET", "HEAD", "OPTIONS"].includes(c.req.method)
  if (write) {
    const user = c.get("user")
    const [userOk, ipOk] = await Promise.all([
      checkRateLimit(c, "sync-write", String(user.id), 120, 60_000),
      checkRateLimit(c, "sync-write-ip", clientIp(c), 240, 60_000),
    ])
    if (!userOk || !ipOk) return c.json({ error: "rate_limited" }, 429)
  }
  await next()
})

const MAX_CHAT_BODY_BYTES = 8 * 1024 * 1024
const MAX_CONVERSATION_BYTES = 64 * 1024
const MAX_MESSAGE_BYTES = 1_500_000
const MAX_MESSAGES = 1_000
const MAX_USER_CHAT_BYTES = 128 * 1024 * 1024
const MAX_USER_CONVERSATIONS = 5_000
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
const MAX_USER_ATTACHMENT_BYTES = 256 * 1024 * 1024
const MAX_USER_ATTACHMENTS = 500
const VALID_ID = /^[A-Za-z0-9_-]{1,128}$/
const encoder = new TextEncoder()

function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength
}

async function readJsonBody(c: Context<AppEnv>) {
  const length = Number(c.req.header("content-length") ?? "0")
  if (Number.isFinite(length) && length > MAX_CHAT_BODY_BYTES) return null
  const raw = await c.req.arrayBuffer()
  if (raw.byteLength > MAX_CHAT_BODY_BYTES) return null
  try {
    return JSON.parse(new TextDecoder().decode(raw)) as unknown
  } catch {
    return undefined
  }
}

function attachmentIds(rows: { msg_json: string }[]): string[] {
  const ids = new Set<string>()
  for (const row of rows) {
    try {
      const value = JSON.parse(row.msg_json) as { attachmentIds?: unknown }
      if (!Array.isArray(value.attachmentIds)) continue
      for (const id of value.attachmentIds) {
        if (typeof id === "string" && VALID_ID.test(id)) ids.add(id)
      }
    } catch {
      // Stored message JSON is expected to be valid; ignore a corrupt row during cleanup.
    }
  }
  return [...ids]
}

async function attachmentIsLinked(db: D1Database, userId: number, id: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS ok
     FROM messages m
     JOIN conversations c ON c.id = m.conv_id
     JOIN json_each(m.msg_json, '$.attachmentIds') a
     WHERE c.user_id = ? AND c.deleted_at IS NULL AND a.value = ?
     LIMIT 1`
  )
    .bind(userId, id)
    .first()
  return !!row
}

async function deleteAttachmentObjects(env: AppEnv["Bindings"], userId: number, ids: string[]) {
  if (!ids.length) return
  await env.MEDIA.delete(ids.map((id) => `${userId}/${id}`))
  const statements: D1PreparedStatement[] = []
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90)
    statements.push(
      env.DB.prepare(
        `DELETE FROM sync_attachments WHERE user_id = ? AND id IN (${chunk.map(() => "?").join(", ")})`
      ).bind(userId, ...chunk)
    )
  }
  await env.DB.batch(statements)
}

sync.get("/manifest", async (c) => {
  const user = c.get("user")
  const rows = await c.env.DB.prepare(
    "SELECT id, updated_at, deleted_at FROM conversations WHERE user_id = ?"
  )
    .bind(user.id)
    .all<{ id: string; updated_at: number; deleted_at: number | null }>()
  return c.json({
    items: rows.results.map((r) => ({
      id: r.id,
      updatedAt: r.updated_at,
      deleted: r.deleted_at !== null,
    })),
  })
})

sync.get("/chats/:id", async (c) => {
  const user = c.get("user")
  const id = c.req.param("id")
  if (!VALID_ID.test(id)) return c.json({ error: "invalid_id" }, 400)
  const conv = await c.env.DB.prepare(
    "SELECT * FROM conversations WHERE id = ? AND user_id = ?"
  )
    .bind(id, user.id)
    .first<{ meta_json: string; deleted_at: number | null }>()
  if (!conv || conv.deleted_at !== null) return c.json({ error: "not_found" }, 404)
  const msgs = await c.env.DB.prepare(
    "SELECT msg_json FROM messages WHERE conv_id = ? ORDER BY seq"
  )
    .bind(id)
    .all<{ msg_json: string }>()
  return c.json({
    conversation: JSON.parse(conv.meta_json),
    messages: msgs.results.map((r) => JSON.parse(r.msg_json)),
  })
})

sync.put("/chats/:id", async (c) => {
  const user = c.get("user")
  const id = c.req.param("id")
  if (!VALID_ID.test(id)) return c.json({ error: "invalid_id" }, 400)
  const parsed = await readJsonBody(c)
  if (parsed === null) return c.json({ error: "too_large" }, 413)
  if (!parsed || typeof parsed !== "object") return c.json({ error: "invalid_json" }, 400)
  const body = parsed as { conversation?: SyncConversation; messages?: SyncMessage[] }
  if (!body.conversation || !Array.isArray(body.messages)) {
    return c.json({ error: "conversation_and_messages_required" }, 400)
  }
  if (body.conversation.id !== id) return c.json({ error: "id_mismatch" }, 400)
  if (
    typeof body.conversation.title !== "string" ||
    body.conversation.title.length > 500 ||
    !Number.isSafeInteger(body.conversation.updatedAt) ||
    jsonBytes(body.conversation) > MAX_CONVERSATION_BYTES ||
    body.messages.length > MAX_MESSAGES
  ) {
    return c.json({ error: "invalid_conversation" }, 400)
  }
  const seenIds = new Set<string>()
  const seenSeq = new Set<number>()
  const serializedMessages: string[] = []
  for (const message of body.messages) {
    const serialized = JSON.stringify(message)
    if (
      !message ||
      typeof message !== "object" ||
      typeof message.id !== "string" ||
      !VALID_ID.test(message.id) ||
      !Number.isSafeInteger(message.seq) ||
      message.seq < 0 ||
      seenIds.has(message.id) ||
      seenSeq.has(message.seq) ||
      message.seq > 1_000_000 ||
      (typeof message.convId === "string" && message.convId !== id) ||
      (message.attachmentIds !== undefined &&
        (!Array.isArray(message.attachmentIds) ||
          message.attachmentIds.length > 20 ||
          message.attachmentIds.some(
            (attachmentId) => typeof attachmentId !== "string" || !VALID_ID.test(attachmentId)
          ))) ||
      encoder.encode(serialized).byteLength > MAX_MESSAGE_BYTES
    ) {
      return c.json({ error: "invalid_message" }, 400)
    }
    seenIds.add(message.id)
    seenSeq.add(message.seq)
    serializedMessages.push(serialized)
  }

  const existing = await c.env.DB.prepare(
    "SELECT user_id, updated_at FROM conversations WHERE id = ?"
  )
    .bind(id)
    .first<{ user_id: number; updated_at: number }>()
  if (existing && existing.user_id !== user.id) return c.json({ error: "forbidden" }, 403)
  if (existing && existing.updated_at > body.conversation.updatedAt) {
    return c.json({ error: "conflict" }, 409)
  }

  // Exclude the conversation being replaced, then add its incoming size. This
  // keeps a single account from growing D1 without bound while still allowing
  // normal last-write-wins replacements at the quota boundary.
  const usage = await c.env.DB.prepare(
    `SELECT
       (SELECT COALESCE(SUM(LENGTH(CAST(c.meta_json AS BLOB))), 0)
          FROM conversations c WHERE c.user_id = ? AND c.id <> ?) +
       (SELECT COALESCE(SUM(LENGTH(CAST(m.msg_json AS BLOB))), 0)
          FROM messages m JOIN conversations c ON c.id = m.conv_id
         WHERE c.user_id = ? AND c.id <> ?) AS used_bytes,
       (SELECT COUNT(*) FROM conversations c WHERE c.user_id = ? AND c.id <> ?) AS conversation_count`
  )
    .bind(user.id, id, user.id, id, user.id, id)
    .first<{ used_bytes: number; conversation_count: number }>()
  const incomingBytes = jsonBytes(body.conversation) + serializedMessages.reduce(
    (total, message) => total + encoder.encode(message).byteLength,
    0
  )
  if (
    (usage?.used_bytes ?? 0) + incomingBytes > MAX_USER_CHAT_BYTES ||
    (usage?.conversation_count ?? 0) + 1 > MAX_USER_CONVERSATIONS
  ) {
    return c.json({ error: "storage_quota_exceeded" }, 413)
  }

  const previousMessages = existing
    ? await c.env.DB.prepare("SELECT msg_json FROM messages WHERE conv_id = ?")
        .bind(id)
        .all<{ msg_json: string }>()
    : { results: [] as { msg_json: string }[] }

  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO conversations (id, user_id, title, meta_json, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         meta_json = excluded.meta_json,
         updated_at = excluded.updated_at,
         deleted_at = NULL`
    ).bind(id, user.id, body.conversation.title, JSON.stringify(body.conversation), body.conversation.updatedAt),
    c.env.DB.prepare("DELETE FROM messages WHERE conv_id = ?").bind(id),
  ]
  // ≤25 rows per INSERT keeps us under D1's 100 bound-params-per-statement cap.
  for (let i = 0; i < body.messages.length; i += 25) {
    const chunk = body.messages.slice(i, i + 25)
    const placeholders = chunk.map(() => "(?, ?, ?, ?)").join(", ")
    const stmt = c.env.DB.prepare(
      `INSERT INTO messages (id, conv_id, seq, msg_json) VALUES ${placeholders}`
    ).bind(
      ...chunk.flatMap((message, offset) => [
        message.id,
        id,
        message.seq,
        serializedMessages[i + offset],
      ])
    )
    stmts.push(stmt)
  }
  await c.env.DB.batch(stmts)
  const previousAttachmentIds = attachmentIds(previousMessages.results)
  const nextAttachmentIds = new Set(
    body.messages.flatMap((message) =>
      Array.isArray(message.attachmentIds)
        ? message.attachmentIds.filter((value): value is string => typeof value === "string")
        : []
    )
  )
  await deleteAttachmentObjects(
    c.env,
    user.id,
    previousAttachmentIds.filter((attachmentId) => !nextAttachmentIds.has(attachmentId))
  )
  return c.json({ ok: true })
})

sync.delete("/chats/:id", async (c) => {
  const user = c.get("user")
  const id = c.req.param("id")
  if (!VALID_ID.test(id)) return c.json({ error: "invalid_id" }, 400)
  const ts = Date.now()

  // Clean up this chat's attachment blobs before dropping its message rows.
  const owned = await c.env.DB.prepare(
    "SELECT 1 FROM conversations WHERE id = ? AND user_id = ?"
  )
    .bind(id, user.id)
    .first()
  if (!owned) return c.json({ error: "not_found" }, 404)
  const msgs = await c.env.DB.prepare("SELECT msg_json FROM messages WHERE conv_id = ?")
    .bind(id)
    .all<{ msg_json: string }>()
  await deleteAttachmentObjects(c.env, user.id, attachmentIds(msgs.results))

  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE conversations SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    ).bind(ts, ts, id, user.id),
    c.env.DB.prepare(
      "DELETE FROM messages WHERE conv_id IN (SELECT id FROM conversations WHERE id = ? AND user_id = ?)"
    ).bind(id, user.id),
  ])
  return c.json({ ok: true })
})

sync.put("/attachments/:id", async (c) => {
  const user = c.get("user")
  const id = c.req.param("id")
  if (!VALID_ID.test(id)) return c.json({ error: "invalid_id" }, 400)
  if (!(await attachmentIsLinked(c.env.DB, user.id, id))) {
    return c.json({ error: "attachment_not_linked" }, 403)
  }
  const declaredLength = Number(c.req.header("content-length") ?? "0")
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ATTACHMENT_BYTES) {
    return c.json({ error: "too_large", maxBytes: MAX_ATTACHMENT_BYTES }, 413)
  }
  const body = await c.req.arrayBuffer()
  if (body.byteLength > MAX_ATTACHMENT_BYTES) {
    return c.json({ error: "too_large", maxBytes: MAX_ATTACHMENT_BYTES }, 413)
  }
  const contentType = c.req.header("content-type") ?? "application/octet-stream"
  const name = c.req.header("x-attachment-name") ?? "attachment"
  if (
    contentType.length > 200 ||
    name.length > 255 ||
    /[\r\n]/.test(contentType) ||
    /[\r\n]/.test(name)
  ) {
    return c.json({ error: "invalid_metadata" }, 400)
  }
  const existing = await c.env.DB.prepare(
    "SELECT size_bytes, created_at FROM sync_attachments WHERE user_id = ? AND id = ?"
  )
    .bind(user.id, id)
    .first<{ size_bytes: number; created_at: number }>()
  const now = Date.now()
  const reservation = crypto.randomUUID()
  const reserved = await c.env.DB.prepare(
    `INSERT INTO sync_attachments
       (user_id, id, size_bytes, created_at, updated_at, reservation_token)
     SELECT ?, ?, ?, ?, ?, ?
     WHERE
       (SELECT COALESCE(SUM(size_bytes), 0) FROM sync_attachments WHERE user_id = ?)
       - COALESCE((SELECT size_bytes FROM sync_attachments WHERE user_id = ? AND id = ?), 0)
       + ? <= ?
       AND
       (SELECT COUNT(*) FROM sync_attachments WHERE user_id = ?)
       + CASE WHEN EXISTS(
           SELECT 1 FROM sync_attachments WHERE user_id = ? AND id = ?
         ) THEN 0 ELSE 1 END <= ?
     ON CONFLICT(user_id, id) DO UPDATE SET
       size_bytes = excluded.size_bytes,
       updated_at = excluded.updated_at,
       reservation_token = excluded.reservation_token
     RETURNING id`
  )
    .bind(
      user.id,
      id,
      body.byteLength,
      existing?.created_at ?? now,
      now,
      reservation,
      user.id,
      user.id,
      id,
      body.byteLength,
      MAX_USER_ATTACHMENT_BYTES,
      user.id,
      user.id,
      id,
      MAX_USER_ATTACHMENTS
    )
    .first()
  if (!reserved) return c.json({ error: "storage_quota_exceeded" }, 413)
  try {
    await c.env.MEDIA.put(`${user.id}/${id}`, body, {
      httpMetadata: { contentType },
      customMetadata: { name },
    })
  } catch (error) {
    if (existing) {
      await c.env.DB.prepare(
        `UPDATE sync_attachments
         SET size_bytes = ?, created_at = ?, updated_at = ?, reservation_token = NULL
         WHERE user_id = ? AND id = ? AND reservation_token = ?`
      )
        .bind(existing.size_bytes, existing.created_at, now, user.id, id, reservation)
        .run()
    } else {
      await c.env.DB.prepare(
        "DELETE FROM sync_attachments WHERE user_id = ? AND id = ? AND reservation_token = ?"
      )
        .bind(user.id, id, reservation)
        .run()
    }
    throw error
  }
  await c.env.DB.prepare(
    `UPDATE sync_attachments SET reservation_token = NULL
     WHERE user_id = ? AND id = ? AND reservation_token = ?`
  )
    .bind(user.id, id, reservation)
    .run()
  return c.json({ ok: true })
})

sync.get("/attachments/:id", async (c) => {
  const user = c.get("user")
  const id = c.req.param("id")
  if (!VALID_ID.test(id)) return c.json({ error: "invalid_id" }, 400)
  if (!(await attachmentIsLinked(c.env.DB, user.id, id))) {
    return c.json({ error: "not_found" }, 404)
  }
  const obj = await c.env.MEDIA.get(`${user.id}/${id}`)
  if (!obj) return c.json({ error: "not_found" }, 404)
  const name = obj.customMetadata?.name ?? "attachment"
  const encodedName = encodeURIComponent(name).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  )
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "x-attachment-name": name,
      // The blob is persisted into IndexedDB by the client. Do not let a shared
      // browser HTTP cache replay it after the signed-in account changes.
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename*=UTF-8''${encodedName}`,
      "content-security-policy": "sandbox; default-src 'none'",
      "x-content-type-options": "nosniff",
    },
  })
})

export default sync
