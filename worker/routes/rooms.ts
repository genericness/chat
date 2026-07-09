import { Hono } from "hono"
import type { AppEnv } from "../types"
import { randomToken } from "../lib/crypto"
import { getSessionUserId } from "../lib/cookies"
import { getUserById } from "../lib/db"
import { requireAuth } from "../middleware/require-auth"

// Group chat rooms. Creating/closing needs auth; the WebSocket accepts members
// (signed in) always and guests (a display name) when the room allows it. The
// actual model call is made by the host's browser — this worker only routes to
// the room's Durable Object, which relays messages. No API key ever touches it.
const rooms = new Hono<AppEnv>()

interface RoomRow {
  host_user_id: number
  title: string
  join_mode: string
  closed_at: number | null
}

// Public: minimal room info for the join screen.
rooms.get("/:token", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT host_user_id, title, join_mode, closed_at FROM rooms WHERE token = ?"
  )
    .bind(c.req.param("token"))
    .first<RoomRow>()
  if (!row || row.closed_at !== null) return c.json({ error: "not_found" }, 404)
  return c.json({ title: row.title, joinMode: row.join_mode })
})

// WebSocket join. Auth is by cookie or ?token= (native has no cookie on WS).
rooms.get("/:token/ws", async (c) => {
  if (c.req.header("upgrade") !== "websocket") {
    return c.json({ error: "expected_websocket" }, 426)
  }
  const token = c.req.param("token")
  const room = await c.env.DB.prepare(
    "SELECT host_user_id, title, join_mode, closed_at FROM rooms WHERE token = ?"
  )
    .bind(token)
    .first<RoomRow>()
  if (!room || room.closed_at !== null) return c.json({ error: "not_found" }, 404)

  const uid = await getSessionUserId(c)
  let identity: { uid: string; name: string; kind: "member" | "guest"; host: boolean }
  if (uid) {
    const user = await getUserById(c.env.DB, uid)
    if (!user) return c.json({ error: "unauthorized" }, 401)
    identity = {
      uid: `user-${user.id}`,
      name: user.name || user.login,
      kind: "member",
      host: user.id === room.host_user_id,
    }
  } else {
    if (room.join_mode !== "guests") return c.json({ error: "login_required" }, 401)
    const name = (c.req.query("name") ?? "Guest").trim().slice(0, 40) || "Guest"
    identity = { uid: `guest-${randomToken(8)}`, name, kind: "guest", host: false }
  }

  const headers = new Headers(c.req.raw.headers)
  headers.set("x-room-uid", identity.uid)
  headers.set("x-room-name", identity.name)
  headers.set("x-room-kind", identity.kind)
  headers.set("x-room-host", identity.host ? "1" : "0")
  const fwd = new Request(c.req.url, { method: "GET", headers })

  const stub = c.env.ROOM.get(c.env.ROOM.idFromName(token))
  return stub.fetch(fwd)
})

rooms.post("/", requireAuth, async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as { title?: string; joinMode?: string }
  const title = (body.title ?? "Group chat").trim().slice(0, 80) || "Group chat"
  const joinMode = body.joinMode === "members" ? "members" : "guests"
  const token = randomToken(12)
  await c.env.DB.prepare(
    "INSERT INTO rooms (token, host_user_id, title, join_mode, created_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(token, user.id, title, joinMode, Date.now())
    .run()
  return c.json({ token, title, joinMode })
})

rooms.delete("/:token", requireAuth, async (c) => {
  const user = c.get("user")
  const token = c.req.param("token")
  const res = await c.env.DB.prepare(
    "UPDATE rooms SET closed_at = ? WHERE token = ? AND host_user_id = ? AND closed_at IS NULL"
  )
    .bind(Date.now(), token, user.id)
    .run()
  if (res.meta.changes) {
    const stub = c.env.ROOM.get(c.env.ROOM.idFromName(token))
    await stub.closeRoom()
  }
  return c.json({ ok: true })
})

export default rooms
