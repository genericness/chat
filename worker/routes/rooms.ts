import { Hono } from "hono"
import type { Context } from "hono"
import type { AppEnv } from "../types"
import { randomToken } from "../lib/crypto"
import { getSessionUserId } from "../lib/cookies"
import { getUserById, type UserRow } from "../lib/db"
import { requireAuth } from "../middleware/require-auth"

// Group chat rooms / projects. Creating/closing/inviting needs auth; the
// WebSocket accepts members (signed in + allowed) and guests (a display name)
// when the room allows it. The model call is made by the host's browser — this
// worker only routes to the room's Durable Object. No API key ever touches it.
const rooms = new Hono<AppEnv>()

interface RoomRow {
  host_user_id: number
  title: string
  join_mode: string
  closed_at: number | null
}

const GH_LOGIN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/

function loadRoom(c: { env: AppEnv["Bindings"] }, token: string): Promise<RoomRow | null> {
  return c.env.DB.prepare(
    "SELECT host_user_id, title, join_mode, closed_at FROM rooms WHERE token = ?"
  )
    .bind(token)
    .first<RoomRow>()
}

async function isMember(env: AppEnv["Bindings"], token: string, login: string): Promise<boolean> {
  const m = await env.DB.prepare("SELECT 1 FROM room_members WHERE token = ? AND login = ?")
    .bind(token, login)
    .first()
  return !!m
}

/** A signed-in user may join a room if they host it, it's link-open, or they're invited. */
async function memberAllowed(
  env: AppEnv["Bindings"],
  room: RoomRow,
  token: string,
  user: UserRow
): Promise<boolean> {
  if (user.id === room.host_user_id) return true
  if (room.join_mode === "guests") return true
  return isMember(env, token, user.login)
}

// List the rooms the signed-in user hosts or is invited to.
rooms.get("/", requireAuth, async (c) => {
  const user = c.get("user")
  const rows = await c.env.DB.prepare(
    `SELECT token, title, join_mode, host_user_id FROM rooms
     WHERE closed_at IS NULL
       AND (host_user_id = ?1 OR token IN (SELECT token FROM room_members WHERE login = ?2))
     ORDER BY created_at DESC`
  )
    .bind(user.id, user.login)
    .all<{ token: string; title: string; join_mode: string; host_user_id: number }>()
  return c.json({
    rooms: rows.results.map((r) => ({
      token: r.token,
      title: r.title,
      joinMode: r.join_mode,
      isHost: r.host_user_id === user.id,
    })),
  })
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

// Public-ish room info for the join screen, incl. whether the caller may join.
rooms.get("/:token", async (c) => {
  const token = c.req.param("token")
  const room = await loadRoom(c, token)
  if (!room || room.closed_at !== null) return c.json({ error: "not_found" }, 404)

  let isHost = false
  let member = false
  const uid = await getSessionUserId(c)
  if (uid) {
    const user = await getUserById(c.env.DB, uid)
    if (user) {
      isHost = user.id === room.host_user_id
      member = await memberAllowed(c.env, room, token, user)
    }
  }
  return c.json({ title: room.title, joinMode: room.join_mode, isHost, member })
})

// WebSocket join. Auth by cookie or ?token= (WebSockets can't set headers).
rooms.get("/:token/ws", async (c) => {
  if (c.req.header("upgrade") !== "websocket") {
    return c.json({ error: "expected_websocket" }, 426)
  }
  const token = c.req.param("token")
  const room = await loadRoom(c, token)
  if (!room || room.closed_at !== null) return c.json({ error: "not_found" }, 404)

  const uid = await getSessionUserId(c)
  let identity: { uid: string; name: string; kind: "member" | "guest"; host: boolean }
  if (uid) {
    const user = await getUserById(c.env.DB, uid)
    if (!user) return c.json({ error: "unauthorized" }, 401)
    if (!(await memberAllowed(c.env, room, token, user))) {
      return c.json({ error: "not_invited" }, 403)
    }
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

// --- host-only room management ---

type HostCheck =
  | { ok: false; res: Response }
  | { ok: true; token: string; room: RoomRow }

async function requireHost(c: Context<AppEnv>): Promise<HostCheck> {
  const user = c.get("user")
  const token = c.req.param("token")
  if (!token) return { ok: false, res: c.json({ error: "not_found" }, 404) }
  const room = await loadRoom(c, token)
  if (!room || room.closed_at !== null) return { ok: false, res: c.json({ error: "not_found" }, 404) }
  if (room.host_user_id !== user.id) return { ok: false, res: c.json({ error: "forbidden" }, 403) }
  return { ok: true, token, room }
}

rooms.get("/:token/members", requireAuth, async (c) => {
  const h = await requireHost(c)
  if (!h.ok) return h.res
  const rows = await c.env.DB.prepare(
    "SELECT login FROM room_members WHERE token = ? ORDER BY added_at"
  )
    .bind(h.token)
    .all<{ login: string }>()
  return c.json({ members: rows.results.map((r) => r.login), joinMode: h.room.join_mode })
})

rooms.post("/:token/members", requireAuth, async (c) => {
  const h = await requireHost(c)
  if (!h.ok) return h.res
  const body = (await c.req.json().catch(() => ({}))) as { login?: string }
  const login = String(body.login ?? "").trim().toLowerCase().replace(/^@/, "")
  if (!GH_LOGIN.test(login)) return c.json({ error: "bad_login" }, 400)
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO room_members (token, login, added_at) VALUES (?, ?, ?)"
  )
    .bind(h.token, login, Date.now())
    .run()
  return c.json({ ok: true, login })
})

rooms.delete("/:token/members/:login", requireAuth, async (c) => {
  const h = await requireHost(c)
  if (!h.ok) return h.res
  await c.env.DB.prepare("DELETE FROM room_members WHERE token = ? AND login = ?")
    .bind(h.token, c.req.param("login").toLowerCase())
    .run()
  return c.json({ ok: true })
})

// Change who can join (link-open vs invite-only) or the title.
rooms.patch("/:token", requireAuth, async (c) => {
  const h = await requireHost(c)
  if (!h.ok) return h.res
  const body = (await c.req.json().catch(() => ({}))) as { joinMode?: string; title?: string }
  const joinMode = body.joinMode === "members" ? "members" : body.joinMode === "guests" ? "guests" : null
  const title = body.title?.trim().slice(0, 80)
  if (joinMode) {
    await c.env.DB.prepare("UPDATE rooms SET join_mode = ? WHERE token = ?").bind(joinMode, h.token).run()
  }
  if (title) {
    await c.env.DB.prepare("UPDATE rooms SET title = ? WHERE token = ?").bind(title, h.token).run()
  }
  return c.json({ ok: true })
})

rooms.delete("/:token", requireAuth, async (c) => {
  const h = await requireHost(c)
  if (!h.ok) return h.res
  await c.env.DB.prepare("UPDATE rooms SET closed_at = ? WHERE token = ?")
    .bind(Date.now(), h.token)
    .run()
  const stub = c.env.ROOM.get(c.env.ROOM.idFromName(h.token))
  await stub.closeRoom()
  return c.json({ ok: true })
})

export default rooms
