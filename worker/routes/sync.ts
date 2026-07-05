import { Hono } from "hono"
import type { AppEnv } from "../types"
import { requireAuth } from "../middleware/require-auth"

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
  const body = (await c.req.json()) as {
    conversation: SyncConversation
    messages: SyncMessage[]
  }
  if (body.conversation.id !== id) return c.json({ error: "id_mismatch" }, 400)

  const existing = await c.env.DB.prepare(
    "SELECT user_id, updated_at FROM conversations WHERE id = ?"
  )
    .bind(id)
    .first<{ user_id: number; updated_at: number }>()
  if (existing && existing.user_id !== user.id) return c.json({ error: "forbidden" }, 403)
  if (existing && existing.updated_at > body.conversation.updatedAt) {
    return c.json({ error: "conflict" }, 409)
  }

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
    ).bind(...chunk.flatMap((m) => [m.id, id, m.seq, JSON.stringify(m)]))
    stmts.push(stmt)
  }
  await c.env.DB.batch(stmts)
  return c.json({ ok: true })
})

sync.delete("/chats/:id", async (c) => {
  const user = c.get("user")
  const id = c.req.param("id")
  const ts = Date.now()
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE conversations SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    ).bind(ts, ts, id, user.id),
    c.env.DB.prepare("DELETE FROM messages WHERE conv_id = ?").bind(id),
  ])
  return c.json({ ok: true })
})

export default sync
