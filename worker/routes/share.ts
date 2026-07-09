import { Hono } from "hono"
import type { AppEnv } from "../types"
import { randomToken } from "../lib/crypto"
import { requireAuth } from "../middleware/require-auth"

// Public, read-only chat shares. Creating/revoking needs auth; reading a
// snapshot by token is public (that's the point). The client sends an already
// stripped snapshot (title + text messages only) — we store it verbatim and
// never expose which user owns which token.
const share = new Hono<AppEnv>()

const MAX_SNAPSHOT_BYTES = 1024 * 1024

interface ShareSnapshot {
  title: string
  messages: { role: string; content: string; model?: string }[]
}

// Public read — no auth. Registered before the auth guard.
share.get("/:token", async (c) => {
  const token = c.req.param("token")
  const row = await c.env.DB.prepare("SELECT snapshot_json, created_at FROM shares WHERE token = ?")
    .bind(token)
    .first<{ snapshot_json: string; created_at: number }>()
  if (!row) return c.json({ error: "not_found" }, 404)
  return c.json({ snapshot: JSON.parse(row.snapshot_json), createdAt: row.created_at })
})

share.use("*", requireAuth)

share.post("/", async (c) => {
  const user = c.get("user")
  const raw = await c.req.text()
  if (raw.length > MAX_SNAPSHOT_BYTES) return c.json({ error: "too_large" }, 413)
  const body = JSON.parse(raw) as { convId: string; snapshot: ShareSnapshot }
  if (!body.convId || !body.snapshot || !Array.isArray(body.snapshot.messages)) {
    return c.json({ error: "bad_request" }, 400)
  }
  // Reuse an existing token for this conversation so re-sharing updates in place.
  const existing = await c.env.DB.prepare(
    "SELECT token FROM shares WHERE user_id = ? AND conv_id = ?"
  )
    .bind(user.id, body.convId)
    .first<{ token: string }>()
  const token = existing?.token ?? randomToken(16)
  await c.env.DB.prepare(
    `INSERT INTO shares (token, user_id, conv_id, snapshot_json, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET snapshot_json = excluded.snapshot_json, created_at = excluded.created_at`
  )
    .bind(token, user.id, body.convId, JSON.stringify(body.snapshot), Date.now())
    .run()
  return c.json({ token })
})

share.delete("/:token", async (c) => {
  const user = c.get("user")
  await c.env.DB.prepare("DELETE FROM shares WHERE token = ? AND user_id = ?")
    .bind(c.req.param("token"), user.id)
    .run()
  return c.json({ ok: true })
})

export default share
